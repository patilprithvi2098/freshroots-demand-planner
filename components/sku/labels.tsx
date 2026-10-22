import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Minus, PackageX, Sparkles, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

/** Plain-language situation for each flag, as Raghav would say it. */
export const SITUATION: Record<string, { label: string; short: string; tone: string; icon: ReactNode }> = {
  stockout_risk: {
    label: "Stockout risk",
    short: "Running low",
    tone: "bg-red-50 text-red-800 ring-red-200",
    icon: <AlertTriangle aria-hidden className="h-3.5 w-3.5" />,
  },
  overstock_risk: {
    label: "Overstock risk",
    short: "Too much stock",
    tone: "bg-amber-50 text-amber-900 ring-amber-200",
    icon: <PackageX aria-hidden className="h-3.5 w-3.5" />,
  },
  high_demand: {
    label: "High demand",
    short: "Demand rising",
    tone: "bg-sky-50 text-sky-900 ring-sky-200",
    icon: <TrendingUp aria-hidden className="h-3.5 w-3.5" />,
  },
  no_action: {
    label: "Healthy",
    short: "Healthy",
    tone: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    icon: <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />,
  },
};

export function SituationBadge({ flag, short = false }: { flag: string; short?: boolean }) {
  const s = SITUATION[flag] ?? SITUATION.no_action;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.tone}`}>
      {s.icon}
      {short ? s.short : s.label}
    </span>
  );
}

export function JudgementBadge() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900 ring-1 ring-inset ring-violet-300">
      <Sparkles aria-hidden className="h-3.5 w-3.5" />
      Needs judgement
    </span>
  );
}

export function TrendValue({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-neutral-500">–</span>;
  const v = pct * 100;
  const Icon = v > 2 ? ArrowUpRight : v < -2 ? ArrowDownRight : Minus;
  const tone = v > 20 ? "text-sky-800 font-semibold" : v < -10 ? "text-neutral-700" : "text-neutral-700";
  return (
    <span className={`tabular inline-flex items-center gap-0.5 ${tone}`}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {v > 0 ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}

export const DECISION: Record<string, { label: string; tone: string }> = {
  pending: { label: "To decide", tone: "bg-white text-neutral-700 ring-neutral-300" },
  approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  edited: { label: "Changed", tone: "bg-sky-50 text-sky-900 ring-sky-200" },
  rejected: { label: "Rejected", tone: "bg-red-50 text-red-800 ring-red-200" },
};

export function DecisionBadge({ status, released }: { status: string; released?: boolean }) {
  if (released)
    return <span className="inline-flex whitespace-nowrap rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">Sent to procurement</span>;
  const d = DECISION[status] ?? DECISION.pending;
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${d.tone}`}>{d.label}</span>;
}
