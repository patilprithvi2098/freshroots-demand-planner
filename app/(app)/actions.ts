"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { FILE_TYPES, type FileType } from "@/lib/csv/loaders";
import { ruleParamsSchema } from "@/lib/rules/config";
import { runBacktest, type HistoricalDecision } from "@/lib/rules/backtest";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { audit, fetchAll } from "@/lib/services/db";
import { enrichRun } from "@/lib/services/enrich";
import { getActiveConfig, loadEngineInput } from "@/lib/services/engineInput";
import * as review from "@/lib/services/review";
import { RunBlockedError, startRun } from "@/lib/services/runs";
import { checkFile, confirmUpload, previewUpload, type UploadPreview } from "@/lib/services/uploads";

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string; code?: string };

function fail(e: unknown): { ok: false; error: string; code?: string } {
  if (e instanceof RunBlockedError) return { ok: false, error: e.message, code: e.code };
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { message: string }[] }).issues;
    return { ok: false, error: issues.map((i) => i.message).join("; ") };
  }
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

function readFileType(v: FormDataEntryValue | null): FileType {
  const t = String(v ?? "");
  if (!FILE_TYPES.some((f) => f.type === t)) throw new Error("Unknown file type");
  return t as FileType;
}

async function readCsv(form: FormData): Promise<{ fileType: FileType; file: File; text: string }> {
  const fileType = readFileType(form.get("fileType"));
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Choose a CSV file.");
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  return { fileType, file, text: await file.text() };
}

// ---------- uploads ----------

export async function previewUploadAction(form: FormData): Promise<ActionResult<UploadPreview>> {
  try {
    await assertRole(["planner"]);
    const { fileType, file, text } = await readCsv(form);
    return { ok: true, data: await previewUpload(await createClient(), fileType, file.name, text) };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmUploadAction(form: FormData): Promise<ActionResult<{ saved: number; warnings: string[] }>> {
  try {
    const session = await assertRole(["planner"]);
    const { fileType, file, text } = await readCsv(form);
    const res = await confirmUpload(await createClient(), session.userId, fileType, file.name, text);
    revalidatePath("/upload");
    revalidatePath("/runs");
    return { ok: true, data: res, message: `Saved ${res.saved} rows.` };
  } catch (e) {
    return fail(e);
  }
}

// ---------- runs ----------

export async function runNowAction(confirmStaleInventory: boolean): Promise<ActionResult<{ runId: string; flagged: number; exceptions: number }>> {
  try {
    const session = await assertRole(["planner"]);
    const db = await createClient();
    const res = await startRun(db, { triggeredBy: session.userId, actorId: session.userId, confirmStaleInventory });
    // Rationales are written after the response: the queue never waits on the AI.
    after(async () => {
      try {
        await enrichRun(db, res.runId);
      } catch (e) {
        console.error("enrichRun failed", e);
      }
    });
    revalidatePath("/runs");
    revalidatePath("/queue");
    return {
      ok: true,
      data: { runId: res.runId, flagged: res.flagged, exceptions: res.exceptions },
      message: `Run complete for data as of ${res.asOfDate}: ${res.flagged} SKUs flagged, ${res.exceptions} exceptions.`,
    };
  } catch (e) {
    return fail(e);
  }
}

/** Retry rationales for exceptions whose AI step failed or was skipped. */
export async function retryRationalesAction(runId: string): Promise<ActionResult<{ called: number; failed: number; skipped: number }>> {
  try {
    await assertRole(["planner"]);
    const db = await createClient();
    await db.from("recommendations").update({ ai_status: "pending" }).eq("run_id", runId).in("ai_status", ["failed", "skipped_cap"]);
    const res = await enrichRun(db, runId);
    revalidatePath("/queue");
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

// ---------- review ----------

export async function approveAction(id: string): Promise<ActionResult> {
  try {
    const s = await assertRole(["planner"]);
    await review.approve(await createClient(), s.userId, id);
    revalidatePath("/queue");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function editAction(input: { id: string; qty: number; reason: string; note?: string }): Promise<ActionResult> {
  try {
    const s = await assertRole(["planner"]);
    await review.edit(await createClient(), s.userId, input as Parameters<typeof review.edit>[2]);
    revalidatePath("/queue");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function rejectAction(input: { id: string; reason: string; note?: string }): Promise<ActionResult> {
  try {
    const s = await assertRole(["planner"]);
    await review.reject(await createClient(), s.userId, input as Parameters<typeof review.reject>[2]);
    revalidatePath("/queue");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function bulkApproveAction(ids: string[]): Promise<ActionResult<{ approved: number; excluded: number }>> {
  try {
    const s = await assertRole(["planner"]);
    const res = await review.bulkApprove(await createClient(), s.userId, ids);
    revalidatePath("/queue");
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

export async function releaseAction(runId: string): Promise<ActionResult<{ released: number }>> {
  try {
    const s = await assertRole(["planner"]);
    const res = await review.release(await createClient(), s.userId, runId);
    revalidatePath("/queue");
    revalidatePath("/procurement");
    return { ok: true, data: res, message: `Released ${res.released} recommendations to procurement.` };
  } catch (e) {
    return fail(e);
  }
}

// ---------- backtest ----------

export async function runBacktestAction(): Promise<ActionResult<{ id: string }>> {
  try {
    const s = await assertRole(["planner"]);
    const db = await createClient();
    const config = await getActiveConfig(db);
    const { data: latestInv } = await db
      .from("inventory_snapshots")
      .select("as_of_date")
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: latestSale } = await db.from("weekly_sales").select("iso_week").order("iso_week", { ascending: false }).limit(1).maybeSingle();
    if (!latestSale) throw new Error("Upload weekly sales first.");
    const asOf = latestInv?.as_of_date ?? new Date().toISOString().slice(0, 10);
    const input = await loadEngineInput(db, asOf, config.params, { allSales: true });
    const decisions = await fetchAll((a, b) => db.from("historical_decisions").select("sku_id, iso_week, action").order("id").range(a, b));
    const { asOfDate: _unused, ...base } = input;
    const res = runBacktest(base, decisions as HistoricalDecision[]);
    const { data, error } = await db
      .from("backtest_results")
      .insert({
        config_version: config.version,
        weeks_replayed: res.weeks.length,
        agreement_pct: res.agreement.pct,
        detail: res as unknown as Json,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(db, s.userId, "backtest", "backtest_results", data.id, { weeks: res.weeks.length, agreement: res.agreement });
    revalidatePath("/backtest");
    revalidatePath("/dashboard");
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------- settings ----------

export async function saveConfigAction(params: unknown): Promise<ActionResult<{ version: number }>> {
  try {
    await assertRole(["planner"]);
    const parsed = ruleParamsSchema.parse(params);
    const db = await createClient();
    const { data, error } = await db.rpc("save_rule_config", { new_params: parsed as unknown as Json });
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    return { ok: true, data: { version: data }, message: `Saved as version ${data}. New runs will use it.` };
  } catch (e) {
    return fail(e);
  }
}
