import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, PackageX, PartyPopper, Sparkles, TrendingUp } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPlanning, type PlanningData } from "@/lib/services/overview";
import { needsReview } from "@/lib/skuRow";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { DemandTrend } from "@/components/charts/DemandTrend";
import { SkuWorkspace } from "@/components/sku/SkuWorkspace";
import { CycleActions } from "./CycleActions";
import { StockHealth } from "./StockHealth";

export default async function OverviewPage() {
  await requireRole(["planner"]);
  const p = await loadPlanning(await createClient());
  const review = p.rows.filter(needsReview);
  const decided = review.filter((r) => r.status !== "pending").length;
  const releasable = p.rows.filter((r) => (r.status === "approved" || r.status === "edited") && !r.released_at).length;
  const released = p.rows.filter((r) => r.released_at).length;
  const stockouts = review.filter((r) => r.flag === "stockout_risk");
  const overstock = review.filter((r) => r.flag === "overstock_risk");
  const rising = review.filter((r) => r.flags.includes("high_demand"));
  const judgement = review.filter((r) => r.is_exception);
  const shortUnits = stockouts.reduce((a, r) => a + (r.gap_units ?? 0), 0);
  const excessUnits = overstock.reduce((a, r) => a + (r.gap_units ?? 0), 0);
  const orderUnits = review.filter((r) => r.recommended_action === "reorder_now").reduce((a, r) => a + (r.recommended_qty ?? 0), 0);

  return (
    <SkuWorkspace rows={p.rows}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-600">{greeting()}, Raghav</p>
          <h1 className="text-2xl font-semibold tracking-tight">This week&apos;s demand plan</h1>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-neutral-700">
          <CalendarDays aria-hidden className="h-4 w-4" /> Next review: {fmtDate(p.nextCycle)} (Tuesdays and Fridays)
        </p>
      </div>

      <CycleCard p={p} reviewCount={review.length} decided={decided} releasable={releasable} released={released} />

      {p.run ? (
        <>
          <section aria-label="What needs attention" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Tile
              href="/queue?view=stockout"
              tone="red"
              icon={<AlertTriangle className="h-5 w-5" />}
              label="Running low"
              value={stockouts.length}
              unit="SKUs"
              detail={stockouts.length ? `~${fmtInt(shortUnits)} units short of minimum cover` : "Nothing at risk of running out"}
            />
            <Tile
              href="/queue?view=overstock"
              tone="amber"
              icon={<PackageX className="h-5 w-5" />}
              label="Too much stock"
              value={overstock.length}
              unit="SKUs"
              detail={overstock.length ? `~${fmtInt(excessUnits)} units over the maximum · pause orders` : "No excess stock"}
            />
            <Tile
              href="/queue?view=rising"
              tone="sky"
              icon={<TrendingUp className="h-5 w-5" />}
              label="Demand rising"
              value={rising.length}
              unit="SKUs"
              detail={rising.length ? "Last 4 weeks > 20% above the 12-week average" : "No unusual demand jumps"}
            />
            <Tile
              href="/queue?view=judgement"
              tone="violet"
              icon={<Sparkles className="h-5 w-5" />}
              label="Needs judgement"
              value={judgement.length}
              unit="SKUs"
              detail={judgement.length ? "Rules disagree or don't fit. Explanation included" : "Every SKU fits the rules"}
            />
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-5">
            <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm xl:col-span-3" aria-labelledby="health-h">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="health-h" className="font-semibold">
                  Stock health
                </h2>
                <p className="text-xs text-neutral-600">Click any SKU for details and to decide</p>
              </div>
              <p className="mb-4 text-sm text-neutral-600">
                Weeks of stock left for each SKU. The green band is the safe range ({p.params.low_perishability.min_weeks}–
                {p.params.low_perishability.max_weeks} weeks, or {p.params.high_perishability.min_weeks}–{p.params.high_perishability.max_weeks} for
                perishables).
              </p>
              <StockHealth rows={p.rows} />
            </section>

            <div className="space-y-6 xl:col-span-2">
              <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm" aria-labelledby="demand-h">
                <h2 id="demand-h" className="mb-2 font-semibold">
                  Total demand, all SKUs
                </h2>
                <DemandTrend data={p.demandTrend} />
              </section>
              <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm" aria-labelledby="order-h">
                <h2 id="order-h" className="font-semibold">
                  This cycle in numbers
                </h2>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Num label="SKUs checked" value={fmtInt(p.rows.length)} />
                  <Num label="Need a decision" value={fmtInt(review.length)} />
                  <Num label="Units suggested to order" value={fmtInt(orderUnits)} />
                  <Num label="Decided so far" value={`${decided} of ${review.length}`} />
                </dl>
              </section>
            </div>
          </div>
        </>
      ) : null}

      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm" aria-labelledby="sources-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sources-h" className="font-semibold">
            Data feeding this plan
          </h2>
          <Link href="/data" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-800 hover:underline">
            Upload new files <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {p.sources.map((s) => (
            <li key={s.key} className="flex items-start gap-3 rounded-xl border border-neutral-200 px-3 py-2.5">
              <StatusDot status={s.status} />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {s.name} <span className="text-xs font-normal text-neutral-600">· {s.system}</span>
                </p>
                <p className="text-xs text-neutral-700">{s.detail}</p>
                <p className="text-xs text-neutral-600">{s.method}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </SkuWorkspace>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function CycleCard({ p, reviewCount, decided, releasable, released }: { p: PlanningData; reviewCount: number; decided: number; releasable: number; released: number }) {
  const dataReady = p.sources.filter((s) => ["weekly_sales", "current_inventory", "sku_master"].includes(s.key)).every((s) => s.status !== "missing");
  const stale = p.sources.find((s) => s.key === "current_inventory")?.status === "stale";
  const ran = Boolean(p.run) && !p.newDataSinceRun;
  const reviewed = ran && reviewCount > 0 && decided === reviewCount;
  const done = ran && released > 0 && releasable === 0 && decided === reviewCount;
  const steps = [
    {
      label: "Fresh data",
      // Old stock counts once the plan has been run on it (the planner confirmed it).
      done: dataReady && (!stale || ran),
      note: stale ? (ran ? "Old stock, confirmed" : "Stock file is old") : dataReady ? "SAP files loaded" : "Upload SAP files",
    },
    { label: "Run the rules", done: ran, note: ran ? `Ran ${fmtDateTime(p.run!.run_date)}` : p.newDataSinceRun ? "New data waiting" : "Not run yet" },
    { label: "Review", done: reviewed, note: ran ? `${decided} of ${reviewCount} decided` : "After the run" },
    { label: "Send to procurement", done, note: released ? `${released} sent` : releasable ? `${releasable} ready to send` : "After review" },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <section aria-label="Planning cycle" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-600">
            {p.run ? (
              <>
                Plan based on stock as of <strong className="text-neutral-900">{fmtDate(p.run.as_of_date)}</strong>
              </>
            ) : (
              "No plan yet for this cycle"
            )}
          </p>
          {p.run?.festival ? (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              <PartyPopper aria-hidden className="h-3.5 w-3.5" /> Festival month: demand raised 25% before checking stock
            </p>
          ) : null}
        </div>
        <CycleActions
          runId={p.run?.id ?? null}
          step={current === -1 ? 4 : current}
          canRun={dataReady}
          stale={Boolean(stale)}
          inventoryAge={p.inventoryAgeDays}
          toReview={reviewCount - decided}
          releasable={releasable}
        />
      </div>
      <ol className="mt-5 grid gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={`rounded-xl border px-3 py-2.5 ${s.done ? "border-emerald-200 bg-emerald-50" : i === current ? "border-emerald-600 bg-white ring-1 ring-emerald-600" : "border-neutral-200 bg-neutral-50"}`}
            aria-current={i === current ? "step" : undefined}
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${s.done ? "bg-emerald-700 text-white" : i === current ? "bg-emerald-700 text-white" : "bg-neutral-300 text-neutral-700"}`}
                aria-hidden
              >
                {s.done ? "✓" : i + 1}
              </span>
              {s.label}
            </p>
            <p className="mt-0.5 pl-7 text-xs text-neutral-700">{s.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const TONES = {
  red: "text-red-700 bg-red-50",
  amber: "text-amber-800 bg-amber-50",
  sky: "text-sky-800 bg-sky-50",
  violet: "text-violet-800 bg-violet-50",
};

function Tile({ href, tone, icon, label, value, unit, detail }: { href: string; tone: keyof typeof TONES; icon: React.ReactNode; label: string; value: number; unit: string; detail: string }) {
  return (
    <Link
      href={href}
      className={`group flex flex-col rounded-2xl border bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:shadow focus-visible:outline-2 focus-visible:outline-emerald-700 ${value ? "border-neutral-200" : "border-neutral-200 opacity-80"}`}
    >
      <span className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${TONES[tone]} [&>svg]:h-4 [&>svg]:w-4`} aria-hidden>
          {icon}
        </span>
        <span className="text-sm font-medium text-neutral-800">{label}</span>
        <ArrowRight aria-hidden className="ml-auto h-4 w-4 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-700" />
      </span>
      <span className="tabular mt-2 text-3xl font-semibold tracking-tight">
        {value} <span className="text-base font-normal text-neutral-600">{unit}</span>
      </span>
      <span className="mt-0.5 text-xs leading-snug text-neutral-700">{detail}</span>
    </Link>
  );
}

function Num({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-3 py-2">
      <dt className="text-xs text-neutral-600">{label}</dt>
      <dd className="tabular text-lg font-semibold">{value}</dd>
    </div>
  );
}

function StatusDot({ status }: { status: "ok" | "stale" | "missing" | "not_connected" }) {
  const map = {
    ok: { c: "bg-emerald-600", t: "Up to date" },
    stale: { c: "bg-amber-500", t: "Out of date" },
    missing: { c: "bg-red-600", t: "Missing" },
    not_connected: { c: "bg-neutral-400", t: "Not connected" },
  }[status];
  return (
    <span className="mt-1.5 flex shrink-0 items-center" title={map.t}>
      <span className={`h-2.5 w-2.5 rounded-full ${map.c}`} />
      <span className="sr-only">{map.t}</span>
    </span>
  );
}
