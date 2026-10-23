"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, History, Pencil, RefreshCw, Search, Send, Sparkles, X } from "lucide-react";
import { CoverGauge } from "@/components/charts/CoverGauge";
import { DecisionBadge, JudgementBadge, SituationBadge, TrendValue } from "@/components/sku/labels";
import { useSku } from "@/components/sku/SkuWorkspace";
import { SkuImage } from "@/components/sku/SkuImage";
import { btn, input } from "@/components/ui";
import { fmt1, fmtInt } from "@/lib/format";
import { historyText, historyWorthShowing } from "@/lib/skuHistory";
import { needsReview, shortName, type SkuRow } from "@/lib/skuRow";
import { MORE_VIEWS, PRIMARY_VIEWS, VIEWS, VIEW_FILTER as FILTER, matchesSearch, type View } from "@/lib/reviewViews";
import { approveAction, bulkApproveAction, releaseAction, retryRationalesAction } from "../actions";

const LABEL = Object.fromEntries(VIEWS.map((v) => [v.key, v.label])) as Record<View, string>;

const rowBtn =
  "inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium ring-1 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-40";

function isTyping(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  // Right after a dialog closes, focus can sit in its input for a moment; that is not typing.
  if (el.closest("dialog") && !el.closest("dialog[open]")) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function QueueClient({ runId, rows, initialView, pendingAi }: { runId: string; rows: SkuRow[]; initialView: View; pendingAi: boolean }) {
  const router = useRouter();
  const { open, notify, override } = useSku();
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, rows.filter(FILTER[v.key]).length])) as Record<View, number>, [rows]);
  const searching = query.trim() !== "";
  // A search looks across every SKU, not only the current tab. In "To decide", judgement calls come first.
  const visible = useMemo(() => {
    const base = searching ? rows.filter((r) => matchesSearch(r, query)) : rows.filter(FILTER[view]);
    return view === "todo" && !searching ? [...base].sort((a, b) => Number(b.is_exception) - Number(a.is_exception) || a.rank - b.rank) : base;
  }, [rows, view, query, searching]);
  const visibleIds = visible.map((r) => r.id);
  const bulkable = visible.filter((r) => !r.is_exception && r.status === "pending" && !r.released_at && r.recommended_qty != null);
  const chosen = bulkable.filter((r) => selected.has(r.id));
  const releasable = rows.filter((r) => (r.status === "approved" || r.status === "edited") && !r.released_at).length;
  const failedAi = rows.filter((r) => r.ai_status === "failed" || r.ai_status === "skipped_cap").length;
  const reviewTotal = rows.filter(needsReview).length;
  const decided = rows.filter((r) => needsReview(r) && r.status !== "pending").length;
  const activeIdx = Math.min(active, Math.max(visible.length - 1, 0));

  function switchView(v: View) {
    setView(v);
    setQuery("");
    setSelected(new Set());
    setActive(0);
    window.history.replaceState(null, "", v === "todo" ? "/queue" : `/queue?view=${v}`);
  }

  const act = useCallback(
    (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, success: string) => {
      start(async () => {
        const res = await fn();
        notify(res.ok ? (res.message ?? success) : (res.error ?? "Something went wrong"), res.ok);
        if (res.ok) {
          setSelected(new Set());
          router.refresh();
        }
      });
    },
    [notify, router],
  );

  const canApprove = (r: SkuRow) => !r.released_at && r.status !== "approved" && r.recommended_qty != null;
  const approve = useCallback((r: SkuRow) => act(() => approveAction(r.id), `${r.sku_id} approved.`), [act]);

  // Keyboard: / search · j/k move · a approve · c change · r reject · o or Enter details. Off while typing or in a dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (visible.length === 0) return;
      const r = visible[activeIdx];
      const move = (to: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(visible.length - 1, to));
        setActive(next);
        listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
      };
      if (e.key === "j") move(activeIdx + 1);
      else if (e.key === "k") move(activeIdx - 1);
      else if (e.key === "a" && canApprove(r) && !pending) approve(r);
      else if (e.key === "c" && !r.released_at) override(r.id, "edit");
      else if (e.key === "r" && !r.released_at) override(r.id, "reject");
      else if (e.key === "o" || e.key === "Enter") open(r.id, visibleIds);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function rowActions(r: SkuRow) {
    if (r.released_at) return null;
    return (
      <>
        {canApprove(r) ? (
          <button
            type="button"
            className={`${rowBtn} bg-emerald-700 text-white ring-emerald-700 hover:bg-emerald-800`}
            disabled={pending}
            onClick={() => approve(r)}
            aria-label={`Approve ${r.sku_id}${r.recommended_action === "pause_next_order" ? " (pause)" : ` at ${r.recommended_qty}`}`}
          >
            <Check aria-hidden className="h-4 w-4" /> Approve
          </button>
        ) : null}
        <button
          type="button"
          className={`${rowBtn} text-neutral-800 ring-neutral-300 hover:bg-neutral-50`}
          onClick={() => override(r.id, "edit")}
          aria-label={`Change quantity for ${r.sku_id}`}
        >
          <Pencil aria-hidden className="h-3.5 w-3.5" /> Change
        </button>
        <button
          type="button"
          className={`${rowBtn} text-red-700 ring-red-200 hover:bg-red-50`}
          onClick={() => override(r.id, "reject")}
          aria-label={`Reject ${r.sku_id}`}
        >
          <X aria-hidden className="h-4 w-4" /> Reject
        </button>
      </>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-1 mb-4 rounded-2xl border border-neutral-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="min-w-32 flex-1">
            <p className="text-sm font-medium">
              {decided} of {reviewTotal} decided
            </p>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-200"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={reviewTotal}
              aria-valuenow={decided}
              aria-label="Decisions made"
            >
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{
                  width: `${reviewTotal ? (decided / reviewTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          {failedAi > 0 ? (
            <button
              type="button"
              className={btn.secondary}
              disabled={pending}
              onClick={() => act(() => retryRationalesAction(runId), "Retried explanations.")}
            >
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
            <Send aria-hidden className="mr-1.5 h-4 w-4" /> Send {releasable}
            <span className="sr-only sm:not-sr-only">&nbsp;to procurement</span>
          </button>
        </div>
        {pendingAi ? (
          <p className="mt-3 text-xs text-neutral-600">Writing explanations for the SKUs that need judgement… refresh in a moment.</p>
        ) : null}
      </div>

      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block lg:w-80">
          <span className="sr-only">Search SKUs by name or code</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            ref={searchRef}
            type="search"
            className={`${input} pl-9`}
            placeholder="Search SKU or name  ( / )"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-1">
          <div role="tablist" aria-label="Filter SKUs" className="flex flex-wrap items-center gap-1">
            {PRIMARY_VIEWS.map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={!searching && view === v}
                onClick={() => switchView(v)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-700 ${
                  !searching && view === v ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"
                }`}
              >
                {LABEL[v]}
                <span className={`tabular rounded-full px-1.5 text-xs ${!searching && view === v ? "bg-white/20" : "bg-neutral-100"}`}>
                  {counts[v]}
                </span>
              </button>
            ))}
          </div>
          <select
            aria-label="More filters"
            className={`rounded-full border-0 py-1.5 pr-8 pl-3 text-sm font-medium ring-1 focus-visible:outline-2 focus-visible:outline-emerald-700 ${
              !searching && MORE_VIEWS.includes(view) ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-700 ring-neutral-200"
            }`}
            value={MORE_VIEWS.includes(view) ? view : ""}
            onChange={(e) => e.target.value && switchView(e.target.value as View)}
          >
            <option value="" disabled>
              More…
            </option>
            {MORE_VIEWS.map((v) => (
              <option key={v} value={v}>
                {LABEL[v]} ({counts[v]})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {searching ? (
          <p className="text-neutral-700" role="status">
            {visible.length} of {rows.length} SKUs match “{query.trim()}”.
          </p>
        ) : bulkable.length > 0 ? (
          <>
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
          </>
        ) : null}
        <p className="hidden text-xs text-neutral-600 lg:ml-auto lg:block">
          Keys: <kbd>/</kbd> search · <kbd>j</kbd> <kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>c</kbd> change · <kbd>r</kbd> reject · <kbd>o</kbd>{" "}
          details
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center text-sm text-neutral-700">
          {searching ? "No SKU matches that search." : view === "todo" ? "All done. Every SKU has a decision." : "No SKUs here."}
        </div>
      ) : (
        <ul ref={listRef} className="space-y-2" aria-label="SKUs">
          {visible.map((r, i) => {
            const canBulk = !searching && bulkable.includes(r);
            const locked = Boolean(r.released_at);
            const h = historyWorthShowing(r.history) ? r.history : null;
            return (
              <li
                key={r.id}
                data-sku={r.sku_id}
                data-index={i}
                onClick={() => setActive(i)}
                className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-2xl border bg-white px-3 py-3 shadow-sm sm:px-4 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,13rem)_6.5rem_auto] ${
                  r.is_exception ? "border-violet-200" : "border-neutral-200"
                } ${i === activeIdx ? "ring-2 ring-emerald-600/60" : ""}`}
              >
                <span className="flex w-5 justify-center">
                  {canBulk ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.sku_id}`}
                      checked={selected.has(r.id)}
                      onChange={() => setSelected((s) => toggle(s, r.id))}
                    />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <SkuImage skuId={r.sku_id} name={r.sku_name} size="md" />
                    <span className="min-w-0">
                      {/* Only the name is inside the button, so its accessible name contains the visible text. */}
                      <button
                        type="button"
                        onClick={() => open(r.id, visibleIds)}
                        className="group flex min-w-0 items-center gap-1 text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700"
                        aria-label={`Open details for ${r.sku_id}: ${shortName(r.sku_name)}`}
                      >
                        <span className="line-clamp-2 lg:truncate">{shortName(r.sku_name)}</span>
                        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-neutral-400" />
                      </button>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-neutral-600">{r.sku_id}</span>
                        <SituationBadge flag={r.flag} short />
                        {r.flags.includes("high_demand") && r.flag !== "high_demand" ? <SituationBadge flag="high_demand" short /> : null}
                        {r.is_exception ? <JudgementBadge /> : null}
                      </span>
                    </span>
                  </div>
                  {r.is_exception ? (
                    <p className="mt-2 flex gap-1.5 text-sm text-violet-900">
                      <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="line-clamp-2">
                        {r.rationale ??
                          (r.ai_status === "pending"
                            ? "Explanation on its way…"
                            : "No explanation available. Open details to see the rules that fired.")}
                      </span>
                    </p>
                  ) : null}
                  {h ? (
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-amber-900">
                      <History aria-hidden className="h-3.5 w-3.5 shrink-0" />
                      <span>{historyText(h)}</span>
                      {h.usualQty != null && !locked ? (
                        <button
                          type="button"
                          className="rounded-md px-1.5 py-0.5 font-medium text-amber-900 underline ring-1 ring-amber-300 hover:bg-amber-50"
                          onClick={() => override(r.id, "edit", h.usualQty!)}
                        >
                          Use {fmtInt(h.usualQty)}
                        </button>
                      ) : null}
                    </p>
                  ) : null}
                </div>
                <div className="col-start-2 lg:col-start-auto">
                  <div className="mb-1 flex justify-between text-xs text-neutral-600">
                    <span>
                      <span className="tabular font-semibold text-neutral-900">{fmt1(r.weeks_cover)}</span> weeks of stock
                    </span>
                    <TrendValue pct={r.trend_pct} />
                  </div>
                  <CoverGauge cover={r.weeks_cover} window={r.window} scaleMax={20} size="sm" />
                </div>
                <div className="col-start-2 flex items-center justify-between gap-3 text-sm lg:col-start-auto lg:block lg:text-right">
                  <span>
                    <span className="block text-xs text-neutral-600">Suggested</span>
                    <span className="tabular font-semibold">
                      {r.recommended_action === "pause_next_order" ? "Pause" : r.recommended_qty == null ? "You decide" : fmtInt(r.recommended_qty)}
                    </span>
                    {r.status === "edited" ? <span className="tabular block text-xs text-sky-800">→ {fmtInt(r.final_qty)}</span> : null}
                  </span>
                  <span className="lg:mt-1 lg:block">
                    <DecisionBadge status={r.status} released={locked} />
                  </span>
                </div>
                <div className="col-span-2 flex flex-wrap justify-end gap-1.5 lg:col-span-1 lg:flex-nowrap">{rowActions(r)}</div>
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
