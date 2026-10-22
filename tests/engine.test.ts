import { describe, expect, it } from "vitest";
import { runEngine } from "@/lib/rules/engine";
import { DEFAULT_PARAMS } from "@/lib/rules/config";
import { addIsoWeeks, isValidIsoWeek, lastCompleteWeek, weeksInIsoYear } from "@/lib/rules/isoWeek";
import type { EngineInput, SkuInput, WeeklySaleInput } from "@/lib/rules/types";

const AS_OF = "2026-10-19"; // Monday of 2026-W43, last complete week 2026-W42
const END = "2026-W42";

function sku(over: Partial<SkuInput> = {}): SkuInput {
  return { sku_id: "T1", name: "Test", perishability: "low", standard_reorder_qty: 100, distributor_id: "D1", ...over };
}

/** units[i] is the week (n-1-i) weeks before END; null leaves the week out. */
function sales(units: (number | null)[], id = "T1", dist: string | null = null): WeeklySaleInput[] {
  const n = units.length;
  return units.flatMap((u, i) =>
    u == null ? [] : [{ sku_id: id, iso_week: addIsoWeeks(END, i - (n - 1)), units_sold: u, distributor_id: dist }],
  );
}

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    asOfDate: AS_OF,
    skus: [sku()],
    weeklySales: sales(Array(16).fill(100)),
    inventory: [{ sku_id: "T1", location: "W", units_on_hand: 1000, as_of_date: AS_OF }],
    openPurchaseOrders: null,
    festivalMonths: [],
    params: DEFAULT_PARAMS,
    ...over,
  };
}

const one = (i: EngineInput) => runEngine(i).recommendations[0];

describe("ISO weeks", () => {
  it("supports 53-week years", () => {
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2025)).toBe(52);
    expect(isValidIsoWeek("2026-W53")).toBe(true);
    expect(isValidIsoWeek("2025-W53")).toBe(false);
    expect(addIsoWeeks("2026-W53", 1)).toBe("2027-W01");
    expect(addIsoWeeks("2027-W01", -1)).toBe("2026-W53");
  });
  it("uses the last complete week on the as-of date", () => {
    expect(lastCompleteWeek("2026-10-19")).toBe("2026-W42");
    expect(lastCompleteWeek("2026-10-25")).toBe("2026-W43"); // Sunday closes W43
  });
  it("rejects malformed weeks", () => {
    expect(isValidIsoWeek("2026-42")).toBe(false);
    expect(isValidIsoWeek("2026-W00")).toBe(false);
  });
});

describe("rules engine edge cases", () => {
  it("no action when cover is inside the window", () => {
    const r = one(input());
    expect(r.flag).toBe("no_action");
    expect(r.weeks_cover).toBe(10);
  });

  it("insufficient history (< 12 weeks) is an exception and skips the rules", () => {
    const r = one(input({ weeklySales: sales(Array(11).fill(100)) }));
    expect(r.exception_reasons).toEqual(["insufficient_history"]);
    expect(r.recommended_action).toBe("manual_review");
    expect(r.recommended_qty).toBeNull();
    expect(r.weeks_cover).toBeNull();
  });

  it("new launch within 8 weeks is an exception", () => {
    const r = one(input({ skus: [sku({ launch_date: "2026-09-01" })] }));
    expect(r.exception_reasons).toEqual(["new_launch"]);
  });

  it("launch older than 8 weeks is evaluated normally", () => {
    const r = one(input({ skus: [sku({ launch_date: "2026-01-01" })] }));
    expect(r.is_exception).toBe(false);
  });

  it("dead stock: zero sales with stock on hand", () => {
    const r = one(input({ weeklySales: sales(Array(16).fill(0)) }));
    expect(r.exception_reasons).toEqual(["dead_stock"]);
    expect(r.recommended_qty).toBe(0);
  });

  it("zero sales and zero stock: no action, not an exception", () => {
    const r = one(
      input({
        weeklySales: sales(Array(16).fill(0)),
        inventory: [{ sku_id: "T1", location: "W", units_on_hand: 0, as_of_date: AS_OF }],
      }),
    );
    expect(r.flag).toBe("no_action");
    expect(r.is_exception).toBe(false);
  });

  it("more than 2 missing weeks in the last 12 is data_gaps; averages are not zero-filled", () => {
    const units: (number | null)[] = Array(16).fill(100);
    units[13] = null;
    units[14] = null;
    units[10] = null;
    const r = one(input({ weeklySales: sales(units) }));
    expect(r.exception_reasons).toContain("data_gaps");
    expect(r.avg12).toBe(100);
    expect(r.missing_weeks).toHaveLength(3);
  });

  it("2 missing weeks is not data_gaps", () => {
    const units: (number | null)[] = Array(16).fill(100);
    units[13] = null;
    units[14] = null;
    expect(one(input({ weeklySales: sales(units) })).is_exception).toBe(false);
  });

  it("overstock plus high demand is conflicting_signals and not auto-resolved", () => {
    const r = one(
      input({
        weeklySales: sales([...Array(12).fill(100), 150, 150, 150, 150]),
        inventory: [{ sku_id: "T1", location: "W", units_on_hand: 5000, as_of_date: AS_OF }],
      }),
    );
    expect(r.flags).toEqual(["overstock_risk", "high_demand"]);
    expect(r.exception_reasons).toContain("conflicting_signals");
  });

  it("high demand alone reorders at 1.5x", () => {
    const r = one(input({ weeklySales: sales([...Array(12).fill(100), 150, 150, 150, 150]) }));
    expect(r.flag).toBe("high_demand");
    expect(r.recommended_qty).toBe(150);
  });

  it("festival uplift applies 25% to cover but never to the trend", () => {
    const r = one(input({ festivalMonths: ["2026-10"] }));
    expect(r.demand_adj).toBe(125);
    expect(r.weeks_cover).toBe(8);
    expect(r.trend_pct).toBe(0);
  });

  it("open POs add to cover", () => {
    const r = one(
      input({
        inventory: [{ sku_id: "T1", location: "W", units_on_hand: 300, as_of_date: AS_OF }],
        openPurchaseOrders: [{ sku_id: "T1", qty: 400, status: "open" }, { sku_id: "T1", qty: 999, status: "received" }],
      }),
    );
    expect(r.on_order_units).toBe(400);
    expect(r.weeks_cover).toBe(7);
    expect(r.flag).toBe("no_action");
  });

  it("caps quantity at 3x standard when a multiplier is configured high", () => {
    const r = one(
      input({
        params: { ...DEFAULT_PARAMS, trend_reorder_multiplier: 3, max_qty_multiple: 2 },
        weeklySales: sales([...Array(12).fill(100), 200, 200, 200, 200]),
      }),
    );
    expect(r.recommended_qty).toBe(200);
  });

  it("distributor share shift above 15pp is an exception", () => {
    const d1 = sales([...Array(12).fill(80), 40, 40, 40, 40], "T1", "D1");
    const d2 = sales([...Array(12).fill(20), 60, 60, 60, 60], "T1", "D2");
    const r = one(input({ weeklySales: [...d1, ...d2] }));
    expect(r.exception_reasons).toContain("distributor_shift");
    expect(runEngine(input({ weeklySales: [...d1, ...d2] })).features.distributor_sales).toBe(true);
  });

  it("sums inventory across locations", () => {
    const r = one(
      input({
        inventory: [
          { sku_id: "T1", location: "A", units_on_hand: 200, as_of_date: AS_OF },
          { sku_id: "T1", location: "B", units_on_hand: 300, as_of_date: AS_OF },
        ],
      }),
    );
    expect(r.units_on_hand).toBe(500);
    expect(r.flag).toBe("stockout_risk");
  });

  it("skips SKU mismatches and lists them", () => {
    const res = runEngine(input({ weeklySales: [...sales(Array(16).fill(100)), ...sales(Array(16).fill(5), "GHOST")] }));
    expect(res.skipped).toEqual([{ sku_id: "GHOST", reason: "In sales data but not in the SKU master" }]);
  });

  it("ranks by rupee exposure when unit price exists", () => {
    const res = runEngine(
      input({
        skus: [sku({ sku_id: "A", unit_price: 10 }), sku({ sku_id: "B", unit_price: 100 })],
        weeklySales: [...sales(Array(16).fill(100), "A"), ...sales(Array(16).fill(100), "B")],
        inventory: [
          { sku_id: "A", location: "W", units_on_hand: 100, as_of_date: AS_OF },
          { sku_id: "B", location: "W", units_on_hand: 400, as_of_date: AS_OF },
        ],
      }),
    );
    expect(res.recommendations.map((r) => r.sku_id)).toEqual(["B", "A"]);
    expect(res.features.unit_price).toBe(true);
  });

  it("reports features that are off", () => {
    const f = runEngine(input()).features;
    expect(f).toMatchObject({ unit_price: false, open_purchase_orders: false, distributor_sales: false, launch_date: false });
  });
});
