import "server-only";
import { resolveParams } from "@/lib/rules/config";
import { addIsoWeeks, compareIsoWeeks, lastCompleteWeek } from "@/lib/rules/isoWeek";
import type { EngineInput, Perishability, RuleParams } from "@/lib/rules/types";
import { fetchAll, type Db } from "./db";

export interface ActiveConfig {
  version: number;
  params: RuleParams;
}

export async function getActiveConfig(db: Db): Promise<ActiveConfig> {
  const { data, error } = await db.from("rule_config").select("version, params").eq("active", true).single();
  if (error || !data) throw new Error(`No active rule config: ${error?.message ?? "missing"}`);
  return { version: data.version, params: resolveParams(data.params as Partial<RuleParams>) };
}

export interface DataFreshness {
  latestSalesWeek: string | null;
  latestInventoryDate: string | null;
}

export async function getDataFreshness(db: Db): Promise<DataFreshness> {
  const [sales, inv] = await Promise.all([
    db.from("weekly_sales").select("iso_week").order("iso_week", { ascending: false }).limit(1).maybeSingle(),
    db.from("inventory_snapshots").select("as_of_date").order("as_of_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { latestSalesWeek: sales.data?.iso_week ?? null, latestInventoryDate: inv.data?.as_of_date ?? null };
}

/**
 * Load everything the engine needs for one as-of date.
 * historyWeeks bounds how much sales history is read (the engine needs the average window plus a 16-week chart).
 */
export async function loadEngineInput(
  db: Db,
  asOfDate: string,
  params: RuleParams,
  opts: { historyWeeks?: number; allSales?: boolean } = {},
): Promise<EngineInput> {
  const endWeek = lastCompleteWeek(asOfDate);
  const span = Math.max(opts.historyWeeks ?? 0, params.avg_window_weeks, 16);
  const fromWeek = addIsoWeeks(endWeek, -(span - 1));

  const [skus, sales, inventory, pos, calendar] = await Promise.all([
    fetchAll((a, b) => db.from("skus").select("*").order("sku_id").range(a, b)),
    fetchAll((a, b) => {
      let q = db.from("weekly_sales").select("sku_id, iso_week, units_sold, distributor_id").lte("iso_week", endWeek);
      if (!opts.allSales) q = q.gte("iso_week", fromWeek);
      return q.order("sku_id").order("iso_week").order("distributor_key").range(a, b);
    }),
    fetchAll((a, b) =>
      db
        .from("inventory_snapshots")
        .select("sku_id, location, units_on_hand, as_of_date")
        .lte("as_of_date", asOfDate)
        .order("sku_id")
        .order("as_of_date")
        .range(a, b),
    ),
    fetchAll((a, b) => db.from("open_purchase_orders").select("sku_id, qty, status, ordered_date, expected_date").order("po_id").range(a, b)),
    fetchAll((a, b) => db.from("calendar").select("year_month, is_festival_month").order("year_month").range(a, b)),
  ]);

  // The insufficient_history rule counts weeks of sales up to the end week. For SKUs with fewer
  // than avg_window_weeks inside the loaded window, look back one more window for older weeks and
  // add them as zero-unit sentinels; they fall outside every averaging window, so units never count.
  let weeklySales = sales;
  if (!opts.allSales) {
    const weeksInWindow = new Map<string, Set<string>>();
    for (const r of sales) {
      let s = weeksInWindow.get(r.sku_id);
      if (!s) weeksInWindow.set(r.sku_id, (s = new Set()));
      s.add(r.iso_week);
    }
    const shortSkus = skus
      .map((s) => s.sku_id)
      .filter((id) => (weeksInWindow.get(id)?.size ?? 0) < params.avg_window_weeks);
    const lookbackFrom = addIsoWeeks(fromWeek, -params.avg_window_weeks);
    const older =
      shortSkus.length === 0
        ? []
        : await fetchAll((a, b) =>
            db
              .from("weekly_sales")
              .select("sku_id, iso_week")
              .in("sku_id", shortSkus)
              .gte("iso_week", lookbackFrom)
              .lt("iso_week", fromWeek)
              .order("sku_id")
              .order("iso_week")
              .range(a, b),
          );
    const olderCount = new Map<string, Set<string>>();
    for (const r of older) {
      let s = olderCount.get(r.sku_id);
      if (!s) olderCount.set(r.sku_id, (s = new Set()));
      s.add(r.iso_week);
    }
    const sentinels = [...olderCount].flatMap(([sku_id, weeks]) =>
      [...weeks].sort(compareIsoWeeks).map((iso_week) => ({ sku_id, iso_week, units_sold: 0, distributor_id: null })),
    );
    // Sentinel weeks are outside every window the engine averages over, so their units never count.
    weeklySales = [...sentinels, ...sales];
  }

  return {
    asOfDate,
    skus: skus.map((s) => ({
      sku_id: s.sku_id,
      name: s.name,
      perishability: s.perishability as Perishability,
      standard_reorder_qty: s.standard_reorder_qty,
      distributor_id: s.distributor_id,
      launch_date: s.launch_date,
      unit_price: s.unit_price == null ? null : Number(s.unit_price),
      lead_time_days: s.lead_time_days,
    })),
    weeklySales,
    inventory,
    openPurchaseOrders: pos.length > 0 ? pos : null,
    festivalMonths: calendar.filter((c) => c.is_festival_month).map((c) => c.year_month),
    params,
  };
}
