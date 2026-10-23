// Link the SKU master and distributors to Zoho Inventory items and vendors.
//
//   npx tsx --env-file=.env.local scripts/zoho/link-catalog.ts            # dry run: shows what would change
//   npx tsx --env-file=.env.local scripts/zoho/link-catalog.ts --apply    # writes zoho_item_id / zoho_vendor_id
//   npx tsx --env-file=.env.local scripts/zoho/link-catalog.ts --apply --create
//        also creates missing items and vendors in Zoho (for a new or test organization)
//
// Matching: a Zoho item whose SKU field equals SKU_ID; a Zoho vendor whose name equals the
// distributor's name, or whose name starts with the Distributor_ID.

import { createZohoClient, zohoConfigFromEnv } from "../../lib/integrations/zoho";
import { adminClient } from "../_admin";

const apply = process.argv.includes("--apply");
const create = process.argv.includes("--create");

async function main() {
  const cfg = zohoConfigFromEnv();
  if (!cfg) throw new Error("ZOHO_* settings are missing from .env.local. Run scripts/zoho/connect.ts first.");
  const zoho = createZohoClient(cfg);
  const db = adminClient();

  const [skus, dists, items, vendors] = await Promise.all([
    db.from("skus").select("sku_id, name, unit_of_measure, unit_price, zoho_item_id").order("sku_id"),
    db.from("distributors").select("distributor_id, name, zoho_vendor_id").order("distributor_id"),
    zoho.listItems(),
    zoho.listVendors(),
  ]);
  if (skus.error) throw new Error(skus.error.message);
  if (dists.error) throw new Error(dists.error.message);
  const itemBySku = new Map(items.filter((i) => i.sku).map((i) => [i.sku!.trim(), i]));

  let itemLinks = 0;
  let itemCreates = 0;
  for (const s of skus.data ?? []) {
    let item = itemBySku.get(s.sku_id);
    if (!item && create && apply) {
      const price = s.unit_price ?? 0;
      item = await zoho.createItem({ name: s.name, sku: s.sku_id, unit: s.unit_of_measure, rate: price, purchase_rate: price });
      itemCreates++;
    }
    if (!item) {
      console.log(`  ${s.sku_id}: no Zoho item with this SKU${create ? "" : " (use --create to add it)"}`);
      continue;
    }
    if (s.zoho_item_id === item.item_id) continue;
    console.log(`  ${s.sku_id} → item ${item.item_id} (${item.name})`);
    itemLinks++;
    if (apply) {
      const { error } = await db.from("skus").update({ zoho_item_id: item.item_id }).eq("sku_id", s.sku_id);
      if (error) throw new Error(error.message);
    }
  }

  let vendorLinks = 0;
  let vendorCreates = 0;
  for (const d of dists.data ?? []) {
    let v = vendors.find((x) => x.contact_name === d.name || x.contact_name.startsWith(d.distributor_id));
    if (!v && create && apply) {
      v = await zoho.createVendor({ contact_name: `${d.distributor_id} ${d.name}`, company_name: d.name });
      vendorCreates++;
    }
    if (!v) {
      console.log(`  ${d.distributor_id}: no Zoho vendor named "${d.name}"${create ? "" : " (use --create to add it)"}`);
      continue;
    }
    if (d.zoho_vendor_id === v.contact_id) continue;
    console.log(`  ${d.distributor_id} → vendor ${v.contact_id} (${v.contact_name})`);
    vendorLinks++;
    if (apply) {
      const { error } = await db.from("distributors").update({ zoho_vendor_id: v.contact_id }).eq("distributor_id", d.distributor_id);
      if (error) throw new Error(error.message);
    }
  }

  console.log(
    `${apply ? "Linked" : "Would link"} ${itemLinks} SKU(s) and ${vendorLinks} distributor(s)` +
      (create ? `; created ${itemCreates} item(s) and ${vendorCreates} vendor(s) in Zoho` : "") +
      (apply ? "." : ". Rerun with --apply to save."),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
