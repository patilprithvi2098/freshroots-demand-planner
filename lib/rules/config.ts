import { z } from "zod";
import type { RuleParams } from "./types";

export const DEFAULT_PARAMS: RuleParams = {
  festival_uplift_pct: 25,
  avg_window_weeks: 12,
  trend_window_weeks: 4,
  trend_threshold_pct: 20,
  trend_reorder_multiplier: 1.5,
  low_perishability: { min_weeks: 6, max_weeks: 14 },
  high_perishability: { min_weeks: 3, max_weeks: 4 },
  new_launch_weeks: 8,
  stale_inventory_days: 4,
  distributor_share_shift_pp: 15,
  max_ai_calls_per_run: 80,
  max_missing_weeks: 2,
  max_qty_multiple: 3,
};

const window = z
  .object({ min_weeks: z.number().positive(), max_weeks: z.number().positive() })
  .refine((w) => w.min_weeks < w.max_weeks, "min_weeks must be below max_weeks");

export const ruleParamsSchema = z
  .object({
    festival_uplift_pct: z.number().min(0).max(200),
    avg_window_weeks: z.number().int().min(4).max(52),
    trend_window_weeks: z.number().int().min(1).max(26),
    trend_threshold_pct: z.number().min(0).max(500),
    trend_reorder_multiplier: z.number().min(1).max(3),
    low_perishability: window,
    high_perishability: window,
    new_launch_weeks: z.number().int().min(0).max(52),
    stale_inventory_days: z.number().int().min(0).max(60),
    distributor_share_shift_pp: z.number().min(0).max(100),
    max_ai_calls_per_run: z.number().int().min(0).max(80),
    max_missing_weeks: z.number().int().min(0).max(12).optional(),
    max_qty_multiple: z.number().min(1).max(10).optional(),
  })
  .refine((p) => p.trend_window_weeks < p.avg_window_weeks, {
    message: "trend_window_weeks must be shorter than avg_window_weeks",
  });

export function resolveParams(params: Partial<RuleParams> | null | undefined): RuleParams {
  return { ...DEFAULT_PARAMS, ...(params ?? {}) };
}
