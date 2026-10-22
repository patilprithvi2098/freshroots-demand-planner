import "server-only";
import { computeMetrics, type DashboardMetrics } from "@/lib/metrics";
import { fetchAll, todayIst, type Db } from "./db";
import { monthlyAiSpendUsd } from "./enrich";

export interface Dashboard extends DashboardMetrics {
  ai_spend_month_usd: number;
  go_live: string | null;
}

/** Aggregates only. The caller has already checked the role. */
export async function loadDashboard(db: Db): Promise<Dashboard> {
  const runs = await fetchAll((a, b) =>
    db.from("runs").select("id, as_of_date, run_date, status").in("status", ["completed", "superseded"]).order("run_date").range(a, b),
  );
  const recs = await fetchAll((a, b) =>
    db
      .from("recommendations")
      .select("id, run_id, sku_id, sku_name, perishability, status, is_exception, demand_adj")
      .order("id")
      .range(a, b),
  );
  const outcomes = await fetchAll((a, b) =>
    db.from("outcomes").select("recommendation_id, measured_at, stockout_weeks, written_off_units").order("id").range(a, b),
  );
  const skus = await fetchAll((a, b) => db.from("skus").select("sku_id, unit_price").order("sku_id").range(a, b));
  const { data: bt } = await db
    .from("backtest_results")
    .select("agreement_pct, run_at")
    .not("agreement_pct", "is", null)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const goLive = runs.length ? runs[0].run_date.slice(0, 10) : null;
  const metrics = computeMetrics({
    runs,
    recs: recs.map((r) => ({ ...r, demand_adj: r.demand_adj == null ? null : Number(r.demand_adj) })),
    outcomes,
    unitPriceBySku: new Map(skus.map((s) => [s.sku_id, s.unit_price == null ? null : Number(s.unit_price)])),
    latestAgreement: bt ? { pct: bt.agreement_pct == null ? null : Number(bt.agreement_pct), run_at: bt.run_at } : null,
    goLiveDate: goLive,
    today: todayIst(),
  });
  return { ...metrics, ai_spend_month_usd: await monthlyAiSpendUsd(db), go_live: goLive };
}
