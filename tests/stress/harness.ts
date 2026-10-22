// Shared stress-test harness: load the synthetic data through the real CSV loaders, replay the engine
// week by week with time-correct stock and open POs, and score each flag against ground truth.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/csv/loaders";
import { DEFAULT_PARAMS } from "@/lib/rules/config";
import { runEngine } from "@/lib/rules/engine";
import type { EngineInput, InventoryInput, OpenPoInput, Recommendation, RuleParams } from "@/lib/rules/types";
import { generateStressData, type Pattern, type SkuTruth, type StressDataset } from "@/scripts/stress/generate";
import { dateOfMs, mondayMs, WEEK_MS } from "@/scripts/stress/isoweek";

export const RESULTS_DIR = path.join(__dirname, "..", "..", "sample-data", "stress", "results");

export function saveResult(name: string, data: unknown) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

export interface Loaded {
  ds: StressDataset;
  base: Omit<EngineInput, "asOfDate" | "inventory" | "openPurchaseOrders">;
  inventoryByDate: Map<string, InventoryInput[]>;
  truthBySku: Map<string, SkuTruth>;
  loadMs: Record<string, number>;
  loadIssues: Record<string, { rows: number; errors: number; warnings: string[] }>;
  csvPoRows: OpenPoInput[];
  posBySku: Map<string, StressDataset["pos"]>;
}

let cache: Loaded | null = null;

export function loadStress(): Loaded {
  if (cache) return cache;
  const ds = generateStressData();
  const loadMs: Record<string, number> = {};
  const loadIssues: Loaded["loadIssues"] = {};
  const timed = <K extends Parameters<typeof parseCsv>[0]>(k: K, text: string) => {
    const t = performance.now();
    const r = parseCsv(k, text);
    loadMs[k] = performance.now() - t;
    loadIssues[k] = { rows: r.rows.length, errors: r.errors.length, warnings: r.warnings };
    return r.rows;
  };
  const skus = timed("sku_master", ds.csv.sku_master);
  const sales = timed("weekly_sales", ds.csv.weekly_sales);
  const inventory = timed("current_inventory", ds.csv.current_inventory);
  timed("distributor_master", ds.csv.distributor_master);
  const calendar = timed("calendar", ds.csv.calendar);
  const pos = timed("open_purchase_orders", ds.csv.open_purchase_orders);

  const inventoryByDate = new Map<string, InventoryInput[]>();
  for (const r of inventory) (inventoryByDate.get(r.as_of_date) ?? inventoryByDate.set(r.as_of_date, []).get(r.as_of_date)!).push(r);

  const posBySku = new Map<string, StressDataset["pos"]>();
  for (const p of ds.pos) (posBySku.get(p.sku_id) ?? posBySku.set(p.sku_id, []).get(p.sku_id)!).push(p);

  cache = {
    ds,
    base: {
      skus,
      weeklySales: sales,
      festivalMonths: calendar.filter((c) => c.is_festival_month).map((c) => c.year_month),
      params: DEFAULT_PARAMS,
    },
    inventoryByDate,
    truthBySku: new Map(ds.truth.map((t) => [t.sku_id, t])),
    loadMs,
    loadIssues,
    csvPoRows: pos,
    posBySku,
  };
  return cache;
}

/** As-of date for a replay of week index t: the Monday after the week, like a live Monday run. */
export const asOfFor = (ds: StressDataset, t: number) => dateOfMs(mondayMs(ds.weeks[0]) + (t + 1) * WEEK_MS);

/** POs open on the as-of date of week t: ordered before that Monday, not yet received. */
export function openPosAt(ds: StressDataset, t: number): OpenPoInput[] {
  return ds.pos
    .filter((p) => p.order_index <= t - 1 && p.arrival_index >= t + 1)
    .map((p) => ({ sku_id: p.sku_id, qty: p.qty, status: "open" }));
}

export function engineInputAt(L: Loaded, t: number, params: RuleParams = DEFAULT_PARAMS): EngineInput {
  const asOfDate = asOfFor(L.ds, t);
  return {
    ...L.base,
    params,
    asOfDate,
    inventory: L.inventoryByDate.get(asOfDate) ?? [],
    openPurchaseOrders: openPosAt(L.ds, t),
  };
}

// ---------- ground truth ----------

export interface Truth {
  /** Stock + POs already open run out within the minimum-cover window (no new orders), on realised demand. */
  stockout: boolean | null;
  /** Stock + open POs still left after the maximum-cover window, on realised demand. */
  overstock: boolean | null;
  /** Expected demand over the next 4 weeks > 1.2 × expected demand over the last 12. */
  high_demand: boolean | null;
  /** What actually happened under the historical planner: lost sales in t+1..t+4. */
  ran_out_next4: boolean | null;
  /** Stock + open POs run out before an order placed on this as-of date could arrive (lead time + 1 week). */
  runs_out_before_new_order_lands: boolean | null;
  data_gaps: boolean;
  distributor_shift: boolean;
  dead_stock: boolean;
  new_launch: boolean;
}

const TRUTH = DEFAULT_PARAMS; // ground truth uses the default windows, never the swept ones

export function truthAt(L: Loaded, sku: SkuTruth, t: number, lastIndex: number): Truth {
  const s = L.ds.series[sku.sku_id];
  const win = sku.perishability === "high" ? TRUTH.high_perishability : TRUTH.low_perishability;
  const open = (L.posBySku.get(sku.sku_id) ?? []).filter((p) => p.order_index <= t - 1 && p.arrival_index >= t + 1);
  const arrivals = (k: number) => open.filter((p) => p.arrival_index === k).reduce((a, p) => a + p.qty, 0);

  let stockout: boolean | null = null;
  if (t + win.min_weeks <= lastIndex) {
    let left = s.on_hand_end[t];
    stockout = false;
    for (let k = t + 1; k <= t + win.min_weeks; k++) {
      left += arrivals(k) - s.demand[k];
      if (left < 0) {
        stockout = true;
        break;
      }
    }
  }
  let overstock: boolean | null = null;
  if (t + win.max_weeks <= lastIndex) {
    const supply = s.on_hand_end[t] + open.reduce((a, p) => a + p.qty, 0);
    let need = 0;
    for (let k = t + 1; k <= t + win.max_weeks; k++) need += s.demand[k];
    overstock = supply - need > 0;
  }
  let high: boolean | null = null;
  if (t + 4 <= lastIndex && t >= 11) {
    const back = s.latent.slice(t - 11, t + 1).reduce((a, b) => a + b, 0) / 12;
    const fwd = s.latent.slice(t + 1, t + 5).reduce((a, b) => a + b, 0) / 4;
    high = back > 0 && fwd > 1.2 * back;
  }
  const ranOut = t + 4 <= lastIndex ? s.lost.slice(t + 1, t + 5).some((x) => x > 0) : null;
  let late: boolean | null = null;
  const landsAt = t + 1 + sku.lead_weeks; // ordered next Monday, received lead weeks later
  if (landsAt <= lastIndex) {
    let left = s.on_hand_end[t];
    late = false;
    for (let k = t + 1; k < landsAt; k++) {
      left += arrivals(k) - s.demand[k];
      if (left < 0) late = true;
    }
  }

  const window12 = Array.from({ length: 12 }, (_, k) => t - 11 + k).filter((i) => i >= 0);
  const missing = window12.filter((i) => !s.has_row[i]).length;
  let shift = false;
  if (sku.pattern === "distributor_shift" && sku.change_index != null) {
    // Expected shares over each window, weighted by expected demand.
    const share = (idx: number[]) => {
      const tot = idx.reduce((a, i) => a + s.latent[i], 0);
      return sku.distributors.map((_, d) =>
        idx.reduce((a, i) => a + s.latent[i] * (i >= sku.change_index! ? sku.shares_after[d] : sku.shares_before[d]), 0) / tot,
      );
    };
    const a = share(window12);
    const b = share(window12.slice(-4));
    shift = a.some((x, d) => Math.abs(b[d] - x) * 100 > TRUTH.distributor_share_shift_pp);
  }
  const dead = window12.every((i) => s.latent[i] === 0) && s.on_hand_end[t] > 0 && sku.launch_index == null;
  const launchDays = sku.launch_index == null ? Infinity : (t + 1 - sku.launch_index) * 7;
  return {
    stockout,
    overstock,
    high_demand: high,
    ran_out_next4: ranOut,
    runs_out_before_new_order_lands: late,
    data_gaps: missing > (TRUTH.max_missing_weeks ?? 2) && sku.launch_index == null,
    distributor_shift: shift,
    dead_stock: dead,
    new_launch: launchDays >= 0 && launchDays < TRUTH.new_launch_weeks * 7,
  };
}

// ---------- scoring ----------

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}
const newConf = (): Confusion => ({ tp: 0, fp: 0, fn: 0, tn: 0 });
export const precision = (c: Confusion) => (c.tp + c.fp === 0 ? null : c.tp / (c.tp + c.fp));
export const recall = (c: Confusion) => (c.tp + c.fn === 0 ? null : c.tp / (c.tp + c.fn));
export const f1 = (c: Confusion) => {
  const p = precision(c);
  const r = recall(c);
  return p == null || r == null || p + r === 0 ? null : (2 * p * r) / (p + r);
};

function add(c: Confusion, predicted: boolean, actual: boolean | null) {
  if (actual == null) return;
  if (predicted && actual) c.tp++;
  else if (predicted) c.fp++;
  else if (actual) c.fn++;
  else c.tn++;
}

export interface Bucket {
  sku_weeks: number;
  abstained: number; // eligibility exceptions (insufficient history / new launch): no flags by design
  flagged: number;
  exceptions: number;
  reasons: Record<string, number>;
  stockout: Confusion;
  overstock: Confusion;
  high_demand: Confusion;
  reality: Confusion; // stockout flag vs actual lost sales in t+1..t+4
  exception_truth: Record<"data_gaps" | "distributor_shift" | "dead_stock" | "new_launch", Confusion>;
  reorders: number;
  reorder_still_short: number; // reorder_now where (stock + on order + qty) / demand is still below the minimum
  stockout_flags_rated_for_lateness: number;
  stockout_flags_too_late: number; // stockout flag where stock runs out before an order placed now can land
}

export const newBucket = (): Bucket => ({
  sku_weeks: 0,
  abstained: 0,
  flagged: 0,
  exceptions: 0,
  reasons: {},
  stockout: newConf(),
  overstock: newConf(),
  high_demand: newConf(),
  reality: newConf(),
  exception_truth: { data_gaps: newConf(), distributor_shift: newConf(), dead_stock: newConf(), new_launch: newConf() },
  reorders: 0,
  reorder_still_short: 0,
  stockout_flags_rated_for_lateness: 0,
  stockout_flags_too_late: 0,
});

export function score(b: Bucket, r: Recommendation, truth: Truth, params: RuleParams) {
  b.sku_weeks++;
  if (r.flag !== "no_action" || r.is_exception) b.flagged++;
  if (r.is_exception) b.exceptions++;
  for (const reason of r.exception_reasons) b.reasons[reason] = (b.reasons[reason] ?? 0) + 1;
  for (const k of ["data_gaps", "distributor_shift", "dead_stock", "new_launch"] as const) {
    add(b.exception_truth[k], r.exception_reasons.includes(k), truth[k]);
  }
  if (r.exception_reasons.includes("insufficient_history") || r.exception_reasons.includes("new_launch")) {
    b.abstained++;
    return;
  }
  add(b.stockout, r.flags.includes("stockout_risk"), truth.stockout);
  add(b.overstock, r.flags.includes("overstock_risk"), truth.overstock);
  add(b.high_demand, r.flags.includes("high_demand"), truth.high_demand);
  add(b.reality, r.flags.includes("stockout_risk"), truth.ran_out_next4);
  if (r.flags.includes("stockout_risk") && truth.runs_out_before_new_order_lands != null) {
    b.stockout_flags_rated_for_lateness++;
    if (truth.runs_out_before_new_order_lands) b.stockout_flags_too_late++;
  }
  if (r.recommended_action === "reorder_now" && r.demand_adj) {
    b.reorders++;
    const win = r.perishability === "high" ? params.high_perishability : params.low_perishability;
    if ((r.units_on_hand + r.on_order_units + (r.recommended_qty ?? 0)) / r.demand_adj < win.min_weeks) b.reorder_still_short++;
  }
}

export interface ReplayOutcome {
  byPattern: Record<string, Bucket>;
  all: Bucket;
  byMonth: Record<string, Bucket>;
  engineMs: number[];
  recs: Map<string, Recommendation>; // key `${sku}|${week}`
}

/** Replay weeks [from..to] (indices) with the engine, scoring against truth whose horizon ends at lastIndex. */
export function replay(L: Loaded, from: number, to: number, lastIndex: number, params: RuleParams = DEFAULT_PARAMS, keepRecs = false): ReplayOutcome {
  const out: ReplayOutcome = { byPattern: {}, all: newBucket(), byMonth: {}, engineMs: [], recs: new Map() };
  for (let t = from; t <= to; t++) {
    const input = engineInputAt(L, t, params);
    const t0 = performance.now();
    const res = runEngine(input);
    out.engineMs.push(performance.now() - t0);
    const month = input.asOfDate.slice(0, 7);
    for (const r of res.recommendations) {
      const sku = L.truthBySku.get(r.sku_id);
      if (!sku) continue;
      const tr = truthAt(L, sku, t, lastIndex);
      score((out.byPattern[sku.pattern] ??= newBucket()), r, tr, params);
      score(out.all, r, tr, params);
      score((out.byMonth[month] ??= newBucket()), r, tr, params);
      if (keepRecs) out.recs.set(`${r.sku_id}|${L.ds.weeks[t]}`, r);
    }
  }
  return out;
}

const pct = (x: number | null) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);

/** Compact summary of a bucket for JSON output and console tables. */
export function summarize(b: Bucket) {
  const rated = b.sku_weeks - b.abstained;
  return {
    sku_weeks: b.sku_weeks,
    exception_rate: b.sku_weeks ? b.exceptions / b.sku_weeks : null,
    flagged_rate: b.sku_weeks ? b.flagged / b.sku_weeks : null,
    stockout_rate: rated ? (b.stockout.tp + b.stockout.fp) / rated : null,
    stockout_p: precision(b.stockout),
    stockout_r: recall(b.stockout),
    overstock_p: precision(b.overstock),
    overstock_r: recall(b.overstock),
    high_demand_p: precision(b.high_demand),
    high_demand_r: recall(b.high_demand),
    reality_p: precision(b.reality),
    reality_base_rate:
      b.reality.tp + b.reality.fp + b.reality.fn + b.reality.tn === 0
        ? null
        : (b.reality.tp + b.reality.fn) / (b.reality.tp + b.reality.fp + b.reality.fn + b.reality.tn),
    reality_r: recall(b.reality),
    reorder_still_short: b.reorders ? b.reorder_still_short / b.reorders : null,
    stockout_flag_too_late: b.stockout_flags_rated_for_lateness ? b.stockout_flags_too_late / b.stockout_flags_rated_for_lateness : null,
    high_demand_flag_rate: rated ? (b.high_demand.tp + b.high_demand.fp) / rated : null,
    reasons: b.reasons,
    exception_truth: Object.fromEntries(
      Object.entries(b.exception_truth).map(([k, c]) => [k, { p: precision(c), r: recall(c), ...c }]),
    ),
  };
}

export function table(rows: Record<string, Bucket>, order?: string[]): string {
  const keys = order ?? Object.keys(rows).sort();
  const head = "| Pattern | SKU-weeks | Exception rate | Stockout P / R | Overstock P / R | High demand P / R | Stockout flag → ran out in 4 wks (base rate) |";
  const lines = [head, "|---|---:|---:|---:|---:|---:|---:|"];
  for (const k of keys) {
    const b = rows[k];
    if (!b) continue;
    const s = summarize(b);
    lines.push(
      `| ${k} | ${s.sku_weeks} | ${pct(s.exception_rate)} | ${pct(s.stockout_p)} / ${pct(s.stockout_r)} | ${pct(s.overstock_p)} / ${pct(s.overstock_r)} | ${pct(s.high_demand_p)} / ${pct(s.high_demand_r)} | ${pct(s.reality_p)} (${pct(s.reality_base_rate)}) |`,
    );
  }
  return lines.join("\n");
}

export const PATTERN_ORDER: (Pattern | "ALL")[] = [
  "steady",
  "rising",
  "falling",
  "festival",
  "perishable",
  "new_launch",
  "dead_stock",
  "data_gaps",
  "distributor_shift",
  "dirty_rows",
  "ALL",
];
export { pct };
