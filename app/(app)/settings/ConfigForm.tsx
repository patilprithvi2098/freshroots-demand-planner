"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RuleParams } from "@/lib/rules/types";
import { btn, input } from "@/components/ui";
import { saveConfigAction } from "../actions";

type FieldKey =
  | "festival_uplift_pct"
  | "avg_window_weeks"
  | "trend_window_weeks"
  | "trend_threshold_pct"
  | "trend_reorder_multiplier"
  | "low_min"
  | "low_max"
  | "high_min"
  | "high_max"
  | "new_launch_weeks"
  | "stale_inventory_days"
  | "distributor_share_shift_pp"
  | "max_ai_calls_per_run"
  | "max_missing_weeks"
  | "max_qty_multiple";

const FIELDS: { key: FieldKey; label: string; help: string; step?: string }[] = [
  { key: "festival_uplift_pct", label: "Festival uplift (%)", help: "Added to average demand in festival months." },
  { key: "avg_window_weeks", label: "Average window (weeks)", help: "Base average and minimum history." },
  { key: "trend_window_weeks", label: "Trend window (weeks)", help: "Recent window compared with the average." },
  { key: "trend_threshold_pct", label: "High-demand threshold (%)", help: "Trend above this sets high demand." },
  { key: "trend_reorder_multiplier", label: "High-demand reorder multiplier", help: "Times the standard quantity.", step: "0.1" },
  { key: "low_min", label: "Low perishability: minimum cover (weeks)", help: "Below this is stockout risk.", step: "0.5" },
  { key: "low_max", label: "Low perishability: maximum cover (weeks)", help: "Above this is overstock risk.", step: "0.5" },
  { key: "high_min", label: "High perishability: minimum cover (weeks)", help: "Below this is stockout risk.", step: "0.5" },
  { key: "high_max", label: "High perishability: maximum cover (weeks)", help: "Above this is overstock risk.", step: "0.5" },
  { key: "new_launch_weeks", label: "New launch window (weeks)", help: "Launched within this goes to manual review." },
  { key: "stale_inventory_days", label: "Stale inventory (days)", help: "Older stock needs confirmation before a run." },
  { key: "distributor_share_shift_pp", label: "Distributor shift (percentage points)", help: "Share change that marks an exception." },
  { key: "max_missing_weeks", label: "Allowed missing weeks", help: "More missing weeks than this marks data gaps." },
  { key: "max_qty_multiple", label: "Quantity ceiling (× standard)", help: "Recommended quantities never exceed this.", step: "0.5" },
  { key: "max_ai_calls_per_run", label: "AI calls per run (max 80)", help: "Exceptions beyond this get no rationale." },
];

function toFields(p: RuleParams): Record<FieldKey, string> {
  return {
    festival_uplift_pct: String(p.festival_uplift_pct),
    avg_window_weeks: String(p.avg_window_weeks),
    trend_window_weeks: String(p.trend_window_weeks),
    trend_threshold_pct: String(p.trend_threshold_pct),
    trend_reorder_multiplier: String(p.trend_reorder_multiplier),
    low_min: String(p.low_perishability.min_weeks),
    low_max: String(p.low_perishability.max_weeks),
    high_min: String(p.high_perishability.min_weeks),
    high_max: String(p.high_perishability.max_weeks),
    new_launch_weeks: String(p.new_launch_weeks),
    stale_inventory_days: String(p.stale_inventory_days),
    distributor_share_shift_pp: String(p.distributor_share_shift_pp),
    max_ai_calls_per_run: String(p.max_ai_calls_per_run),
    max_missing_weeks: String(p.max_missing_weeks ?? 2),
    max_qty_multiple: String(p.max_qty_multiple ?? 3),
  };
}

export function ConfigForm({ params }: { params: RuleParams }) {
  const router = useRouter();
  const [values, setValues] = useState(toFields(params));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const n = (k: FieldKey) => Number(values[k]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await saveConfigAction({
        festival_uplift_pct: n("festival_uplift_pct"),
        avg_window_weeks: n("avg_window_weeks"),
        trend_window_weeks: n("trend_window_weeks"),
        trend_threshold_pct: n("trend_threshold_pct"),
        trend_reorder_multiplier: n("trend_reorder_multiplier"),
        low_perishability: { min_weeks: n("low_min"), max_weeks: n("low_max") },
        high_perishability: { min_weeks: n("high_min"), max_weeks: n("high_max") },
        new_launch_weeks: n("new_launch_weeks"),
        stale_inventory_days: n("stale_inventory_days"),
        distributor_share_shift_pp: n("distributor_share_shift_pp"),
        max_ai_calls_per_run: n("max_ai_calls_per_run"),
        max_missing_weeks: n("max_missing_weeks"),
        max_qty_multiple: n("max_qty_multiple"),
      });
      if (res.ok) {
        setMsg({ ok: true, text: res.message ?? "Saved." });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block font-medium">{f.label}</span>
            <input
              type="number"
              step={f.step ?? "1"}
              min="0"
              required
              className={input}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            <span className="mt-1 block text-xs text-neutral-600">{f.help}</span>
          </label>
        ))}
      </div>
      <div aria-live="polite">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-brand-800" : "text-red-700"}`}>
            {msg.text}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button type="submit" className={btn.primary} disabled={pending}>
          {pending ? "Saving…" : "Save as new version"}
        </button>
        <button type="button" className={btn.secondary} disabled={pending} onClick={() => setValues(toFields(params))}>
          Reset
        </button>
      </div>
    </form>
  );
}
