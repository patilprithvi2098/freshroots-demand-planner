"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { createZohoOrdersAction, syncZohoAction } from "../actions";

export function ZohoOrderButtons({ pendingLines, configured }: { pendingLines: number; configured: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function act(fn: typeof createZohoOrdersAction | typeof syncZohoAction) {
    setResult(null);
    start(async () => {
      const res = await fn();
      setConfirming(false);
      setResult(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
      router.refresh();
    });
  }

  if (!configured) {
    return <p className="max-w-xs text-right text-sm text-neutral-600">Zoho Inventory is not connected yet.</p>;
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <div role="alertdialog" aria-labelledby="zoho-confirm-title" aria-describedby="zoho-confirm-body" className="max-w-sm rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p id="zoho-confirm-title" className="font-medium">
            Create draft purchase orders in Zoho Inventory?
          </p>
          <p id="zoho-confirm-body" className="mt-1">
            {pendingLines} released line{pendingLines === 1 ? "" : "s"} will be grouped into one draft PO per distributor. Nothing goes to a supplier until you issue the PO in Zoho.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn.primary} disabled={pending} onClick={() => act(createZohoOrdersAction)}>
              {pending ? "Creating…" : "Yes, create drafts"}
            </button>
            <button type="button" className={btn.secondary} disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} disabled={pending} onClick={() => act(syncZohoAction)}>
            {pending ? "Checking…" : "Refresh Zoho status"}
          </button>
          <button type="button" className={btn.primary} disabled={pending || pendingLines === 0} onClick={() => setConfirming(true)}>
            Create POs in Zoho
          </button>
        </div>
      )}
      <div aria-live="polite">
        {result ? <p className={`max-w-sm text-right text-sm ${result.ok ? "text-brand-800" : "text-red-700"}`}>{result.text}</p> : null}
      </div>
    </div>
  );
}
