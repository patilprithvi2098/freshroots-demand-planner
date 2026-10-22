"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw, Send } from "lucide-react";
import { CoverGauge } from "@/components/charts/CoverGauge";
import { DecisionBadge, JudgementBadge, SituationBadge, TrendValue } from "@/components/sku/labels";
import { useSku } from "@/components/sku/SkuWorkspace";
import { SkuImage } from "@/components/sku/SkuImage";
import { btn } from "@/components/ui";
import { fmt1, fmtInt } from "@/lib/format";
import { needsReview, shortName, type SkuRow } from "@/lib/skuRow";
import { VIEWS, VIEW_FILTER as FILTER, type View } from "@/lib/reviewViews";
import { approveAction, bulkApproveAction, releaseAction, retryRationalesAction } from "../actions";

export function QueueClient({ runId, rows, initialView, pendingAi }: { runId: string; rows: SkuRow[]; initialView: View; pendingAi: boolean }) {
  const router = useRouter();
  const { open, notify } = useSku();
  const [view, setView] = useState<View>(initialView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, rows.filter(FILTER[v.key]).length])) as Record<View, number>, [rows]);
  const visible = rows.filter(FILTER[view]);
  const visibleIds = visible.map((r) => r.id);
  const bulkable = visible.filter((r) => !r.is_exception && r.status === "pending" && !r.released_at && r.recommended_qty != null);
  const chosen = bulkable.filter((r) => selected.has(r.id));
  const releasable = rows.filter((r) => (r.status === "approved" || r.status === "edited") && !r.released_at).length;
  const failedAi = rows.filter((r) => r.ai_status === "failed" || r.ai_status === "skipped_cap").length;
  const reviewTotal = rows.filter(needsReview).length;
  const decided = rows.filter((r) => needsReview(r) && r.status !== "pending").length;

  function switchView(v: View) {
    setView(v);
    setSelected(new Set());
    window.history.replaceState(null, "", v === "todo" ? "/queue" : `/queue?view=${v}`);
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, success: string) {
    start(async () => {
      const res = await fn();
      notify(res.ok ? (res.message ?? success) : (res.error ?? "Something went wrong"), res.ok);
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function actions(r: SkuRow, locked: boolean) {
    return (
      <>
        {!locked && r.status === "pending" && r.recommended_qty != null ? (
          <button
            type="button"
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-40"
            disabled={pending}
            onClick={() => act(() => approveAction(r.id), `${r.sku_id} approved.`)}
            aria-label={`Approve ${r.sku_id}`}
          >
            Approve
          </button>
        ) : null}
        <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50" onClick={() => open(r.id, visibleIds)}>
          Details
        </button>
      </>
    );
  }

  return (
    <div>
      <div className="mb-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-48 flex-1">
            <p className="text-sm font-medium">
              {decided} of {reviewTotal} decided
            </p>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={reviewTotal} aria-valuenow={decided} aria-label="Decisions made">
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${reviewTotal ? (decided / reviewTotal) * 100 : 0}%` }} />
            </div>
          </div>
          {failedAi > 0 ? (
            <button type="button" className={btn.secondary} disabled={pending} onClick={() => act(() => retryRationalesAction(runId), "Retried explanations.")}>
              <RefreshCw aria-hidden className="mr-1.5 h-4 w-4" /> Retry {failedAi} explanation{failedAi === 1 ? "" : "s"}
            </button>
          ) : null}
          <button
            type="button"
            className={btn.primary}
            disabled={pending || releasable === 0}
            onClick={() => {
              if (window.confirm(`Send ${releasable} approved order line(s) to procurement? They can't be changed afterwards.`)) {
                act(() => releaseAction(runId), "Sent.");
              }
            }}
          >
            <Send aria-hidden className="mr-1.5 h-4 w-4" /> Send {releasable} to procurement
          </button>
        </div>
        {pendingAi ? <p className="mt-3 text-xs text-neutral-600">Writing explanations for the SKUs that need judgement… refresh in a moment.</p> : null}
      </div>

      <div role="tablist" aria-label="Filter SKUs" className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            type="button"
            aria-selected={view === v.key}
            onClick={() => switchView(v.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-700 ${
              view === v.key ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {v.label}
            <span className={`tabular rounded-full px-1.5 text-xs ${view === v.key ? "bg-white/20" : "bg-neutral-100"}`}>{counts[v.key]}</span>
          </button>
        ))}
      </div>

      {bulkable.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.length === bulkable.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(bulkable.map((r) => r.id)) : new Set())}
            />
            Select all {bulkable.length} straightforward SKUs
          </label>
          <button
            type="button"
            className={btn.secondary}
            disabled={pending || chosen.length === 0}
            onClick={() => act(() => bulkApproveAction(chosen.map((r) => r.id)), `Approved ${chosen.length}.`)}
          >
            <Check aria-hidden className="mr-1.5 h-4 w-4" /> Approve {chosen.length} selected
          </button>
          <span className="text-xs text-neutral-600">SKUs that need judgement are approved one at a time.</span>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center text-sm text-neutral-700">
          {view === "todo" ? "All done. Every SKU has a decision." : "No SKUs here."}
        </div>
      ) : (
        <ul className="space-y-2" aria-label="SKUs">
          {visible.map((r) => {
            const canBulk = bulkable.includes(r);
            const locked = Boolean(r.released_at);
            return (
              <li
                key={r.id}
                data-sku={r.sku_id}
                className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-2xl border bg-white px-3 py-3 shadow-sm sm:px-4 md:grid-cols-[auto_minmax(0,19rem)_minmax(0,1fr)_6.5rem_8rem_auto] ${
                  r.is_exception ? "border-violet-200" : "border-neutral-200"
                }`}
              >
                <span className="flex w-5 justify-center">
                  {canBulk ? (
                    <input type="checkbox" aria-label={`Select ${r.sku_id}`} checked={selected.has(r.id)} onChange={() => setSelected((s) => toggle(s, r.id))} />
                  ) : null}
                </span>
                <button type="button" onClick={() => open(r.id, visibleIds)} className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-emerald-700" aria-label={`Open details for ${r.sku_id}`}>
                  <SkuImage skuId={r.sku_id} name={r.sku_name} size="md" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 font-medium hover:underline md:block md:truncate">{shortName(r.sku_name)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-neutral-600">{r.sku_id}</span>
                      <SituationBadge flag={r.flag} short />
                      {r.flags.includes("high_demand") && r.flag !== "high_demand" ? <SituationBadge flag="high_demand" short /> : null}
                      {r.is_exception ? <JudgementBadge /> : null}
                      <span className="md:hidden">
                        <DecisionBadge status={r.status} released={locked} />
                      </span>
                    </span>
                  </span>
                </button>
                <div className="col-start-2 md:col-start-auto">
                  <div className="mb-1 flex justify-between text-xs text-neutral-600">
                    <span>
                      <span className="tabular font-semibold text-neutral-900">{fmt1(r.weeks_cover)}</span> weeks of stock
                    </span>
                    <TrendValue pct={r.trend_pct} />
                  </div>
                  <CoverGauge cover={r.weeks_cover} window={r.window} scaleMax={20} size="sm" />
                </div>
                <div className="col-start-2 flex items-center justify-between gap-3 text-sm md:col-start-auto md:block md:text-right">
                  <span>
                    <span className="block text-xs text-neutral-600">Suggested</span>
                    <span className="tabular font-semibold">
                      {r.recommended_action === "pause_next_order" ? "Pause" : r.recommended_qty == null ? "You decide" : fmtInt(r.recommended_qty)}
                    </span>
                    {r.status === "edited" ? <span className="tabular block text-xs text-sky-800">→ {fmtInt(r.final_qty)}</span> : null}
                  </span>
                  <span className="flex gap-1 md:hidden">{actions(r, locked)}</span>
                </div>
                <div className="hidden md:block">
                  <DecisionBadge status={r.status} released={locked} />
                  {r.misfit ? <span className="mt-1 block text-[11px] font-medium text-amber-800">Overridden often</span> : null}
                </div>
                <div className="hidden justify-end gap-1 md:flex">{actions(r, locked)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function toggle(s: Set<string>, id: string) {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}
