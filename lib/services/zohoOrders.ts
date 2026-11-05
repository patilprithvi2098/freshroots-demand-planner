import "server-only";
// Procurement places released recommendations as purchase orders in Zoho Inventory and issues them straight
// away (the brief: Raghav releases, procurement places the POs). Status and delivery dates come back by sync.
// Callers check the user's role first; this module uses whichever client it is given.

import { createAndIssuePurchaseOrder, createZohoClient, zohoConfigFromEnv, type ZohoClient } from "@/lib/integrations/zoho";
import { planPurchaseOrders, type PoProblem, type ReleasedLine } from "@/lib/integrations/zohoPo";
import { resolveParams } from "@/lib/rules/config";
import type { RuleParams } from "@/lib/rules/types";
import { audit, fetchAll, type Db } from "./db";

export function zohoClientFromEnv(): ZohoClient | null {
  const cfg = zohoConfigFromEnv();
  return cfg ? createZohoClient(cfg) : null;
}

/** A line is held by an order run for at most this long; after that a crashed run's claim is ignored. */
const CLAIM_MINUTES = 10;

const today = () => new Date().toISOString().slice(0, 10);

interface Loaded {
  lines: ReleasedLine[];
  asOfByRec: Map<string, string>;
  stdBySku: Map<string, number>;
  distName: Map<string, string>;
  maxMultiple: number;
}

/** Released, unordered lines with a quantity, plus what the preview and the cap check need. */
async function releasedLines(db: Db, recommendationIds?: string[]): Promise<Loaded> {
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
  const { data: cfg } = await db.from("rule_config").select("params").eq("active", true).maybeSingle();
  const maxMultiple = resolveParams((cfg?.params ?? null) as Partial<RuleParams> | null).max_qty_multiple ?? 3;
  if (recs.length === 0) return { lines: [], asOfByRec: new Map(), stdBySku: new Map(), distName: new Map(), maxMultiple };
  const skuIds = [...new Set(recs.map((r) => r.sku_id))];
  const distIds = [...new Set(recs.map((r) => r.distributor_id).filter((d): d is string => !!d))];
  const runIds = [...new Set(recs.map((r) => r.run_id))];
  const [skus, dists, runs] = await Promise.all([
    db.from("skus").select("sku_id, zoho_item_id, lead_time_days, unit_price, standard_reorder_qty").in("sku_id", skuIds),
    distIds.length
      ? db.from("distributors").select("distributor_id, name, zoho_vendor_id").in("distributor_id", distIds)
      : Promise.resolve({ data: [] as { distributor_id: string; name: string; zoho_vendor_id: string | null }[], error: null }),
    db.from("runs").select("id, as_of_date").in("id", runIds),
  ]);
  for (const r of [skus, dists, runs]) if (r.error) throw new Error(r.error.message);
  const skuById = new Map((skus.data ?? []).map((s) => [s.sku_id, s]));
  const vendorByDist = new Map((dists.data ?? []).map((d) => [d.distributor_id, d.zoho_vendor_id]));
  const asOfByRun = new Map((runs.data ?? []).map((r) => [r.id, r.as_of_date]));
  return {
    asOfByRec: new Map(recs.map((r) => [r.id, asOfByRun.get(r.run_id) ?? today()])),
    stdBySku: new Map((skus.data ?? []).map((s) => [s.sku_id, s.standard_reorder_qty])),
    distName: new Map((dists.data ?? []).map((d) => [d.distributor_id, d.name])),
    maxMultiple,
    lines: recs.map((r) => {
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
        unit_price: s?.unit_price == null ? null : Number(s.unit_price),
        zoho_po_id: r.zoho_po_id,
      };
    }),
  };
}

function plansByAsOf(l: Loaded) {
  const byAsOf = new Map<string, ReleasedLine[]>();
  for (const line of l.lines) {
    const k = l.asOfByRec.get(line.recommendation_id)!;
    byAsOf.set(k, [...(byAsOf.get(k) ?? []), line]);
  }
  return [...byAsOf].map(([asOfDate, group]) => ({ asOfDate, group, plan: planPurchaseOrders(group, { asOfDate, orderDate: today() }) }));
}

// ---------- preview ----------

export interface PreviewOrder {
  distributor_id: string;
  distributor_name: string;
  delivery_date: string;
  lines: { recommendation_id: string; sku_id: string; sku_name: string; qty: number; standard_qty: number | null; above_cap: boolean }[];
  value: number | null;
}

export interface OrdersPreview {
  orders: PreviewOrder[];
  problems: PoProblem[];
  /** Lines above max_qty_multiple × standard: procurement must confirm them explicitly. */
  aboveCap: number;
  maxMultiple: number;
}

/** What "Create and issue" would send, without sending anything. */
export async function previewZohoOrders(db: Db): Promise<OrdersPreview> {
  const l = await releasedLines(db);
  const out: OrdersPreview = { orders: [], problems: [], aboveCap: 0, maxMultiple: l.maxMultiple };
  for (const { group, plan } of plansByAsOf(l)) {
    out.problems.push(...plan.problems);
    for (const po of plan.orders) {
      const lines = po.recommendation_ids.map((id) => {
        const g = group.find((x) => x.recommendation_id === id)!;
        const std = l.stdBySku.get(g.sku_id) ?? null;
        const aboveCap = std != null && g.final_qty > std * l.maxMultiple;
        if (aboveCap) out.aboveCap++;
        return { recommendation_id: id, sku_id: g.sku_id, sku_name: g.sku_name, qty: g.final_qty, standard_qty: std, above_cap: aboveCap };
      });
      const priced = po.line_items.every((li) => li.rate != null);
      out.orders.push({
        distributor_id: po.distributor_id,
        distributor_name: l.distName.get(po.distributor_id) ?? po.distributor_id,
        delivery_date: po.delivery_date,
        lines,
        value: priced ? po.line_items.reduce((a, li) => a + (li.rate ?? 0) * li.quantity, 0) : null,
      });
    }
  }
  return out;
}

// ---------- create and issue ----------

export interface PlaceOrdersResult {
  created: { po_number: string; distributor_id: string; lines: number; issued: boolean }[];
  reused: number;
  failed: { distributor_id: string; error: string }[];
  problems: PoProblem[];
  skipped: number;
  /** Lines another order run was already sending. */
  busy: number;
  /** POs created earlier but not issued yet, issued now. */
  issuedDrafts: number;
}

/**
 * Claim lines so a second click (or a second tab) can't send them again. Only lines with no PO and no
 * live claim are taken; the returned ids are the ones this run owns.
 */
async function claim(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const stale = new Date(Date.now() - CLAIM_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("recommendations")
    .update({ zoho_claimed_at: new Date().toISOString() })
    .in("id", ids)
    .is("zoho_po_id", null)
    .or(`zoho_claimed_at.is.null,zoho_claimed_at.lt.${stale}`)
    .select("id");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.id));
}

/**
 * Create each distributor's PO in Zoho and issue it. Lines above the quantity cap are refused unless
 * `confirmAboveCap` is true (procurement ticked "I've checked the highlighted quantities").
 */
export async function placeZohoOrders(
  db: Db,
  client: ZohoClient,
  actor: string,
  opts: { confirmAboveCap?: boolean; recommendationIds?: string[] } = {},
): Promise<PlaceOrdersResult> {
  const result: PlaceOrdersResult = { created: [], reused: 0, failed: [], problems: [], skipped: 0, busy: 0, issuedDrafts: 0 };
  result.issuedDrafts = await issueDrafts(db, client, actor);

  const l = await releasedLines(db, opts.recommendationIds);
  for (const { group, plan } of plansByAsOf(l)) {
    result.problems.push(...plan.problems);
    result.skipped += plan.skipped.length;
    for (const order of plan.orders) {
      const orderLines = group.filter((g) => order.recommendation_ids.includes(g.recommendation_id));
      const aboveCap = orderLines.filter((g) => {
        const std = l.stdBySku.get(g.sku_id);
        return std != null && g.final_qty > std * l.maxMultiple;
      });
      if (aboveCap.length && !opts.confirmAboveCap) {
        result.failed.push({
          distributor_id: order.distributor_id,
          error: `Not sent: ${aboveCap.map((g) => `${g.sku_id} (${g.final_qty})`).join(", ")} above ${l.maxMultiple}× the standard quantity. Confirm the quantities to send.`,
        });
        continue;
      }
      const owned = await claim(db, order.recommendation_ids);
      if (owned.size !== order.recommendation_ids.length) {
        // Someone else is sending (part of) this order right now; leave it to them.
        result.busy += order.recommendation_ids.length;
        if (owned.size) await db.from("recommendations").update({ zoho_claimed_at: null }).in("id", [...owned]);
        continue;
      }
      try {
        const { po, created, issued } = await createAndIssuePurchaseOrder(client, order);
        if (!created) result.reused++;
        const now = new Date().toISOString();
        const isIssued = po.status.toLowerCase() !== "draft";
        const { error } = await db
          .from("recommendations")
          .update({
            zoho_po_id: po.purchaseorder_id,
            zoho_po_number: po.purchaseorder_number,
            zoho_po_reference: order.reference_number,
            zoho_ordered_at: now,
            zoho_issued_at: isIssued ? now : null,
            zoho_claimed_at: null,
            zoho_error: null,
          })
          .in("id", order.recommendation_ids);
        if (error) throw new Error(`Saved in Zoho as ${po.purchaseorder_number} but not recorded here: ${error.message}`);
        // The next run counts these as stock on order.
        const qtyBySku = new Map(orderLines.map((g) => [g.sku_id, g.final_qty]));
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
          lines: order.line_items.map((li) => ({ item_id: li.item_id, quantity: li.quantity })),
          issued: isIssued,
          reused: !created,
          confirmed_above_cap: aboveCap.length > 0,
        });
        result.created.push({ po_number: po.purchaseorder_number, distributor_id: order.distributor_id, lines: order.line_items.length, issued: issued || isIssued });
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        result.failed.push({ distributor_id: order.distributor_id, error: message });
        await db.from("recommendations").update({ zoho_error: message, zoho_claimed_at: null }).in("id", order.recommendation_ids);
      }
    }
  }
  return result;
}

/** POs created but left as drafts (the issue call failed last time): issue them now. */
async function issueDrafts(db: Db, client: ZohoClient, actor: string): Promise<number> {
  const drafts = await fetchAll((a, b) =>
    db.from("recommendations").select("id, zoho_po_id, zoho_po_number").not("zoho_po_id", "is", null).is("zoho_issued_at", null).order("id").range(a, b),
  );
  const byPo = new Map<string, { number: string | null; ids: string[] }>();
  for (const d of drafts) {
    const e = byPo.get(d.zoho_po_id!) ?? { number: d.zoho_po_number, ids: [] };
    e.ids.push(d.id);
    byPo.set(d.zoho_po_id!, e);
  }
  let issued = 0;
  for (const [poId, { number, ids }] of byPo) {
    try {
      const po = await client.getPurchaseOrder(poId);
      if (po.status.toLowerCase() === "draft") await client.issuePurchaseOrder(poId);
      await db.from("recommendations").update({ zoho_issued_at: new Date().toISOString(), zoho_error: null }).in("id", ids);
      await audit(db, actor, "zoho_po_issue", "purchase_order", poId, { po_number: number });
      issued++;
    } catch (e) {
      const message = `Created in Zoho as ${number} but not issued: ${(e instanceof Error ? e.message : String(e)).slice(0, 400)}`;
      await db.from("recommendations").update({ zoho_error: message }).in("id", ids);
    }
  }
  return issued;
}

// ---------- status and deliveries ----------

/** Zoho status → the open-PO statuses the engine understands. */
export function mapZohoStatus(status: string, receivedStatus?: string): string {
  const s = status.toLowerCase();
  const r = (receivedStatus ?? "").toLowerCase();
  if (s === "cancelled") return "cancelled";
  if (s === "received" || r === "received" || s === "closed" || s === "billed") return "received";
  if (s === "partially_received" || r === "partially_received") return "partially_received";
  return "open"; // draft, open, issued
}

/** Latest delivery date on a PO, from its purchase receives. */
export function latestReceiveDate(receives: { date: string }[] | undefined): string | null {
  const dates = (receives ?? []).map((r) => r.date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/**
 * Refresh Zoho-created open POs: status, and the delivery date once received, so received orders stop
 * counting as stock on order and the backtest and outcome loop get a dated PO history.
 */
export async function syncZohoStatuses(db: Db, client: ZohoClient): Promise<{ checked: number; changed: number }> {
  const open = await fetchAll((a, b) =>
    db.from("open_purchase_orders").select("po_id, status").eq("source", "zoho").in("status", ["open", "partially_received"]).order("po_id").range(a, b),
  );
  const poNumbers = [...new Set(open.map((o) => o.po_id.replace(/-[^-]+$/, "")))];
  if (poNumbers.length === 0) return { checked: 0, changed: 0 };
  const recs = await fetchAll((a, b) =>
    db.from("recommendations").select("id, zoho_po_id, zoho_po_number, zoho_issued_at").in("zoho_po_number", poNumbers).order("id").range(a, b),
  );
  const idByNumber = new Map(recs.map((r) => [r.zoho_po_number!, r.zoho_po_id!]));
  let changed = 0;
  for (const number of poNumbers) {
    const id = idByNumber.get(number);
    if (!id) continue;
    let next: string;
    let received: string | null = null;
    try {
      const po = await client.getPurchaseOrder(id);
      next = mapZohoStatus(po.status, po.received_status);
      if (next === "received") received = latestReceiveDate(po.purchasereceives);
      // Issued in Zoho by hand (or by an earlier run that lost its response): record it.
      if (po.status.toLowerCase() !== "draft") {
        const pending = recs.filter((r) => r.zoho_po_number === number && !r.zoho_issued_at).map((r) => r.id);
        if (pending.length) await db.from("recommendations").update({ zoho_issued_at: new Date().toISOString() }).in("id", pending);
      }
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) next = "cancelled";
      else continue;
    }
    const rows = open.filter((o) => o.po_id.startsWith(`${number}-`) && o.status !== next);
    if (rows.length === 0) continue;
    const { error } = await db
      .from("open_purchase_orders")
      .update({ status: next, ...(received ? { received_date: received } : {}) })
      .in("po_id", rows.map((r) => r.po_id));
    if (error) throw new Error(error.message);
    changed += rows.length;
  }
  return { checked: poNumbers.length, changed };
}
