import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/rules/backtest";
import { computeMetrics, fullQuartersSince, killCriteria, repeatedOverrides, overrideStats } from "@/lib/metrics";
import { csvCell, toCsv } from "@/lib/csv/export";
import { loadSampleInput } from "./helpers";

describe("backtest on the sample data", () => {
  const { asOfDate: _ignored, ...base } = loadSampleInput();
  const res = runBacktest(base, [
    { sku_id: "SKU003", iso_week: "2026-W42", action: "reorder_now" },
    { sku_id: "SKU002", iso_week: "2026-W42", action: "reorder_now" },
    { sku_id: "SKU001", iso_week: "2026-W42", action: "reorder_now" }, // exception: excluded
  ]);

  it("replays every week with a full 12-week window", () => {
    expect(res.weeks.map((w) => w.iso_week)).toEqual(["2026-W38", "2026-W39", "2026-W40", "2026-W41", "2026-W42"]);
  });

  it("uses full rules only where an inventory snapshot exists for that week", () => {
    const last = res.weeks[res.weeks.length - 1];
    expect(last.mode).toBe("full");
    expect(last.as_of_date).toBe("2026-10-19");
    expect(last.flagged).toBe(7);
    expect(res.weeks.slice(0, 4).every((w) => w.mode === "trend_only")).toBe(true);
  });

  it("computes agreement on rule-governed SKUs only", () => {
    expect(res.agreement).toMatchObject({ compared: 2, agreed: 1, pct: 0.5 });
  });

  it("reports festival and non-festival flag shares", () => {
    expect(res.festival_flag_share).not.toBeNull();
    expect(res.non_festival_flag_share).not.toBeNull();
  });
});

describe("metrics and kill criteria", () => {
  const runs = [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, as_of_date: `2026-10-0${i}`, run_date: `2026-10-0${i}T00:00:00Z`, status: "completed" }));
  const recs = runs.flatMap((r, i) => [
    { id: `${r.id}a`, run_id: r.id, sku_id: "A", sku_name: "A", perishability: "low", status: i < 3 ? "edited" : "approved", is_exception: false, demand_adj: 10 },
    { id: `${r.id}b`, run_id: r.id, sku_id: "B", sku_name: "B", perishability: "high", status: "approved", is_exception: false, demand_adj: 10 },
  ]);

  it("override rate by run and repeated-override flag", () => {
    const stats = overrideStats(runs, recs);
    expect(stats.map((s) => s.override_rate)).toEqual([0.5, 0.5, 0.5, 0, 0]);
    expect(repeatedOverrides(stats, recs)).toEqual([{ sku_id: "A", sku_name: "A", overrides: 3, runs: 3 }]);
  });

  it("red when override rate > 40% for 3 consecutive runs", () => {
    const stats = overrideStats(runs.slice(0, 3), recs);
    expect(killCriteria(stats, null, null, null, "2026-10-22")[1].light).toBe("red");
  });

  it("agreement light", () => {
    expect(killCriteria([], { pct: 0.7, run_at: "2026-10-22" }, null, null, "2026-10-22")[0].light).toBe("red");
    expect(killCriteria([], { pct: 0.9, run_at: "2026-10-22" }, null, null, "2026-10-22")[0].light).toBe("green");
  });

  it("loss is only red after two full quarters", () => {
    expect(killCriteria([], null, 30_00_000, "2026-10-22", "2027-03-01")[2].light).toBe("amber");
    expect(killCriteria([], null, 30_00_000, "2026-10-22", "2027-07-01")[2].light).toBe("red");
    expect(killCriteria([], null, 20_00_000, "2026-10-22", "2027-07-01")[2].light).toBe("green");
  });

  it("counts full quarters", () => {
    expect(fullQuartersSince("2026-10-22", "2027-04-02")).toBe(1);
    expect(fullQuartersSince("2026-10-01", "2027-04-02")).toBe(2);
  });

  it("estimates loss from outcomes and unit prices", () => {
    const m = computeMetrics({
      runs,
      recs,
      outcomes: [{ recommendation_id: "r1a", measured_at: "2026-10-20", stockout_weeks: 2, written_off_units: 5 }],
      unitPriceBySku: new Map([["A", 100]]),
      latestAgreement: null,
      goLiveDate: "2026-10-01",
      today: "2026-10-22",
    });
    expect(m.estimated_quarter_loss).toBe(2 * 10 * 100 + 5 * 100);
    expect(m.accept_rate).toBe(0.7);
  });
});

describe("CSV export escaping", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@cmd"])("neutralises %s", (v) => {
    expect(csvCell(v).startsWith("'")).toBe(true);
  });
  it("quotes commas and quotes", () => {
    expect(toCsv(["a"], [['x,"y"']])).toBe('a\r\n"x,""y"""\r\n');
  });
});
