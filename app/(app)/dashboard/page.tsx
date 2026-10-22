import { requireRole } from "@/lib/auth";
import { LOSS_TARGET_RUPEES, type Light } from "@/lib/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/services/dashboard";
import { fmtDate, fmtInt, fmtPct, fmtRupees } from "@/lib/format";
import { Banner, Card, EmptyState, PageHeader } from "@/components/ui";

const LIGHT: Record<Light, { dot: string; text: string; label: string }> = {
  green: { dot: "bg-green-600", text: "text-green-800", label: "OK" },
  amber: { dot: "bg-amber-500", text: "text-amber-900", label: "Watch" },
  red: { dot: "bg-red-600", text: "text-red-800", label: "Kill condition met" },
  grey: { dot: "bg-neutral-400", text: "text-neutral-600", label: "Not enough data" },
};

export default async function DashboardPage() {
  const session = await requireRole(["planner", "viewer"]);
  let dashboard;
  try {
    // Viewers have no table access under RLS; aggregates are computed server-side with the service key.
    const db = session.role === "viewer" ? createAdminClient() : await createClient();
    dashboard = await loadDashboard(db);
  } catch (e) {
    return (
      <>
        <PageHeader title="Metrics" />
        <Banner tone="error">The dashboard could not load: {e instanceof Error ? e.message : "unknown error"}.</Banner>
      </>
    );
  }
  const d = dashboard;
  const usd = new Intl.NumberFormat("en-IN", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  return (
    <>
      <PageHeader
        title="Metrics"
        description={
          <>
            Goal: cut combined stockout and write-off loss from ₹28–34 lakh to {fmtRupees(LOSS_TARGET_RUPEES)} or below per quarter within two full
            quarters of going live{d.go_live ? <> (first run {fmtDate(d.go_live)})</> : null}.
          </>
        }
      />

      <Card className="mb-6">
        <h2 className="font-semibold">Kill criteria</h2>
        <p className="mb-4 text-sm text-neutral-600">
          Deepa decides whether to stop the system. If any light is red, the fallback is Raghav&apos;s monthly Excel process using the rules on the
          Settings page.
        </p>
        <ul className="grid gap-4 md:grid-cols-3">
          {d.kill.map((k) => {
            const l = LIGHT[k.light];
            return (
              <li key={k.key} className="rounded-md border border-neutral-200 p-4">
                <div className="flex items-center gap-2">
                  <span aria-hidden className={`h-3.5 w-3.5 rounded-full ${l.dot}`} />
                  <span className={`text-sm font-semibold ${l.text}`}>{l.label}</span>
                </div>
                <p className="mt-2 text-sm font-medium">{k.label}</p>
                <p className="tabular mt-1 text-xl font-semibold">{k.value}</p>
                <p className="mt-1 text-xs text-neutral-600">{k.detail}</p>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs uppercase text-neutral-600">Accept rate</p>
          <p className="tabular mt-1 text-2xl font-semibold">{fmtPct(d.accept_rate)}</p>
          <p className="text-xs text-neutral-600">Approved as recommended, of all decisions</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-neutral-600">Stockout weeks</p>
          <p className="tabular mt-1 text-2xl font-semibold">{fmtInt(d.stockout_weeks)}</p>
          <p className="text-xs text-neutral-600">From four-week outcomes</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-neutral-600">Perishable write-offs</p>
          <p className="tabular mt-1 text-2xl font-semibold">{fmtInt(d.perishable_written_off_units)} units</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-neutral-600">Estimated loss this quarter</p>
          <p className="tabular mt-1 text-2xl font-semibold">{d.estimated_quarter_loss == null ? "–" : fmtRupees(d.estimated_quarter_loss)}</p>
          <p className="text-xs text-neutral-600">{d.loss_note}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Override rate by run</h2>
          {d.runs.length === 0 ? (
            <EmptyState title="No decisions yet">Rates appear once the planner approves, edits or rejects recommendations.</EmptyState>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-neutral-600">
                <tr>
                  <th className="py-2 pr-4">Data as of</th>
                  <th className="py-2 pr-4 text-right">Decided</th>
                  <th className="py-2 pr-4 text-right">Overridden</th>
                  <th className="py-2 text-right">Override rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {d.runs.map((r) => (
                  <tr key={r.run_id}>
                    <td className="py-2 pr-4">{fmtDate(r.as_of_date)}</td>
                    <td className="tabular py-2 pr-4 text-right">{r.decided}</td>
                    <td className="tabular py-2 pr-4 text-right">{r.overridden}</td>
                    <td className={`tabular py-2 text-right font-medium ${(r.override_rate ?? 0) > 0.4 ? "text-red-700" : ""}`}>{fmtPct(r.override_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">Rules may not fit these SKUs</h2>
          <p className="mb-3 text-sm text-neutral-600">Overridden 3 or more times in the last 5 runs. The engine never changes its own rules; review them in Settings.</p>
          {d.repeated_overrides.length === 0 ? (
            <p className="text-sm text-neutral-600">None.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {d.repeated_overrides.map((s) => (
                <li key={s.sku_id} className="flex justify-between py-2">
                  <span>
                    <span className="font-mono text-xs">{s.sku_id}</span> {s.sku_name}
                  </span>
                  <span className="tabular">
                    {s.overrides} overrides in {s.runs} runs
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-neutral-600">AI spend this month: {usd.format(d.ai_spend_month_usd)}</p>
        </Card>
      </div>
    </>
  );
}
