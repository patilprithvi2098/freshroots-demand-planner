"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Play, Send } from "lucide-react";
import { btn } from "@/components/ui";
import { releaseAction, runNowAction } from "../actions";

/** The one button for the next step of the cycle. */
export function CycleActions({
  runId,
  step,
  canRun,
  stale,
  inventoryAge,
  toReview,
  releasable,
}: {
  runId: string | null;
  step: number;
  canRun: boolean;
  stale: boolean;
  inventoryAge: number | null;
  toReview: number;
  releasable: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmStale, setConfirmStale] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(confirm: boolean) {
    setMsg(null);
    start(async () => {
      const res = await runNowAction(confirm);
      if (res.ok) {
        setConfirmStale(false);
        setMsg({ ok: true, text: res.message ?? "Plan ready." });
        router.refresh();
      } else if (res.code === "stale_inventory") setConfirmStale(true);
      else setMsg({ ok: false, text: res.error });
    });
  }

  function release() {
    if (!runId) return;
    if (!window.confirm(`Send ${releasable} approved order line(s) to procurement? They can't be changed afterwards.`)) return;
    start(async () => {
      const res = await releaseAction(runId);
      setMsg(res.ok ? { ok: true, text: res.message ?? "Sent." } : { ok: false, text: res.error });
      router.refresh();
    });
  }

  let action: React.ReactNode;
  if (step === 0 || !canRun) {
    action = (
      <Link href="/data" className={btn.primary}>
        Upload SAP files <ArrowRight aria-hidden className="ml-1.5 h-4 w-4" />
      </Link>
    );
  } else if (step === 1) {
    action = confirmStale ? (
      <div role="alertdialog" aria-labelledby="stale-q" className="max-w-xs rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p id="stale-q" className="font-medium">
          Stock data is {inventoryAge} days old. Plan anyway?
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" className={btn.primary} disabled={pending} onClick={() => run(true)}>
            {pending ? "Planning…" : "Yes, plan"}
          </button>
          <button type="button" className={btn.secondary} onClick={() => setConfirmStale(false)}>
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <button type="button" className={btn.primary} disabled={pending} onClick={() => (stale ? setConfirmStale(true) : run(false))}>
        <Play aria-hidden className="mr-1.5 h-4 w-4" /> {pending ? "Planning…" : "Run planning"}
      </button>
    );
  } else if (step === 2) {
    action = (
      <Link href="/queue" className={btn.primary}>
        Review {toReview} SKU{toReview === 1 ? "" : "s"} <ArrowRight aria-hidden className="ml-1.5 h-4 w-4" />
      </Link>
    );
  } else if (step === 3) {
    action = (
      <button type="button" className={btn.primary} disabled={pending || releasable === 0} onClick={release}>
        <Send aria-hidden className="mr-1.5 h-4 w-4" /> {pending ? "Sending…" : `Send ${releasable} to procurement`}
      </button>
    );
  } else {
    action = (
      <Link href="/procurement" className={btn.secondary}>
        Plan sent · view orders <ArrowRight aria-hidden className="ml-1.5 h-4 w-4" />
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {action}
      <div aria-live="polite">{msg ? <p className={`max-w-xs text-right text-sm ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p> : null}</div>
    </div>
  );
}
