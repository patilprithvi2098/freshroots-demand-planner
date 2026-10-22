import "server-only";
import { createHash } from "node:crypto";
import {
  crossFileWarnings,
  MAX_UPLOAD_BYTES,
  parseCsv,
  type FileType,
  type LoadResult,
} from "@/lib/csv/loaders";
import type { Json } from "@/lib/supabase/database.types";
import { audit, fetchAll, insertChunked, type Db } from "./db";

export interface UploadPreview {
  fileType: FileType;
  filename: string;
  fileHash: string;
  rowCount: number;
  validRows: number;
  headers: string[];
  preview: Record<string, string>[];
  errors: { row: number; message: string }[];
  warnings: string[];
  duplicateOf: string | null;
  canConfirm: boolean;
}

export function hashFile(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function checkFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".csv")) return "Only .csv files are accepted.";
  if (file.type && !["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv"].includes(file.type)) {
    return `Only CSV files are accepted (got ${file.type}).`;
  }
  if (file.size > MAX_UPLOAD_BYTES) return "File is larger than 10 MB.";
  if (file.size === 0) return "File is empty.";
  return null;
}

async function existingSkuIds(db: Db): Promise<string[]> {
  const rows = await fetchAll((a, b) => db.from("skus").select("sku_id").order("sku_id").range(a, b));
  return rows.map((r) => r.sku_id);
}

/** Extra warnings that need the database: SKU mismatches against the current master. */
async function dbWarnings(db: Db, result: LoadResult<unknown>): Promise<string[]> {
  if (result.fileType === "weekly_sales" || result.fileType === "current_inventory" || result.fileType === "open_purchase_orders") {
    const master = await existingSkuIds(db);
    if (master.length === 0) return ["The SKU master is empty. Upload sku_master.csv first or these rows will be skipped."];
    const ids = [...new Set((result.rows as { sku_id: string }[]).map((r) => r.sku_id))];
    if (result.fileType === "weekly_sales") return crossFileWarnings(master, ids, []);
    return crossFileWarnings(master, master, ids).filter((w) => w.includes("in inventory"));
  }
  if (result.fileType === "sku_master") {
    const sales = await fetchAll((a, b) =>
      db.from("weekly_sales").select("sku_id").order("sku_id").range(a, b),
    );
    const salesIds = [...new Set(sales.map((s) => s.sku_id))];
    if (salesIds.length === 0) return [];
    return crossFileWarnings((result.rows as { sku_id: string }[]).map((r) => r.sku_id), salesIds, []).filter((w) =>
      w.includes("no sales rows"),
    );
  }
  return [];
}

export async function previewUpload(db: Db, fileType: FileType, filename: string, text: string): Promise<UploadPreview> {
  const result = parseCsv(fileType, text);
  const fileHash = hashFile(text);
  const { data: dup } = await db
    .from("upload_batches")
    .select("filename, created_at")
    .eq("file_hash", fileHash)
    .eq("status", "confirmed")
    .maybeSingle();
  const warnings = [...result.warnings, ...(result.errors.length === 0 ? await dbWarnings(db, result) : [])];
  return {
    fileType,
    filename,
    fileHash,
    rowCount: result.rowCount,
    validRows: result.rows.length,
    headers: result.headers,
    preview: result.preview,
    errors: result.errors.slice(0, 200),
    warnings,
    duplicateOf: dup ? `${dup.filename} (uploaded ${dup.created_at.slice(0, 10)})` : null,
    canConfirm: result.errors.length === 0 && result.rows.length > 0 && !dup,
  };
}

/** Re-parses server-side (never trusts the preview), then saves. Rows with invalid data block the whole file. */
export async function confirmUpload(db: Db, actor: string, fileType: FileType, filename: string, text: string) {
  const preview = await previewUpload(db, fileType, filename, text);
  if (preview.duplicateOf) throw new Error(`This exact file was already uploaded: ${preview.duplicateOf}.`);
  if (!preview.canConfirm) throw new Error("Fix the errors in this file before confirming.");
  let saved = preview.validRows;
  const skipped: string[] = [];

  const knownSkus = async () => new Set(await existingSkuIds(db));

  switch (fileType) {
    case "distributor_master": {
      const rows = parseCsv("distributor_master", text).rows;
      await insertChunked((c) => db.from("distributors").upsert(c, { onConflict: "distributor_id" }), rows);
      break;
    }
    case "sku_master": {
      const rows = parseCsv("sku_master", text).rows;
      await insertChunked((c) => db.from("skus").upsert(c, { onConflict: "sku_id" }), rows);
      break;
    }
    case "calendar": {
      const rows = parseCsv("calendar", text).rows;
      await insertChunked((c) => db.from("calendar").upsert(c, { onConflict: "year_month" }), rows);
      break;
    }
    case "weekly_sales": {
      const known = await knownSkus();
      const rows = parseCsv("weekly_sales", text).rows;
      const keep = rows.filter((r) => known.has(r.sku_id));
      skipped.push(...new Set(rows.filter((r) => !known.has(r.sku_id)).map((r) => r.sku_id)));
      await insertChunked(
        (c) => db.from("weekly_sales").upsert(c, { onConflict: "sku_id,iso_week,distributor_key" }),
        keep,
      );
      saved = keep.length;
      break;
    }
    case "current_inventory": {
      const known = await knownSkus();
      const rows = parseCsv("current_inventory", text).rows;
      const keep = rows.filter((r) => known.has(r.sku_id));
      skipped.push(...new Set(rows.filter((r) => !known.has(r.sku_id)).map((r) => r.sku_id)));
      await insertChunked(
        (c) => db.from("inventory_snapshots").upsert(c, { onConflict: "sku_id,location,as_of_date" }),
        keep,
      );
      saved = keep.length;
      break;
    }
    case "open_purchase_orders": {
      const known = await knownSkus();
      const rows = parseCsv("open_purchase_orders", text).rows;
      const keep = rows.filter((r) => known.has(r.sku_id));
      skipped.push(...new Set(rows.filter((r) => !known.has(r.sku_id)).map((r) => r.sku_id)));
      await insertChunked((c) => db.from("open_purchase_orders").upsert(c, { onConflict: "po_id" }), keep);
      saved = keep.length;
      break;
    }
    case "historical_decisions": {
      const rows = parseCsv("historical_decisions", text).rows;
      await insertChunked((c) => db.from("historical_decisions").upsert(c, { onConflict: "sku_id,iso_week" }), rows);
      break;
    }
  }

  const warnings = [...preview.warnings];
  if (skipped.length) warnings.push(`Skipped rows for SKUs not in the master: ${skipped.sort().join(", ")}`);
  const { data: batch, error } = await db
    .from("upload_batches")
    .insert({
      file_type: fileType,
      filename,
      file_hash: preview.fileHash,
      uploaded_by: actor,
      row_count: saved,
      status: "confirmed",
      warnings: warnings as unknown as Json,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("This exact file was already uploaded.");
    throw new Error(error.message);
  }
  await audit(db, actor, "upload", "upload_batches", batch.id, { file_type: fileType, filename, rows: saved, warnings });
  return { saved, warnings };
}
