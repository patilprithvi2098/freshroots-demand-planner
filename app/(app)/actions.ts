"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { FILE_TYPES, type FileType } from "@/lib/csv/loaders";
import { ruleParamsSchema } from "@/lib/rules/config";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { enrichRun } from "@/lib/services/enrich";
import { measureOutcomes } from "@/lib/services/outcomeJob";
import { runAndStoreBacktest } from "@/lib/services/backtest";
import { acceptProposal, dismissProposal } from "@/lib/services/ruleReview";
import * as review from "@/lib/services/review";
import { RunBlockedError, startRun } from "@/lib/services/runs";
import { checkFile, confirmUpload, previewUpload, type UploadPreview } from "@/lib/services/uploads";
import { createAdminClient } from "@/lib/supabase/admin";
import { placeZohoOrders, syncZohoStatuses, zohoClientFromEnv } from "@/lib/services/zohoOrders";

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
    const db = await createClient();
    const res = await confirmUpload(db, session.userId, fileType, file.name, text);
    // Outcome loop: new sales, stock or write-offs may complete the four weeks after earlier decisions.
    if (fileType === "weekly_sales" || fileType === "current_inventory" || fileType === "write_offs") {
      after(async () => {
        try {
          await measureOutcomes(db);
        } catch (e) {
          console.error("measureOutcomes failed", e);
        }
      });
    }
    revalidatePath("/data");
    revalidatePath("/overview");
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
    revalidatePath("/data");
    revalidatePath("/overview");
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
    revalidatePath("/overview");
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
    revalidatePath("/overview");
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
    revalidatePath("/overview");
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
    revalidatePath("/overview");
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
    revalidatePath("/overview");
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
    revalidatePath("/overview");
    revalidatePath("/procurement");
    return { ok: true, data: res, message: `Sent ${res.released} order line${res.released === 1 ? "" : "s"} to procurement.` };
  } catch (e) {
    return fail(e);
  }
}

// ---------- backtest ----------

export async function runBacktestAction(): Promise<ActionResult<{ id: string }>> {
  try {
    const s = await assertRole(["planner"]);
    const res = await runAndStoreBacktest(await createClient(), s.userId);
    revalidatePath("/backtest");
    revalidatePath("/dashboard");
    return { ok: true, data: { id: res.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------- rule review (loop 2) ----------

export async function acceptProposalAction(key: string): Promise<ActionResult> {
  try {
    const s = await assertRole(["planner"]);
    const res = await acceptProposal(await createClient(), s.userId, String(key));
    revalidatePath("/settings");
    revalidatePath("/backtest");
    return { ok: true, data: undefined, message: res.message };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissProposalAction(key: string): Promise<ActionResult> {
  try {
    const s = await assertRole(["planner"]);
    await dismissProposal(await createClient(), s.userId, String(key));
    revalidatePath("/settings");
    return { ok: true, data: undefined, message: "Dismissed. It won't be suggested again for this rule version." };
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

// ---------- Zoho Inventory ----------

const ZOHO_NOT_CONFIGURED = "Zoho Inventory is not connected. Add the ZOHO_* settings (see scripts/zoho/connect.ts).";

/**
 * Create draft purchase orders in Zoho Inventory for released lines that have no PO yet.
 * Procurement cannot write recommendations under RLS, so this uses the service client after the role check.
 */
export async function createZohoOrdersAction(): Promise<
  ActionResult<{ created: number; reused: number; failed: number; problems: number }>
> {
  try {
    const s = await assertRole(["planner", "procurement"]);
    const client = zohoClientFromEnv();
    if (!client) throw new Error(ZOHO_NOT_CONFIGURED);
    const res = await placeZohoOrders(createAdminClient(), client, s.userId);
    revalidatePath("/procurement");
    const parts = [
      res.created.length ? `Created ${res.created.length} draft PO${res.created.length === 1 ? "" : "s"} in Zoho Inventory (${res.created.map((c) => c.po_number).join(", ")}).` : "No new purchase orders.",
      res.problems.length ? `${res.problems.length} line(s) need a Zoho item or vendor link first.` : "",
      res.failed.length ? `${res.failed.length} PO(s) failed: ${res.failed.map((f) => `${f.distributor_id}: ${f.error}`).join("; ")}` : "",
    ].filter(Boolean);
    const data = { created: res.created.length, reused: res.reused, failed: res.failed.length, problems: res.problems.length };
    if (res.failed.length && !res.created.length) return { ok: false, error: parts.join(" ") };
    return { ok: true, data, message: parts.join(" ") };
  } catch (e) {
    return fail(e);
  }
}

/** Pull PO status from Zoho so received orders stop counting as stock on order. */
export async function syncZohoAction(): Promise<ActionResult<{ checked: number; changed: number }>> {
  try {
    await assertRole(["planner", "procurement"]);
    const client = zohoClientFromEnv();
    if (!client) throw new Error(ZOHO_NOT_CONFIGURED);
    const res = await syncZohoStatuses(createAdminClient(), client);
    revalidatePath("/procurement");
    return { ok: true, data: res, message: `Checked ${res.checked} PO(s) in Zoho; ${res.changed} line(s) changed status.` };
  } catch (e) {
    return fail(e);
  }
}
