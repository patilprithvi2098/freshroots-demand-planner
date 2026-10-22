import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses row level security, so use it only for:
 * cron runs, AI enrichment after a response is sent, viewer dashboard aggregates
 * (after a role check), and admin scripts.
 */
export function createAdminClient() {
  return createClient<Database>(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
