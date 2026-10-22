// Database types, condensed from `supabase gen types` output for supabase/migrations.
// Regenerate with the Supabase CLI or MCP `generate_typescript_types` after schema changes.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ProfileRow = { id: string; email: string; role: string; created_at: string };
export type DistributorRow = { distributor_id: string; name: string; region: string; status: string; created_at: string };
export type SkuRow = {
  sku_id: string;
  name: string;
  category: string;
  perishability: string;
  standard_reorder_qty: number;
  unit_of_measure: string;
  distributor_id: string | null;
  launch_date: string | null;
  unit_price: number | null;
  lead_time_days: number | null;
  created_at: string;
};
export type WeeklySalesRow = {
  id: string;
  sku_id: string;
  iso_week: string;
  units_sold: number;
  distributor_id: string | null;
  distributor_key: string | null;
  created_at: string;
};
export type InventorySnapshotRow = {
  id: string;
  sku_id: string;
  location: string;
  units_on_hand: number;
  as_of_date: string;
  created_at: string;
};
export type OpenPurchaseOrderRow = {
  po_id: string;
  sku_id: string;
  qty: number;
  ordered_date: string;
  expected_date: string | null;
  status: string;
  created_at: string;
};
export type CalendarRow = { year_month: string; year: number; month: number; is_festival_month: boolean; created_at: string };
export type HistoricalDecisionRow = {
  id: string;
  sku_id: string;
  iso_week: string;
  action: string;
  qty: number | null;
  created_at: string;
};
export type UploadBatchRow = {
  id: string;
  file_type: string;
  filename: string;
  file_hash: string;
  uploaded_by: string | null;
  row_count: number;
  status: string;
  warnings: Json;
  created_at: string;
};
export type RuleConfigRow = {
  id: string;
  version: number;
  params: Json;
  created_by: string | null;
  active: boolean;
  created_at: string;
};
export type RunRow = {
  id: string;
  run_date: string;
  as_of_date: string;
  triggered_by: string;
  config_version: number;
  status: string;
  sku_count: number;
  flagged_count: number;
  exception_count: number;
  features: Json;
  skipped: Json;
  stale_inventory_confirmed: boolean;
  error: string | null;
  created_at: string;
};
export type RecommendationRow = {
  id: string;
  run_id: string;
  sku_id: string;
  sku_name: string;
  distributor_id: string | null;
  perishability: string;
  flag: string;
  flags: string[];
  rules_fired: Json;
  weeks_cover: number | null;
  trend_pct: number | null;
  avg12: number | null;
  demand_adj: number | null;
  units_on_hand: number | null;
  on_order_units: number | null;
  festival_applied: boolean;
  recent_sales: Json;
  rupee_exposure: number | null;
  rank: number;
  recommended_action: string;
  recommended_qty: number | null;
  is_exception: boolean;
  exception_reasons: string[];
  rationale: string | null;
  check_first: string | null;
  ai_status: string;
  status: string;
  final_qty: number | null;
  decided_by: string | null;
  decided_at: string | null;
  override_reason_code: string | null;
  override_note: string | null;
  released_at: string | null;
  created_at: string;
};
export type AiCallRow = {
  id: string;
  run_id: string | null;
  recommendation_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  ok: boolean;
  error: string | null;
  created_at: string;
};
export type OutcomeRow = {
  id: string;
  recommendation_id: string;
  measured_at: string;
  stock_after_4_weeks: number | null;
  stockout_weeks: number;
  written_off_units: number | null;
  created_at: string;
};
export type BacktestResultRow = {
  id: string;
  run_at: string;
  config_version: number;
  weeks_replayed: number;
  agreement_pct: number | null;
  detail: Json;
  created_at: string;
};
export type AuditLogRow = {
  id: string;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Json;
  created_at: string;
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      profiles: Table<ProfileRow, "id" | "email">;
      distributors: Table<DistributorRow, "distributor_id" | "name" | "region" | "status">;
      skus: Table<SkuRow, "sku_id" | "name" | "category" | "perishability" | "standard_reorder_qty" | "unit_of_measure">;
      weekly_sales: Table<WeeklySalesRow, "sku_id" | "iso_week" | "units_sold">;
      inventory_snapshots: Table<InventorySnapshotRow, "sku_id" | "location" | "units_on_hand" | "as_of_date">;
      open_purchase_orders: Table<OpenPurchaseOrderRow, "po_id" | "sku_id" | "qty" | "ordered_date" | "status">;
      calendar: Table<CalendarRow, "year_month" | "year" | "month">;
      historical_decisions: Table<HistoricalDecisionRow, "sku_id" | "iso_week" | "action">;
      upload_batches: Table<UploadBatchRow, "file_type" | "filename" | "file_hash" | "row_count" | "status">;
      rule_config: Table<RuleConfigRow, "version" | "params">;
      runs: Table<RunRow, "as_of_date" | "triggered_by" | "config_version" | "status">;
      recommendations: Table<
        RecommendationRow,
        "run_id" | "sku_id" | "sku_name" | "perishability" | "flag" | "rank" | "recommended_action"
      >;
      ai_calls: Table<AiCallRow, "model" | "ok">;
      outcomes: Table<OutcomeRow, "recommendation_id" | "measured_at">;
      backtest_results: Table<BacktestResultRow, "config_version" | "weeks_replayed">;
      audit_log: Table<AuditLogRow, "action" | "entity">;
    };
    Views: { [_ in never]: never };
    Functions: {
      app_role: { Args: never; Returns: string };
      save_rule_config: { Args: { new_params: Json }; Returns: number };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
