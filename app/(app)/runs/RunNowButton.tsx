"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { runNowAction } from "../actions";

export function RunNowButton({ stale, staleMessage, disabled }: { stale: boolean; staleMessage: string | null; disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run(confirmStale: boolean) {
    setResult(null);
    start(async () => {
      const res = await runNowAction(confirmStale);
      if (res.ok) {
        setConfirming(false);
        setResult({ ok: true, text: res.message ?? "Run complete." });
        router.refresh();
      } else if (res.code === "stale_inventory") {
        setConfirming(true);
      } else {
        setResult({ ok: false, text: res.error });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <div role="alertdialog" aria-labelledby="stale-title" className="max-w-sm rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p id="stale-title" className="font-medium">
            Run on stale inventory?
          </p>
          <p className="mt-1">{staleMessage} Recommendations may be wrong if stock has moved since.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn.primary} disabled={pending} onClick={() => run(true)}>
              {pending ? "Running…" : "Yes, run anyway"}
            </button>
            <button type="button" className={btn.secondary} disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={btn.primary} disabled={pending || disabled} onClick={() => (stale ? setConfirming(true) : run(false))}>
          {pending ? "Running…" : "Run now"}
        </button>
      )}
      <div aria-live="polite">
        {result ? (
          <p className={`max-w-sm text-right text-sm ${result.ok ? "text-brand-800" : "text-red-700"}`}>
            {result.text}
            {result.ok ? (
              <>
                {" "}
                <a href="/queue" className="underline">
                  Open the review queue
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
