// Shared types for the rules engine. The engine is pure: callers load data and pass it in.

export type Perishability = "high" | "low";
export type Flag = "stockout_risk" | "overstock_risk" | "high_demand" | "no_action";
export type RecommendedAction = "reorder_now" | "pause_next_order" | "manual_review" | "no_action";

export type ExceptionReason =
  | "insufficient_history"
  | "new_launch"
  | "dead_stock"
  | "conflicting_signals"
  | "possible_double_count"
  | "perishable_pause_in_festival"
  | "data_gaps"
  | "distributor_shift";

export type RuleId =
  | "eligibility"
  | "festival_uplift"
  | "stockout_threshold"
  | "overstock_threshold"
  | "trend_high_demand"
  | "reorder_standard"
  | "reorder_trend_multiplier"
  | "pause_order"
  | "quantity_cap";

export interface RuleParams {
  festival_uplift_pct: number;
  avg_window_weeks: number;
  trend_window_weeks: number;
  trend_threshold_pct: number;
  trend_reorder_multiplier: number;
  low_perishability: { min_weeks: number; max_weeks: number };
  high_perishability: { min_weeks: number; max_weeks: number };
  new_launch_weeks: number;
  stale_inventory_days: number;
  distributor_share_shift_pp: number;
  max_ai_calls_per_run: number;
  /** Not in the original list; documented: weeks missing in the average window before data_gaps fires. */
  max_missing_weeks?: number;
  /** Not in the original list; documented: quantity ceiling as a multiple of standard_reorder_qty. */
  max_qty_multiple?: number;
}

export interface SkuInput {
  sku_id: string;
  name: string;
  perishability: Perishability;
  standard_reorder_qty: number;
  distributor_id: string | null;
  launch_date?: string | null;
  unit_price?: number | null;
  lead_time_days?: number | null;
}

export interface WeeklySaleInput {
  sku_id: string;
  iso_week: string;
  units_sold: number;
  distributor_id?: string | null;
}

export interface InventoryInput {
  sku_id: string;
  location?: string;
  units_on_hand: number;
  as_of_date: string;
}

export interface OpenPoInput {
  sku_id: string;
  qty: number;
  status: string;
}

export interface EngineInput {
  asOfDate: string;
  skus: SkuInput[];
  weeklySales: WeeklySaleInput[];
  inventory: InventoryInput[];
  /** Omit or pass null when no open PO data has been loaded. */
  openPurchaseOrders?: OpenPoInput[] | null;
  /** Year_Month strings (YYYY-MM) that are festival months. */
  festivalMonths: string[];
  params: RuleParams;
}

export interface RuleTraceEntry {
  rule: RuleId;
  /** Plain-language explanation with the numbers used. */
  detail: string;
}

export interface Recommendation {
  sku_id: string;
  name: string;
  perishability: Perishability;
  distributor_id: string | null;
  flag: Flag;
  /** Secondary flags that also fired (e.g. high_demand alongside stockout_risk). */
  flags: Flag[];
  rules_fired: RuleTraceEntry[];
  weeks_cover: number | null;
  trend_pct: number | null;
  avg12: number | null;
  avg4: number | null;
  demand_adj: number | null;
  units_on_hand: number;
  on_order_units: number;
  festival_applied: boolean;
  recommended_action: RecommendedAction;
  recommended_qty: number | null;
  is_exception: boolean;
  exception_reasons: ExceptionReason[];
  missing_weeks: string[];
  rupee_exposure: number | null;
  /** Weekly units for the most recent 16 weeks (null = no row for that week). */
  recent_sales: { iso_week: string; units: number | null }[];
}

export interface EngineResult {
  as_of_date: string;
  end_week: string;
  festival_month: boolean;
  /** Ranked: flagged and exception SKUs first, then no-action rows. */
  recommendations: Recommendation[];
  features: FeatureStatus;
  skipped: { sku_id: string; reason: string }[];
}

export interface FeatureStatus {
  unit_price: boolean;
  lead_time: boolean;
  launch_date: boolean;
  distributor_sales: boolean;
  open_purchase_orders: boolean;
  festival_calendar: boolean;
}
