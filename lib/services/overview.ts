import "server-only";
import { overrideStats, repeatedOverrides } from "@/lib/metrics";
import { compareIsoWeeks, daysBetween, mondayOfIsoWeek, weekWindow } from "@/lib/rules/isoWeek";
import type { RuleParams } from "@/lib/rules/types";
import { toSkuRow, type SkuRow } from "@/lib/skuRow";
import { fetchAll, todayIst, type Db } from "./db";
import { getActiveConfig, getDataFreshness } from "./engineInput";

export interface DataSource {
  key: string;
  name: string;
  system: "SAP" | "Zoho" | "Freshroots";
  method: string;
  status: "ok" | "stale" | "missing" | "not_connected";
  detail: string;
}

export interface LatestRun {
  id: string;
  as_of_date: string;
  run_date: string;
  config_version: number;
  festival: boolean;
  features: Record<string, boolean>;
}

export interface PlanningData {
  params: RuleParams;
  configVersion: number;
  run: LatestRun | null;
  rows: SkuRow[];
  sources: DataSource[];
  /** Total units sold per week across all SKUs, last 16 weeks. */
  demandTrend: { iso_week: string; units: number; festival: boolean }[];
  inventoryAgeDays: number | null;
  /** True when newer data has been uploaded since the latest run. */
  newDataSinceRun: boolean;
  nextCycle: string;
  releasedRecently: number;
}

/** Today if it is a Tuesday or Friday (IST review days), otherwise the next one. */
export function nextCycleDate(today: string): string {
  const base = new Date(`${today}T00:00:00Z`).getTime();
  for (let i = 0; i < 7; i++) {
    const d = new Date(base + i * 86_400_000);
    if (d.getUTCDay() === 2 || d.getUTCDay() === 5) return d.toISOString().slice(0, 10);
  }
  return today;
}

export async function loadPlanning(db: Db): Promise<PlanningData> {
  const today = todayIst();
  const [config, fresh] = await Promise.all([getActiveConfig(db), getDataFreshness(db)]);
  const windows = {
    low: { min: config.params.low_perishability.min_weeks, max: config.params.low_perishability.max_weeks },
    high: { min: config.params.high_perishability.min_weeks, max: config.params.high_perishability.max_weeks },
  };

  const { data: runRow } = await db
    .from("runs")
    .select("id, as_of_date, run_date, config_version, features, created_at")
    .eq("status", "completed")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let rows: SkuRow[] = [];
  if (runRow) {
    const recs = await fetchAll((a, b) => db.from("recommendations").select("*").eq("run_id", runRow.id).order("rank").range(a, b));
    const { data: recentRuns } = await db
      .from("runs")
      .select("id, as_of_date, run_date, status")
      .in("status", ["completed", "superseded"])
      .order("run_date", { ascending: false })
      .limit(5);
    const ids = (recentRuns ?? []).map((r) => r.id);
    const decided = ids.length
      ? await fetchAll((a, b) =>
          db
            .from("recommendations")
            .select("id, run_id, sku_id, sku_name, perishability, status, is_exception, demand_adj")
            .in("run_id", ids)
            .in("status", ["approved", "edited", "rejected"])
            .order("id")
            .range(a, b),
        )
      : [];
    const misfit = new Set(repeatedOverrides(overrideStats(recentRuns ?? [], decided), decided).map((r) => r.sku_id));
    rows = recs.map((r) => toSkuRow(r, windows, misfit.has(r.sku_id)));
  }

  // Demand trend: total units per week over the last 16 weeks of uploaded sales.
  const endWeek = fresh.latestSalesWeek;
  let demandTrend: PlanningData["demandTrend"] = [];
  if (endWeek) {
    const weeks = weekWindow(endWeek, 16);
    const sales = await fetchAll((a, b) =>
      db.from("weekly_sales").select("iso_week, units_sold").gte("iso_week", weeks[0]).lte("iso_week", endWeek).order("iso_week").range(a, b),
    );
    const { data: cal } = await db.from("calendar").select("year_month, is_festival_month");
    const festivalMonths = new Set((cal ?? []).filter((c) => c.is_festival_month).map((c) => c.year_month));
    const totals = new Map<string, number>();
    for (const s of sales) totals.set(s.iso_week, (totals.get(s.iso_week) ?? 0) + s.units_sold);
    demandTrend = weeks.map((w) => ({
      iso_week: w,
      units: totals.get(w) ?? 0,
      festival: festivalMonths.has(mondayOfIsoWeek(w).slice(0, 7)),
    }));
  }

  const inventoryAgeDays = fresh.latestInventoryDate ? daysBetween(fresh.latestInventoryDate, today) : null;
  const [{ count: skuCount }, { count: distCount }, { count: calCount }, { count: poCount }] = await Promise.all([
    db.from("skus").select("sku_id", { count: "exact", head: true }),
    db.from("distributors").select("distributor_id", { count: "exact", head: true }),
    db.from("calendar").select("year_month", { count: "exact", head: true }),
    db.from("open_purchase_orders").select("po_id", { count: "exact", head: true }),
  ]);

  const sources: DataSource[] = [
    {
      key: "weekly_sales",
      name: "Weekly sales",
      system: "SAP",
      method: "CSV export, uploaded here",
      status: endWeek ? "ok" : "missing",
      detail: endWeek ? `Up to week ${Number(endWeek.slice(6))} of ${endWeek.slice(0, 4)}` : "Not uploaded",
    },
    {
      key: "current_inventory",
      name: "Stock on hand",
      system: "SAP",
      method: "CSV export, uploaded here",
      status: inventoryAgeDays == null ? "missing" : inventoryAgeDays > config.params.stale_inventory_days ? "stale" : "ok",
      detail:
        inventoryAgeDays == null
          ? "Not uploaded"
          : `As of ${fresh.latestInventoryDate} · ${inventoryAgeDays === 0 ? "today" : `${inventoryAgeDays} day${inventoryAgeDays === 1 ? "" : "s"} old`}`,
    },
    {
      key: "sku_master",
      name: "SKU master",
      system: "SAP",
      method: "CSV export, uploaded here",
      status: skuCount ? "ok" : "missing",
      detail: skuCount ? `${skuCount} active SKUs` : "Not uploaded",
    },
    {
      key: "distributor_master",
      name: "Distributors",
      system: "SAP",
      method: "CSV export, uploaded here",
      status: distCount ? "ok" : "missing",
      detail: distCount ? `${distCount} distributors` : "Not uploaded",
    },
    {
      key: "calendar",
      name: "Festival calendar",
      system: "Freshroots",
      method: "CSV, uploaded here",
      status: calCount ? "ok" : "missing",
      detail: calCount ? `${calCount} months loaded` : "Not uploaded",
    },
    {
      key: "open_purchase_orders",
      name: "Open purchase orders",
      system: "Zoho",
      method: poCount ? "CSV export, uploaded here" : "Not connected (API access not confirmed)",
      status: poCount ? "ok" : "not_connected",
      detail: poCount ? `${poCount} open POs` : "Stock on order is counted as zero",
    },
  ];

  const newDataSinceRun = Boolean(
    runRow && fresh.latestInventoryDate && fresh.latestInventoryDate > runRow.as_of_date,
  );
  const releasedRecently = rows.filter((r) => r.released_at).length;
  const festival = runRow ? rows.some((r) => r.festival_applied) : false;

  return {
    params: config.params,
    configVersion: config.version,
    run: runRow
      ? {
          id: runRow.id,
          as_of_date: runRow.as_of_date,
          run_date: runRow.run_date,
          config_version: runRow.config_version,
          festival,
          features: (runRow.features ?? {}) as Record<string, boolean>,
        }
      : null,
    rows,
    sources,
    demandTrend: demandTrend.sort((a, b) => compareIsoWeeks(a.iso_week, b.iso_week)),
    inventoryAgeDays,
    newDataSinceRun,
    nextCycle: nextCycleDate(today),
    releasedRecently,
  };
}
