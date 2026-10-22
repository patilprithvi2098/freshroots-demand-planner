// TEST set (held-out 2026-W01..2026-W53, a 53-week ISO year): weekly replay at default parameters,
// precision / recall per demand pattern against ground truth, exception rate, runtime, and runBacktest
// at full scale. Tests named "FINDING:" pin current engine behaviour that the report flags for change.

import { beforeAll, describe, expect, it } from "vitest";
import { runBacktest, type HistoricalDecision } from "@/lib/rules/backtest";
import { DEFAULT_PARAMS } from "@/lib/rules/config";
import { runEngine } from "@/lib/rules/engine";
import { TEST_FIRST_WEEK } from "@/scripts/stress/generate";
import {
  engineInputAt,
  loadStress,
  PATTERN_ORDER,
  pct,
  precision,
  recall,
  replay,
  saveResult,
  summarize,
  table,
  type Loaded,
  type ReplayOutcome,
} from "./harness";

let L: Loaded;
let out: ReplayOutcome;
let first = 0;
let last = 0;

beforeAll(() => {
  L = loadStress();
  first = L.ds.weeks.indexOf(TEST_FIRST_WEEK);
  last = L.ds.weeks.length - 1;
  out = replay(L, first, last, last, DEFAULT_PARAMS, true);
}, 600_000);

const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

describe("TEST set: loaders at full scale", () => {
  it("loads 400 SKUs, ~156k sales rows, 1,200 distributors; rejects every injected invalid row", () => {
    const i = L.loadIssues;
    expect(i.sku_master.rows).toBe(400);
    expect(i.sku_master.errors).toBe(1); // the "Medium" perishability row
    expect(i.distributor_master.rows).toBe(1200);
    expect(i.weekly_sales.errors).toBe(L.ds.injected.invalid_sales_rows);
    expect(i.current_inventory.errors).toBe(1);
    const dupWarning = i.weekly_sales.warnings.find((w) => w.includes("duplicate"))!;
    expect(dupWarning).toMatch(new RegExp(`^${L.ds.injected.duplicate_sales_rows + L.ds.injected.conflicting_duplicate_rows} duplicate`));
  });

  it("after de-duplication (last row wins) every SKU-week total equals the simulated units sold", () => {
    const totals = new Map<string, number>();
    for (const r of L.base.weeklySales) totals.set(`${r.sku_id}|${r.iso_week}`, (totals.get(`${r.sku_id}|${r.iso_week}`) ?? 0) + r.units_sold);
    let mismatches = 0;
    for (const t of L.ds.truth) {
      const s = L.ds.series[t.sku_id];
      L.ds.weeks.forEach((w, i) => {
        if (s.has_row[i] && totals.get(`${t.sku_id}|${w}`) !== s.sold[i]) mismatches++;
        if (!s.has_row[i] && totals.has(`${t.sku_id}|${w}`)) mismatches++;
      });
    }
    expect(mismatches).toBe(0);
  });

  it("FINDING: salesGapWarnings is quadratic — parsing the 156k-row sales file takes seconds", () => {
    console.log("parseCsv ms by file:", L.loadMs);
    // Papa + Zod alone take well under a second; the gap scan dominates (lib/csv/loaders.ts:419).
    expect(L.loadMs.weekly_sales).toBeGreaterThan(1500);
  });
});

describe("TEST set: weekly replay, 400 SKUs × 53 weeks, time-correct stock and open POs", () => {
  it("prints and saves the per-pattern metrics", () => {
    const rows = { ...out.byPattern, ALL: out.all };
    console.log(table(rows, PATTERN_ORDER as string[]));
    const months = Object.entries(out.byMonth).map(([m, b]) => ({ month: m, festival: L.ds.festivalMonths.includes(m), ...summarize(b) }));
    saveResult("test", {
      weeks: [L.ds.weeks[first], L.ds.weeks[last]],
      by_pattern: Object.fromEntries(Object.entries(rows).map(([k, b]) => [k, summarize(b)])),
      by_month: months,
      engine_ms: { median: quantile(out.engineMs, 0.5), p95: quantile(out.engineMs, 0.95), max: Math.max(...out.engineMs) },
    });
    expect(out.all.sku_weeks).toBeGreaterThan(20_000);
  });

  it("runtime: one run over 400 SKUs × 157 weeks of history stays far below a few seconds", () => {
    const ms = { median: quantile(out.engineMs, 0.5), max: Math.max(...out.engineMs) };
    console.log("runEngine ms:", ms);
    expect(ms.median).toBeLessThan(250);
    expect(ms.max).toBeLessThan(1000);
  });

  it("stockout and overstock rules separate risk from no-risk on unseen data", () => {
    expect(precision(out.all.stockout)!).toBeGreaterThan(0.6);
    expect(recall(out.all.stockout)!).toBeGreaterThan(0.7);
    expect(precision(out.all.overstock)!).toBeGreaterThan(0.7);
    expect(recall(out.all.overstock)!).toBeGreaterThan(0.5);
  });

  it("did the flag predict reality: a stockout flag at week t makes lost sales in t+1..t+4 far more likely", () => {
    const s = summarize(out.all);
    console.log(`stockout flag → ran out in 4 weeks: ${pct(s.reality_p)} vs base rate ${pct(s.reality_base_rate)}; recall ${pct(s.reality_r)}`);
    expect(s.reality_p!).toBeGreaterThan(2 * s.reality_base_rate!);
    expect(s.reality_r!).toBeGreaterThan(0.6);
  });

  it("data-quality exceptions are caught: data gaps, dead stock and new launches 100%, distributor shifts ≥ 85%", () => {
    const e = out.all.exception_truth;
    expect(recall(e.data_gaps)).toBe(1);
    expect(precision(e.data_gaps)).toBe(1);
    expect(recall(e.dead_stock)).toBe(1);
    expect(recall(e.new_launch)).toBe(1);
    expect(recall(e.distributor_shift)!).toBeGreaterThanOrEqual(0.85);
    expect(precision(e.distributor_shift)!).toBeGreaterThanOrEqual(0.85);
  });

  it("FINDING: overall exception rate is below the brief's 15–20%; festival months triple it via possible_double_count", () => {
    const rate = out.all.exceptions / out.all.sku_weeks;
    const fest = Object.entries(out.byMonth).filter(([m]) => L.ds.festivalMonths.includes(m)).map(([, b]) => b);
    const festRate = fest.reduce((a, b) => a + b.exceptions, 0) / fest.reduce((a, b) => a + b.sku_weeks, 0);
    const non = Object.entries(out.byMonth).filter(([m]) => !L.ds.festivalMonths.includes(m)).map(([, b]) => b);
    const nonRate = non.reduce((a, b) => a + b.exceptions, 0) / non.reduce((a, b) => a + b.sku_weeks, 0);
    console.log(`exception rate ${pct(rate)}; festival months ${pct(festRate)}; other months ${pct(nonRate)}; reasons`, out.all.reasons);
    expect(rate).toBeLessThan(0.15);
    expect(festRate).toBeGreaterThan(2 * nonRate);
    expect(out.all.reasons.possible_double_count).toBeGreaterThan(out.all.exceptions / 4);
  });

  it("FINDING: the review queue (flagged, not only exceptions) is several times the exception count", () => {
    const flagged = out.all.flagged / out.all.sku_weeks;
    console.log(`flagged ${pct(flagged)} of SKU-weeks ≈ ${Math.round(flagged * 400)} SKUs per run`);
    expect(flagged).toBeGreaterThan((3 * out.all.exceptions) / out.all.sku_weeks);
  });

  it("FINDING: high_demand (4-week trend > 20%) is a weak predictor of next-4-week demand", () => {
    const s = summarize(out.all);
    console.log(`high_demand precision ${pct(s.high_demand_p)}, recall ${pct(s.high_demand_r)}`);
    expect(s.high_demand_p!).toBeLessThan(0.6);
  });

  it("FINDING: some stockout flags come too late for the SKU's lead time, and some reorders do not restore minimum cover", () => {
    const s = summarize(out.all);
    console.log(`stockout flags already too late for lead time: ${pct(s.stockout_flag_too_late)}; reorder qty still below min cover: ${pct(s.reorder_still_short)}`);
    expect(s.stockout_flag_too_late!).toBeGreaterThan(0);
    expect(s.reorder_still_short!).toBeGreaterThan(0);
  });

  it("53-week year: the replay covers 2026-W53 and the run after it reads a window that spans the year boundary", () => {
    expect(L.ds.weeks[last]).toBe("2026-W53");
    const res = runEngine(engineInputAt(L, last));
    expect(res.as_of_date).toBe("2027-01-04");
    expect(res.end_week).toBe("2026-W53");
    expect(res.recommendations.length).toBeGreaterThan(380);
    const steady = res.recommendations.find((r) => L.truthBySku.get(r.sku_id)?.pattern === "steady")!;
    expect(steady.recent_sales.map((x) => x.iso_week).slice(-2)).toEqual(["2026-W52", "2026-W53"]);
  });
});

describe("TEST set: runBacktest at full scale (157 weeks, weekly stock snapshots)", () => {
  it("replays every week in full mode, measures agreement with the simulated planner, and stays fast", () => {
    const { inventoryByDate } = L;
    const inventory = [...inventoryByDate.values()].flat();
    // The simulated planner's actual decisions: ordered that week → reorder, otherwise no action.
    const decisions: HistoricalDecision[] = L.ds.truth.flatMap((t) =>
      L.ds.weeks.map((w, i) => ({ sku_id: t.sku_id, iso_week: w, action: L.ds.series[t.sku_id].ordered[i] > 0 ? "reorder_now" : "no_action" }) as HistoricalDecision),
    );
    const t0 = performance.now();
    const bt = runBacktest({ ...L.base, inventory, openPurchaseOrders: null }, decisions);
    const ms = performance.now() - t0;
    console.log(`runBacktest: ${bt.weeks.length} weeks in ${Math.round(ms)} ms; agreement ${pct(bt.agreement.pct)} on ${bt.agreement.compared} SKU-weeks`);
    saveResult("backtest", { ms, weeks: bt.weeks.length, agreement: bt.agreement, festival_flag_share: bt.festival_flag_share, non_festival_flag_share: bt.non_festival_flag_share });
    expect(bt.weeks.every((w) => w.mode === "full")).toBe(true);
    expect(bt.weeks[bt.weeks.length - 1].iso_week).toBe("2026-W53");
    expect(ms).toBeLessThan(30_000);
  }, 120_000);

  it("FINDING: runBacktest applies today's open POs to every past week (no PO dates in OpenPoInput)", () => {
    const inventory = [...L.inventoryByDate.values()].flat();
    // As an upload would: the PO file with statuses as of the latest date.
    const bt = runBacktest({ ...L.base, inventory, openPurchaseOrders: L.csvPoRows });
    const key = (sku: string, week: string) => `${sku}|${week}`;
    const btFlag = new Map(bt.flags.map((f) => [key(f.sku_id, f.iso_week), f.flag]));
    let differ = 0;
    let compared = 0;
    for (const [k, r] of out.recs) {
      if (r.exception_reasons.includes("insufficient_history") || r.exception_reasons.includes("new_launch")) continue;
      compared++;
      if ((btFlag.get(k) ?? "no_action") !== r.flag) differ++;
    }
    console.log(`backtest vs time-correct replay: ${differ} of ${compared} test SKU-weeks (${pct(differ / compared)}) get a different primary flag`);

    // Kill criterion "agreement < 75%": the same planner decisions, scored two ways on the test weeks.
    const planner = (sku: string, week: string) => (L.ds.series[sku].ordered[L.ds.weeks.indexOf(week)] > 0 ? "reorder_now" : "no_action");
    let agreeTrue = 0;
    let nTrue = 0;
    for (const [k, r] of out.recs) {
      if (r.is_exception) continue;
      const [sku, week] = k.split("|");
      nTrue++;
      if (r.recommended_action === planner(sku, week)) agreeTrue++;
    }
    const testWeeks = new Set(L.ds.testWeeks);
    const decisions: HistoricalDecision[] = L.ds.truth.flatMap((t) =>
      L.ds.testWeeks.map((w) => ({ sku_id: t.sku_id, iso_week: w, action: planner(t.sku_id, w) }) as HistoricalDecision),
    );
    const btTest = runBacktest({ ...L.base, inventory, openPurchaseOrders: null }, decisions);
    const agreement = { time_correct: agreeTrue / nTrue, time_correct_n: nTrue, backtest_no_pos: btTest.agreement.pct, backtest_n: btTest.agreement.compared };
    console.log(`agreement with the simulated planner on test weeks: time-correct ${pct(agreement.time_correct)} vs runBacktest ${pct(agreement.backtest_no_pos)}`);
    saveResult("backtest-po-leak", { differ, compared, agreement, test_weeks: testWeeks.size });
    expect(differ).toBeGreaterThan(0);
    expect(agreement.time_correct).toBeGreaterThan(agreement.backtest_no_pos!);
  }, 120_000);
});
