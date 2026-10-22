// Edge and load cases: empty files, a 200,000-row sales file, all-zero sales, 53-week year boundaries,
// a missing calendar, and every optional column absent.

import { describe, expect, it } from "vitest";
import { FILE_TYPES, MAX_UPLOAD_ROWS, parseCsv } from "@/lib/csv/loaders";
import { runBacktest } from "@/lib/rules/backtest";
import { DEFAULT_PARAMS } from "@/lib/rules/config";
import { runEngine } from "@/lib/rules/engine";
import { addIsoWeeks, isValidIsoWeek, lastCompleteWeek, weekWindow, weeksInIsoYear } from "@/lib/rules/isoWeek";
import type { EngineInput, SkuInput, WeeklySaleInput } from "@/lib/rules/types";
import { labelOfMs, mondayMs, WEEK_MS, weekRange } from "@/scripts/stress/isoweek";
import { saveResult } from "./harness";
import { oracle } from "./oracle";

const timings: Record<string, number> = {};

const sku = (id: string, extra: Partial<SkuInput> = {}): SkuInput => ({
  sku_id: id,
  name: id,
  perishability: "low",
  standard_reorder_qty: 100,
  distributor_id: null,
  ...extra,
});

function input(partial: Partial<EngineInput>): EngineInput {
  return {
    asOfDate: "2026-10-19",
    skus: [],
    weeklySales: [],
    inventory: [],
    openPurchaseOrders: null,
    festivalMonths: [],
    params: DEFAULT_PARAMS,
    ...partial,
  };
}

const salesFor = (id: string, weeks: string[], units: (i: number) => number): WeeklySaleInput[] =>
  weeks.map((w, i) => ({ sku_id: id, iso_week: w, units_sold: units(i) }));

describe("empty files", () => {
  it.each(FILE_TYPES.map((f) => f.type))("%s: an empty file gives an error, not a crash", (type) => {
    const r = parseCsv(type, "");
    expect(r.rows).toEqual([]);
    expect(r.errors.some((e) => /Missing required column/.test(e.message))).toBe(true);
  });

  it("FINDING: an empty file's first error is PapaParse's delimiter message on a 'row 2' that does not exist", () => {
    const r = parseCsv("weekly_sales", "");
    expect(r.errors[0]).toEqual({ row: 2, message: "Unable to auto-detect delimiting character; defaulted to ','" });
  });

  it("header-only files load zero rows without errors", () => {
    const r = parseCsv("weekly_sales", "SKU_ID,Week,Units_Sold\n");
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("the engine and the backtest accept empty inputs", () => {
    const res = runEngine(input({}));
    expect(res.recommendations).toEqual([]);
    expect(res.skipped).toEqual([]);
    const { asOfDate: _a, ...base } = input({});
    const bt = runBacktest(base);
    expect(bt.weeks).toEqual([]);
    expect(bt.agreement.pct).toBeNull();
  });

  it("SKUs with no sales and no inventory are listed as skipped, with reasons", () => {
    const res = runEngine(input({ skus: [sku("A"), sku("B")], weeklySales: salesFor("B", ["2026-W42"], () => 5) }));
    expect(res.skipped.map((s) => s.sku_id)).toEqual(["A", "B"]);
  });
});

describe("load: a 200,000-row weekly sales file through parseCsv", () => {
  // 1,250 SKUs × 160 weeks = 200,000 rows, exactly the upload limit.
  const weeks = weekRange("2023-W50", labelOfMs(mondayMs("2023-W50") + 159 * WEEK_MS));
  const build = (rows: number) => {
    const lines = ["SKU_ID,Week,Units_Sold,Distributor_ID"];
    for (let i = 0; lines.length <= rows; i++) {
      const id = `L${String(Math.floor(i / weeks.length)).padStart(5, "0")}`;
      lines.push(`${id},${weeks[i % weeks.length]},${(i * 7919) % 300},D${i % 1200}`);
    }
    return lines.join("\n");
  };

  it("parses 200,000 rows (the limit) and reports the time", () => {
    const text = build(MAX_UPLOAD_ROWS);
    const t0 = performance.now();
    const r = parseCsv("weekly_sales", text);
    timings.parse_200k_ms = performance.now() - t0;
    console.log(`parseCsv 200,000 rows: ${Math.round(timings.parse_200k_ms)} ms, ${(text.length / 1e6).toFixed(1)} MB`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(MAX_UPLOAD_ROWS);
    expect(text.length).toBeLessThan(10 * 1024 * 1024);
  }, 300_000);

  it("rejects 200,001 rows with one clear error", () => {
    const r = parseCsv("weekly_sales", build(MAX_UPLOAD_ROWS + 1));
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ row: 1, message: `File has ${MAX_UPLOAD_ROWS + 1} rows; the limit is ${MAX_UPLOAD_ROWS}.` }]);
  }, 60_000);

  it("FINDING: the gap scan alone dominates parse time on a long history (one SKU, 600 weeks)", () => {
    // salesGapWarnings grows a window one week at a time and rebuilds it each step: O(span²) per SKU,
    // and it stops at 600 weeks, so longer histories are silently mis-measured.
    const long = weekRange("2015-W01", labelOfMs(mondayMs("2015-W01") + 649 * WEEK_MS));
    const text = ["SKU_ID,Week,Units_Sold", ...long.filter((_, i) => i !== 5).map((w) => `X,${w},10`)].join("\n");
    const t0 = performance.now();
    const r = parseCsv("weekly_sales", text);
    timings.gap_scan_650_weeks_ms = performance.now() - t0;
    console.log(`one SKU, 649 rows over 650 weeks: ${Math.round(timings.gap_scan_650_weeks_ms)} ms; warnings:`, r.warnings);
    // The missing week (index 5) is outside the 600-week reach, so no gap warning is raised at all.
    expect(r.warnings.filter((w) => w.includes("missing"))).toEqual([]);
  }, 120_000);
});

describe("all-zero sales", () => {
  const weeks = weekRange("2026-W27", "2026-W42");
  const skus = [sku("Z1"), sku("Z2", { perishability: "high" })];
  const sales = [...salesFor("Z1", weeks, () => 0), ...salesFor("Z2", weeks, () => 0)];

  it("stock on hand → dead_stock exception, pause, qty 0; no stock → no action; no NaN anywhere", () => {
    const res = runEngine(
      input({
        skus,
        weeklySales: sales,
        festivalMonths: ["2026-10"],
        inventory: [
          { sku_id: "Z1", location: "P", units_on_hand: 50, as_of_date: "2026-10-19" },
          { sku_id: "Z2", location: "P", units_on_hand: 0, as_of_date: "2026-10-19" },
        ],
      }),
    );
    const [z1, z2] = ["Z1", "Z2"].map((id) => res.recommendations.find((r) => r.sku_id === id)!);
    expect(z1).toMatchObject({ flag: "overstock_risk", recommended_action: "pause_next_order", recommended_qty: 0, is_exception: true, exception_reasons: ["dead_stock"] });
    expect(z2).toMatchObject({ flag: "no_action", recommended_action: "no_action", is_exception: false });
    expect(JSON.stringify(res)).not.toMatch(/NaN|Infinity/);
  });

  it("backtest over all-zero history raises no high_demand (no divide-by-zero)", () => {
    const bt = runBacktest({ skus, weeklySales: sales, inventory: [], festivalMonths: [], params: DEFAULT_PARAMS });
    expect(bt.weeks.length).toBeGreaterThan(0);
    expect(bt.flags).toEqual([]);
  });
});

describe("53-week year boundaries", () => {
  it("lib isoWeek agrees with the independent helper on every week 2015–2032", () => {
    const all = weekRange("2015-W01", "2032-W52");
    for (let i = 1; i < all.length; i++) expect(addIsoWeeks(all[i - 1], 1)).toBe(all[i]);
    expect([2015, 2020, 2026, 2032].map(weeksInIsoYear)).toEqual([53, 53, 53, 53]);
    expect([2024, 2025, 2027].map(weeksInIsoYear)).toEqual([52, 52, 52]);
    expect(isValidIsoWeek("2026-W53")).toBe(true);
    expect(isValidIsoWeek("2025-W53")).toBe(false);
    expect(isValidIsoWeek("2027-W53")).toBe(false);
  });

  it("windows ending in 2027-W01 include 2026-W53 exactly once", () => {
    expect(weekWindow("2027-W01", 3)).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
    expect(lastCompleteWeek("2027-01-03")).toBe("2026-W53");
    expect(lastCompleteWeek("2027-01-04")).toBe("2026-W53");
    expect(lastCompleteWeek("2026-01-04")).toBe("2026-W01");
  });

  it("a SKU sold only in W53 still averages over 12 calendar weeks; engine equals oracle", () => {
    const weeks = weekRange("2026-W42", "2027-W01");
    const sales = salesFor("Y", weeks, (i) => (weeks[i] === "2026-W53" ? 120 : 100));
    const inp = input({ asOfDate: "2027-01-11", skus: [sku("Y")], weeklySales: sales, inventory: [{ sku_id: "Y", location: "P", units_on_hand: 400, as_of_date: "2027-01-11" }] });
    const r = runEngine(inp).recommendations[0];
    const o = oracle(inp).rows[0];
    expect(r.avg12).toBeCloseTo((11 * 100 + 120) / 12, 10);
    expect(r.avg12).toBeCloseTo(o.avg12!, 10);
    expect(r.flag).toBe(o.primary);
    expect(r.missing_weeks).toEqual([]);
  });
});

describe("missing calendar", () => {
  it("no festival months: no uplift, festival_calendar feature off, same result as a non-festival month", () => {
    const weeks = weekRange("2026-W27", "2026-W42");
    const base = { skus: [sku("C")], weeklySales: salesFor("C", weeks, () => 100), inventory: [{ sku_id: "C", location: "P", units_on_hand: 500, as_of_date: "2026-10-19" }] };
    const none = runEngine(input({ ...base, festivalMonths: [] }));
    const fest = runEngine(input({ ...base, festivalMonths: ["2026-10"] }));
    expect(none.features.festival_calendar).toBe(false);
    expect(none.festival_month).toBe(false);
    expect(none.recommendations[0].demand_adj).toBe(100);
    expect(fest.recommendations[0].demand_adj).toBe(125);
    expect(parseCsv("calendar", "Year,Month,Year_Month,Is_Festival_Month\n").rows).toEqual([]);
  });
});

describe("every optional column absent", () => {
  it("loads and runs: no unit price, lead time, launch date, distributor sales or POs", () => {
    const master = parseCsv(
      "sku_master",
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nO1,One,Snack,Low,100,Units,\nO2,Two,Dairy,High,50,Units,\n",
    );
    expect(master.errors).toEqual([]);
    const weeks = weekRange("2026-W27", "2026-W42");
    const sales = parseCsv("weekly_sales", ["SKU_ID,Week,Units_Sold", ...weeks.flatMap((w) => [`O1,${w},100`, `O2,${w},40`])].join("\n"));
    const inv = parseCsv("current_inventory", "SKU_ID,Location,Units_On_Hand,As_Of_Date\nO1,P,300,2026-10-19\nO2,P,500,2026-10-19\n");
    const res = runEngine(input({ skus: master.rows, weeklySales: sales.rows, inventory: inv.rows }));
    expect(res.features).toEqual({ unit_price: false, lead_time: false, launch_date: false, distributor_sales: false, open_purchase_orders: false, festival_calendar: false });
    expect(res.recommendations.map((r) => [r.sku_id, r.flag, r.rupee_exposure])).toEqual([
      ["O1", "stockout_risk", null],
      ["O2", "overstock_risk", null],
    ]);
  });
});

describe("questionable inputs found while stress testing", () => {
  it("FINDING: inventory rows without a location are summed across dates (engine.ts:62)", () => {
    const weeks = weekRange("2026-W27", "2026-W42");
    const res = runEngine(
      input({
        skus: [sku("I")],
        weeklySales: salesFor("I", weeks, () => 100),
        inventory: [
          { sku_id: "I", units_on_hand: 300, as_of_date: "2026-10-12" },
          { sku_id: "I", units_on_hand: 300, as_of_date: "2026-10-19" },
        ],
      }),
    );
    // Two snapshots of the same stock a week apart count as 600 units, not the latest 300.
    expect(res.recommendations[0].units_on_hand).toBe(600);
  });

  it("FINDING: Lead_Time_Days is loaded but never used by the rules", () => {
    const weeks = weekRange("2026-W27", "2026-W42");
    const run = (lead: number) =>
      runEngine(
        input({
          skus: [sku("T", { lead_time_days: lead })],
          weeklySales: salesFor("T", weeks, () => 100),
          inventory: [{ sku_id: "T", location: "P", units_on_hand: 650, as_of_date: "2026-10-19" }],
        }),
      ).recommendations[0];
    // 6.5 weeks of cover: fine with a 3-day lead time, too late with a 60-day one. Same answer either way.
    expect(run(3).flag).toBe("no_action");
    expect(run(60).flag).toBe("no_action");
  });

  it("saves the edge timings", () => {
    saveResult("edge", timings);
    expect(Object.keys(timings).length).toBeGreaterThan(0);
  });
});
