// What Raghav did with each SKU in his recent runs, so the Review list can say
// "You changed this in 3 of your last 4 runs, usually to 600". Pure: rows in, summary out.

export interface PastDecision {
  run_id: string;
  run_date: string;
  sku_id: string;
  status: string; // approved | edited | rejected
  recommended_qty: number | null;
  final_qty: number | null;
  override_reason_code: string | null;
}

export interface SkuHistory {
  /** Runs (most recent first, at most `maxRuns`) in which this SKU got a decision. */
  decided: number;
  changed: number;
  rejected: number;
  /** Median final quantity of his changes, when he changed it at least twice. */
  usualQty: number | null;
  lastReason: string | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function buildHistory(past: PastDecision[], maxRuns = 4): Map<string, SkuHistory> {
  const bySku = new Map<string, PastDecision[]>();
  for (const d of past) {
    if (!["approved", "edited", "rejected"].includes(d.status)) continue;
    (bySku.get(d.sku_id) ?? bySku.set(d.sku_id, []).get(d.sku_id)!).push(d);
  }
  const out = new Map<string, SkuHistory>();
  for (const [sku, list] of bySku) {
    const recent = [...list].sort((a, b) => (a.run_date < b.run_date ? 1 : a.run_date > b.run_date ? -1 : 0)).slice(0, maxRuns);
    const edits = recent.filter((d) => d.status === "edited");
    const editQtys = edits.map((d) => d.final_qty).filter((q): q is number => q != null);
    const overridden = recent.find((d) => d.status !== "approved" && d.override_reason_code);
    out.set(sku, {
      decided: recent.length,
      changed: edits.length,
      rejected: recent.filter((d) => d.status === "rejected").length,
      usualQty: editQtys.length >= 2 ? median(editQtys) : null,
      lastReason: overridden?.override_reason_code ?? null,
    });
  }
  return out;
}

/** True when the history is worth showing: he overrode this SKU at least twice recently. */
export const historyWorthShowing = (h: SkuHistory | null | undefined): h is SkuHistory => !!h && h.changed + h.rejected >= 2;

export function historyText(h: SkuHistory): string {
  const parts: string[] = [];
  if (h.changed) parts.push(`changed it in ${h.changed}`);
  if (h.rejected) parts.push(`rejected it in ${h.rejected}`);
  const usual = h.usualQty != null ? `, usually to ${h.usualQty.toLocaleString("en-IN")}` : "";
  return `You ${parts.join(" and ")} of your last ${h.decided} runs${usual}.`;
}
