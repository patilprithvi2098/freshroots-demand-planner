// Push SKU prices from the database to the linked Zoho Inventory items.
//
//   npx tsx --env-file=.env.local scripts/zoho/sync-prices.ts            # dry run
//   npx tsx --env-file=.env.local scripts/zoho/sync-prices.ts --apply
//
// Purchase rate = skus.unit_price (cost per unit, excl. GST). Selling rate = sample-data/sku_pricing_benchmark.csv
// MRP converted to ex-GST, or the purchase rate when no benchmark exists.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createZohoClient, zohoConfigFromEnv } from "../../lib/integrations/zoho";
import { adminClient } from "../_admin";

const apply = process.argv.includes("--apply");

function benchmarkSellingRates(): Map<string, number> {
  const file = path.join(__dirname, "..", "..", "sample-data", "sku_pricing_benchmark.csv");
  const [head, ...lines] = readFileSync(file, "utf8").trim().split("\n");
  const cols = head.split(",");
  const out = new Map<string, number>();
  for (const line of lines) {
    const cells = line.split(",");
    const get = (c: string) => cells[cols.indexOf(c)];
    const mrp = Number(get("Benchmark_MRP_INR"));
    const gst = Number(get("GST_Pct"));
    // Retailers buy at roughly 80% of MRP; Zoho rates are ex-GST.
    if (mrp > 0) out.set(get("SKU_ID"), Math.round(((mrp * 0.8) / (1 + gst / 100)) * 100) / 100);
  }
  return out;
}

async function main() {
  const cfg = zohoConfigFromEnv();
  if (!cfg) throw new Error("ZOHO_* settings are missing from .env.local.");
  const zoho = createZohoClient(cfg);
  const { data: skus, error } = await adminClient().from("skus").select("sku_id, unit_price, zoho_item_id").order("sku_id");
  if (error) throw new Error(error.message);
  const selling = benchmarkSellingRates();
  let n = 0;
  for (const s of skus ?? []) {
    if (!s.zoho_item_id || s.unit_price == null) continue;
    const purchase = Number(s.unit_price);
    const rate = Math.max(purchase, selling.get(s.sku_id) ?? purchase);
    console.log(`  ${s.sku_id}: purchase ₹${purchase.toFixed(2)}, selling ₹${rate.toFixed(2)}`);
    if (apply) await zoho.updateItemRates(s.zoho_item_id, { rate, purchase_rate: purchase });
    n++;
  }
  console.log(`${apply ? "Updated" : "Would update"} ${n} Zoho item(s).${apply ? "" : " Rerun with --apply."}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
