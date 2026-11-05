import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { releasedItems } from "@/lib/services/procurement";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import type { OrderStatus } from "@/lib/services/procurement";
import { btn, EmptyState, PageHeader } from "@/components/ui";
import { SkuImage } from "@/components/sku/SkuImage";
import { zohoConfigFromEnv } from "@/lib/integrations/zoho";
import { ZohoOrderButtons } from "./ZohoOrderButtons";

export default async function ProcurementPage() {
  const session = await requireRole(["planner", "procurement"]);
  // Delivery status lives in open_purchase_orders, which procurement can't read under RLS: read it server-side.
  const items = await releasedItems(await createClient(), 60, createAdminClient());
  const batches = new Map<string, typeof items>();
  for (const i of items) {
    const key = i.released_at;
    batches.set(key, [...(batches.get(key) ?? []), i]);
  }
  const notOrdered = items.filter((i) => i.final_qty > 0 && !i.zoho_po_number).length;

  return (
    <>
      <PageHeader
        title="Orders for procurement"
        description={
          session.role === "procurement"
            ? "Orders the demand planner has approved and released. Check the preview, then create and issue them in Zoho Inventory in one step. Quantities are final."
            : "Orders you released. Procurement creates and issues them in Zoho Inventory; their status and deliveries show here."
        }
        actions={
          items.length ? (
            <div className="flex flex-col items-end gap-2">
              <ZohoOrderButtons pendingLines={notOrdered} configured={zohoConfigFromEnv() != null} canOrder={session.role === "procurement"} />
              <a className={btn.secondary} href="/api/procurement/export" download>
                Export CSV
              </a>
            </div>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Nothing released yet">No approved orders have been sent in the last 60 days.</EmptyState>
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
                    <th scope="col" className="px-4 py-2">Zoho order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {list.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2 font-mono text-xs">{i.sku_id}</td>
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-3">
                          <SkuImage skuId={i.sku_id} name={i.sku_name} size="xs" />
                          {i.sku_name}
                        </span>
                      </td>
                      <td className="px-4 py-2">{i.distributor_id ?? "–"}</td>
                      <td className="px-4 py-2">{i.action}</td>
                      <td className="tabular px-4 py-2 text-right font-medium">{fmtInt(i.final_qty)}</td>
                      <td className="px-4 py-2">
                        <OrderCell item={i} />
                      </td>
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

const STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  not_ordered: { label: "Not yet ordered", tone: "text-neutral-600" },
  draft: { label: "Created, not issued", tone: "text-amber-800" },
  issued: { label: "Issued", tone: "text-emerald-800" },
  partially_received: { label: "Partly received", tone: "text-sky-800" },
  received: { label: "Received", tone: "text-emerald-900" },
  cancelled: { label: "Cancelled in Zoho", tone: "text-red-700" },
};

function OrderCell({ item: i }: { item: { final_qty: number; zoho_po_number: string | null; zoho_error: string | null; order_status: OrderStatus; received_date: string | null } }) {
  if (i.final_qty === 0) return <span className="text-neutral-600">No order (pause)</span>;
  const s = STATUS[i.order_status];
  return (
    <span className="flex flex-col">
      {i.zoho_po_number ? <span className="font-mono text-xs">{i.zoho_po_number}</span> : null}
      <span className={`text-sm font-medium ${s.tone}`}>
        {s.label}
        {i.order_status === "received" && i.received_date ? ` ${fmtDate(i.received_date)}` : ""}
      </span>
      {i.zoho_error ? <span className="text-xs text-red-700">{i.zoho_error}</span> : null}
    </span>
  );
}
