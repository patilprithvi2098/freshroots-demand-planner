"use client";

import { useEffect, useRef, useTransition } from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { approveAction } from "@/app/(app)/actions";
import { CoverGauge } from "@/components/charts/CoverGauge";
import { SalesBars } from "@/components/charts/SalesBars";
import { btn } from "@/components/ui";
import { EXCEPTION_LABEL, fmt1, fmtInt, fmtRupees } from "@/lib/format";
import type { SkuRow } from "@/lib/skuRow";
import { DecisionBadge, JudgementBadge, SituationBadge, TrendValue } from "./labels";
import { SkuImage } from "./SkuImage";

const REASON_LABEL: Record<string, string> = {
  known_event: "Known event",
  new_product: "New product",
  supplier_constraint: "Supplier constraint",
  rule_too_strict: "Rule too strict",
  rule_too_loose: "Rule too loose",
  other: "Other",
};

/** One plain sentence: where the stock is and what the rules suggest. */
export function headline(r: SkuRow): string {
  if (r.recommended_action === "manual_review") {
    return "The rules can't size an order for this SKU on their own. Decide the quantity yourself.";
  }
  const cover = r.weeks_cover == null ? null : fmt1(r.weeks_cover);
  const stock = `${fmtInt(r.units_on_hand)} units${r.on_order_units ? ` (+${fmtInt(r.on_order_units)} on order)` : ""}`;
  const pace = r.demand_adj == null ? "" : ` at ${fmtInt(Math.round(r.demand_adj))} a week${r.festival_applied ? " (festival demand)" : ""}`;
  const where =
    cover == null
      ? ""
      : r.weeks_cover! < r.window.min
        ? `${stock} last ${cover} weeks${pace}, below the ${r.window.min}-week minimum.`
        : r.weeks_cover! > r.window.max
          ? `${stock} last ${cover} weeks${pace}, above the ${r.window.max}-week maximum.`
          : `${stock} last ${cover} weeks${pace}, inside the safe range.`;
  const action =
    r.recommended_action === "reorder_now"
      ? ` Suggested: order ${fmtInt(r.recommended_qty)} units now.`
      : r.recommended_action === "pause_next_order"
        ? " Suggested: pause the next order."
        : " No order needed.";
  return `${where}${action}`;
}

export function SkuModal({
  row,
  position,
  onPrev,
  onNext,
  onClose,
  onEdit,
  onReject,
  onDone,
}: {
  row: SkuRow;
  position: { index: number; total: number };
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onEdit: () => void;
  onReject: () => void;
  onDone: (text: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const locked = Boolean(row.released_at);
  const canApprove = !locked && row.status !== "approved" && row.recommended_qty != null;

  function approve() {
    start(async () => {
      const res = await approveAction(row.id);
      if (res.ok) {
        onDone(`${row.sku_id} approved${row.recommended_qty ? ` at ${fmtInt(row.recommended_qty)} units` : ""}.`);
        onNext?.();
      } else onDone(res.error);
    });
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="sku-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
        if (e.key === "ArrowRight" && onNext) onNext();
        if (e.key === "ArrowLeft" && onPrev) onPrev();
      }}
      className="m-auto max-h-[92vh] w-[min(56rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl p-0 shadow-2xl backdrop:bg-neutral-950/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex max-h-[92vh] flex-col">
        <header className="flex items-start gap-4 border-b border-neutral-200 px-6 py-4">
          <SkuImage skuId={row.sku_id} name={row.sku_name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SituationBadge flag={row.flag} />
              {row.flags
                .filter((f) => f !== row.flag)
                .map((f) => (
                  <SituationBadge key={f} flag={f} />
                ))}
              {row.is_exception ? <JudgementBadge /> : null}
              <DecisionBadge status={row.status} released={locked} />
            </div>
            <h2 id="sku-title" className="mt-2 truncate text-xl font-semibold tracking-tight">
              {row.sku_name}
            </h2>
            <p className="text-sm text-neutral-600">
              <span className="font-mono">{row.sku_id}</span> · {row.perishability === "high" ? "Perishable" : "Long shelf life"} ·{" "}
              {row.distributor_id ?? "No distributor"}
              {row.misfit ? <span className="ml-2 font-medium text-amber-800">· Overridden often: the rules may not fit this SKU</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 hidden text-xs text-neutral-600 sm:inline">
              {position.index + 1} of {position.total}
            </span>
            <button type="button" onClick={onPrev} disabled={!onPrev} className="rounded-lg p-2 hover:bg-neutral-100 disabled:opacity-30" aria-label="Previous SKU">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={onNext} disabled={!onNext} className="rounded-lg p-2 hover:bg-neutral-100 disabled:opacity-30" aria-label="Next SKU">
              <ChevronRight className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => ref.current?.close()} className="rounded-lg p-2 hover:bg-neutral-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <p className="text-[15px] leading-relaxed text-neutral-800">{headline(row)}</p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Suggested order"
              value={row.recommended_action === "pause_next_order" ? "Pause" : row.recommended_qty == null ? "You decide" : `${fmtInt(row.recommended_qty)} units`}
              strong
            />
            <Stat label="Weeks of cover" value={fmt1(row.weeks_cover)} />
            <Stat label="Avg weekly sales (12 wks)" value={fmtInt(row.avg12 == null ? null : Math.round(row.avg12))} />
            <Stat label="Trend (4 vs 12 wks)" value={<TrendValue pct={row.trend_pct} />} />
          </div>

          <div>
            <div className="mb-1.5 flex justify-between text-xs text-neutral-600">
              <span>Stock cover against the safe range</span>
              <span>
                Safe: {row.window.min}–{row.window.max} weeks
              </span>
            </div>
            <CoverGauge cover={row.weeks_cover} window={row.window} />
            {row.gap_units ? (
              <p className="mt-1.5 text-xs text-neutral-700">
                {row.weeks_cover! < row.window.min
                  ? `About ${fmtInt(row.gap_units)} units short of the minimum.`
                  : `About ${fmtInt(row.gap_units)} units above the maximum.`}
                {row.rupee_exposure ? ` Worth ${fmtRupees(row.rupee_exposure)}.` : ""}
              </p>
            ) : null}
          </div>

          {row.is_exception ? (
            <section aria-labelledby="ai-h" className="rounded-xl border border-violet-200 bg-violet-50/70 p-4">
              <h3 id="ai-h" className="flex items-center gap-1.5 text-sm font-semibold text-violet-950">
                <Sparkles aria-hidden className="h-4 w-4" /> Why this needs your judgement
              </h3>
              <p className="mt-1 text-xs text-violet-900">{row.exception_reasons.map((e) => EXCEPTION_LABEL[e] ?? e).join(" · ")}</p>
              {row.ai_status === "pending" ? (
                <p className="mt-2 text-sm text-violet-950">Writing an explanation… it will appear in a moment.</p>
              ) : row.rationale ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-violet-950">{row.rationale}</p>
                  <p className="mt-2 text-sm text-violet-950">
                    <strong>Check this first:</strong> {row.check_first}
                  </p>
                  <p className="mt-2 text-xs text-violet-800">Written by Claude from the numbers on this page. It never sets the quantity.</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-violet-950">Rationale unavailable. The rule reasons below still apply.</p>
              )}
            </section>
          ) : null}

          <section aria-labelledby="sales-h">
            <h3 id="sales-h" className="mb-2 text-sm font-semibold">
              Weekly sales, last 16 weeks
            </h3>
            <SalesBars data={row.recent_sales} avg={row.avg12} />
          </section>

          <details className="group rounded-xl border border-neutral-200 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold marker:text-neutral-400">How the rules got here</summary>
            {row.rules_fired.length ? (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-800">
                {row.rules_fired.map((t, i) => (
                  <li key={i}>{t.detail}</li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-neutral-700">No rule fired: cover is inside the safe range and the trend is below the threshold.</p>
            )}
          </details>

          {row.status !== "pending" ? (
            <p className="rounded-xl bg-neutral-50 px-4 py-3 text-sm">
              Your decision: <strong>{row.status === "edited" ? `changed to ${fmtInt(row.final_qty)} units` : row.status}</strong>
              {row.override_reason_code ? <> · {REASON_LABEL[row.override_reason_code]}</> : null}
              {row.override_note ? <span className="mt-1 block text-neutral-700">“{row.override_note}”</span> : null}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-neutral-200 bg-neutral-50 px-6 py-3">
          {locked ? (
            <p className="text-sm text-neutral-700">Sent to procurement. It can no longer be changed.</p>
          ) : (
            <>
              <button type="button" className={btn.primary} disabled={pending || !canApprove} onClick={approve}>
                {pending ? "Approving…" : row.recommended_action === "pause_next_order" ? "Approve pause" : `Approve ${fmtInt(row.recommended_qty)}`}
              </button>
              <button type="button" className={btn.secondary} disabled={pending} onClick={onEdit}>
                Change quantity
              </button>
              <button type="button" className={btn.danger} disabled={pending || row.status === "rejected"} onClick={onReject}>
                Reject
              </button>
              <span className="ml-auto hidden text-xs text-neutral-600 sm:inline">Tip: ← → to move between SKUs</span>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function Stat({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${strong ? "border-emerald-200 bg-emerald-50" : "border-neutral-200 bg-white"}`}>
      <p className="text-xs text-neutral-600">{label}</p>
      <p className={`tabular mt-0.5 text-lg font-semibold ${strong ? "text-emerald-900" : ""}`}>{value}</p>
    </div>
  );
}
