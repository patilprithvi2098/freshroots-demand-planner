import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

// Daily ping from Vercel Cron (vercel.json) so the free-tier Supabase project never pauses for
// inactivity. Reads one count; writes nothing.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = env.cronSecret();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { count, error } = await createAdminClient().from("skus").select("sku_id", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  return NextResponse.json({ ok: true, skus: count, at: new Date().toISOString() });
}
