"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { fmtDate, fmtInt, fmtRupees } from "@/lib/format";
import type { OrdersPreview } from "@/lib/services/zohoOrders";
import { createZohoOrdersAction, previewZohoOrdersAction, syncZohoAction } from "../actions";

/**
 * Procurement: preview every distributor's order, then create and issue them in Zoho in one step.
 * The planner sees status only (the brief: procurement places the POs).
 */
export function ZohoOrderButtons({ pendingLines, configured, canOrder }: { pendingLines: number; configured: boolean; canOrder: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<OrdersPreview | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!configured) {
    return <p className="max-w-xs text-right text-sm text-neutral-600">Zoho Inventory is not connected yet.</p>;
  }

  function sync() {
    setResult(null);
    start(async () => {
      const res = await syncZohoAction();
      setResult(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
      router.refresh();
    });
  }

  function openPreview() {
    setResult(null);
    start(async () => {
      const res = await previewZohoOrdersAction();
      if (res.ok) setPreview(res.data);
      else setResult({ ok: false, text: res.error });
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button type="button" className={btn.secondary} disabled={pending} onClick={sync}>
          {pending && !preview ? "Checking…" : "Refresh Zoho status"}
        </button>
        {canOrder ? (
          <button type="button" className={btn.primary} disabled={pending || pendingLines === 0} onClick={openPreview}>
            Create and issue in Zoho ({pendingLines})
          </button>
        ) : null}
      </div>
      <div aria-live="polite">
        {result ? <p className={`max-w-md text-right text-sm ${result.ok ? "text-emerald-800" : "text-red-700"}`}>{result.text}</p> : null}
      </div>
      {preview ? (
        <PreviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onDone={(r) => {
            setPreview(null);
            setResult(r);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function PreviewDialog({ preview, onClose, onDone }: { preview: OrdersPreview; onClose: () => void; onDone: (r: { ok: boolean; text: string }) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const lines = preview.orders.reduce((a, o) => a + o.lines.length, 0);
  const units = preview.orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
  const needsCheck = preview.aboveCap > 0;

  function send() {
    start(async () => {
      const res = await createZohoOrdersAction({ confirmAboveCap: checked });
      onDone(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
    });
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="po-preview-title"
      onClose={onClose}
      className="m-auto max-h-[90vh] w-[min(44rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl p-0 shadow-2xl backdrop:bg-neutral-950/40"
    >
      <div className="flex max-h-[90vh] flex-col">
        <header className="border-b border-neutral-200 px-5 py-4">
          <h2 id="po-preview-title" className="text-lg font-semibold">
            Issue {preview.orders.length} purchase order{preview.orders.length === 1 ? "" : "s"} in Zoho?
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            {lines} line{lines === 1 ? "" : "s"}, {fmtInt(units)} units. Each order is created and <strong>issued straight away</strong> to its
            distributor. Issued orders can only be cancelled inside Zoho.
          </p>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {preview.orders.map((o) => (
            <section key={o.distributor_id} aria-label={`Order for ${o.distributor_name}`} className="rounded-xl border border-neutral-200">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 px-4 py-2.5">
                <p className="font-medium">
                  {o.distributor_name} <span className="font-mono text-xs text-neutral-600">{o.distributor_id}</span>
                </p>
                <p className="text-xs text-neutral-700">
                  Due {fmtDate(o.delivery_date)}
                  {o.value != null ? ` · ${fmtRupees(o.value)}` : ""}
                </p>
              </div>
              <ul className="divide-y divide-neutral-100 text-sm">
                {o.lines.map((l) => (
                  <li key={l.recommendation_id} className={`flex justify-between gap-3 px-4 py-2 ${l.above_cap ? "bg-amber-50" : ""}`}>
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs text-neutral-600">{l.sku_id}</span> {l.sku_name.replace(/^Freshroots\s+/i, "")}
                    </span>
                    <span className="tabular shrink-0 font-semibold">
                      {fmtInt(l.qty)}
                      {l.above_cap ? (
                        <span className="ml-2 text-xs font-medium text-amber-900">above {preview.maxMultiple}× standard ({fmtInt(l.standard_qty)})</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {preview.problems.length ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {preview.problems.length} line(s) can&apos;t be ordered yet ({preview.problems.map((p) => `${p.sku_id}: ${p.reason.replace(/_/g, " ")}`).join("; ")}).
              They stay on this page until the Zoho link is fixed.
            </p>
          ) : null}
        </div>
        <footer className="flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-neutral-50 px-5 py-3">
          {needsCheck ? (
            <label className="flex items-center gap-2 text-sm text-amber-950">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              I&apos;ve checked the {preview.aboveCap} highlighted quantit{preview.aboveCap === 1 ? "y" : "ies"}
            </label>
          ) : null}
          <div className="ml-auto flex gap-2">
            <button type="button" className={btn.secondary} disabled={pending} onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button type="button" className={btn.primary} disabled={pending || preview.orders.length === 0 || (needsCheck && !checked)} onClick={send}>
              {pending ? "Issuing…" : `Issue ${preview.orders.length} order${preview.orders.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
