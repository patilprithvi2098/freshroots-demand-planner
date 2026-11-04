import "server-only";
import { runBacktest, type BacktestResult, type HistoricalDecision } from "@/lib/rules/backtest";
import type { Json } from "@/lib/supabase/database.types";
import { audit, fetchAll, type Db } from "./db";
import { getActiveConfig, loadEngineInput } from "./engineInput";

/** Replay the active rules over all uploaded sales weeks and store the result. */
export async function runAndStoreBacktest(db: Db, actor: string | null): Promise<{ id: string; result: BacktestResult; configVersion: number }> {
  const config = await getActiveConfig(db);
  const { data: latestInv } = await db.from("inventory_snapshots").select("as_of_date").order("as_of_date", { ascending: false }).limit(1).maybeSingle();
  const { data: latestSale } = await db.from("weekly_sales").select("iso_week").order("iso_week", { ascending: false }).limit(1).maybeSingle();
  if (!latestSale) throw new Error("Upload weekly sales first.");
  const asOf = latestInv?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const { asOfDate: _unused, ...base } = await loadEngineInput(db, asOf, config.params, { allSales: true });
  const decisions = await fetchAll((a, b) => db.from("historical_decisions").select("sku_id, iso_week, action").order("id").range(a, b));
  const result = runBacktest(base, decisions as HistoricalDecision[]);
  const { data, error } = await db
    .from("backtest_results")
    .insert({ config_version: config.version, weeks_replayed: result.weeks.length, agreement_pct: result.agreement.pct, detail: result as unknown as Json })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await audit(db, actor, "backtest", "backtest_results", data.id, { weeks: result.weeks.length, agreement: result.agreement, config_version: config.version });
  return { id: data.id, result, configVersion: config.version };
}
