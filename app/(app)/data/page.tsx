import { requireRole } from "@/lib/auth";
import { FILE_TYPES, type FileType } from "@/lib/csv/loaders";
import { createClient } from "@/lib/supabase/server";
import { loadPlanning } from "@/lib/services/overview";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { Banner, EmptyState } from "@/components/ui";
import { RunNowButton } from "./RunNowButton";
import { UploadZone } from "./UploadZone";

const GROUPS: { key: string; title: string; hint: string; types: FileType[]; compact: boolean }[] = [
  {
    key: "cycle",
    title: "Every planning cycle",
    hint: "Upload the latest SAP sales and stock exports each Tuesday and Friday before running planning.",
    types: ["weekly_sales", "current_inventory"],
    compact: false,
  },
  {
    key: "masters",
    title: "When something changes",
    hint: "New SKUs, new distributors, or next year's festival months.",
    types: ["sku_master", "distributor_master", "calendar"],
    compact: true,
  },
  {
    key: "optional",
    title: "Optional",
    hint: "Open POs from Zoho add stock on order to cover. Past decisions let the backtest measure agreement.",
    types: ["open_purchase_orders", "historical_decisions"],
    compact: true,
  },
];

const FEATURE_LABEL: Record<string, string> = {
  unit_price: "Unit prices (rank by rupee value)",
  lead_time: "Lead times",
  launch_date: "Launch dates (new-launch check)",
  distributor_sales: "Sales by distributor (distributor-shift check)",
  open_purchase_orders: "Open POs from Zoho (stock on order)",
  festival_calendar: "Festival calendar",
};

export default async function DataPage() {
  await requireRole(["planner"]);
  const db = await createClient();
  const [p, batchesRes, runsRes] = await Promise.all([
    loadPlanning(db),
    db.from("upload_batches").select("id, file_type, filename, row_count, created_at, warnings").eq("status", "confirmed").order("created_at", { ascending: false }).limit(30),
    db.from("runs").select("*").order("created_at", { ascending: false }).limit(20),
  ]);
  const batches = batchesRes.data ?? [];
  const runs = runsRes.data ?? [];
  const lastByType = new Map<string, (typeof batches)[number]>();
  for (const b of batches) if (!lastByType.has(b.file_type)) lastByType.set(b.file_type, b);
  const stale = p.sources.find((s) => s.key === "current_inventory")?.status === "stale";
  const latest = runs.find((r) => r.status === "completed");
  const features = (latest?.features ?? null) as Record<string, boolean> | null;
  const skipped = (latest?.skipped ?? []) as { sku_id: string; reason: string }[];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            SAP and Zoho are not connected directly yet (no API access confirmed), so each cycle starts by uploading the SAP exports here. You see a
            preview and any problems before anything is saved.
          </p>
        </div>
        <RunNowButton
          stale={Boolean(stale)}
          staleMessage={stale ? `Stock data is ${p.inventoryAgeDays} days old.` : null}
          disabled={!p.sources.every((s) => s.status !== "missing" || ["open_purchase_orders", "distributor_master", "calendar"].includes(s.key))}
        />
      </div>

      {stale ? (
        <Banner tone="warn">
          The stock file is <strong>{p.inventoryAgeDays} days old</strong>; the limit is {p.params.stale_inventory_days} days. Upload a fresh SAP stock export before
          planning, or confirm you want to plan on old stock.
        </Banner>
      ) : null}

      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`grp-${g.key}`} className="mb-8">
          <h2 id={`grp-${g.key}`} className="font-semibold">
            {g.title}
          </h2>
          <p className="mb-3 text-sm text-neutral-600">{g.hint}</p>
          <div className={g.compact ? "grid gap-3 lg:grid-cols-2" : "grid gap-4 lg:grid-cols-2"}>
            {g.types.map((type) => {
              const f = FILE_TYPES.find((x) => x.type === type)!;
              const last = lastByType.get(type);
              const source = p.sources.find((s) => s.key === type);
              return (
                <UploadZone
                  key={type}
                  fileType={type}
                  label={f.label.replace(/ \(optional.*\)$/, "")}
                  compact={g.compact}
                  status={source?.detail ?? null}
                  lastUpload={last ? `${last.filename} · ${fmtInt(last.row_count)} rows · ${fmtDateTime(last.created_at)}` : null}
                />
              );
            })}
          </div>
        </section>
      ))}

      {features ? (
        <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm" aria-labelledby="feat-h">
          <h2 id="feat-h" className="font-semibold">
            Optional data in the latest plan
          </h2>
          <p className="mb-3 text-sm text-neutral-600">Checks switch off when their data is missing. Planning never fails because of it.</p>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {Object.entries(FEATURE_LABEL).map(([k, label]) => (
              <li key={k} className="flex items-center gap-2">
                <span aria-hidden className={`h-2 w-2 rounded-full ${features[k] ? "bg-emerald-600" : "bg-neutral-300"}`} />
                {label}: <strong>{features[k] ? "on" : "off"}</strong>
              </li>
            ))}
          </ul>
          {skipped.length ? (
            <p className="mt-3 text-sm text-amber-900">
              Skipped {skipped.length} SKU(s): {skipped.map((s) => `${s.sku_id} (${s.reason})`).join("; ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm" aria-labelledby="runs-h">
        <h2 id="runs-h" className="mb-3 font-semibold">
          Planning runs
        </h2>
        {runs.length === 0 ? (
          <EmptyState title="No runs yet">Upload the files above, then click Run planning.</EmptyState>
        ) : (
          <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-emerald-700" tabIndex={0} role="region" aria-label="Planning runs (scrolls sideways)">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-neutral-600">
                <tr>
                  <th className="py-2 pr-4">Run at</th>
                  <th className="py-2 pr-4">Stock as of</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">SKUs</th>
                  <th className="py-2 pr-4 text-right">Need review</th>
                  <th className="py-2 pr-4 text-right">Need judgement</th>
                  <th className="py-2">Rules</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-4 whitespace-nowrap">{fmtDateTime(r.run_date)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {fmtDate(r.as_of_date)}
                      {r.stale_inventory_confirmed ? <span className="ml-1 text-xs text-amber-800">(old stock confirmed)</span> : null}
                    </td>
                    <td className="py-2 pr-4 capitalize">
                      {r.status === "superseded" ? "Replaced" : r.status}
                      {r.error ? <span className="block text-xs text-red-700">{r.error}</span> : null}
                    </td>
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
      </section>
    </>
  );
}
