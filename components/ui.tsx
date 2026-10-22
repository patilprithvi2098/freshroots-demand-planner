import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-neutral-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-900",
    success: "border-brand-100 bg-brand-50 text-brand-800",
  }[tone];
  return (
    <div role={tone === "error" || tone === "warn" ? "alert" : "status"} className={`mb-4 rounded-md border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-neutral-600">{children}</div> : null}
    </div>
  );
}

const FLAG_STYLE: Record<string, string> = {
  stockout_risk: "bg-red-100 text-red-800 ring-red-200",
  overstock_risk: "bg-amber-100 text-amber-900 ring-amber-200",
  high_demand: "bg-sky-100 text-sky-900 ring-sky-200",
  no_action: "bg-neutral-100 text-neutral-700 ring-neutral-200",
};

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>;
}

export function FlagPill({ flag, label }: { flag: string; label: string }) {
  return <Pill className={FLAG_STYLE[flag] ?? FLAG_STYLE.no_action}>{label}</Pill>;
}

export function ExceptionPill() {
  return (
    <Pill className="bg-violet-100 text-violet-900 ring-violet-300">
      <span aria-hidden className="mr-1">◆</span>Exception
    </Pill>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  approved: "bg-brand-50 text-brand-800 ring-brand-100",
  edited: "bg-sky-50 text-sky-900 ring-sky-200",
  rejected: "bg-red-50 text-red-800 ring-red-200",
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return <Pill className={STATUS_STYLE[status] ?? STATUS_STYLE.pending}>{label}</Pill>;
}

export const btn = {
  primary:
    "inline-flex items-center justify-center rounded-md bg-brand-700 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50",
};

export const input =
  "block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";
