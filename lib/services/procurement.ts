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
}

/**
 * Released recommendations only (RLS enforces this for procurement users too).
 * No join to runs: procurement has no access to that table, and an inner join would hide every row.
 * Procurement sees the final quantity, never the original recommendation or override notes.
 */
export async function releasedItems(db: Db, sinceDays = 60): Promise<ReleasedItem[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = await fetchAll((a, b) =>
    db
      .from("recommendations")
      .select("id, sku_id, sku_name, distributor_id, final_qty, recommended_action, released_at")
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
  }));
}
