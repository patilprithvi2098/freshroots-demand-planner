import Link from "next/link";
import { requireRole } from "@/lib/auth";
import type { BacktestResult } from "@/lib/rules/backtest";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, fmtInt, fmtPct, FLAG_LABEL } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { RunBacktestButton } from "./RunBacktestButton";

export default async function BacktestPage() {
  await requireRole(["planner"]);
  const db = await createClient();
  const [{ data: latest }, { count: decisions }] = await Promise.all([
    db.from("backtest_results").select("*").order("run_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("historical_decisions").select("id", { count: "exact", head: true }),
  ]);
  const res = (latest?.detail ?? null) as BacktestResult | null;

  return (
    <>
      <PageHeader
        title="Backtest"
        description="Replays the current rules over every historical week in the uploaded sales data. Use it to check the rules against Raghav's past decisions before trusting them."
        actions={<RunBacktestButton />}
      />
      <p className="mb-4 text-sm text-neutral-600">
        Historical decisions loaded: <strong>{fmtInt(decisions ?? 0)}</strong>.{" "}
        <Link href="/upload" className="text-brand-700 underline">
          Upload a historical decisions CSV
        </Link>{" "}
        (columns SKU_ID, Week, Action, optional Qty) to measure agreement.
      </p>
      {!res || !latest ? (
        <EmptyState title="No backtest yet">Click Run backtest after uploading weekly sales.</EmptyState>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <p className="text-xs uppercase text-neutral-600">Weeks replayed</p>
              <p className="mt-1 text-2xl font-semibold">{res.weeks.length}</p>
              <p className="text-xs text-neutral-600">
                {fmtDateTime(latest.run_at)} · rules v{latest.config_version}
              </p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-neutral-600">Flagged share, festival months</p>
              <p className="mt-1 text-2xl font-semibold">{fmtPct(res.festival_flag_share)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-neutral-600">Flagged share, other months</p>
              <p className="mt-1 text-2xl font-semibold">{fmtPct(res.non_festival_flag_share)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-neutral-600">Agreement with Raghav</p>
              <p className="mt-1 text-2xl font-semibold">{fmtPct(res.agreement.pct)}</p>
              <p className="text-xs text-neutral-600">{res.agreement.note}</p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-1 font-semibold">Flags per week</h2>
            <p className="mb-3 text-sm text-neutral-600">
              Weeks with an inventory snapshot from that time are replayed in full. Other weeks can only use the trend rule, because
              stock levels for those weeks are not in the data.
            </p>
            <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand-700" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-neutral-600">
                  <tr>
                    <th className="py-2 pr-4">Week</th>
                    <th className="py-2 pr-4">As of</th>
                    <th className="py-2 pr-4">Mode</th>
                    <th className="py-2 pr-4">Festival</th>
                    <th className="py-2 pr-4 text-right">SKUs</th>
                    <th className="py-2 pr-4 text-right">Stockout</th>
                    <th className="py-2 pr-4 text-right">Overstock</th>
                    <th className="py-2 pr-4 text-right">High demand</th>
                    <th className="py-2 pr-4 text-right">Exceptions</th>
                    <th className="py-2 text-right">Flagged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {res.weeks.map((w) => (
                    <tr key={w.iso_week}>
                      <td className="py-2 pr-4 font-mono text-xs">{w.iso_week}</td>
                      <td className="py-2 pr-4">{fmtDate(w.as_of_date)}</td>
                      <td className="py-2 pr-4">{w.mode === "full" ? "Full rules" : "Trend only"}</td>
                      <td className="py-2 pr-4">{w.festival ? "Yes" : "No"}</td>
                      <td className="tabular py-2 pr-4 text-right">{w.sku_count}</td>
                      <td className="tabular py-2 pr-4 text-right">{w.mode === "full" ? w.stockout_risk : "–"}</td>
                      <td className="tabular py-2 pr-4 text-right">{w.mode === "full" ? w.overstock_risk : "–"}</td>
                      <td className="tabular py-2 pr-4 text-right">{w.high_demand}</td>
                      <td className="tabular py-2 pr-4 text-right">{w.mode === "full" ? w.exceptions : "–"}</td>
                      <td className="tabular py-2 text-right font-medium">{w.flagged}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Flagged SKUs by week</h2>
            {res.flags.length === 0 ? (
              <p className="text-sm text-neutral-600">No SKU was flagged in any replayed week.</p>
            ) : (
              <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Table (scrolls)">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs uppercase text-neutral-600">
                    <tr>
                      <th className="py-2 pr-4">Week</th>
                      <th className="py-2 pr-4">SKU</th>
                      <th className="py-2 pr-4">Flag</th>
                      <th className="py-2">Exception</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {res.flags.map((f) => (
                      <tr key={`${f.iso_week}-${f.sku_id}`}>
                        <td className="py-1.5 pr-4 font-mono text-xs">{f.iso_week}</td>
                        <td className="py-1.5 pr-4 font-mono text-xs">{f.sku_id}</td>
                        <td className="py-1.5 pr-4">{FLAG_LABEL[f.flag]}</td>
                        <td className="py-1.5">{f.is_exception ? "Yes" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
