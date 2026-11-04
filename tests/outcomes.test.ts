import { describe, expect, it } from "vitest";
import { computeOutcome, hitRates, type DecisionForOutcome, type LaterData } from "@/lib/outcomes";

// Run as of Monday 2026-10-19 → last complete week 2026-W42 → outcome weeks W43–W46 (ends Sunday 2026-11-15).
const decision: DecisionForOutcome = {
  recommendation_id: "r1",
  sku_id: "SKU001",
  as_of_date: "2026-10-19",
  window: { min: 6, max: 14 },
  avg12: 200,
  status: "approved",
};

const weeks = ["2026-W43", "2026-W44", "2026-W45", "2026-W46"];
const sales = (units: number[]) => weeks.map((iso_week, i) => ({ sku_id: "SKU001", iso_week, units_sold: units[i] }));
const later = (over: Partial<LaterData> = {}): LaterData => ({
  weeklySales: sales([200, 200, 200, 200]),
  inventory: [{ sku_id: "SKU001", location: "Pune", units_on_hand: 1200, as_of_date: "2026-11-15" }],
  writeOffs: null,
  latestSalesWeek: "2026-W46",
  ...over,
});

describe("outcome loop: computeOutcome", () => {
  it("waits until all four weeks of sales are uploaded", () => {
    expect(computeOutcome(decision, later({ latestSalesWeek: "2026-W45" }))).toBeNull();
    expect(computeOutcome(decision, later({ latestSalesWeek: null }))).toBeNull();
  });

  it("healthy four weeks is ok, attributed to the rule when approved", () => {
    const o = computeOutcome(decision, later())!;
    expect(o).toMatchObject({
      horizon_start_week: "2026-W43",
      horizon_end_week: "2026-W46",
      measured_at: "2026-11-15",
      stockout_weeks: 0,
      stock_after_4_weeks: 1200,
      written_off_units: null,
      result: "ok",
      driver: "rule",
    });
  });

  it("a zero stock snapshot is a stock-out week", () => {
    const o = computeOutcome(decision, later({ inventory: [{ sku_id: "SKU001", units_on_hand: 0, as_of_date: "2026-10-28" }, { sku_id: "SKU001", units_on_hand: 900, as_of_date: "2026-11-13" }] }))!;
    expect(o.result).toBe("stocked_out");
    expect(o.stockout_weeks).toBe(1);
    expect(o.evidence[0]).toBe("Stock hit zero in 2026-W44.");
    expect(o.stock_after_4_weeks).toBe(900);
  });

  it("without a snapshot that week, sales collapsing below 10% of usual counts as a probable stock-out", () => {
    const o = computeOutcome(decision, later({ weeklySales: sales([200, 5, 0, 180]), inventory: [] }))!;
    expect(o.stockout_weeks).toBe(2);
    expect(o.result).toBe("stocked_out");
    expect(o.stock_after_4_weeks).toBeNull();
  });

  it("write-offs are summed over the four weeks; unknown (null) without a write-off file", () => {
    const o = computeOutcome(decision, later({ writeOffs: [{ sku_id: "SKU001", iso_week: "2026-W45", units: 30 }, { sku_id: "SKU001", iso_week: "2026-W50", units: 99 }] }))!;
    expect(o.written_off_units).toBe(30);
    expect(o.result).toBe("wrote_off");
    expect(computeOutcome(decision, later({ writeOffs: [] }))!.written_off_units).toBe(0);
  });

  it("stock left above the maximum cover at the rate it actually sold is overstocked", () => {
    const o = computeOutcome(decision, later({ weeklySales: sales([100, 100, 100, 100]), inventory: [{ sku_id: "SKU001", units_on_hand: 2000, as_of_date: "2026-11-15" }] }))!;
    expect(o.result).toBe("overstocked");
    expect(o.evidence[0]).toMatch(/20\.0 weeks at the rate it sold, above the 14-week maximum/);
  });

  it("ignores stock snapshots from before the decision", () => {
    const o = computeOutcome(decision, later({ inventory: [{ sku_id: "SKU001", units_on_hand: 0, as_of_date: "2026-10-12" }] }))!;
    expect(o.stockout_weeks).toBe(0);
    expect(o.stock_after_4_weeks).toBeNull();
  });

  it("attributes changed or rejected lines to the override", () => {
    expect(computeOutcome({ ...decision, status: "edited" }, later())!.driver).toBe("override");
    expect(computeOutcome({ ...decision, status: "rejected" }, later())!.driver).toBe("override");
    expect(computeOutcome({ ...decision, status: "pending" }, later())!.driver).toBe("undecided");
  });
});

describe("outcome loop: measurement", () => {
  it("hit rates for the rule and for overrides", () => {
    const r = hitRates([
      { result: "ok", driver: "rule" },
      { result: "stocked_out", driver: "rule" },
      { result: "ok", driver: "override" },
      { result: "ok", driver: "undecided" },
    ]);
    expect(r.rule).toEqual({ n: 2, ok: 1, rate: 0.5 });
    expect(r.override).toEqual({ n: 1, ok: 1, rate: 1 });
    expect(r.decisions).toBe(4);
  });
});
