import "server-only";
import { fetchAll, type Db } from "./db";

export type OrderStatus = "not_ordered" | "draft" | "issued" | "partially_received" | "received" | "cancelled";

export interface ReleasedItem {
  id: string;
  sku_id: string;
  sku_name: string;
  distributor_id: string | null;
  final_qty: number;
  action: string;
  released_at: string;
  zoho_po_number: string | null;
  zoho_error: string | null;
  order_status: OrderStatus;
  received_date: string | null;
}

/**
 * Released recommendations only (RLS enforces this for procurement users too).
 * No join to runs: procurement has no access to that table, and an inner join would hide every row.
 * Procurement sees the final quantity, never the original recommendation or override notes.
 *
 * `poDb` reads open_purchase_orders for delivery status. Procurement has no table access to it under RLS,
 * so the page passes the service client after its role check.
 */
export async function releasedItems(db: Db, sinceDays = 60, poDb: Db = db): Promise<ReleasedItem[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = await fetchAll((a, b) =>
    db
      .from("recommendations")
      .select("id, sku_id, sku_name, distributor_id, final_qty, recommended_action, released_at, zoho_po_number, zoho_error, zoho_issued_at")
      .not("released_at", "is", null)
      .gte("released_at", since)
      .order("released_at", { ascending: false })
      .order("rank")
      .range(a, b),
  );
  const poIds = rows.filter((r) => r.zoho_po_number).map((r) => `${r.zoho_po_number}-${r.sku_id}`);
  const pos = poIds.length
    ? await fetchAll((a, b) => poDb.from("open_purchase_orders").select("po_id, status, received_date").in("po_id", poIds).order("po_id").range(a, b))
    : [];
  const poById = new Map(pos.map((p) => [p.po_id, p]));
  return rows.map((r) => {
    const po = r.zoho_po_number ? poById.get(`${r.zoho_po_number}-${r.sku_id}`) : undefined;
    const status: OrderStatus = !r.zoho_po_number
      ? "not_ordered"
      : po && ["partially_received", "received", "cancelled"].includes(po.status)
        ? (po.status as OrderStatus)
        : r.zoho_issued_at
          ? "issued"
          : "draft";
    return {
      id: r.id,
      sku_id: r.sku_id,
      sku_name: r.sku_name,
      distributor_id: r.distributor_id,
      final_qty: r.final_qty ?? 0,
      action: (r.final_qty ?? 0) === 0 ? "Pause / do not order" : "Order",
      released_at: r.released_at ?? "",
      zoho_po_number: r.zoho_po_number,
      zoho_error: r.zoho_error,
      order_status: status,
      received_date: po?.received_date ?? null,
    };
  });
}
