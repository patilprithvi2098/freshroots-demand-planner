import "server-only";
// Loop 1 (outcome loop): Capture → Store, and Retrieve. Runs after sales, stock or write-off uploads and from
// the daily cron. Idempotent: an outcome is recomputed until its data is complete, then upserted.

import { computeOutcome, driverOf, type DecisionForOutcome, type Outcome, type PastOutcome } from "@/lib/outcomes";
import { resolveParams } from "@/lib/rules/config";
import { addIsoWeeks, lastCompleteWeek } from "@/lib/rules/isoWeek";
import type { RuleParams } from "@/lib/rules/types";
import type { Json } from "@/lib/supabase/database.types";
import { fetchAll, type Db } from "./db";

export interface MeasureResult {
  measured: number;
  waiting: number;
}

export async function measureOutcomes(db: Db): Promise<MeasureResult> {
  const runs = await fetchAll((a, b) =>
    db.from("runs").select("id, as_of_date, config_version").eq("status", "completed").order("as_of_date").range(a, b),
  );
  if (runs.length === 0) return { measured: 0, waiting: 0 };

  const { data: latest } = await db.from("weekly_sales").select("iso_week").order("iso_week", { ascending: false }).limit(1).maybeSingle();
  const latestSalesWeek = latest?.iso_week ?? null;

  const versions = [...new Set(runs.map((r) => r.config_version))];
  const { data: cfgs } = await db.from("rule_config").select("version, params").in("version", versions);
  const paramsByVersion = new Map((cfgs ?? []).map((c) => [c.version, resolveParams(c.params as Partial<RuleParams>)]));

  const recs = await fetchAll((a, b) =>
    db
      .from("recommendations")
      .select("id, run_id, sku_id, perishability, avg12, status")
      .in(
        "run_id",
        runs.map((r) => r.id),
      )
      .order("id")
      .range(a, b),
  );

  const firstAsOf = runs[0].as_of_date;
  const fromWeek = addIsoWeeks(lastCompleteWeek(firstAsOf), 1);
  const [sales, inventory, writeOffCount] = await Promise.all([
    fetchAll((a, b) => db.from("weekly_sales").select("sku_id, iso_week, units_sold").gte("iso_week", fromWeek).order("id").range(a, b)),
    fetchAll((a, b) =>
      db.from("inventory_snapshots").select("sku_id, location, units_on_hand, as_of_date").gt("as_of_date", firstAsOf).order("id").range(a, b),
    ),
    db.from("write_offs").select("id", { count: "exact", head: true }),
  ]);
  const writeOffs = (writeOffCount.count ?? 0) > 0
    ? await fetchAll((a, b) => db.from("write_offs").select("sku_id, iso_week, units").gte("iso_week", fromWeek).order("id").range(a, b))
    : null;

  const runById = new Map(runs.map((r) => [r.id, r]));
  const later = { weeklySales: sales, inventory, writeOffs, latestSalesWeek };
  const done: Outcome[] = [];
  let waiting = 0;
  for (const r of recs) {
    const run = runById.get(r.run_id);
    if (!run) continue;
    const p = paramsByVersion.get(run.config_version) ?? resolveParams(null);
    const w = r.perishability === "high" ? p.high_perishability : p.low_perishability;
    const decision: DecisionForOutcome = {
      recommendation_id: r.id,
      sku_id: r.sku_id,
      as_of_date: run.as_of_date,
      window: { min: w.min_weeks, max: w.max_weeks },
      avg12: r.avg12 == null ? null : Number(r.avg12),
      status: r.status,
    };
    const o = computeOutcome(decision, later);
    if (o) done.push(o);
    else waiting++;
  }

  for (let i = 0; i < done.length; i += 500) {
    const { error } = await db.from("outcomes").upsert(
      done.slice(i, i + 500).map((o) => ({
        recommendation_id: o.recommendation_id,
        measured_at: o.measured_at,
        horizon_start_week: o.horizon_start_week,
        horizon_end_week: o.horizon_end_week,
        stockout_weeks: o.stockout_weeks,
        stock_after_4_weeks: o.stock_after_4_weeks,
        written_off_units: o.written_off_units,
        result: o.result,
        driver: o.driver,
        evidence: o.evidence as unknown as Json,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "recommendation_id" },
    );
    if (error) throw new Error(`outcomes: ${error.message}`);
  }
  return { measured: done.length, waiting };
}

/** Retrieve: the last `limit` measured outcomes per SKU, newest first. */
export async function outcomeHistory(db: Db, skuIds: string[], limit = 3): Promise<Map<string, PastOutcome[]>> {
  const out = new Map<string, PastOutcome[]>();
  if (skuIds.length === 0) return out;
  const rows = await fetchAll((a, b) =>
    db
      .from("outcomes")
      .select("result, driver, stockout_weeks, written_off_units, evidence, measured_at, recommendations!inner(sku_id, status, recommended_qty, final_qty, runs!inner(as_of_date))")
      .in("recommendations.sku_id", skuIds)
      .not("result", "is", null)
      .order("measured_at", { ascending: false })
      .range(a, b)
      .returns<
        {
          result: string;
          driver: string;
          stockout_weeks: number;
          written_off_units: number | null;
          evidence: Json;
          measured_at: string;
          recommendations: { sku_id: string; status: string; recommended_qty: number | null; final_qty: number | null; runs: { as_of_date: string } };
        }[]
      >(),
  );
  for (const r of rows) {
    const list = out.get(r.recommendations.sku_id) ?? [];
    if (list.length >= limit) continue;
    list.push({
      as_of_date: r.recommendations.runs.as_of_date,
      result: r.result,
      // Derived from the decision as it stands now: Raghav may decide after the outcome was first measured.
      driver: driverOf(r.recommendations.status),
      recommended_qty: r.recommendations.recommended_qty,
      final_qty: r.recommendations.final_qty,
      stockout_weeks: r.stockout_weeks,
      written_off_units: r.written_off_units,
      summary: ((r.evidence as string[] | null) ?? [])[0] ?? "",
    });
    out.set(r.recommendations.sku_id, list);
  }
  return out;
}
