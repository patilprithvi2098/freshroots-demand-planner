// Loop 1 (outcome loop), Signal → Capture: what happened in the four weeks after a decision.
// Pure: decisions and later SAP data in, one labelled outcome per decision out. See docs/feedback-loops.md.

import { addIsoWeeks, compareIsoWeeks, lastCompleteWeek, mondayOfIsoWeek, sundayOfIsoWeek } from "@/lib/rules/isoWeek";

export const OUTCOME_WEEKS = 4;
/** With no stock snapshot in a week, sales below this share of the usual rate count as a probable stock-out. */
export const STOCKOUT_SALES_SHARE = 0.1;

export type OutcomeResult = "stocked_out" | "wrote_off" | "overstocked" | "ok";
/** Who the outcome is attributed to: the rule as recommended, or Raghav's change or rejection. */
export type OutcomeDriver = "rule" | "override" | "undecided";

export interface DecisionForOutcome {
  recommendation_id: string;
  sku_id: string;
  /** As-of date of the run that made the recommendation. */
  as_of_date: string;
  /** Safe cover window for the SKU, in weeks. */
  window: { min: number; max: number };
  /** Usual weekly sales at the time (12-week average). */
  avg12: number | null;
  status: string; // pending | approved | edited | rejected
}

export interface LaterData {
  weeklySales: { sku_id: string; iso_week: string; units_sold: number }[];
  inventory: { sku_id: string; location?: string; units_on_hand: number; as_of_date: string }[];
  /** Null when no write-off file has been uploaded: write-offs are then unknown, not zero. */
  writeOffs: { sku_id: string; iso_week: string; units: number }[] | null;
  /** Latest week with uploaded sales. An outcome is measured only once its four weeks are all in. */
  latestSalesWeek: string | null;
}

export interface Outcome {
  recommendation_id: string;
  sku_id: string;
  horizon_start_week: string;
  horizon_end_week: string;
  /** Date the outcome is measured at: the Sunday that ends the horizon. */
  measured_at: string;
  stockout_weeks: number;
  stock_after_4_weeks: number | null;
  written_off_units: number | null;
  result: OutcomeResult;
  driver: OutcomeDriver;
  /** Plain-language reasons, one per finding, for the pop-up and Claude's context. */
  evidence: string[];
}

export function driverOf(status: string): OutcomeDriver {
  if (status === "edited" || status === "rejected") return "override";
  if (status === "approved") return "rule";
  return "undecided";
}

/** Total stock per date for one SKU: the latest snapshot per location on each date, summed. */
function stockByDate(rows: LaterData["inventory"]): Map<string, number> {
  const perLoc = new Map<string, number>();
  for (const r of rows) perLoc.set(`${r.as_of_date}\u0000${r.location ?? ""}`, r.units_on_hand);
  const byDate = new Map<string, number>();
  for (const [key, units] of perLoc) {
    const date = key.split("\u0000")[0];
    byDate.set(date, (byDate.get(date) ?? 0) + units);
  }
  return byDate;
}

/** Outcome for one decision, or null while its four weeks are not all uploaded yet. */
export function computeOutcome(d: DecisionForOutcome, later: LaterData): Outcome | null {
  const endOfRun = lastCompleteWeek(d.as_of_date);
  const horizon = Array.from({ length: OUTCOME_WEEKS }, (_, i) => addIsoWeeks(endOfRun, i + 1));
  const last = horizon[horizon.length - 1];
  if (!later.latestSalesWeek || compareIsoWeeks(later.latestSalesWeek, last) < 0) return null;

  const sales = new Map<string, number>();
  for (const r of later.weeklySales) {
    if (r.sku_id !== d.sku_id || !horizon.includes(r.iso_week)) continue;
    sales.set(r.iso_week, (sales.get(r.iso_week) ?? 0) + r.units_sold);
  }
  const stock = stockByDate(later.inventory.filter((r) => r.sku_id === d.sku_id && r.as_of_date > d.as_of_date));
  const evidence: string[] = [];

  // Stock-out weeks: a zero stock snapshot that week, or, without a snapshot, sales collapsing to near zero.
  let stockoutWeeks = 0;
  for (const w of horizon) {
    const from = mondayOfIsoWeek(w);
    const to = sundayOfIsoWeek(w);
    const snaps = [...stock].filter(([date]) => date >= from && date <= to);
    if (snaps.length) {
      if (snaps.some(([, units]) => units === 0)) {
        stockoutWeeks++;
        evidence.push(`Stock hit zero in ${w}.`);
      }
      continue;
    }
    const sold = sales.get(w);
    if (d.avg12 && d.avg12 > 0 && sold != null && sold < d.avg12 * STOCKOUT_SALES_SHARE) {
      stockoutWeeks++;
      evidence.push(`Sales fell to ${sold} in ${w} against a usual ${Math.round(d.avg12)}: probably out of stock (no stock snapshot that week).`);
    }
  }

  const endDate = sundayOfIsoWeek(last);
  const lastSnap = [...stock].filter(([date]) => date <= endDate).sort(([a], [b]) => (a < b ? -1 : 1)).pop();
  const stockAfter = lastSnap ? lastSnap[1] : null;

  const writtenOff =
    later.writeOffs == null
      ? null
      : later.writeOffs.filter((r) => r.sku_id === d.sku_id && horizon.includes(r.iso_week)).reduce((a, r) => a + r.units, 0);
  if (writtenOff) evidence.push(`${writtenOff} units written off in the four weeks.`);

  // Overstock after the horizon: stock left against the rate it actually sold at in those weeks.
  const soldWeeks = horizon.map((w) => sales.get(w)).filter((v): v is number => v != null);
  const rate = soldWeeks.length ? soldWeeks.reduce((a, b) => a + b, 0) / soldWeeks.length : null;
  let overstocked = false;
  if (stockAfter != null && rate != null) {
    const cover = rate > 0 ? stockAfter / rate : stockAfter > 0 ? Infinity : 0;
    if (cover > d.window.max) {
      overstocked = true;
      evidence.push(
        rate > 0
          ? `${stockAfter} units left after four weeks: ${cover.toFixed(1)} weeks at the rate it sold, above the ${d.window.max}-week maximum.`
          : `${stockAfter} units left after four weeks with no sales.`,
      );
    }
  }

  const result: OutcomeResult = stockoutWeeks > 0 ? "stocked_out" : writtenOff ? "wrote_off" : overstocked ? "overstocked" : "ok";
  if (result === "ok") evidence.push("No stock-out, write-off or excess stock in the four weeks.");

  return {
    recommendation_id: d.recommendation_id,
    sku_id: d.sku_id,
    horizon_start_week: horizon[0],
    horizon_end_week: last,
    measured_at: endDate,
    stockout_weeks: stockoutWeeks,
    stock_after_4_weeks: stockAfter,
    written_off_units: writtenOff,
    result,
    driver: driverOf(d.status),
    evidence,
  };
}

export interface HitRates {
  decisions: number;
  rule: { n: number; ok: number; rate: number | null };
  override: { n: number; ok: number; rate: number | null };
}

/** Measurement: how often the rule as recommended, and Raghav's overrides, ended well. */
export function hitRates(outcomes: Pick<Outcome, "result" | "driver">[]): HitRates {
  const part = (driver: OutcomeDriver) => {
    const xs = outcomes.filter((o) => o.driver === driver);
    const ok = xs.filter((o) => o.result === "ok").length;
    return { n: xs.length, ok, rate: xs.length ? ok / xs.length : null };
  };
  return { decisions: outcomes.length, rule: part("rule"), override: part("override") };
}
