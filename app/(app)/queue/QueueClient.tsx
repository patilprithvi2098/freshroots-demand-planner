"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_LABEL, EXCEPTION_LABEL, FLAG_LABEL, fmt1, fmtInt, fmtPct, fmtRupees, STATUS_LABEL } from "@/lib/format";
import { btn, ExceptionPill, FlagPill, Pill, StatusPill } from "@/components/ui";
import { approveAction, bulkApproveAction, releaseAction, retryRationalesAction } from "../actions";
import { OverrideDialog } from "./OverrideDialog";
import { SidePanel } from "./SidePanel";

export interface QueueRow {
  id: string;
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
  misfit: boolean;
}

interface Filters {
  flag: string;
  exceptionsOnly: boolean;
  status: string;
  showAll: boolean;
}

const RULE_SHORT: Record<string, string> = {
  eligibility: "Eligibility",
  festival_uplift: "Festival +25%",
  stockout_threshold: "Below min cover",
  overstock_threshold: "Above max cover",
  trend_high_demand: "Trend > 20%",
  reorder_standard: "Std reorder",
  reorder_trend_multiplier: "1.5× reorder",
  pause_order: "Pause",
  quantity_cap: "Capped",
};

export function QueueClient({ runId, rows, initial }: { runId: string; rows: QueueRow[]; initial: Filters }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "edit" | "reject"; row: QueueRow } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        const inQueue = r.flag !== "no_action" || r.is_exception;
        if (!filters.showAll && !inQueue) return false;
        if (filters.flag !== "all" && r.flag !== filters.flag) return false;
        if (filters.exceptionsOnly && !r.is_exception) return false;
        if (filters.status !== "all" && r.status !== filters.status) return false;
        return true;
      }),
    [rows, filters],
  );

  const releasable = rows.filter((r) => (r.status === "approved" || r.status === "edited") && !r.released_at).length;
  const released = rows.filter((r) => r.released_at).length;
  const bulkable = visible.filter((r) => !r.is_exception && r.status === "pending" && !r.released_at);
  const selectedBulkable = bulkable.filter((r) => selected.has(r.id));
  const failedAi = rows.filter((r) => r.ai_status === "failed" || r.ai_status === "skipped_cap").length;
  const openRow = rows.find((r) => r.id === openId) ?? null;

  function syncUrl(next: Filters) {
    const p = new URLSearchParams();
    if (next.flag !== "all") p.set("flag", next.flag);
    if (next.exceptionsOnly) p.set("exceptions", "1");
    if (next.status !== "all") p.set("status", next.status);
    if (next.showAll) p.set("all", "1");
    window.history.replaceState(null, "", `/queue${p.size ? `?${p}` : ""}`);
  }
  function update(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    syncUrl(next);
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, success?: string) {
    setMessage(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (success || res.message) setMessage({ ok: true, text: res.message ?? success! });
        setSelected(new Set());
        router.refresh();
      } else setMessage({ ok: false, text: res.error ?? "Failed" });
    });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600">Flag</span>
          <select className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" value={filters.flag} onChange={(e) => update({ flag: e.target.value })}>
            <option value="all">All flags</option>
            <option value="stockout_risk">Stockout risk</option>
            <option value="overstock_risk">Overstock risk</option>
            <option value="high_demand">High demand</option>
            <option value="no_action">No action</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600">Status</span>
          <select className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="all">Any status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="edited">Edited</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.exceptionsOnly} onChange={(e) => update({ exceptionsOnly: e.target.checked })} />
          Exceptions only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.showAll} onChange={(e) => update({ showAll: e.target.checked })} />
          Show no-action SKUs
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {failedAi > 0 ? (
            <button type="button" className={btn.secondary} disabled={pending} onClick={() => act(() => retryRationalesAction(runId), "Retried explanations.")}>
              Retry {failedAi} explanation(s)
            </button>
          ) : null}
          <button
            type="button"
            className={btn.secondary}
            disabled={pending || selectedBulkable.length === 0}
            onClick={() => act(() => bulkApproveAction(selectedBulkable.map((r) => r.id)), `Approved ${selectedBulkable.length}.`)}
          >
            Approve selected ({selectedBulkable.length})
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={pending || releasable === 0}
            onClick={() => {
              if (window.confirm(`Release ${releasable} approved or edited recommendation(s) to procurement? This cannot be undone.`)) {
                act(() => releaseAction(runId));
              }
            }}
          >
            Release to procurement ({releasable})
          </button>
        </div>
      </div>

      <div aria-live="polite">
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={`mb-3 rounded-md border px-3 py-2 text-sm ${message.ok ? "border-brand-100 bg-brand-50 text-brand-800" : "border-red-300 bg-red-50 text-red-800"}`}>
            {message.text}
          </p>
        ) : null}
      </div>
      {released > 0 ? <p className="mb-2 text-sm text-neutral-600">{released} recommendation(s) from this run already released.</p> : null}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-12 text-center text-sm text-neutral-600">
          No SKUs match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white focus-visible:outline-2 focus-visible:outline-brand-700" tabIndex={0} role="region" aria-label="Recommendations table (scrolls sideways)">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recommendations for review, highest priority first</caption>
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-600">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all non-exception pending rows"
                    checked={bulkable.length > 0 && bulkable.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(bulkable.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th scope="col" className="px-3 py-2">SKU</th>
                <th scope="col" className="px-3 py-2">Name</th>
                <th scope="col" className="px-3 py-2">Perish.</th>
                <th scope="col" className="px-3 py-2 text-right">Weeks cover</th>
                <th scope="col" className="px-3 py-2 text-right">Trend</th>
                <th scope="col" className="px-3 py-2">Flag</th>
                <th scope="col" className="px-3 py-2 text-right">Rec. qty</th>
                <th scope="col" className="px-3 py-2">Rules fired</th>
                <th scope="col" className="px-3 py-2">Exception</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visible.map((r) => {
                const canBulk = !r.is_exception && r.status === "pending" && !r.released_at;
                const locked = Boolean(r.released_at);
                return (
                  <tr key={r.id} className={`${r.is_exception ? "bg-violet-50/60" : ""} ${openId === r.id ? "outline-2 -outline-offset-2 outline-brand-600" : ""} hover:bg-neutral-50`}>
                    <td className="px-3 py-2">
                      {canBulk ? (
                        <input type="checkbox" aria-label={`Select ${r.sku_id}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      ) : (
                        <span className="sr-only">{r.is_exception ? "Exceptions cannot be bulk approved" : "Not selectable"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <button type="button" className="text-brand-700 underline-offset-2 hover:underline" onClick={() => setOpenId(r.id)} aria-label={`Open details for ${r.sku_id}`}>
                        {r.sku_id}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" className="text-left hover:underline" onClick={() => setOpenId(r.id)}>
                        {r.sku_name}
                      </button>
                      {r.misfit ? <span className="mt-0.5 block text-xs text-amber-800">Rules may not fit this SKU</span> : null}
                    </td>
                    <td className="px-3 py-2 capitalize">{r.perishability}</td>
                    <td className="tabular px-3 py-2 text-right">{fmt1(r.weeks_cover)}</td>
                    <td className={`tabular px-3 py-2 text-right ${r.trend_pct != null && r.trend_pct > 0.2 ? "font-medium text-sky-800" : ""}`}>{fmtPct(r.trend_pct, true)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <FlagPill flag={r.flag} label={FLAG_LABEL[r.flag]} />
                        {r.flags.filter((f) => f !== r.flag).map((f) => (
                          <FlagPill key={f} flag={f} label={FLAG_LABEL[f]} />
                        ))}
                      </div>
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {r.recommended_qty == null ? "–" : fmtInt(r.recommended_qty)}
                      {r.rupee_exposure ? <span className="block text-xs text-neutral-600">{fmtRupees(r.rupee_exposure)} at risk</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600">{r.rules_fired.map((t) => RULE_SHORT[t.rule] ?? t.rule).filter((v, i, a) => a.indexOf(v) === i).join(", ") || "–"}</td>
                    <td className="px-3 py-2">
                      {r.is_exception ? (
                        <div className="flex flex-col gap-1">
                          <ExceptionPill />
                          <span className="text-xs text-violet-900">{r.exception_reasons.map((e) => EXCEPTION_LABEL[e] ?? e).join(", ")}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status} label={STATUS_LABEL[r.status]} />
                      {r.status === "edited" ? <span className="tabular block text-xs text-neutral-600">→ {fmtInt(r.final_qty)}</span> : null}
                      {locked ? <Pill className="mt-1 bg-neutral-800 text-white ring-neutral-800">Released</Pill> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button type="button" className="rounded px-2 py-1 text-xs font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-40" disabled={pending || locked || r.status === "approved"} onClick={() => act(() => approveAction(r.id))}>
                          Approve
                        </button>
                        <button type="button" className="rounded px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-40" disabled={pending || locked} onClick={() => setDialog({ mode: "edit", row: r })}>
                          Edit
                        </button>
                        <button type="button" className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40" disabled={pending || locked || r.status === "rejected"} onClick={() => setDialog({ mode: "reject", row: r })}>
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-600">
        {visible.length} of {rows.length} SKUs shown. Exceptions are highlighted and must be approved one at a time.
      </p>

      {openRow ? (
        <SidePanel
          row={openRow}
          actionLabel={ACTION_LABEL[openRow.recommended_action]}
          onClose={() => setOpenId(null)}
          onApprove={() => act(() => approveAction(openRow.id))}
          onEdit={() => setDialog({ mode: "edit", row: openRow })}
          onReject={() => setDialog({ mode: "reject", row: openRow })}
          pending={pending}
        />
      ) : null}
      {dialog ? (
        <OverrideDialog
          mode={dialog.mode}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage({ ok: true, text });
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
