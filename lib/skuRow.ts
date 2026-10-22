// The shape every screen uses for one SKU recommendation (review list, overview, pop-up).
import type { RecommendationRow } from "@/lib/supabase/database.types";

export interface SkuRow {
  id: string;
  run_id: string;
  rank: number;
  sku_id: string;
  sku_name: string;
  perishability: string;
  distributor_id: string | null;
  weeks_cover: number | null;
  trend_pct: number | null;
  avg12: number | null;
  demand_adj: number | null;
  units_on_hand: number | null;
  on_order_units: number | null;
  flag: string;
  flags: string[];
  rules_fired: { rule: string; detail: string }[];
  recent_sales: { iso_week: string; units: number | null }[];
  recommended_action: string;
  recommended_qty: number | null;
  is_exception: boolean;
  exception_reasons: string[];
  rationale: string | null;
  check_first: string | null;
  ai_status: string;
  status: string;
  final_qty: number | null;
  override_reason_code: string | null;
  override_note: string | null;
  released_at: string | null;
  rupee_exposure: number | null;
  festival_applied: boolean;
  /** Safe cover window for this SKU's perishability, in weeks. */
  window: { min: number; max: number };
  /** Units needed to reach the minimum cover (stockouts), or above the maximum (overstock). */
  gap_units: number | null;
  misfit: boolean;
}

const num = (v: number | null) => (v == null ? null : Number(v));

export function toSkuRow(
  r: RecommendationRow,
  windows: { low: { min: number; max: number }; high: { min: number; max: number } },
  misfit = false,
): SkuRow {
  const window = r.perishability === "high" ? windows.high : windows.low;
  const cover = num(r.weeks_cover);
  const demand = num(r.demand_adj);
  let gap: number | null = null;
  if (cover != null && demand != null) {
    if (cover < window.min) gap = Math.round((window.min - cover) * demand);
    else if (cover > window.max) gap = Math.round((cover - window.max) * demand);
  }
  return {
    id: r.id,
    run_id: r.run_id,
    rank: r.rank,
    sku_id: r.sku_id,
    sku_name: r.sku_name,
    perishability: r.perishability,
    distributor_id: r.distributor_id,
    weeks_cover: cover,
    trend_pct: num(r.trend_pct),
    avg12: num(r.avg12),
    demand_adj: demand,
    units_on_hand: r.units_on_hand,
    on_order_units: r.on_order_units,
    flag: r.flag,
    flags: r.flags,
    rules_fired: r.rules_fired as SkuRow["rules_fired"],
    recent_sales: r.recent_sales as SkuRow["recent_sales"],
    recommended_action: r.recommended_action,
    recommended_qty: r.recommended_qty,
    is_exception: r.is_exception,
    exception_reasons: r.exception_reasons,
    rationale: r.rationale,
    check_first: r.check_first,
    ai_status: r.ai_status,
    status: r.status,
    final_qty: r.final_qty,
    override_reason_code: r.override_reason_code,
    override_note: r.override_note,
    released_at: r.released_at,
    rupee_exposure: num(r.rupee_exposure),
    festival_applied: r.festival_applied,
    window,
    gap_units: gap,
    misfit,
  };
}

export const needsReview = (r: SkuRow) => r.flag !== "no_action" || r.is_exception;

/** "Freshroots Mango Drink 200ml" → "Mango Drink 200ml": every product carries the brand, so lists drop it. */
export const shortName = (name: string) => name.replace(/^freshroots\s+/i, "");
