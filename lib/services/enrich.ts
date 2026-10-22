import "server-only";
import {
  AI_MODEL,
  buildExceptionContext,
  defaultClient,
  generateRationale,
  type MessagesClient,
  type OverrideContext,
} from "@/lib/ai/rationale";
import type { Recommendation } from "@/lib/rules/types";
import { env } from "@/lib/env";
import { resolveParams } from "@/lib/rules/config";
import type { RuleParams } from "@/lib/rules/types";
import { startOfMonthIstUtc, type Db } from "./db";

export async function monthlyAiSpendUsd(db: Db, now = new Date()): Promise<number> {
  const { data, error } = await db.from("ai_calls").select("cost_usd").gte("created_at", startOfMonthIstUtc(now));
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((a, r) => a + Number(r.cost_usd), 0);
}

/** Last three planner overrides on a SKU, without notes or identities (those never go to the AI). */
async function lastOverrides(db: Db, skuId: string, beforeRunId: string): Promise<OverrideContext[]> {
  const { data } = await db
    .from("recommendations")
    .select("status, recommended_qty, final_qty, override_reason_code, decided_at, runs!inner(as_of_date)")
    .eq("sku_id", skuId)
    .neq("run_id", beforeRunId)
    .in("status", ["edited", "rejected"])
    .order("decided_at", { ascending: false })
    .limit(3)
    .returns<
      {
        status: "edited" | "rejected";
        recommended_qty: number | null;
        final_qty: number | null;
        override_reason_code: string | null;
        runs: { as_of_date: string };
      }[]
    >();
  return (data ?? []).map((r) => ({
    as_of_date: r.runs.as_of_date,
    status: r.status,
    recommended_qty: r.recommended_qty,
    final_qty: r.final_qty,
    reason_code: r.override_reason_code ?? "other",
  }));
}

/**
 * Add Claude rationales to a run's exceptions. Never throws for AI problems: failed calls leave
 * rationale null ("Rationale unavailable"). Stops calling when the per-run or monthly cap is reached.
 */
export async function enrichRun(db: Db, runId: string, client?: MessagesClient): Promise<{ called: number; failed: number; skipped: number }> {
  const { data: run } = await db.from("runs").select("as_of_date, config_version").eq("id", runId).single();
  if (!run) return { called: 0, failed: 0, skipped: 0 };
  const { data: cfg } = await db.from("rule_config").select("params").eq("version", run.config_version).single();
  const params = resolveParams((cfg?.params ?? null) as Partial<RuleParams> | null);

  const { data: pending } = await db
    .from("recommendations")
    .select("*")
    .eq("run_id", runId)
    .eq("ai_status", "pending")
    .order("rank");
  if (!pending?.length) return { called: 0, failed: 0, skipped: 0 };

  const markSkipped = async (ids: string[]) => {
    if (ids.length) await db.from("recommendations").update({ ai_status: "skipped_cap" }).in("id", ids);
  };

  if (!env.anthropicConfigured()) {
    await markSkipped(pending.map((p) => p.id));
    return { called: 0, failed: 0, skipped: pending.length };
  }

  const ai = client ?? defaultClient();
  const cap = env.aiMonthlyCapUsd();
  let spent = await monthlyAiSpendUsd(db);
  let called = 0;
  let failed = 0;

  const skuIds = pending.map((p) => p.sku_id);
  const { data: skus } = await db.from("skus").select("*").in("sku_id", skuIds);
  const skuById = new Map((skus ?? []).map((s) => [s.sku_id, s]));

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    if (called >= params.max_ai_calls_per_run || spent >= cap) {
      await markSkipped(pending.slice(i).map((p) => p.id));
      return { called, failed, skipped: pending.length - i };
    }
    const sku = skuById.get(row.sku_id);
    if (!sku) continue;
    const rec: Recommendation = {
      sku_id: row.sku_id,
      name: row.sku_name,
      perishability: row.perishability as Recommendation["perishability"],
      distributor_id: row.distributor_id,
      flag: row.flag as Recommendation["flag"],
      flags: row.flags as Recommendation["flags"],
      rules_fired: row.rules_fired as unknown as Recommendation["rules_fired"],
      weeks_cover: row.weeks_cover == null ? null : Number(row.weeks_cover),
      trend_pct: row.trend_pct == null ? null : Number(row.trend_pct),
      avg12: row.avg12 == null ? null : Number(row.avg12),
      avg4: null,
      demand_adj: row.demand_adj == null ? null : Number(row.demand_adj),
      units_on_hand: row.units_on_hand ?? 0,
      on_order_units: row.on_order_units ?? 0,
      festival_applied: row.festival_applied,
      recommended_action: row.recommended_action as Recommendation["recommended_action"],
      recommended_qty: row.recommended_qty,
      is_exception: row.is_exception,
      exception_reasons: row.exception_reasons as Recommendation["exception_reasons"],
      missing_weeks: [],
      rupee_exposure: row.rupee_exposure == null ? null : Number(row.rupee_exposure),
      recent_sales: row.recent_sales as unknown as Recommendation["recent_sales"],
    };
    const recentUnits = rec.recent_sales.slice(-params.trend_window_weeks).map((s) => s.units).filter((u): u is number => u != null);
    rec.avg4 = recentUnits.length ? recentUnits.reduce((a, b) => a + b, 0) / recentUnits.length : null;
    rec.missing_weeks = rec.recent_sales.slice(-params.avg_window_weeks).filter((s) => s.units == null).map((s) => s.iso_week);

    const overrides = await lastOverrides(db, row.sku_id, runId);
    const context = buildExceptionContext(
      rec,
      {
        sku_id: sku.sku_id,
        name: sku.name,
        category: sku.category,
        perishability: sku.perishability as "high" | "low",
        standard_reorder_qty: sku.standard_reorder_qty,
        distributor_id: sku.distributor_id,
        lead_time_days: sku.lead_time_days,
        launch_date: sku.launch_date,
      },
      run.as_of_date,
      overrides,
    );
    const result = await generateRationale(ai, context);
    called++;
    for (const a of result.attempts) {
      spent += a.cost_usd;
      await db.from("ai_calls").insert({
        run_id: runId,
        recommendation_id: row.id,
        model: AI_MODEL,
        input_tokens: a.input_tokens,
        output_tokens: a.output_tokens,
        cost_usd: a.cost_usd,
        ok: a.ok,
        error: a.error,
      });
    }
    if (result.rationale) {
      await db
        .from("recommendations")
        .update({ rationale: result.rationale.rationale, check_first: result.rationale.check_first, ai_status: "ok" })
        .eq("id", row.id);
    } else {
      failed++;
      await db.from("recommendations").update({ rationale: null, check_first: null, ai_status: "failed" }).eq("id", row.id);
    }
  }
  return { called, failed, skipped: 0 };
}
