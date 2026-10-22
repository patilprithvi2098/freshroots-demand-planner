// Service-role client for local admin scripts. Reads .env.local via `tsx --env-file`.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
