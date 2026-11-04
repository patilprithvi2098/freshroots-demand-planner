"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lightbulb } from "lucide-react";
import type { Proposal } from "@/lib/ruleReview";
import { btn } from "@/components/ui";
import { acceptProposalAction, dismissProposalAction } from "../actions";

const REASON: Record<string, string> = {
  known_event: "known event",
  new_product: "new product",
  supplier_constraint: "supplier constraint",
  rule_too_strict: "rule too strict",
  rule_too_loose: "rule too loose",
  other: "other",
};

export function RuleReview({ proposals }: { proposals: Proposal[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function act(key: string, fn: (k: string) => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusyKey(key);
    setMsg(null);
    start(async () => {
      const res = await fn(key);
      setMsg({ ok: res.ok, text: res.ok ? (res.message ?? "Done.") : (res.error ?? "Something went wrong") });
      setBusyKey(null);
      if (res.ok) router.refresh();
    });
  }

  return (
    <section aria-labelledby="review-h" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
      <h2 id="review-h" className="flex items-center gap-2 font-semibold">
        <Lightbulb aria-hidden className="h-4 w-4 text-amber-700" /> Rule review
      </h2>
      <p className="mt-1 text-sm text-neutral-700">
        When you correct the same thing at least 3 times in the last 5 runs made with the current rules, it shows up here as a suggested rule
        change, checked against what actually happened afterwards. The rules never change unless you accept.
      </p>
      <div aria-live="polite">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
            {msg.text}
          </p>
        ) : null}
      </div>
      {proposals.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-700">No suggestions right now. Your changes don&apos;t show a repeated pattern yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {proposals.map((p) => {
            const reasons = Object.entries(p.evidence.reasons)
              .sort((a, b) => b[1] - a[1])
              .map(([r, n]) => `${REASON[r] ?? r} ×${n}`)
              .join(", ");
            return (
              <li key={p.key} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.title}</p>
                    <p className="mt-1 text-sm text-neutral-800">{p.why}</p>
                    {p.change ? (
                      <p className="mt-2 text-sm">
                        <span className="text-neutral-600">{p.change.label}:</span>{" "}
                        <span className="tabular font-semibold">
                          {p.change.from} → {p.change.to}
                        </span>
                      </p>
                    ) : p.skuNote ? (
                      <p className="mt-2 text-sm">
                        <span className="text-neutral-600">Your usual quantities:</span> {p.skuNote}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-neutral-600">
                      {p.evidence.overrides} changes on {p.evidence.skus.join(", ")} · reasons: {reasons}.{" "}
                      {p.support === "supported"
                        ? `Outcomes back it: ${p.evidence.override_ok} of ${p.evidence.override_measured} of your changes went fine` +
                          (p.evidence.rule_measured ? `, against ${p.evidence.rule_ok} of ${p.evidence.rule_measured} for the rule.` : ".")
                        : "Not enough measured outcomes yet to confirm it."}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className={btn.primary}
                      disabled={pending}
                      onClick={() => act(p.key, acceptProposalAction)}
                      aria-label={`Accept: ${p.title}`}
                    >
                      {busyKey === p.key && pending ? "Saving…" : p.change ? "Accept and backtest" : "Noted"}
                    </button>
                    <button type="button" className={btn.secondary} disabled={pending} onClick={() => act(p.key, dismissProposalAction)} aria-label={`Dismiss: ${p.title}`}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
