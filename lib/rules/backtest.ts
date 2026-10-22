// Backtest: replay the rules over every historical week. Pure, deterministic.
// A week is replayed "as of" the Monday after it, which is how a live run sees it.
// Cover rules need an inventory snapshot from that time; weeks without one are replayed on the trend rule only.

import { isFlagged, runEngine } from "./engine";
import { addIsoWeeks, compareIsoWeeks, mondayOfIsoWeek, weekWindow, yearMonthOf } from "./isoWeek";
import type { EngineInput, Flag, RecommendedAction } from "./types";

export interface HistoricalDecision {
  sku_id: string;
  iso_week: string;
  action: Exclude<RecommendedAction, "manual_review">;
}

export interface BacktestWeek {
  iso_week: string;
  as_of_date: string;
  mode: "full" | "trend_only";
  festival: boolean;
  sku_count: number;
  stockout_risk: number;
  overstock_risk: number;
  high_demand: number;
  exceptions: number;
  flagged: number;
}

export interface BacktestFlag {
  iso_week: string;
  sku_id: string;
  flag: Flag;
  is_exception: boolean;
  action: RecommendedAction;
}

export interface BacktestResult {
  weeks: BacktestWeek[];
  flags: BacktestFlag[];
  festival_flag_share: number | null;
  non_festival_flag_share: number | null;
  agreement: { compared: number; agreed: number; pct: number | null; note: string };
}

export function runBacktest(
  base: Omit<EngineInput, "asOfDate">,
  decisions: HistoricalDecision[] = [],
): BacktestResult {
  const weeksPresent = [...new Set(base.weeklySales.map((r) => r.iso_week))].sort(compareIsoWeeks);
  if (weeksPresent.length === 0) {
    return {
      weeks: [],
      flags: [],
      festival_flag_share: null,
      non_festival_flag_share: null,
      agreement: { compared: 0, agreed: 0, pct: null, note: "No sales data." },
    };
  }
  const first = weeksPresent[0];
  const last = weeksPresent[weeksPresent.length - 1];
  const p = base.params;
  // First week with a full averaging window behind it.
  const startWeek = addIsoWeeks(first, p.avg_window_weeks - 1);
  const allWeeks: string[] = [];
  for (let w = startWeek; compareIsoWeeks(w, last) <= 0; w = addIsoWeeks(w, 1)) allWeeks.push(w);

  const weeks: BacktestWeek[] = [];
  const flags: BacktestFlag[] = [];
  const actionByKey = new Map<string, { action: RecommendedAction; exception: boolean }>();

  for (const week of allWeeks) {
    const asOf = mondayOfIsoWeek(addIsoWeeks(week, 1));
    const festival = base.festivalMonths.includes(yearMonthOf(asOf));
    // Inventory valid for this week: a snapshot within the staleness window before the as-of date.
    const minDate = new Date(new Date(`${asOf}T00:00:00Z`).getTime() - p.stale_inventory_days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const inventory = base.inventory.filter((i) => i.as_of_date <= asOf && i.as_of_date >= minDate);
    const haveInventory = new Set(inventory.map((i) => i.sku_id));
    const mode: BacktestWeek["mode"] = base.skus.some((s) => haveInventory.has(s.sku_id)) ? "full" : "trend_only";

    let stats = { sku_count: 0, stockout_risk: 0, overstock_risk: 0, high_demand: 0, exceptions: 0, flagged: 0 };

    if (mode === "full") {
      const res = runEngine({ ...base, asOfDate: asOf, inventory });
      for (const r of res.recommendations) {
        stats.sku_count++;
        if (r.flags.includes("stockout_risk")) stats.stockout_risk++;
        if (r.flags.includes("overstock_risk")) stats.overstock_risk++;
        if (r.flags.includes("high_demand")) stats.high_demand++;
        if (r.is_exception) stats.exceptions++;
        if (isFlagged(r)) {
          stats.flagged++;
          flags.push({ iso_week: week, sku_id: r.sku_id, flag: r.flag, is_exception: r.is_exception, action: r.recommended_action });
        }
        actionByKey.set(`${r.sku_id}|${week}`, { action: r.recommended_action, exception: r.is_exception });
      }
    } else {
      stats = trendOnlyWeek(base, week, flags);
    }
    weeks.push({ iso_week: week, as_of_date: asOf, mode, festival, ...stats });
  }

  const share = (ws: BacktestWeek[]) => {
    const skus = ws.reduce((a, w) => a + w.sku_count, 0);
    return skus === 0 ? null : ws.reduce((a, w) => a + w.flagged, 0) / skus;
  };

  // Agreement on rule-governed SKUs: weeks replayed in full, where the engine did not raise an exception.
  let compared = 0;
  let agreed = 0;
  for (const d of decisions) {
    const engine = actionByKey.get(`${d.sku_id}|${d.iso_week}`);
    if (!engine || engine.exception) continue;
    compared++;
    if (engine.action === d.action) agreed++;
  }
  const note =
    decisions.length === 0
      ? "Upload historical decisions to measure agreement."
      : compared === 0
        ? "No historical decisions fall on fully replayed, rule-governed SKU-weeks (an inventory snapshot from that week is needed)."
        : `Compared ${compared} rule-governed SKU-weeks.`;

  return {
    weeks,
    flags,
    festival_flag_share: share(weeks.filter((w) => w.festival)),
    non_festival_flag_share: share(weeks.filter((w) => !w.festival)),
    agreement: { compared, agreed, pct: compared === 0 ? null : agreed / compared, note },
  };
}

function trendOnlyWeek(base: Omit<EngineInput, "asOfDate">, week: string, flags: BacktestFlag[]) {
  const p = base.params;
  const w12 = weekWindow(week, p.avg_window_weeks);
  const w4 = weekWindow(week, p.trend_window_weeks);
  const bySku = new Map<string, Map<string, number>>();
  for (const r of base.weeklySales) {
    let m = bySku.get(r.sku_id);
    if (!m) bySku.set(r.sku_id, (m = new Map()));
    m.set(r.iso_week, (m.get(r.iso_week) ?? 0) + r.units_sold);
  }
  const stats = { sku_count: 0, stockout_risk: 0, overstock_risk: 0, high_demand: 0, exceptions: 0, flagged: 0 };
  for (const sku of [...base.skus].sort((a, b) => (a.sku_id < b.sku_id ? -1 : 1))) {
    const m = bySku.get(sku.sku_id);
    if (!m) continue;
    const v12 = w12.filter((w) => m.has(w)).map((w) => m.get(w)!);
    const v4 = w4.filter((w) => m.has(w)).map((w) => m.get(w)!);
    if (v12.length < p.avg_window_weeks - (p.max_missing_weeks ?? 2) || v4.length === 0) continue;
    stats.sku_count++;
    const avg12 = v12.reduce((a, b) => a + b, 0) / v12.length;
    const avg4 = v4.reduce((a, b) => a + b, 0) / v4.length;
    if (avg12 > 0 && (avg4 / avg12 - 1) * 100 > p.trend_threshold_pct) {
      stats.high_demand++;
      stats.flagged++;
      flags.push({ iso_week: week, sku_id: sku.sku_id, flag: "high_demand", is_exception: false, action: "reorder_now" });
    }
  }
  return stats;
}
