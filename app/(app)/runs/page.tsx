import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { daysBetween } from "@/lib/rules/isoWeek";
import { createClient } from "@/lib/supabase/server";
import { getActiveConfig, getDataFreshness } from "@/lib/services/engineInput";
import { todayIst } from "@/lib/services/db";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { Banner, Card, EmptyState, PageHeader } from "@/components/ui";
import { RunNowButton } from "./RunNowButton";

const FEATURE_LABEL: Record<string, string> = {
  unit_price: "Unit prices (rupee ranking)",
  lead_time: "Lead times",
  launch_date: "Launch dates (new-launch rule)",
  distributor_sales: "Distributor-level sales (distributor-shift rule)",
  open_purchase_orders: "Open purchase orders (on-order cover)",
  festival_calendar: "Festival calendar",
};

export default async function RunsPage() {
  await requireRole(["planner"]);
  const db = await createClient();
  const [fresh, config, runsRes] = await Promise.all([
    getDataFreshness(db),
    getActiveConfig(db),
    db.from("runs").select("*").order("created_at", { ascending: false }).limit(30),
  ]);
  const runs = runsRes.data ?? [];
  const age = fresh.latestInventoryDate ? daysBetween(fresh.latestInventoryDate, todayIst()) : null;
  const stale = age != null && age > config.params.stale_inventory_days;
  const latest = runs.find((r) => r.status === "completed");
  const features = (latest?.features ?? null) as Record<string, boolean> | null;
  const skipped = (latest?.skipped ?? []) as { sku_id: string; reason: string }[];

  return (
    <>
      <PageHeader
        title="Runs"
        description="Run the rules on the latest uploaded sales and inventory. Each run creates a fresh set of recommendations in the review queue."
        actions={<RunNowButton stale={stale} staleMessage={stale ? `Inventory is ${age} days old (as of ${fmtDate(fresh.latestInventoryDate)}).` : null} disabled={!fresh.latestInventoryDate || !fresh.latestSalesWeek} />}
      />
      {stale ? (
        <Banner tone="warn">
          Inventory data is <strong>{age} days old</strong> (as of {fmtDate(fresh.latestInventoryDate)}); the limit is {config.params.stale_inventory_days} days. Upload a fresh
          inventory export, or confirm you want to run on stale stock.
        </Banner>
      ) : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs uppercase text-neutral-600">Latest sales week</p>
          <p className="mt-1 text-xl font-semibold">{fresh.latestSalesWeek ?? "None uploaded"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-neutral-600">Inventory as of</p>
          <p className="mt-1 text-xl font-semibold">{fmtDate(fresh.latestInventoryDate)}</p>
          {age != null ? <p className="text-sm text-neutral-600">{age === 0 ? "Today" : `${age} day(s) ago`}</p> : null}
        </Card>
        <Card>
          <p className="text-xs uppercase text-neutral-600">Rule set</p>
          <p className="mt-1 text-xl font-semibold">Version {config.version}</p>
          <Link href="/settings" className="text-sm text-brand-700 underline">
            View rules
          </Link>
        </Card>
      </div>

      {features ? (
        <Card className="mb-6">
          <h2 className="font-semibold">Optional data in the latest run</h2>
          <p className="mb-3 text-sm text-neutral-600">Features switch off when their data is missing. The run never fails because of it.</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {Object.entries(FEATURE_LABEL).map(([k, label]) => (
              <li key={k} className="flex items-center gap-2">
                <span aria-hidden className={features[k] ? "text-brand-700" : "text-neutral-400"}>
                  {features[k] ? "●" : "○"}
                </span>
                {label}: <strong>{features[k] ? "on" : "off"}</strong>
              </li>
            ))}
          </ul>
          {skipped.length ? (
            <p className="mt-3 text-sm text-amber-900">
              Skipped {skipped.length} SKU(s): {skipped.map((s) => `${s.sku_id} (${s.reason})`).join("; ")}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold">Run history</h2>
        {runs.length === 0 ? (
          <EmptyState title="No runs yet">Upload the five files, then click Run now.</EmptyState>
        ) : (
          <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand-700" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-neutral-600">
                <tr>
                  <th className="py-2 pr-4">Run at</th>
                  <th className="py-2 pr-4">Data as of</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Trigger</th>
                  <th className="py-2 pr-4 text-right">SKUs</th>
                  <th className="py-2 pr-4 text-right">Flagged</th>
                  <th className="py-2 pr-4 text-right">Exceptions</th>
                  <th className="py-2">Rules</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-4 whitespace-nowrap">{fmtDateTime(r.run_date)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {fmtDate(r.as_of_date)}
                      {r.stale_inventory_confirmed ? <span className="ml-1 text-xs text-amber-800">(stale confirmed)</span> : null}
                    </td>
                    <td className="py-2 pr-4 capitalize">
                      {r.status}
                      {r.error ? <span className="block text-xs text-red-700">{r.error}</span> : null}
                    </td>
                    <td className="py-2 pr-4">{r.triggered_by === "cron" ? "Scheduled" : "Manual"}</td>
                    <td className="tabular py-2 pr-4 text-right">{fmtInt(r.sku_count)}</td>
                    <td className="tabular py-2 pr-4 text-right">{fmtInt(r.flagged_count)}</td>
                    <td className="tabular py-2 pr-4 text-right">{fmtInt(r.exception_count)}</td>
                    <td className="py-2">v{r.config_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
