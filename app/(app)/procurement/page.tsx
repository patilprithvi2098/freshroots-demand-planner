import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { releasedItems } from "@/lib/services/procurement";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { btn, EmptyState, PageHeader } from "@/components/ui";

export default async function ProcurementPage() {
  await requireRole(["planner", "procurement"]);
  const items = await releasedItems(await createClient());
  const batches = new Map<string, typeof items>();
  for (const i of items) {
    const key = i.released_at;
    batches.set(key, [...(batches.get(key) ?? []), i]);
  }

  return (
    <>
      <PageHeader
        title="Approved orders for procurement"
        description="Recommendations the demand planner has approved and released. Place these purchase orders in Zoho Inventory. Quantities are final."
        actions={
          items.length ? (
            <a className={btn.primary} href="/api/procurement/export" download>
              Export CSV
            </a>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Nothing released yet">The planner has not released any approved recommendations in the last 60 days.</EmptyState>
      ) : (
        <div className="space-y-6">
          {[...batches].map(([releasedAt, list]) => (
            <section key={releasedAt} tabIndex={0} aria-label={`Released ${fmtDateTime(releasedAt)}`} className="overflow-x-auto rounded-lg border border-neutral-200 bg-white focus-visible:outline-2 focus-visible:outline-brand-700">
              <h2 className="border-b border-neutral-200 px-4 py-3 text-sm font-semibold">
                Released {fmtDateTime(releasedAt)} · {list.length} line(s)
              </h2>
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-600">
                  <tr>
                    <th scope="col" className="px-4 py-2">SKU</th>
                    <th scope="col" className="px-4 py-2">Name</th>
                    <th scope="col" className="px-4 py-2">Distributor</th>
                    <th scope="col" className="px-4 py-2">Action</th>
                    <th scope="col" className="px-4 py-2 text-right">Final quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {list.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2 font-mono text-xs">{i.sku_id}</td>
                      <td className="px-4 py-2">{i.sku_name}</td>
                      <td className="px-4 py-2">{i.distributor_id ?? "–"}</td>
                      <td className="px-4 py-2">{i.action}</td>
                      <td className="tabular px-4 py-2 text-right font-medium">{fmtInt(i.final_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
