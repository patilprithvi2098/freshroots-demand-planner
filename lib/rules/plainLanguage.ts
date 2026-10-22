// The rule logic in plain language, generated from the live parameters.
// This is the fallback document if the system is switched off and Raghav returns to Excel.

import type { RuleParams } from "./types";

export function rulesInPlainLanguage(p: RuleParams, version: number): string[] {
  return [
    `Rule set version ${version}.`,
    `1. Eligibility: an SKU needs at least ${p.avg_window_weeks} weeks of sales history. SKUs launched in the last ${p.new_launch_weeks} weeks, or with less history, go to manual review.`,
    `2. Averages: take the average weekly units over the last ${p.avg_window_weeks} complete weeks (avg${p.avg_window_weeks}) and over the last ${p.trend_window_weeks} weeks (avg${p.trend_window_weeks}). Trend = avg${p.trend_window_weeks} ÷ avg${p.avg_window_weeks} − 1, on raw sales. Missing weeks are left out, not counted as zero. No sales but stock on hand is "dead stock" and goes to manual review.`,
    `3. Festival uplift: if the as-of date is in a festival month (from the calendar file), demand = avg${p.avg_window_weeks} × ${1 + p.festival_uplift_pct / 100}. Otherwise demand = avg${p.avg_window_weeks}.`,
    `4. Weeks of cover = (units on hand + units on open purchase orders) ÷ demand.`,
    `5. Low-perishability SKUs: stockout risk below ${p.low_perishability.min_weeks} weeks of cover, overstock risk above ${p.low_perishability.max_weeks}. High-perishability SKUs: stockout risk below ${p.high_perishability.min_weeks} weeks, overstock risk above ${p.high_perishability.max_weeks}.`,
    `6. High demand: trend above ${p.trend_threshold_pct}%.`,
    `7. Action: stockout risk → reorder the standard quantity now (× ${p.trend_reorder_multiplier} if also high demand). Overstock risk → pause the next order. High demand alone → reorder × ${p.trend_reorder_multiplier}. Quantities are whole numbers, never negative, never above ${p.max_qty_multiple ?? 3} × the standard quantity.`,
    `8. Send to manual review (exception) when: overstock and high demand together; festival uplift and high demand together (possible double count); a high-perishability SKU would be paused in a festival month while sales are rising; more than ${p.max_missing_weeks ?? 2} of the last ${p.avg_window_weeks} weeks are missing; or a distributor's share of the SKU's sales moved by more than ${p.distributor_share_shift_pp} percentage points between the ${p.avg_window_weeks}-week and ${p.trend_window_weeks}-week windows.`,
    `9. Order of review: stockout risk first, then overstock, then high demand; within each, the largest rupee exposure first when unit prices exist, otherwise the lowest cover for stockouts and the highest cover for overstock; ties by SKU code.`,
    `Inventory older than ${p.stale_inventory_days} days needs an explicit confirmation before a run.`,
  ];
}
