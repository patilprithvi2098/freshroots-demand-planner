import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { overrideStats, repeatedOverrides } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/services/db";
import { fmtDate } from "@/lib/format";
import { Banner, EmptyState, PageHeader } from "@/components/ui";
import { QueueClient, type QueueRow } from "./QueueClient";

type Search = { flag?: string; exceptions?: string; status?: string; all?: string };

export default async function QueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole(["planner"]);
  const sp = await searchParams;
  const db = await createClient();
  const { data: run } = await db
    .from("runs")
    .select("id, as_of_date, run_date, config_version, flagged_count, exception_count, features")
    .eq("status", "completed")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!run) {
    return (
      <>
        <PageHeader title="Review queue" />
        <EmptyState title="Nothing to review yet">
          Upload the latest SAP files and start a run from the <Link className="text-brand-700 underline" href="/runs">Runs</Link> page.
        </EmptyState>
      </>
    );
  }

  const all = await fetchAll((a, b) => db.from("recommendations").select("*").eq("run_id", run.id).order("rank").range(a, b));

  // "Rules may not fit this SKU": overridden 3+ times in the last 5 runs.
  const { data: recentRuns } = await db
    .from("runs")
    .select("id, as_of_date, run_date, status")
    .in("status", ["completed", "superseded"])
    .order("run_date", { ascending: false })
    .limit(5);
  const runIds = (recentRuns ?? []).map((r) => r.id);
  const recentRecs = runIds.length
    ? await fetchAll((a, b) =>
        db
          .from("recommendations")
          .select("id, run_id, sku_id, sku_name, perishability, status, is_exception, demand_adj")
          .in("run_id", runIds)
          .in("status", ["approved", "edited", "rejected"])
          .order("id")
          .range(a, b),
      )
    : [];
  const misfit = new Set(repeatedOverrides(overrideStats(recentRuns ?? [], recentRecs), recentRecs).map((r) => r.sku_id));

  const rows: QueueRow[] = all.map((r) => ({
    id: r.id,
    sku_id: r.sku_id,
    sku_name: r.sku_name,
    perishability: r.perishability,
    distributor_id: r.distributor_id,
    weeks_cover: r.weeks_cover == null ? null : Number(r.weeks_cover),
    trend_pct: r.trend_pct == null ? null : Number(r.trend_pct),
    avg12: r.avg12 == null ? null : Number(r.avg12),
    demand_adj: r.demand_adj == null ? null : Number(r.demand_adj),
    units_on_hand: r.units_on_hand,
    on_order_units: r.on_order_units,
    flag: r.flag,
    flags: r.flags,
    rules_fired: r.rules_fired as { rule: string; detail: string }[],
    recent_sales: r.recent_sales as { iso_week: string; units: number | null }[],
    recommended_action: r.recommended_action,
    recommended_qty: r.recommended_qty,
    is_exception: r.is_exception,
    exception_reasons: r.exception_reasons,
    rationale: r.rationale,
    check_first: r.check_first,
    ai_status: r.ai_status,
    status: r.status,
    final_qty: r.final_qty,
    override_reason_code: r.override_reason_code,
    override_note: r.override_note,
    released_at: r.released_at,
    rupee_exposure: r.rupee_exposure == null ? null : Number(r.rupee_exposure),
    festival_applied: r.festival_applied,
    misfit: misfit.has(r.sku_id),
  }));

  const pendingAi = rows.filter((r) => r.ai_status === "pending").length;
  const features = run.features as Record<string, boolean>;

  return (
    <>
      <PageHeader
        title="Review queue"
        description={
          <>
            Run on data as of <strong>{fmtDate(run.as_of_date)}</strong> · rules v{run.config_version} · {run.flagged_count} flagged, {run.exception_count} exceptions.
            Nothing reaches procurement until you approve it and click Release.
          </>
        }
      />
      {pendingAi > 0 ? (
        <Banner tone="info">
          Writing explanations for {pendingAi} exception(s). You can start reviewing now; refresh to see them.
        </Banner>
      ) : null}
      {!features?.unit_price ? (
        <p className="mb-3 text-xs text-neutral-600">Unit prices are not loaded, so rows are ordered by weeks of cover instead of rupee exposure.</p>
      ) : null}
      <QueueClient
        runId={run.id}
        rows={rows}
        initial={{
          flag: sp.flag ?? "all",
          exceptionsOnly: sp.exceptions === "1",
          status: sp.status ?? "all",
          showAll: sp.all === "1",
        }}
      />
    </>
  );
}
