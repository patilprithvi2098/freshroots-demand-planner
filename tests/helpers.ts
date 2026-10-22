import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/csv/loaders";
import { DEFAULT_PARAMS } from "@/lib/rules/config";
import type { EngineInput } from "@/lib/rules/types";

export function sampleText(name: string): string {
  return readFileSync(path.join(__dirname, "..", "sample-data", name), "utf8");
}

export function loadSampleInput(asOfDate = "2026-10-19"): EngineInput {
  const skus = parseCsv("sku_master", sampleText("sku_master.csv")).rows;
  const sales = parseCsv("weekly_sales", sampleText("weekly_sales.csv")).rows;
  const inventory = parseCsv("current_inventory", sampleText("current_inventory.csv")).rows;
  const calendar = parseCsv("calendar", sampleText("calendar.csv")).rows;
  return {
    asOfDate,
    skus,
    weeklySales: sales,
    inventory,
    openPurchaseOrders: null,
    festivalMonths: calendar.filter((c) => c.is_festival_month).map((c) => c.year_month),
    params: DEFAULT_PARAMS,
  };
}
