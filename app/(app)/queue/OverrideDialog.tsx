"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { fmtInt } from "@/lib/format";
import { btn, input } from "@/components/ui";
import { editAction, rejectAction } from "../actions";
import type { QueueRow } from "./QueueClient";

const REASONS: { value: string; label: string }[] = [
  { value: "known_event", label: "Known event" },
  { value: "new_product", label: "New product" },
  { value: "supplier_constraint", label: "Supplier constraint" },
  { value: "rule_too_strict", label: "Rule too strict" },
  { value: "rule_too_loose", label: "Rule too loose" },
  { value: "other", label: "Other" },
];

export function OverrideDialog({ mode, row, onClose, onDone }: { mode: "edit" | "reject"; row: QueueRow; onClose: () => void; onDone: (msg: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [qty, setQty] = useState(String(row.final_qty ?? row.recommended_qty ?? 0));
  const [reason, setReason] = useState(row.override_reason_code ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    // No close() in cleanup: React's dev double-mount would fire onClose and unmount the dialog.
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason) return setError("Choose a reason.");
    if (mode === "edit" && !/^\d+$/.test(qty.trim())) return setError("Quantity must be a whole number, 0 or more.");
    start(async () => {
      const res =
        mode === "edit"
          ? await editAction({ id: row.id, qty: Number(qty), reason, note })
          : await rejectAction({ id: row.id, reason, note });
      if (res.ok) onDone(mode === "edit" ? `${row.sku_id} edited to ${fmtInt(Number(qty))}.` : `${row.sku_id} rejected.`);
      else setError(res.error);
    });
  }

  const title = mode === "edit" ? `Edit quantity for ${row.sku_id}` : `Reject recommendation for ${row.sku_id}`;
  return (
    <dialog
      ref={ref}
      aria-labelledby="override-title"
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-lg p-0 shadow-xl backdrop:bg-black/30"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h2 id="override-title" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            {row.sku_name}. The rules recommended {row.recommended_qty == null ? "manual review" : `${fmtInt(row.recommended_qty)} units`}.
          </p>
        </div>
        {mode === "edit" ? (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Final quantity</span>
            <input className={input} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus aria-describedby="qty-help" />
            <span id="qty-help" className="mt-1 block text-xs text-neutral-600">
              Whole units. Procurement sees only this number.
            </span>
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            Reason <span className="text-red-700">(required)</span>
          </span>
          <select className={input} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus={mode === "reject"}>
            <option value="" disabled>
              Choose a reason
            </option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Note (optional)</span>
          <textarea className={input} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="note-help" />
          <span id="note-help" className="mt-1 block text-xs text-neutral-600">
            Kept for the audit trail. Never sent to the AI.
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={() => ref.current?.close()} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className={mode === "edit" ? btn.primary : btn.danger} disabled={pending}>
            {pending ? "Saving…" : mode === "edit" ? "Save edit" : "Reject"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
