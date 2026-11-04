import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { measureOutcomes } from "@/lib/services/outcomeJob";

// Daily ping from Vercel Cron (vercel.json) so the free-tier Supabase project never pauses for
// inactivity. Also measures any outcomes whose four weeks have completed (outcome loop).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = env.cronSecret();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const db = createAdminClient();
  const { count, error } = await db.from("skus").select("sku_id", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  const outcomes = await measureOutcomes(db).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
  return NextResponse.json({ ok: true, skus: count, outcomes, at: new Date().toISOString() });
}
