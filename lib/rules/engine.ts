// Deterministic demand-planning rules engine. Pure: no I/O, no clock, no randomness.
// Implements Raghav's five documented rules plus the exception rules from the spec.

import {
  compareIsoWeeks,
  daysBetween,
  lastCompleteWeek,
  weekWindow,
  yearMonthOf,
} from "./isoWeek";
import type {
  EngineInput,
  EngineResult,
  ExceptionReason,
  FeatureStatus,
  Flag,
  Recommendation,
  RuleParams,
  RuleTraceEntry,
  SkuInput,
} from "./types";

const OPEN_PO_STATUSES = new Set(["open", "ordered", "in_transit", "partially_received"]);
const RECENT_WEEKS_SHOWN = 16;

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface SkuSales {
  /** Total units per ISO week (summed across distributors). */
  byWeek: Map<string, number>;
  /** Units per distributor per ISO week, only for rows that carry a distributor. */
  byDistributor: Map<string, Map<string, number>>;
}

function indexSales(input: EngineInput): Map<string, SkuSales> {
  const out = new Map<string, SkuSales>();
  for (const row of input.weeklySales) {
    let s = out.get(row.sku_id);
    if (!s) {
      s = { byWeek: new Map(), byDistributor: new Map() };
      out.set(row.sku_id, s);
    }
    s.byWeek.set(row.iso_week, (s.byWeek.get(row.iso_week) ?? 0) + row.units_sold);
    if (row.distributor_id) {
      let d = s.byDistributor.get(row.distributor_id);
      if (!d) {
        d = new Map();
        s.byDistributor.set(row.distributor_id, d);
      }
      d.set(row.iso_week, (d.get(row.iso_week) ?? 0) + row.units_sold);
    }
  }
  return out;
}

/** Latest snapshot per (sku, location) on or before the as-of date, summed per SKU. */
function indexInventory(input: EngineInput): Map<string, { units: number; as_of: string }> {
  const latest = new Map<string, { units: number; as_of: string }>();
  input.inventory.forEach((row, i) => {
    if (row.as_of_date > input.asOfDate) return;
    const key = `${row.sku_id}\u0000${row.location ?? i}`;
    const prev = latest.get(key);
    if (!prev || row.as_of_date >= prev.as_of) latest.set(key, { units: row.units_on_hand, as_of: row.as_of_date });
  });
  const out = new Map<string, { units: number; as_of: string }>();
  for (const [key, v] of latest) {
    const sku = key.split("\u0000")[0];
    const prev = out.get(sku);
    out.set(sku, {
      units: (prev?.units ?? 0) + v.units,
      as_of: prev && prev.as_of > v.as_of ? prev.as_of : v.as_of,
    });
  }
  return out;
}

function indexOpenPos(input: EngineInput): Map<string, number> {
  const out = new Map<string, number>();
  for (const po of input.openPurchaseOrders ?? []) {
    if (!OPEN_PO_STATUSES.has(po.status.toLowerCase())) continue;
    out.set(po.sku_id, (out.get(po.sku_id) ?? 0) + po.qty);
  }
  return out;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function windowFor(sku: SkuInput, p: RuleParams) {
  return sku.perishability === "high" ? p.high_perishability : p.low_perishability;
}

function distributorShift(
  sales: SkuSales,
  last12: string[],
  last4: string[],
  thresholdPp: number,
): { shifted: boolean; detail: string } {
  if (sales.byDistributor.size === 0) return { shifted: false, detail: "" };
  const share = (weeks: string[]) => {
    const totals = new Map<string, number>();
    let all = 0;
    for (const [dist, byWeek] of sales.byDistributor) {
      const sum = weeks.reduce((acc, w) => acc + (byWeek.get(w) ?? 0), 0);
      totals.set(dist, sum);
      all += sum;
    }
    return { totals, all };
  };
  const s12 = share(last12);
  const s4 = share(last4);
  if (s12.all === 0 || s4.all === 0) return { shifted: false, detail: "" };
  let worst = { dist: "", pp: 0, from: 0, to: 0 };
  for (const dist of [...sales.byDistributor.keys()].sort()) {
    const from = ((s12.totals.get(dist) ?? 0) / s12.all) * 100;
    const to = ((s4.totals.get(dist) ?? 0) / s4.all) * 100;
    const pp = Math.abs(to - from);
    if (pp > worst.pp) worst = { dist, pp, from, to };
  }
  return {
    shifted: worst.pp > thresholdPp,
    detail: `${worst.dist} share moved from ${fmt(round1(worst.from))}% (12 weeks) to ${fmt(round1(worst.to))}% (4 weeks), a ${fmt(round1(worst.pp))} point shift`,
  };
}

export function detectFeatures(input: EngineInput): FeatureStatus {
  return {
    unit_price: input.skus.some((s) => s.unit_price != null),
    lead_time: input.skus.some((s) => s.lead_time_days != null),
    launch_date: input.skus.some((s) => s.launch_date != null),
    distributor_sales: input.weeklySales.some((r) => r.distributor_id != null && r.distributor_id !== ""),
    open_purchase_orders: input.openPurchaseOrders != null,
    festival_calendar: input.festivalMonths.length > 0,
  };
}

export function evaluateSku(
  sku: SkuInput,
  sales: SkuSales,
  stock: number,
  onOrder: number,
  ctx: { asOfDate: string; endWeek: string; festival: boolean; params: RuleParams },
): Recommendation {
  const p = ctx.params;
  const trace: RuleTraceEntry[] = [];
  const reasons: ExceptionReason[] = [];
  const window12 = weekWindow(ctx.endWeek, p.avg_window_weeks);
  const window4 = weekWindow(ctx.endWeek, p.trend_window_weeks);
  const recent = weekWindow(ctx.endWeek, Math.max(RECENT_WEEKS_SHOWN, p.avg_window_weeks)).slice(-RECENT_WEEKS_SHOWN);
  const historyWeeks = [...sales.byWeek.keys()].filter((w) => compareIsoWeeks(w, ctx.endWeek) <= 0).length;
  const missing = window12.filter((w) => !sales.byWeek.has(w));

  const base: Recommendation = {
    sku_id: sku.sku_id,
    name: sku.name,
    perishability: sku.perishability,
    distributor_id: sku.distributor_id,
    flag: "no_action",
    flags: [],
    rules_fired: trace,
    weeks_cover: null,
    trend_pct: null,
    avg12: null,
    avg4: null,
    demand_adj: null,
    units_on_hand: stock,
    on_order_units: onOrder,
    festival_applied: false,
    recommended_action: "no_action",
    recommended_qty: null,
    is_exception: false,
    exception_reasons: reasons,
    missing_weeks: missing,
    rupee_exposure: null,
    recent_sales: recent.map((w) => ({ iso_week: w, units: sales.byWeek.get(w) ?? null })),
  };

  // 1. Eligibility
  if (historyWeeks < p.avg_window_weeks) {
    reasons.push("insufficient_history");
    trace.push({
      rule: "eligibility",
      detail: `Only ${historyWeeks} weeks of sales history; the rules need ${p.avg_window_weeks}.`,
    });
  }
  if (sku.launch_date && sku.launch_date <= ctx.asOfDate) {
    const age = daysBetween(sku.launch_date, ctx.asOfDate);
    if (age < p.new_launch_weeks * 7) {
      reasons.push("new_launch");
      trace.push({
        rule: "eligibility",
        detail: `Launched ${sku.launch_date}, ${Math.floor(age / 7)} weeks ago (within the ${p.new_launch_weeks}-week new-launch window).`,
      });
    }
  }
  if (reasons.length > 0) {
    return { ...base, is_exception: true, recommended_action: "manual_review" };
  }

  // 2. Averages on raw sales (festival uplift never inflates the trend). Missing weeks are not zero-filled.
  const present12 = window12.filter((w) => sales.byWeek.has(w)).map((w) => sales.byWeek.get(w)!);
  const present4 = window4.filter((w) => sales.byWeek.has(w)).map((w) => sales.byWeek.get(w)!);
  const avg12 = mean(present12);
  const avg4 = mean(present4);
  base.avg12 = avg12;
  base.avg4 = avg4;

  if (missing.length > (p.max_missing_weeks ?? 2)) {
    reasons.push("data_gaps");
    trace.push({
      rule: "eligibility",
      detail: `${missing.length} of the last ${p.avg_window_weeks} weeks have no sales rows (${missing.join(", ")}); averages use only the weeks present.`,
    });
  }

  if (avg12 === 0) {
    if (stock > 0) {
      reasons.push("dead_stock");
      trace.push({
        rule: "eligibility",
        detail: `No sales in the last ${p.avg_window_weeks} weeks but ${stock} units on hand.`,
      });
      return {
        ...base,
        flag: "overstock_risk",
        flags: ["overstock_risk"],
        trend_pct: null,
        recommended_action: "pause_next_order",
        recommended_qty: 0,
        is_exception: true,
      };
    }
    trace.push({ rule: "eligibility", detail: "No sales and no stock: nothing to do." });
    return { ...base, is_exception: reasons.length > 0 };
  }

  const trend = avg4 / avg12 - 1;
  base.trend_pct = trend;

  // 3. Festival uplift
  const demandAdj = ctx.festival ? avg12 * (1 + p.festival_uplift_pct / 100) : avg12;
  base.demand_adj = demandAdj;
  base.festival_applied = ctx.festival;
  if (ctx.festival) {
    trace.push({
      rule: "festival_uplift",
      detail: `Festival month: demand raised ${p.festival_uplift_pct}% from ${fmt(round1(avg12))} to ${fmt(round1(demandAdj))} units a week.`,
    });
  }

  // 4. Cover
  const cover = (stock + onOrder) / demandAdj;
  base.weeks_cover = cover;
  const coverText = `${stock} on hand${onOrder ? ` + ${onOrder} on order` : ""} covers ${fmt(round1(cover))} weeks at ${fmt(round1(demandAdj))} a week`;

  // 5. Thresholds by perishability
  const win = windowFor(sku, p);
  const flags: Flag[] = [];
  if (cover < win.min_weeks) {
    flags.push("stockout_risk");
    trace.push({
      rule: "stockout_threshold",
      detail: `${coverText}, below the ${win.min_weeks}-week minimum for ${sku.perishability}-perishability SKUs.`,
    });
  } else if (cover > win.max_weeks) {
    flags.push("overstock_risk");
    trace.push({
      rule: "overstock_threshold",
      detail: `${coverText}, above the ${win.max_weeks}-week maximum for ${sku.perishability}-perishability SKUs.`,
    });
  }

  // 6. Trend rule
  const highDemand = trend * 100 > p.trend_threshold_pct;
  if (highDemand) {
    flags.push("high_demand");
    trace.push({
      rule: "trend_high_demand",
      detail: `Last ${p.trend_window_weeks} weeks averaged ${fmt(round1(avg4))}, ${fmt(round1(trend * 100))}% above the ${p.avg_window_weeks}-week average of ${fmt(round1(avg12))} (threshold ${p.trend_threshold_pct}%).`,
    });
  }

  // 7. Recommended action and quantity; 10. floors and ceilings
  const std = sku.standard_reorder_qty;
  const cap = std * (p.max_qty_multiple ?? 3);
  const clampQty = (q: number) => Math.min(Math.max(0, Math.round(q)), cap);
  let action: Recommendation["recommended_action"] = "no_action";
  let qty: number | null = null;
  const stockout = flags.includes("stockout_risk");
  const overstock = flags.includes("overstock_risk");
  if (stockout) {
    action = "reorder_now";
    const raw = highDemand ? std * p.trend_reorder_multiplier : std;
    qty = clampQty(raw);
    trace.push(
      highDemand
        ? { rule: "reorder_trend_multiplier", detail: `Reorder now at ${p.trend_reorder_multiplier}x the standard ${std} = ${qty} units.` }
        : { rule: "reorder_standard", detail: `Reorder now at the standard quantity of ${qty} units.` },
    );
  } else if (overstock) {
    action = "pause_next_order";
    qty = 0;
    trace.push({ rule: "pause_order", detail: "Pause the next order (quantity 0)." });
  } else if (highDemand) {
    action = "reorder_now";
    qty = clampQty(std * p.trend_reorder_multiplier);
    trace.push({
      rule: "reorder_trend_multiplier",
      detail: `Reorder at ${p.trend_reorder_multiplier}x the standard ${std} = ${qty} units.`,
    });
  }
  if (qty != null && action === "reorder_now") {
    const raw = stockout && !highDemand ? std : std * p.trend_reorder_multiplier;
    if (Math.round(raw) > cap) {
      trace.push({ rule: "quantity_cap", detail: `Capped at ${cap} units (${p.max_qty_multiple ?? 3}x standard).` });
    }
  }

  // 8. Exception rules
  if (overstock && highDemand) reasons.push("conflicting_signals");
  if (ctx.festival && highDemand) reasons.push("possible_double_count");
  if (sku.perishability === "high" && overstock && ctx.festival && trend > 0) {
    reasons.push("perishable_pause_in_festival");
  }
  const shift = distributorShift(sales, window12, window4, p.distributor_share_shift_pp);
  if (shift.shifted) {
    reasons.push("distributor_shift");
    trace.push({ rule: "eligibility", detail: `Distributor mix changed: ${shift.detail}.` });
  }

  const primary: Flag = stockout ? "stockout_risk" : overstock ? "overstock_risk" : highDemand ? "high_demand" : "no_action";

  // 9. Rupee exposure (ranking input) when unit price exists
  let exposure: number | null = null;
  if (sku.unit_price != null) {
    if (stockout) exposure = (win.min_weeks - cover) * demandAdj * sku.unit_price;
    else if (overstock) exposure = (cover - win.max_weeks) * demandAdj * sku.unit_price;
    else exposure = 0;
  }

  return {
    ...base,
    flag: primary,
    flags,
    recommended_action: action,
    recommended_qty: qty,
    is_exception: reasons.length > 0,
    rupee_exposure: exposure,
  };
}

const SEVERITY: Record<Flag, number> = { stockout_risk: 0, overstock_risk: 1, high_demand: 2, no_action: 3 };

/** Step 9. Deterministic ordering; exported for the queue and backtest. */
export function compareRecommendations(a: Recommendation, b: Recommendation): number {
  const sev = SEVERITY[a.flag] - SEVERITY[b.flag];
  if (sev !== 0) return sev;
  if (a.rupee_exposure != null && b.rupee_exposure != null && a.rupee_exposure !== b.rupee_exposure) {
    return b.rupee_exposure - a.rupee_exposure;
  }
  if (a.weeks_cover != null && b.weeks_cover != null && a.weeks_cover !== b.weeks_cover) {
    // Stockouts and high demand: lowest cover first. Overstock: highest cover first.
    return a.flag === "overstock_risk" ? b.weeks_cover - a.weeks_cover : a.weeks_cover - b.weeks_cover;
  }
  if ((a.weeks_cover == null) !== (b.weeks_cover == null)) return a.weeks_cover == null ? 1 : -1;
  return a.sku_id < b.sku_id ? -1 : a.sku_id > b.sku_id ? 1 : 0;
}

export function isFlagged(r: Recommendation): boolean {
  return r.flag !== "no_action" || r.is_exception;
}

export function runEngine(input: EngineInput): EngineResult {
  const endWeek = lastCompleteWeek(input.asOfDate);
  const festival = input.festivalMonths.includes(yearMonthOf(input.asOfDate));
  const sales = indexSales(input);
  const inventory = indexInventory(input);
  const onOrder = indexOpenPos(input);
  const skipped: EngineResult["skipped"] = [];
  const masterIds = new Set(input.skus.map((s) => s.sku_id));

  for (const id of [...sales.keys()].sort()) {
    if (!masterIds.has(id)) skipped.push({ sku_id: id, reason: "In sales data but not in the SKU master" });
  }

  const recs: Recommendation[] = [];
  for (const sku of [...input.skus].sort((a, b) => (a.sku_id < b.sku_id ? -1 : 1))) {
    const s = sales.get(sku.sku_id);
    if (!s) {
      skipped.push({ sku_id: sku.sku_id, reason: "In the SKU master but has no sales rows" });
      continue;
    }
    const inv = inventory.get(sku.sku_id);
    if (!inv) {
      skipped.push({ sku_id: sku.sku_id, reason: "No inventory snapshot on or before the as-of date" });
      continue;
    }
    recs.push(
      evaluateSku(sku, s, inv.units, onOrder.get(sku.sku_id) ?? 0, {
        asOfDate: input.asOfDate,
        endWeek,
        festival,
        params: input.params,
      }),
    );
  }

  recs.sort((a, b) => {
    const fa = isFlagged(a) ? 0 : 1;
    const fb = isFlagged(b) ? 0 : 1;
    return fa - fb || compareRecommendations(a, b);
  });

  return {
    as_of_date: input.asOfDate,
    end_week: endWeek,
    festival_month: festival,
    recommendations: recs,
    features: detectFeatures(input),
    skipped,
  };
}
