// Indian number formatting (en-IN) and rupee display everywhere money appears.

const int = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rupee = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export const fmtInt = (n: number | null | undefined) => (n == null ? "–" : int.format(n));
export const fmt1 = (n: number | null | undefined) => (n == null ? "–" : one.format(Number(n)));
export const fmtRupees = (n: number | null | undefined) => (n == null ? "–" : rupee.format(Number(n)));
export const fmtPct = (fraction: number | null | undefined, signed = false) => {
  if (fraction == null) return "–";
  const v = Number(fraction) * 100;
  return `${signed && v > 0 ? "+" : ""}${one.format(v)}%`;
};
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "–";
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "–";

export const FLAG_LABEL: Record<string, string> = {
  stockout_risk: "Stockout risk",
  overstock_risk: "Overstock risk",
  high_demand: "High demand",
  no_action: "No action",
};

export const ACTION_LABEL: Record<string, string> = {
  reorder_now: "Reorder now",
  pause_next_order: "Pause next order",
  manual_review: "Manual review",
  no_action: "No action",
};

export const EXCEPTION_LABEL: Record<string, string> = {
  insufficient_history: "Short history",
  new_launch: "New launch",
  dead_stock: "Dead stock",
  conflicting_signals: "Conflicting signals",
  possible_double_count: "Possible double count",
  perishable_pause_in_festival: "Perishable pause in festival",
  data_gaps: "Data gaps",
  distributor_shift: "Distributor shift",
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  edited: "Edited",
  rejected: "Rejected",
};
