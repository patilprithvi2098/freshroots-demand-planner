// Pure: turn released recommendations into Zoho purchase-order payloads, one per vendor.
// No I/O, so it is unit-tested without Zoho. Quantities come from the planner's final_qty only.

export interface ReleasedLine {
  recommendation_id: string;
  sku_id: string;
  sku_name: string;
  distributor_id: string | null;
  final_qty: number;
  zoho_item_id: string | null;
  zoho_vendor_id: string | null;
  lead_time_days: number | null;
  unit_price: number | null;
  /** Set when a PO was already created for this line. */
  zoho_po_id: string | null;
}

export interface PoDraft {
  vendor_id: string;
  distributor_id: string;
  /** Deterministic, so a retry can find a PO that was created but not recorded. */
  reference_number: string;
  date: string;
  delivery_date: string;
  line_items: { item_id: string; quantity: number; rate?: number; description: string }[];
  recommendation_ids: string[];
}

export interface PoProblem {
  recommendation_id: string;
  sku_id: string;
  reason: "missing_zoho_item" | "missing_distributor" | "missing_zoho_vendor";
}

export interface PoPlan {
  orders: PoDraft[];
  problems: PoProblem[];
  /** Lines skipped because they are pauses (qty 0) or already have a PO. */
  skipped: { recommendation_id: string; reason: "zero_qty" | "already_ordered" }[];
}

const DAY = 86_400_000;
const DEFAULT_LEAD_DAYS = 7;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** FNV-1a, hex. Not security-relevant: only makes the reference unique per set of lines. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * Same lines → same reference (so a retry finds the PO it already created);
 * lines released later for the same distributor → a new reference and a new PO.
 * Zoho limits reference_number to 50 characters.
 */
export function poReference(asOfDate: string, distributorId: string, recommendationIds: string[]): string {
  const hash = shortHash([...recommendationIds].sort().join(","));
  return `FR-${asOfDate}-${distributorId.slice(0, 20)}-${hash}`;
}

export function planPurchaseOrders(lines: ReleasedLine[], opts: { asOfDate: string; orderDate: string }): PoPlan {
  const plan: PoPlan = { orders: [], problems: [], skipped: [] };
  const byVendor = new Map<string, PoDraft>();
  const sorted = [...lines].sort((a, b) => (a.sku_id < b.sku_id ? -1 : a.sku_id > b.sku_id ? 1 : 0));

  for (const l of sorted) {
    if (l.zoho_po_id) {
      plan.skipped.push({ recommendation_id: l.recommendation_id, reason: "already_ordered" });
      continue;
    }
    if (!Number.isInteger(l.final_qty) || l.final_qty <= 0) {
      plan.skipped.push({ recommendation_id: l.recommendation_id, reason: "zero_qty" });
      continue;
    }
    const problem = (reason: PoProblem["reason"]) => plan.problems.push({ recommendation_id: l.recommendation_id, sku_id: l.sku_id, reason });
    if (!l.distributor_id) {
      problem("missing_distributor");
      continue;
    }
    if (!l.zoho_vendor_id) {
      problem("missing_zoho_vendor");
      continue;
    }
    if (!l.zoho_item_id) {
      problem("missing_zoho_item");
      continue;
    }
    let po = byVendor.get(l.zoho_vendor_id);
    if (!po) {
      po = {
        vendor_id: l.zoho_vendor_id,
        distributor_id: l.distributor_id,
        reference_number: "", // set below, once all lines are known
        date: opts.orderDate,
        delivery_date: opts.orderDate,
        line_items: [],
        recommendation_ids: [],
      };
      byVendor.set(l.zoho_vendor_id, po);
      plan.orders.push(po);
    }
    po.line_items.push({
      item_id: l.zoho_item_id,
      quantity: l.final_qty,
      ...(l.unit_price != null ? { rate: l.unit_price } : {}),
      description: `${l.sku_id} ${l.sku_name}`,
    });
    po.recommendation_ids.push(l.recommendation_id);
    // The PO's delivery date is the slowest line's lead time.
    const due = addDays(opts.orderDate, l.lead_time_days ?? DEFAULT_LEAD_DAYS);
    if (due > po.delivery_date) po.delivery_date = due;
  }
  for (const po of plan.orders) po.reference_number = poReference(opts.asOfDate, po.distributor_id, po.recommendation_ids);
  return plan;
}
