import "server-only";
import { z } from "zod";
import { audit, type Db } from "./db";

export const REASON_CODES = [
  "known_event",
  "new_product",
  "supplier_constraint",
  "rule_too_strict",
  "rule_too_loose",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABELS: Record<ReasonCode, string> = {
  known_event: "Known event",
  new_product: "New product",
  supplier_constraint: "Supplier constraint",
  rule_too_strict: "Rule too strict",
  rule_too_loose: "Rule too loose",
  other: "Other",
};

export const overrideSchema = z.object({
  id: z.string().uuid(),
  reason: z.enum(REASON_CODES),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((s) => (s ? s : null)),
});

export const editSchema = overrideSchema.extend({
  qty: z.coerce.number().int("Quantity must be a whole number").min(0, "Quantity cannot be negative").max(1_000_000),
});

async function loadOpen(db: Db, id: string) {
  const { data, error } = await db
    .from("recommendations")
    .select("id, sku_id, recommended_qty, released_at, status, is_exception, run_id")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Recommendation not found");
  if (data.released_at) throw new Error("Already released to procurement; it can no longer be changed.");
  return data;
}

export async function approve(db: Db, actor: string, id: string) {
  const rec = await loadOpen(db, id);
  const { error } = await db
    .from("recommendations")
    .update({
      status: "approved",
      final_qty: rec.recommended_qty ?? 0,
      decided_by: actor,
      decided_at: new Date().toISOString(),
      override_reason_code: null,
      override_note: null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await audit(db, actor, "approve", "recommendations", id, { sku_id: rec.sku_id, final_qty: rec.recommended_qty });
}

export async function edit(db: Db, actor: string, input: z.input<typeof editSchema>) {
  const v = editSchema.parse(input);
  const rec = await loadOpen(db, v.id);
  const { error } = await db
    .from("recommendations")
    .update({
      status: "edited",
      final_qty: v.qty,
      decided_by: actor,
      decided_at: new Date().toISOString(),
      override_reason_code: v.reason,
      override_note: v.note,
    })
    .eq("id", v.id);
  if (error) throw new Error(error.message);
  await audit(db, actor, "override_edit", "recommendations", v.id, {
    sku_id: rec.sku_id,
    recommended_qty: rec.recommended_qty,
    final_qty: v.qty,
    reason: v.reason,
  });
}

export async function reject(db: Db, actor: string, input: z.input<typeof overrideSchema>) {
  const v = overrideSchema.parse(input);
  const rec = await loadOpen(db, v.id);
  const { error } = await db
    .from("recommendations")
    .update({
      status: "rejected",
      final_qty: null,
      decided_by: actor,
      decided_at: new Date().toISOString(),
      override_reason_code: v.reason,
      override_note: v.note,
    })
    .eq("id", v.id);
  if (error) throw new Error(error.message);
  await audit(db, actor, "override_reject", "recommendations", v.id, {
    sku_id: rec.sku_id,
    recommended_qty: rec.recommended_qty,
    reason: v.reason,
  });
}

/** Bulk approve: only non-exception, pending, unreleased rows. Exceptions are silently excluded and counted. */
export async function bulkApprove(db: Db, actor: string, ids: string[]) {
  const parsed = z.array(z.string().uuid()).max(2000).parse(ids);
  if (parsed.length === 0) return { approved: 0, excluded: 0 };
  const { data, error } = await db
    .from("recommendations")
    .select("id, recommended_qty, is_exception, status, released_at")
    .in("id", parsed);
  if (error) throw new Error(error.message);
  const eligible = (data ?? []).filter((r) => !r.is_exception && r.status === "pending" && !r.released_at);
  const decidedAt = new Date().toISOString();
  for (const r of eligible) {
    const { error: e } = await db
      .from("recommendations")
      .update({ status: "approved", final_qty: r.recommended_qty ?? 0, decided_by: actor, decided_at: decidedAt })
      .eq("id", r.id)
      .eq("is_exception", false);
    if (e) throw new Error(e.message);
  }
  await audit(db, actor, "bulk_approve", "recommendations", null, { ids: eligible.map((r) => r.id) });
  return { approved: eligible.length, excluded: parsed.length - eligible.length };
}

/** Release every approved or edited, unreleased row of a run. Rejected rows never go to procurement. */
export async function release(db: Db, actor: string, runId: string) {
  const id = z.string().uuid().parse(runId);
  const releasedAt = new Date().toISOString();
  const { data, error } = await db
    .from("recommendations")
    .update({ released_at: releasedAt })
    .eq("run_id", id)
    .in("status", ["approved", "edited"])
    .is("released_at", null)
    .select("id, sku_id, final_qty");
  if (error) throw new Error(error.message);
  await audit(db, actor, "release", "runs", id, {
    count: data?.length ?? 0,
    items: (data ?? []).map((r) => ({ sku_id: r.sku_id, final_qty: r.final_qty })),
  });
  return { released: data?.length ?? 0 };
}
