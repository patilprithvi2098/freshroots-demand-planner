// TRAINING set (2024-W01..2025-W52): parameter sensitivity, for reporting only.
// The engine must never tune itself: this file sweeps parameters around the defaults, records flag
// rates and accuracy, and asserts that DEFAULT_PARAMS is unchanged afterwards.

import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "@/lib/rules/config";
import type { RuleParams } from "@/lib/rules/types";
import { TRAIN_LAST_WEEK } from "@/scripts/stress/generate";
import { f1, loadStress, pct, precision, recall, replay, saveResult, summarize, type Loaded, type ReplayOutcome } from "./harness";

const FROZEN_DEFAULTS = structuredClone(DEFAULT_PARAMS);

type Variant = { group: string; label: string; params: RuleParams };
const v = (group: string, label: string, patch: Partial<RuleParams>): Variant => ({
  group,
  label,
  params: { ...DEFAULT_PARAMS, ...patch },
});

const VARIANTS: Variant[] = [
  v("default", "defaults", {}),
  ...[10, 15, 25, 30, 40].map((x) => v("trend_threshold_pct", String(x), { trend_threshold_pct: x })),
  ...[0, 10, 40, 60].map((x) => v("festival_uplift_pct", String(x), { festival_uplift_pct: x })),
  ...(
    [
      [5, 12],
      [7, 16],
      [6, 10],
      [6, 18],
    ] as const
  ).map(([a, b]) => v("low_perishability", `${a}–${b} wks`, { low_perishability: { min_weeks: a, max_weeks: b } })),
  ...(
    [
      [2, 3],
      [2, 4],
      [3, 5],
    ] as const
  ).map(([a, b]) => v("high_perishability", `${a}–${b} wks`, { high_perishability: { min_weeks: a, max_weeks: b } })),
];

let L: Loaded;
const results = new Map<string, ReplayOutcome>();
let from = 0;
let to = 0;

beforeAll(() => {
  L = loadStress();
  from = 11; // first week with a full 12-week window (2024-W12)
  to = L.ds.weeks.indexOf(TRAIN_LAST_WEEK); // truth horizons are cut at the end of training: no peeking at test data
  for (const variant of VARIANTS) results.set(`${variant.group}:${variant.label}`, replay(L, from, to, to, variant.params));
}, 600_000);

const row = (key: string) => {
  const r = results.get(key)!;
  const s = summarize(r.all);
  const festival = Object.entries(r.byMonth).filter(([m]) => L.ds.festivalMonths.includes(m));
  const nonFestival = Object.entries(r.byMonth).filter(([m]) => !L.ds.festivalMonths.includes(m));
  const rate = (bs: [string, (typeof r.all)][], k: "stockout" | "overstock") => {
    const rated = bs.reduce((a, [, b]) => a + b.sku_weeks - b.abstained, 0);
    return bs.reduce((a, [, b]) => a + b[k].tp + b[k].fp, 0) / rated;
  };
  return {
    key,
    flagged: s.flagged_rate,
    exceptions: s.exception_rate,
    stockout_rate: s.stockout_rate,
    stockout_rate_festival: rate(festival, "stockout"),
    stockout_rate_non_festival: rate(nonFestival, "stockout"),
    overstock_rate: rate([["all", r.all]], "overstock"),
    high_demand_rate: s.high_demand_flag_rate,
    stockout_f1: f1(r.all.stockout),
    overstock_f1: f1(r.all.overstock),
    high_demand_p: precision(r.all.high_demand),
    high_demand_r: recall(r.all.high_demand),
    possible_double_count: r.all.reasons.possible_double_count ?? 0,
  };
};

describe("TRAINING set: parameter sensitivity (reporting only, defaults never change)", () => {
  it("replays 93 training weeks × 400 SKUs for every variant and records flag rates", () => {
    const rows = VARIANTS.map((x) => row(`${x.group}:${x.label}`));
    saveResult("training", { weeks: [L.ds.weeks[from], L.ds.weeks[to]], variants: rows, defaults: summarize(results.get("default:defaults")!.all) });
    const lines = [
      "| Variant | Flagged | Exceptions | Stockout (fest / non-fest) | Overstock | High demand | Stockout F1 | Overstock F1 | High demand P / R |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...rows.map(
        (r) =>
          `| ${r.key} | ${pct(r.flagged)} | ${pct(r.exceptions)} | ${pct(r.stockout_rate)} (${pct(r.stockout_rate_festival)} / ${pct(r.stockout_rate_non_festival)}) | ${pct(r.overstock_rate)} | ${pct(r.high_demand_rate)} | ${pct(r.stockout_f1)} | ${pct(r.overstock_f1)} | ${pct(r.high_demand_p)} / ${pct(r.high_demand_r)} |`,
      ),
    ];
    console.log(lines.join("\n"));
    expect(rows.every((r) => r.flagged! > 0)).toBe(true);
  });

  it("the engine did not tune itself: DEFAULT_PARAMS is byte-for-byte unchanged", () => {
    expect(DEFAULT_PARAMS).toEqual(FROZEN_DEFAULTS);
    expect(DEFAULT_PARAMS.trend_threshold_pct).toBe(20);
    expect(DEFAULT_PARAMS.festival_uplift_pct).toBe(25);
    expect(DEFAULT_PARAMS.low_perishability).toEqual({ min_weeks: 6, max_weeks: 14 });
    expect(DEFAULT_PARAMS.high_perishability).toEqual({ min_weeks: 3, max_weeks: 4 });
  });

  it("a higher trend threshold never raises more high_demand flags", () => {
    const rates = ["10", "15", "20", "25", "30", "40"].map((x) =>
      x === "20" ? row("default:defaults").high_demand_rate! : row(`trend_threshold_pct:${x}`).high_demand_rate!,
    );
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);
  });

  it("festival uplift only moves festival months, and raises stockout flags there", () => {
    const zero = row("festival_uplift_pct:0");
    const sixty = row("festival_uplift_pct:60");
    expect(sixty.stockout_rate_non_festival).toBeCloseTo(zero.stockout_rate_non_festival!, 10);
    expect(sixty.stockout_rate_festival).toBeGreaterThan(zero.stockout_rate_festival!);
  });

  it("a wider low-perishability minimum raises stockout flags; a wider maximum lowers overstock flags", () => {
    expect(row("low_perishability:7–16 wks").stockout_rate!).toBeGreaterThan(row("low_perishability:5–12 wks").stockout_rate!);
    expect(row("low_perishability:6–18 wks").overstock_rate).toBeLessThan(row("low_perishability:6–10 wks").overstock_rate);
  });

  it("is deterministic: the default replay gives identical counts twice", () => {
    const again = replay(L, from, to, to, DEFAULT_PARAMS);
    expect(summarize(again.all)).toEqual(summarize(results.get("default:defaults")!.all));
  }, 120_000);
});
