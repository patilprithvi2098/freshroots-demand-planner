// Finding 1 fixed: the backtest only counts POs that were open in each replayed week, so with PO
// history it agrees with a time-correct replay instead of under-reporting planner agreement.
import { describe, expect, it } from "vitest";
import { runBacktest, type HistoricalDecision } from "@/lib/rules/backtest";
import { loadStress, saveResult } from "./harness";

describe("fixed (finding 1): backtest with dated PO history", () => {
  it("agreement with the planner is close to the time-correct 80.6%, not the 54.8% without POs", () => {
    const L = loadStress();
    const inventory = [...L.inventoryByDate.values()].flat();
    const planner = (sku: string, week: string) => (L.ds.series[sku].ordered[L.ds.weeks.indexOf(week)] > 0 ? "reorder_now" : "no_action");
    const decisions: HistoricalDecision[] = L.ds.truth.flatMap((t) =>
      L.ds.testWeeks.map((w) => ({ sku_id: t.sku_id, iso_week: w, action: planner(t.sku_id, w) }) as HistoricalDecision),
    );
    const withPos = runBacktest({ ...L.base, inventory, openPurchaseOrders: L.csvPoRows }, decisions);
    const without = runBacktest({ ...L.base, inventory, openPurchaseOrders: null }, decisions);
    saveResult("backtest-fixed", { with_dated_pos: withPos.agreement, without_pos: without.agreement });
    console.log(`agreement: with dated POs ${(withPos.agreement.pct! * 100).toFixed(1)}%, without POs ${(without.agreement.pct! * 100).toFixed(1)}%`);
    expect(withPos.agreement.pct!).toBeGreaterThan(0.75);
    expect(withPos.agreement.pct!).toBeGreaterThan(without.agreement.pct! + 0.15);
  }, 180_000);
});
