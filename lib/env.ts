import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  /** Server-only. Never imported by client components. */
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  /** Monthly AI spend cap in USD. Defaults to 20. */
  aiMonthlyCapUsd: () => Number(process.env.AI_MONTHLY_SPEND_CAP_USD ?? "20"),
  maxRunsPerDay: () => Number(process.env.MAX_RUNS_PER_DAY ?? "10"),
  cronSecret: () => process.env.CRON_SECRET ?? "",
};
