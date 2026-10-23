import "server-only";
// Place released recommendations as draft purchase orders in Zoho Inventory, and keep their status in sync.
// Callers check the user's role first; this module uses whichever client it is given.

import { createPurchaseOrderOnce, createZohoClient, zohoConfigFromEnv, type ZohoClient } from "@/lib/integrations/zoho";
import { planPurchaseOrders, type PoProblem, type ReleasedLine } from "@/lib/integrations/zohoPo";
import { audit, fetchAll, type Db } from "./db";

export function zohoClientFromEnv(): ZohoClient | null {
  const cfg = zohoConfigFromEnv();
  return cfg ? createZohoClient(cfg) : null;
}

export interface PlaceOrdersResult {
  created: { po_number: string; distributor_id: string; lines: number }[];
  reused: number;
  failed: { distributor_id: string; error: string }[];
  problems: PoProblem[];
  skipped: number;
}

const today = () => new Date().toISOString().slice(0, 10);

async function releasedLines(db: Db, recommendationIds?: string[]): Promise<{ lines: ReleasedLine[]; asOfByRec: Map<string, string> }> {
  const recs = await fetchAll((a, b) => {
    let q = db
      .from("recommendations")
      .select("id, run_id, sku_id, sku_name, distributor_id, final_qty, zoho_po_id")
      .not("released_at", "is", null)
      .is("zoho_po_id", null)
      .gt("final_qty", 0);
    if (recommendationIds?.length) q = q.in("id", recommendationIds);
    return q.order("id").range(a, b);
  });
  if (recs.length === 0) return { lines: [], asOfByRec: new Map() };
  const skuIds = [...new Set(recs.map((r) => r.sku_id))];
  const distIds = [...new Set(recs.map((r) => r.distributor_id).filter((d): d is string => !!d))];
  const runIds = [...new Set(recs.map((r) => r.run_id))];
  const [skus, dists, runs] = await Promise.all([
    db.from("skus").select("sku_id, zoho_item_id, lead_time_days, unit_price").in("sku_id", skuIds),
    distIds.length ? db.from("distributors").select("distributor_id, zoho_vendor_id").in("distributor_id", distIds) : Promise.resolve({ data: [], error: null }),
    db.from("runs").select("id, as_of_date").in("id", runIds),
  ]);
  for (const r of [skus, dists, runs]) if (r.error) throw new Error(r.error.message);
  const skuById = new Map((skus.data ?? []).map((s) => [s.sku_id, s]));
  const vendorByDist = new Map((dists.data ?? []).map((d) => [d.distributor_id, d.zoho_vendor_id]));
  const asOfByRun = new Map((runs.data ?? []).map((r) => [r.id, r.as_of_date]));
  const asOfByRec = new Map(recs.map((r) => [r.id, asOfByRun.get(r.run_id) ?? today()]));
  const lines = recs.map((r) => {
    const s = skuById.get(r.sku_id);
    return {
      recommendation_id: r.id,
      sku_id: r.sku_id,
      sku_name: r.sku_name,
      distributor_id: r.distributor_id,
      final_qty: r.final_qty ?? 0,
      zoho_item_id: s?.zoho_item_id ?? null,
      zoho_vendor_id: r.distributor_id ? (vendorByDist.get(r.distributor_id) ?? null) : null,
      lead_time_days: s?.lead_time_days ?? null,
      unit_price: s?.unit_price ?? null,
      zoho_po_id: r.zoho_po_id,
    };
  });
  return { lines, asOfByRec };
}

/** Create draft POs for released, unordered lines (optionally only the given recommendation ids). */
export async function placeZohoOrders(db: Db, client: ZohoClient, actor: string, recommendationIds?: string[]): Promise<PlaceOrdersResult> {
  const { lines, asOfByRec } = await releasedLines(db, recommendationIds);
  const result: PlaceOrdersResult = { created: [], reused: 0, failed: [], problems: [], skipped: 0 };
  // One plan per run (as-of date), so a PO never mixes two planning runs.
  const byAsOf = new Map<string, ReleasedLine[]>();
  for (const l of lines) {
    const k = asOfByRec.get(l.recommendation_id)!;
    byAsOf.set(k, [...(byAsOf.get(k) ?? []), l]);
  }
  for (const [asOfDate, group] of byAsOf) {
    const plan = planPurchaseOrders(group, { asOfDate, orderDate: today() });
    result.problems.push(...plan.problems);
    result.skipped += plan.skipped.length;
    for (const order of plan.orders) {
      try {
        const { po, created } = await createPurchaseOrderOnce(client, order);
        if (!created) result.reused++;
        const now = new Date().toISOString();
        const { error } = await db
          .from("recommendations")
          .update({
            zoho_po_id: po.purchaseorder_id,
            zoho_po_number: po.purchaseorder_number,
            zoho_po_reference: order.reference_number,
            zoho_ordered_at: now,
            zoho_error: null,
          })
          .in("id", order.recommendation_ids);
        if (error) throw new Error(`Saved in Zoho as ${po.purchaseorder_number} but not recorded here: ${error.message}`);
        // The next run counts these as stock on order.
        const qtyBySku = new Map(group.filter((l) => order.recommendation_ids.includes(l.recommendation_id)).map((l) => [l.sku_id, l.final_qty]));
        const { error: poError } = await db.from("open_purchase_orders").upsert(
          [...qtyBySku].map(([sku_id, qty]) => ({
            po_id: `${po.purchaseorder_number}-${sku_id}`,
            sku_id,
            qty,
            ordered_date: order.date,
            expected_date: order.delivery_date,
            status: "open",
            source: "zoho",
          })),
          { onConflict: "po_id" },
        );
        if (poError) throw new Error(`Saved in Zoho as ${po.purchaseorder_number} but not added to open POs: ${poError.message}`);
        await audit(db, actor, "zoho_po_create", "purchase_order", po.purchaseorder_id, {
          po_number: po.purchaseorder_number,
          reference: order.reference_number,
          distributor_id: order.distributor_id,
          lines: order.line_items.length,
          reused: !created,
        });
        result.created.push({ po_number: po.purchaseorder_number, distributor_id: order.distributor_id, lines: order.line_items.length });
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        result.failed.push({ distributor_id: order.distributor_id, error: message });
        await db.from("recommendations").update({ zoho_error: message }).in("id", order.recommendation_ids);
      }
    }
  }
  return result;
}

/** Zoho status → the open-PO statuses the engine understands. */
export function mapZohoStatus(status: string, receivedStatus?: string): string {
  const s = status.toLowerCase();
  const r = (receivedStatus ?? "").toLowerCase();
  if (s === "cancelled") return "cancelled";
  if (r === "received" || s === "closed" || s === "billed") return "received";
  if (r === "partially_received") return "partially_received";
  return "open"; // draft, open, issued
}

/** Refresh the status of Zoho-created open POs, so received orders stop counting as on order. */
export async function syncZohoStatuses(db: Db, client: ZohoClient): Promise<{ checked: number; changed: number }> {
  const open = await fetchAll((a, b) =>
    db.from("open_purchase_orders").select("po_id, status").eq("source", "zoho").in("status", ["open", "partially_received"]).order("po_id").range(a, b),
  );
  const poNumbers = [...new Set(open.map((o) => o.po_id.replace(/-[^-]+$/, "")))];
  if (poNumbers.length === 0) return { checked: 0, changed: 0 };
  const recs = await fetchAll((a, b) =>
    db.from("recommendations").select("zoho_po_id, zoho_po_number").in("zoho_po_number", poNumbers).order("id").range(a, b),
  );
  const idByNumber = new Map(recs.map((r) => [r.zoho_po_number!, r.zoho_po_id!]));
  let changed = 0;
  for (const number of poNumbers) {
    const id = idByNumber.get(number);
    if (!id) continue;
    let next: string;
    try {
      const po = (await client.getPurchaseOrder(id)) as { status: string; received_status?: string };
      next = mapZohoStatus(po.status, po.received_status);
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) next = "cancelled";
      else continue;
    }
    const rows = open.filter((o) => o.po_id.startsWith(`${number}-`) && o.status !== next);
    if (rows.length === 0) continue;
    const { error } = await db.from("open_purchase_orders").update({ status: next }).in("po_id", rows.map((r) => r.po_id));
    if (error) throw new Error(error.message);
    changed += rows.length;
  }
  return { checked: poNumbers.length, changed };
}
