"use client";

import { useEffect, useRef } from "react";
import { EXCEPTION_LABEL, FLAG_LABEL, fmt1, fmtInt, fmtPct, fmtRupees, STATUS_LABEL } from "@/lib/format";
import { btn, ExceptionPill, FlagPill, StatusPill } from "@/components/ui";
import type { QueueRow } from "./QueueClient";

const REASON_LABEL: Record<string, string> = {
  known_event: "Known event",
  new_product: "New product",
  supplier_constraint: "Supplier constraint",
  rule_too_strict: "Rule too strict",
  rule_too_loose: "Rule too loose",
  other: "Other",
};

export function SidePanel({
  row,
  actionLabel,
  onClose,
  onApprove,
  onEdit,
  onReject,
  pending,
}: {
  row: QueueRow;
  actionLabel: string;
  onClose: () => void;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const locked = Boolean(row.released_at);

  return (
    <dialog
      ref={ref}
      aria-labelledby="panel-title"
      onClose={onClose}
      className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-xl overflow-y-auto bg-white p-0 shadow-2xl backdrop:bg-black/20"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-4">
        <div>
          <p className="font-mono text-xs text-neutral-600">
            {row.sku_id} · {row.distributor_id ?? "no distributor"} · {row.perishability} perishability
          </p>
          <h2 id="panel-title" className="text-lg font-semibold">
            {row.sku_name}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {[row.flag, ...row.flags.filter((f) => f !== row.flag)].map((f) => (
              <FlagPill key={f} flag={f} label={FLAG_LABEL[f]} />
            ))}
            {row.is_exception ? <ExceptionPill /> : null}
            <StatusPill status={row.status} label={STATUS_LABEL[row.status]} />
          </div>
        </div>
        <button type="button" onClick={() => ref.current?.close()} className="rounded p-1 text-neutral-600 hover:bg-neutral-100" aria-label="Close details">
          ✕
        </button>
      </div>

      <div className="space-y-6 px-5 py-5">
        <section aria-labelledby="rec-h">
          <h3 id="rec-h" className="text-sm font-semibold">
            Recommendation
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Stat label="Action" value={actionLabel} />
            <Stat label="Quantity" value={row.recommended_qty == null ? "Planner decides" : fmtInt(row.recommended_qty)} />
            <Stat label="Weeks of cover" value={fmt1(row.weeks_cover)} />
            <Stat label="On hand" value={fmtInt(row.units_on_hand)} />
            <Stat label="On order" value={fmtInt(row.on_order_units)} />
            <Stat label="Trend (4 vs 12 wk)" value={fmtPct(row.trend_pct, true)} />
            <Stat label="12-week avg / week" value={fmt1(row.avg12)} />
            <Stat label="Demand used" value={`${fmt1(row.demand_adj)}${row.festival_applied ? " (festival)" : ""}`} />
            {row.rupee_exposure ? <Stat label="Exposure" value={fmtRupees(row.rupee_exposure)} /> : null}
          </dl>
          {row.status !== "pending" ? (
            <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
              Decision: <strong>{STATUS_LABEL[row.status]}</strong>
              {row.final_qty != null ? <> · final quantity {fmtInt(row.final_qty)}</> : null}
              {row.override_reason_code ? <> · {REASON_LABEL[row.override_reason_code]}</> : null}
              {row.override_note ? <span className="mt-1 block text-neutral-600">“{row.override_note}”</span> : null}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="chart-h">
          <h3 id="chart-h" className="text-sm font-semibold">
            Weekly sales, last 16 weeks
          </h3>
          <SalesChart data={row.recent_sales} avg={row.avg12} />
        </section>

        {row.is_exception ? (
          <section aria-labelledby="ai-h" className="rounded-md border border-violet-200 bg-violet-50 p-4">
            <h3 id="ai-h" className="text-sm font-semibold text-violet-950">
              Why this needs your judgement
            </h3>
            <p className="mt-1 text-xs text-violet-900">{row.exception_reasons.map((e) => EXCEPTION_LABEL[e] ?? e).join(" · ")}</p>
            {row.ai_status === "pending" ? (
              <p className="mt-2 text-sm text-violet-950">Writing an explanation… refresh in a moment.</p>
            ) : row.rationale ? (
              <>
                <p className="mt-2 text-sm text-violet-950">{row.rationale}</p>
                <p className="mt-2 text-sm text-violet-950">
                  <strong>Check this first:</strong> {row.check_first}
                </p>
                <p className="mt-2 text-xs text-violet-800">Written by Claude from the numbers above. It never sets the quantity.</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-violet-950">Rationale unavailable. The rule trace below still applies.</p>
            )}
          </section>
        ) : null}

        <section aria-labelledby="trace-h">
          <h3 id="trace-h" className="text-sm font-semibold">
            Which rules fired
          </h3>
          {row.rules_fired.length ? (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {row.rules_fired.map((t, i) => (
                <li key={i}>{t.detail}</li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-neutral-600">No rule fired: cover is inside the window and the trend is below the threshold.</p>
          )}
        </section>
      </div>

      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-neutral-200 bg-white px-5 py-3">
        {locked ? (
          <p className="text-sm text-neutral-600">Released to procurement. It can no longer be changed.</p>
        ) : (
          <>
            <button type="button" className={btn.primary} disabled={pending || row.status === "approved"} onClick={onApprove}>
              Approve{row.recommended_qty != null ? ` ${fmtInt(row.recommended_qty)}` : ""}
            </button>
            <button type="button" className={btn.secondary} disabled={pending} onClick={onEdit}>
              Edit quantity
            </button>
            <button type="button" className={btn.danger} disabled={pending || row.status === "rejected"} onClick={onReject}>
              Reject
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-600">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

function SalesChart({ data, avg }: { data: { iso_week: string; units: number | null }[]; avg: number | null }) {
  const W = 520;
  const H = 160;
  const pad = { l: 36, r: 8, t: 8, b: 28 };
  const max = Math.max(1, ...data.map((d) => d.units ?? 0), avg ?? 0) * 1.1;
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const summary = data.map((d) => `${d.iso_week}: ${d.units == null ? "missing" : d.units}`).join(", ");
  return (
    <figure className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Weekly units sold. ${summary}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#e5e7eb" />
            <text x={pad.l - 4} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="#6b7280">
              {Math.round(max * f).toLocaleString("en-IN")}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + 2;
          const recent = i >= data.length - 4;
          return (
            <g key={d.iso_week}>
              {d.units == null ? (
                <text x={x + (bw - 4) / 2} y={H - pad.b - 4} fontSize="10" textAnchor="middle" fill="#b45309">
                  ?
                </text>
              ) : (
                <rect x={x} y={y(d.units)} width={bw - 4} height={H - pad.b - y(d.units)} rx="2" fill={recent ? "#2f7a3e" : "#9cc5a5"}>
                  <title>{`${d.iso_week}: ${d.units.toLocaleString("en-IN")} units`}</title>
                </rect>
              )}
              {i % 2 === data.length % 2 ? (
                <text x={x + (bw - 4) / 2} y={H - 10} fontSize="9" textAnchor="middle" fill="#6b7280">
                  {d.iso_week.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
        {avg != null ? (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(avg)} y2={y(avg)} stroke="#1c1f1d" strokeDasharray="4 3" />
          </g>
        ) : null}
      </svg>
      <figcaption className="mt-1 text-xs text-neutral-600">
        Dark bars: last 4 weeks. Dashed line: 12-week average. “?” marks a week with no data (not counted as zero).
      </figcaption>
    </figure>
  );
}
