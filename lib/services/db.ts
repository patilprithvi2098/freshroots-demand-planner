import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

const PAGE = 1000;

/** Page through a query; PostgREST caps responses at 1000 rows. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function insertChunked<T>(
  insert: (rows: T[]) => PromiseLike<{ error: { message: string } | null }>,
  rows: T[],
  size = 500,
) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await insert(rows.slice(i, i + size));
    if (error) throw new Error(error.message);
  }
}

export async function audit(
  db: Db,
  actor: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
) {
  const { error } = await db
    .from("audit_log")
    .insert({ actor, action, entity, entity_id: entityId, detail: detail as Json });
  if (error) throw new Error(`audit_log: ${error.message}`);
}

/** Today's date in India (IST), YYYY-MM-DD. */
export function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function startOfTodayIstUtc(now = new Date()): string {
  return new Date(`${todayIst(now)}T00:00:00+05:30`).toISOString();
}

export function startOfMonthIstUtc(now = new Date()): string {
  return new Date(`${todayIst(now).slice(0, 7)}-01T00:00:00+05:30`).toISOString();
}
