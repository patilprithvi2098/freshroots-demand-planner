// An independent, deliberately plain re-implementation of the planner's rules, written from the
// spec text (lib/rules/plainLanguage.ts and the README "Decisions" section), not from engine.ts.
// It shares no code with lib/rules: its own ISO-week math, its own aggregation, no ranking.

import { dateMs, lastCompleteWeekOf, mondayMs, WEEK_MS, labelOfMs } from "@/scripts/stress/isoweek";
import type { EngineInput } from "@/lib/rules/types";

export interface OracleRow {
  sku_id: string;
  flags: string[]; // stockout_risk / overstock_risk / high_demand, in that order
  primary: string;
  avg12: number | null;
  avg4: number | null;
  trend: number | null;
  demand: number | null;
  cover: number | null;
  action: string;
  qty: number | null;
  exceptions: string[];
}

export interface OracleResult {
  end_week: string;
  festival: boolean;
  rows: OracleRow[];
  skipped: string[];
}

const ON_ORDER = ["open", "ordered", "in_transit", "partially_received"];

export function oracle(input: EngineInput): OracleResult {
  const p = input.params;
  const endWeek = lastCompleteWeekOf(input.asOfDate);
  const endMs = mondayMs(endWeek);
  const lastN = (k: number) => Array.from({ length: k }, (_, i) => labelOfMs(endMs - (k - 1 - i) * WEEK_MS));
  const w12 = lastN(p.avg_window_weeks);
  const w4 = lastN(p.trend_window_weeks);
  const festival = input.festivalMonths.includes(input.asOfDate.slice(0, 7));

  const bySku = <T extends { sku_id: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) (m.get(x.sku_id) ?? m.set(x.sku_id, []).get(x.sku_id)!).push(x);
    return m;
  };
  const salesOf = bySku(input.weeklySales);
  const stockOf = bySku(input.inventory);
  const posOf = bySku(input.openPurchaseOrders ?? []);

  const rows: OracleRow[] = [];
  const skipped: string[] = [];
  for (const sku of input.skus) {
    // Units per week (all distributors) and per distributor per week.
    const week = new Map<string, number>();
    const dist = new Map<string, Map<string, number>>();
    for (const r of salesOf.get(sku.sku_id) ?? []) {
      week.set(r.iso_week, (week.get(r.iso_week) ?? 0) + r.units_sold);
      if (r.distributor_id) {
        if (!dist.has(r.distributor_id)) dist.set(r.distributor_id, new Map());
        const d = dist.get(r.distributor_id)!;
        d.set(r.iso_week, (d.get(r.iso_week) ?? 0) + r.units_sold);
      }
    }
    // Stock: newest snapshot per location on or before the as-of date, added up.
    const newest = new Map<string, { date: string; units: number }>();
    for (const r of stockOf.get(sku.sku_id) ?? []) {
      if (r.as_of_date > input.asOfDate) continue;
      const loc = r.location ?? "?";
      const cur = newest.get(loc);
      if (!cur || r.as_of_date >= cur.date) newest.set(loc, { date: r.as_of_date, units: r.units_on_hand });
    }
    if (week.size === 0 || newest.size === 0) {
      skipped.push(sku.sku_id);
      continue;
    }
    const stock = [...newest.values()].reduce((a, b) => a + b.units, 0);
    const onOrder = (posOf.get(sku.sku_id) ?? [])
      .filter((o) => ON_ORDER.includes(o.status.toLowerCase()))
      .reduce((a, o) => a + o.qty, 0);

    const row: OracleRow = {
      sku_id: sku.sku_id,
      flags: [],
      primary: "no_action",
      avg12: null,
      avg4: null,
      trend: null,
      demand: null,
      cover: null,
      action: "no_action",
      qty: null,
      exceptions: [],
    };
    rows.push(row);

    // Rule 1: eligibility.
    const history = [...week.keys()].filter((w) => mondayMs(w) <= endMs).length;
    if (history < p.avg_window_weeks) row.exceptions.push("insufficient_history");
    if (sku.launch_date && sku.launch_date <= input.asOfDate) {
      const days = (dateMs(input.asOfDate) - dateMs(sku.launch_date)) / 86_400_000;
      if (days < p.new_launch_weeks * 7) row.exceptions.push("new_launch");
    }
    if (row.exceptions.length) {
      row.action = "manual_review";
      continue;
    }

    // Rule 2: averages over the weeks that have rows; gaps are not zeros.
    const present = (ws: string[]) => ws.filter((w) => week.has(w)).map((w) => week.get(w)!);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const a12 = avg(present(w12));
    const a4 = avg(present(w4));
    row.avg12 = a12;
    row.avg4 = a4;
    const missing = w12.length - present(w12).length;
    if (missing > (p.max_missing_weeks ?? 2)) row.exceptions.push("data_gaps");
    if (a12 === 0) {
      if (stock > 0) {
        row.exceptions.push("dead_stock");
        row.flags = ["overstock_risk"];
        row.primary = "overstock_risk";
        row.action = "pause_next_order";
        row.qty = 0;
      }
      continue;
    }
    const trend = a4 / a12 - 1;
    row.trend = trend;

    // Rule 3: festival uplift. Rule 4: cover. Rule 5: thresholds. Rule 6: trend.
    const demand = festival ? a12 * (1 + p.festival_uplift_pct / 100) : a12;
    row.demand = demand;
    const cover = (stock + onOrder) / demand;
    row.cover = cover;
    const win = sku.perishability === "high" ? p.high_perishability : p.low_perishability;
    const stockout = cover < win.min_weeks;
    const overstock = !stockout && cover > win.max_weeks;
    const high = trend * 100 > p.trend_threshold_pct;
    if (stockout) row.flags.push("stockout_risk");
    if (overstock) row.flags.push("overstock_risk");
    if (high) row.flags.push("high_demand");
    row.primary = row.flags[0] ?? "no_action";

    // Rule 7: action and quantity.
    const std = sku.standard_reorder_qty;
    const cap = std * (p.max_qty_multiple ?? 3);
    const whole = (q: number) => Math.min(cap, Math.max(0, Math.round(q)));
    if (stockout) {
      row.action = "reorder_now";
      row.qty = whole(high ? std * p.trend_reorder_multiplier : std);
    } else if (overstock) {
      row.action = "pause_next_order";
      row.qty = 0;
    } else if (high) {
      row.action = "reorder_now";
      row.qty = whole(std * p.trend_reorder_multiplier);
    }

    // Rule 8: exceptions.
    if (overstock && high) row.exceptions.push("conflicting_signals");
    if (festival && high) row.exceptions.push("possible_double_count");
    if (sku.perishability === "high" && overstock && festival && trend > 0) row.exceptions.push("perishable_pause_in_festival");
    if (dist.size > 0) {
      const shares = (ws: string[]) => {
        const per = [...dist].map(([id, m]) => [id, ws.reduce((a, w) => a + (m.get(w) ?? 0), 0)] as const);
        const total = per.reduce((a, [, v]) => a + v, 0);
        return { per: new Map(per), total };
      };
      const s12 = shares(w12);
      const s4 = shares(w4);
      if (s12.total > 0 && s4.total > 0) {
        const moved = [...dist.keys()].some(
          (id) => Math.abs(s4.per.get(id)! / s4.total - s12.per.get(id)! / s12.total) * 100 > p.distributor_share_shift_pp,
        );
        if (moved) row.exceptions.push("distributor_shift");
      }
    }
  }
  return { end_week: endWeek, festival, rows, skipped };
}
