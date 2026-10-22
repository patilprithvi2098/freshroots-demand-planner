// Seed the database from the five sample files in sample-data/.
// Usage: npm run seed
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/csv/loaders";
import { adminClient } from "./_admin";

const dir = path.join(process.cwd(), "sample-data");
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");

function rowsOf<T>(r: { rows: T[]; errors: { row: number; message: string }[] }, name: string): T[] {
  if (r.errors.length) {
    console.error(`${name}: ${r.errors.length} error(s)`, r.errors.slice(0, 5));
    process.exit(1);
  }
  return r.rows;
}

async function main() {
  const db = adminClient();
  const steps: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
    ["distributors", () => db.from("distributors").upsert(rowsOf(parseCsv("distributor_master", read("distributor_master.csv")), "distributors"))],
    ["calendar", () => db.from("calendar").upsert(rowsOf(parseCsv("calendar", read("calendar.csv")), "calendar"))],
    ["skus", () => db.from("skus").upsert(rowsOf(parseCsv("sku_master", read("sku_master.csv")), "skus"))],
    [
      "weekly_sales",
      () =>
        db
          .from("weekly_sales")
          .upsert(rowsOf(parseCsv("weekly_sales", read("weekly_sales.csv")), "weekly_sales"), { onConflict: "sku_id,iso_week,distributor_key" }),
    ],
    [
      "inventory_snapshots",
      () =>
        db
          .from("inventory_snapshots")
          .upsert(rowsOf(parseCsv("current_inventory", read("current_inventory.csv")), "inventory"), { onConflict: "sku_id,location,as_of_date" }),
    ],
  ];
  for (const [name, run] of steps) {
    const { error } = await run();
    if (error) {
      console.error(`${name}: ${error.message}`);
      process.exit(1);
    }
    console.log(`seeded ${name}`);
  }
}

main();
