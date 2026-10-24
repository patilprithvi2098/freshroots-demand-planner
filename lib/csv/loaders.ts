// CSV loaders for the five SAP export files plus optional open POs and historical decisions.
// Pure functions: take CSV text, return typed rows with row-numbered errors and warnings.

import Papa from "papaparse";
import { z } from "zod";
import { addIsoWeeks, compareIsoWeeks, isValidIsoWeek } from "@/lib/rules/isoWeek";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 200_000;

export type FileType =
  | "sku_master"
  | "weekly_sales"
  | "current_inventory"
  | "distributor_master"
  | "calendar"
  | "open_purchase_orders"
  | "historical_decisions";

export const FILE_TYPES: { type: FileType; label: string; required: boolean }[] = [
  { type: "sku_master", label: "SKU master", required: true },
  { type: "weekly_sales", label: "Weekly sales", required: true },
  { type: "current_inventory", label: "Current inventory", required: true },
  { type: "distributor_master", label: "Distributor master", required: true },
  { type: "calendar", label: "Festival calendar", required: true },
  { type: "open_purchase_orders", label: "Open purchase orders (optional)", required: false },
  { type: "historical_decisions", label: "Historical decisions (optional, for backtest)", required: false },
];

export interface RowIssue {
  /** 1-based data row number, counting the header as row 1 (matches what Excel shows). */
  row: number;
  message: string;
}

export interface LoadResult<T> {
  fileType: FileType;
  rows: T[];
  rowCount: number;
  errors: RowIssue[];
  warnings: string[];
  /** Raw records for preview (first 20). */
  preview: Record<string, string>[];
  headers: string[];
}

// ---------- field helpers ----------

const trimmed = z.string().transform((s) => s.trim());
const requiredText = trimmed.pipe(z.string().min(1, "is required"));
const optionalText = z
  .string()
  .optional()
  .transform((s) => (s == null || s.trim() === "" ? null : s.trim()));

const nonNegInt = (label: string) =>
  trimmed.pipe(
    z
      .string()
      .min(1, `${label} is required`)
      .regex(/^\d+$/, `${label} must be a non-negative whole number`)
      .transform(Number),
  );

const positiveInt = (label: string) =>
  nonNegInt(label).pipe(z.number().positive(`${label} must be above 0`));

const optionalNonNegNumber = (label: string) =>
  z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (s == null || s.trim() === "") return null;
      const n = Number(s.trim());
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: "custom", message: `${label} must be a non-negative number` });
        return z.NEVER;
      }
      return n;
    });

const isoDate = (label: string) =>
  trimmed.pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be YYYY-MM-DD`)
      .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), `${label} is not a real date`),
  );

const optionalIsoDate = (label: string) =>
  z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (s == null || s.trim() === "") return null;
      const v = s.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
        ctx.addIssue({ code: "custom", message: `${label} must be YYYY-MM-DD` });
        return z.NEVER;
      }
      return v;
    });

const bool = (label: string) =>
  trimmed.transform((s, ctx) => {
    const v = s.toLowerCase();
    if (["true", "yes", "y", "1"].includes(v)) return true;
    if (["false", "no", "n", "0"].includes(v)) return false;
    ctx.addIssue({ code: "custom", message: `${label} must be TRUE or FALSE` });
    return z.NEVER;
  });

const isoWeek = trimmed.refine(isValidIsoWeek, "Week must be an ISO week like 2026-W42");

// ---------- row schemas (input headers exactly as in the sample files) ----------

export const skuMasterRow = z
  .object({
    SKU_ID: requiredText,
    SKU_Name: requiredText,
    Category: requiredText,
    Perishability: trimmed.transform((s, ctx) => {
      const v = s.toLowerCase();
      if (v === "high" || v === "low") return v as "high" | "low";
      ctx.addIssue({ code: "custom", message: `Perishability must be High or Low (got "${s}")` });
      return z.NEVER;
    }),
    Standard_Reorder_Qty: positiveInt("Standard_Reorder_Qty"),
    Unit_of_Measure: requiredText,
    Distributor_ID: optionalText,
    Unit_Price: optionalNonNegNumber("Unit_Price"),
    Lead_Time_Days: optionalNonNegNumber("Lead_Time_Days"),
    Launch_Date: optionalIsoDate("Launch_Date"),
  })
  .transform((r) => ({
    sku_id: r.SKU_ID,
    name: r.SKU_Name,
    category: r.Category,
    perishability: r.Perishability,
    standard_reorder_qty: r.Standard_Reorder_Qty,
    unit_of_measure: r.Unit_of_Measure,
    distributor_id: r.Distributor_ID,
    unit_price: r.Unit_Price,
    lead_time_days: r.Lead_Time_Days == null ? null : Math.round(r.Lead_Time_Days),
    launch_date: r.Launch_Date,
  }));

export const weeklySalesRow = z
  .object({
    SKU_ID: requiredText,
    Week: isoWeek,
    Units_Sold: nonNegInt("Units_Sold"),
    Distributor_ID: optionalText,
  })
  .transform((r) => ({
    sku_id: r.SKU_ID,
    iso_week: r.Week,
    units_sold: r.Units_Sold,
    distributor_id: r.Distributor_ID,
  }));

export const inventoryRow = z
  .object({
    SKU_ID: requiredText,
    Location: requiredText,
    Units_On_Hand: nonNegInt("Units_On_Hand"),
    As_Of_Date: isoDate("As_Of_Date"),
  })
  .transform((r) => ({
    sku_id: r.SKU_ID,
    location: r.Location,
    units_on_hand: r.Units_On_Hand,
    as_of_date: r.As_Of_Date,
  }));

export const distributorRow = z
  .object({
    Distributor_ID: requiredText,
    Distributor_Name: requiredText,
    Region: requiredText,
    Status: requiredText,
  })
  .transform((r) => ({
    distributor_id: r.Distributor_ID,
    name: r.Distributor_Name,
    region: r.Region,
    status: r.Status,
  }));

export const calendarRow = z
  .object({
    Year: positiveInt("Year"),
    Month: positiveInt("Month").pipe(z.number().max(12, "Month must be 1 to 12")),
    Year_Month: trimmed.pipe(z.string().regex(/^\d{4}-\d{2}$/, "Year_Month must be YYYY-MM")),
    Is_Festival_Month: bool("Is_Festival_Month"),
  })
  .superRefine((r, ctx) => {
    const expected = `${r.Year}-${String(r.Month).padStart(2, "0")}`;
    if (r.Year_Month !== expected) {
      ctx.addIssue({ code: "custom", message: `Year_Month ${r.Year_Month} does not match Year/Month (${expected})` });
    }
  })
  .transform((r) => ({
    year_month: r.Year_Month,
    year: r.Year,
    month: r.Month,
    is_festival_month: r.Is_Festival_Month,
  }));

export const openPoRow = z
  .object({
    PO_ID: requiredText,
    SKU_ID: requiredText,
    Qty: nonNegInt("Qty"),
    Ordered_Date: isoDate("Ordered_Date"),
    Expected_Date: optionalIsoDate("Expected_Date"),
    Status: requiredText,
  })
  .transform((r) => ({
    po_id: r.PO_ID,
    sku_id: r.SKU_ID,
    qty: r.Qty,
    ordered_date: r.Ordered_Date,
    expected_date: r.Expected_Date,
    status: r.Status.toLowerCase(),
  }));

/** Raghav's past decisions, for backtest agreement. Action: reorder, pause or no_action. */
export const historicalDecisionRow = z
  .object({
    SKU_ID: requiredText,
    Week: isoWeek,
    Action: trimmed.transform((s, ctx) => {
      const v = s.toLowerCase().replace(/[\s-]+/g, "_");
      const map: Record<string, "reorder_now" | "pause_next_order" | "no_action"> = {
        reorder: "reorder_now",
        reorder_now: "reorder_now",
        pause: "pause_next_order",
        pause_next_order: "pause_next_order",
        no_action: "no_action",
        none: "no_action",
      };
      if (map[v]) return map[v];
      ctx.addIssue({ code: "custom", message: `Action must be reorder, pause or no_action (got "${s}")` });
      return z.NEVER;
    }),
    Qty: optionalNonNegNumber("Qty"),
  })
  .transform((r) => ({ sku_id: r.SKU_ID, iso_week: r.Week, action: r.Action, qty: r.Qty }));

export type SkuMasterRow = z.output<typeof skuMasterRow>;
export type WeeklySalesRow = z.output<typeof weeklySalesRow>;
export type InventoryRow = z.output<typeof inventoryRow>;
export type DistributorRow = z.output<typeof distributorRow>;
export type CalendarRow = z.output<typeof calendarRow>;
export type OpenPoRow = z.output<typeof openPoRow>;
export type HistoricalDecisionRow = z.output<typeof historicalDecisionRow>;

interface Spec<T> {
  schema: z.ZodType<T>;
  required: string[];
  optional: string[];
  key: (r: T) => string;
  keyLabel: string;
}

const SPECS: { [K in FileType]: Spec<RowFor<K>> } = {
  sku_master: {
    schema: skuMasterRow,
    required: ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"],
    optional: ["Unit_Price", "Lead_Time_Days", "Launch_Date"],
    key: (r) => r.sku_id,
    keyLabel: "SKU_ID",
  },
  weekly_sales: {
    schema: weeklySalesRow,
    required: ["SKU_ID", "Week", "Units_Sold"],
    optional: ["Distributor_ID"],
    key: (r) => `${r.sku_id}|${r.iso_week}|${r.distributor_id ?? ""}`,
    keyLabel: "SKU_ID + Week (+ Distributor_ID)",
  },
  current_inventory: {
    schema: inventoryRow,
    required: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
    optional: [],
    key: (r) => `${r.sku_id}|${r.location}|${r.as_of_date}`,
    keyLabel: "SKU_ID + Location + As_Of_Date",
  },
  distributor_master: {
    schema: distributorRow,
    required: ["Distributor_ID", "Distributor_Name", "Region", "Status"],
    optional: [],
    key: (r) => r.distributor_id,
    keyLabel: "Distributor_ID",
  },
  calendar: {
    schema: calendarRow,
    required: ["Year", "Month", "Year_Month", "Is_Festival_Month"],
    optional: [],
    key: (r) => r.year_month,
    keyLabel: "Year_Month",
  },
  open_purchase_orders: {
    schema: openPoRow,
    required: ["PO_ID", "SKU_ID", "Qty", "Ordered_Date", "Status"],
    optional: ["Expected_Date"],
    key: (r) => r.po_id,
    keyLabel: "PO_ID",
  },
  historical_decisions: {
    schema: historicalDecisionRow,
    required: ["SKU_ID", "Week", "Action"],
    optional: ["Qty"],
    key: (r) => `${r.sku_id}|${r.iso_week}`,
    keyLabel: "SKU_ID + Week",
  },
};

export type RowFor<K extends FileType> = K extends "sku_master"
  ? SkuMasterRow
  : K extends "weekly_sales"
    ? WeeklySalesRow
    : K extends "current_inventory"
      ? InventoryRow
      : K extends "distributor_master"
        ? DistributorRow
        : K extends "calendar"
          ? CalendarRow
          : K extends "open_purchase_orders"
            ? OpenPoRow
            : HistoricalDecisionRow;

export function parseCsv<K extends FileType>(fileType: K, text: string): LoadResult<RowFor<K>> {
  const spec = SPECS[fileType] as unknown as Spec<RowFor<K>>;
  const result: LoadResult<RowFor<K>> = {
    fileType,
    rows: [],
    rowCount: 0,
    errors: [],
    warnings: [],
    preview: [],
    headers: [],
  };

  const clean = text.replace(/^﻿/, "");
  if (clean.trim() === "") {
    result.errors.push({ row: 1, message: "The file is empty." });
    return result;
  }
  const parsed = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  result.headers = parsed.meta.fields ?? [];
  result.rowCount = parsed.data.length;
  result.preview = parsed.data.slice(0, 20);

  for (const e of parsed.errors) {
    result.errors.push({ row: (e.row ?? 0) + 2, message: e.message });
  }

  const missing = spec.required.filter((h) => !result.headers.includes(h));
  if (missing.length) {
    result.errors.push({ row: 1, message: `Missing required column(s): ${missing.join(", ")}` });
    return result;
  }
  const known = new Set([...spec.required, ...spec.optional]);
  const extra = result.headers.filter((h) => !known.has(h));
  if (extra.length) result.warnings.push(`Ignored unknown column(s): ${extra.join(", ")}`);

  if (result.rowCount > MAX_UPLOAD_ROWS) {
    result.errors.push({ row: 1, message: `File has ${result.rowCount} rows; the limit is ${MAX_UPLOAD_ROWS}.` });
    return result;
  }

  const byKey = new Map<string, { row: number; value: RowFor<K> }>();
  const duplicates: string[] = [];
  parsed.data.forEach((raw, i) => {
    const rowNo = i + 2;
    const r = spec.schema.safeParse(raw);
    if (!r.success) {
      for (const issue of r.error.issues) {
        const field = issue.path.length ? `${String(issue.path[0])}: ` : "";
        result.errors.push({ row: rowNo, message: `${field}${issue.message}` });
      }
      return;
    }
    const key = spec.key(r.data);
    const prev = byKey.get(key);
    if (prev) duplicates.push(`row ${rowNo} repeats row ${prev.row}`);
    // Keep the last row for duplicate keys.
    byKey.delete(key);
    byKey.set(key, { row: rowNo, value: r.data });
  });
  if (duplicates.length) {
    result.warnings.push(
      `${duplicates.length} duplicate ${spec.keyLabel} key(s); kept the last row each time (${duplicates.slice(0, 5).join("; ")}${duplicates.length > 5 ? "; …" : ""}).`,
    );
  }
  result.rows = [...byKey.values()].map((v) => v.value);

  if (fileType === "weekly_sales") {
    result.warnings.push(...salesGapWarnings(result.rows as WeeklySalesRow[]));
  }
  return result;
}

/** Warn about missing weeks between a SKU's first and last sales week. Never zero-fills. */
export function salesGapWarnings(rows: WeeklySalesRow[]): string[] {
  const weeksBySku = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = weeksBySku.get(r.sku_id);
    if (!s) weeksBySku.set(r.sku_id, (s = new Set()));
    s.add(r.iso_week);
  }
  const warnings: string[] = [];
  for (const [sku, weeks] of [...weeksBySku].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sorted = [...weeks].sort(compareIsoWeeks);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    // One pass from first to last week: linear in the span, with no cap on history length.
    const missing: string[] = [];
    for (let w = first; compareIsoWeeks(w, last) < 0; w = addIsoWeeks(w, 1)) if (!weeks.has(w)) missing.push(w);
    if (missing.length) {
      warnings.push(
        `${sku}: ${missing.length} week(s) missing between ${first} and ${last} (${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ", …" : ""}). They are not filled with zeros.`,
      );
    }
  }
  return warnings;
}

/** Cross-file checks: SKUs present in sales but not the master, or the reverse. */
export function crossFileWarnings(skuIds: string[], salesSkuIds: string[], inventorySkuIds: string[]): string[] {
  const master = new Set(skuIds);
  const sales = new Set(salesSkuIds);
  const inv = new Set(inventorySkuIds);
  const out: string[] = [];
  const notInMaster = [...sales].filter((s) => !master.has(s)).sort();
  const noSales = [...master].filter((s) => !sales.has(s)).sort();
  const invNotInMaster = [...inv].filter((s) => !master.has(s)).sort();
  if (notInMaster.length) out.push(`SKUs in sales but not in the SKU master will be skipped: ${notInMaster.join(", ")}`);
  if (noSales.length) out.push(`SKUs in the master with no sales rows will be skipped: ${noSales.join(", ")}`);
  if (invNotInMaster.length) out.push(`SKUs in inventory but not in the SKU master will be skipped: ${invNotInMaster.join(", ")}`);
  return out;
}
