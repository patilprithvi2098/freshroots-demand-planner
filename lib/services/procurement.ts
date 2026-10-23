import "server-only";
import { fetchAll, type Db } from "./db";

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
}

/**
 * Released recommendations only (RLS enforces this for procurement users too).
 * No join to runs: procurement has no access to that table, and an inner join would hide every row.
 * Procurement sees the final quantity, never the original recommendation or override notes.
 */
const BASE_COLUMNS = "id, sku_id, sku_name, distributor_id, final_qty, recommended_action, released_at";
const ZOHO_COLUMNS = ", zoho_po_number, zoho_error";

export async function releasedItems(db: Db, sinceDays = 60): Promise<ReleasedItem[]> {
  try {
    return await releasedItemsWith(db, sinceDays, true);
  } catch (e) {
    // Until migration 0003 is applied the Zoho columns do not exist; show the list without them.
    if (e instanceof Error && /zoho_/.test(e.message)) return releasedItemsWith(db, sinceDays, false);
    throw e;
  }
}

async function releasedItemsWith(db: Db, sinceDays: number, withZoho: boolean): Promise<ReleasedItem[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = await fetchAll((a, b) =>
    db
      .from("recommendations")
      .select(withZoho ? BASE_COLUMNS + ZOHO_COLUMNS : BASE_COLUMNS)
      .not("released_at", "is", null)
      .gte("released_at", since)
      .order("released_at", { ascending: false })
      .order("rank")
      .range(a, b)
      .returns<
        {
          id: string;
          sku_id: string;
          sku_name: string;
          distributor_id: string | null;
          final_qty: number | null;
          recommended_action: string;
          released_at: string;
          zoho_po_number?: string | null;
          zoho_error?: string | null;
        }[]
      >(),
  );
  return rows.map((r) => ({
    id: r.id,
    sku_id: r.sku_id,
    sku_name: r.sku_name,
    distributor_id: r.distributor_id,
    final_qty: r.final_qty ?? 0,
    action: (r.final_qty ?? 0) === 0 ? "Pause / do not order" : "Order",
    released_at: r.released_at,
    zoho_po_number: r.zoho_po_number ?? null,
    zoho_error: r.zoho_error ?? null,
  }));
}
