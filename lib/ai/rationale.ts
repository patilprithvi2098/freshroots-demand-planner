// Exception rationale: one Claude call per exception SKU. Server-side only.
// The AI never sets or changes a quantity; it only explains and names what to check first.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Recommendation } from "@/lib/rules/types";

export const AI_MODEL = "claude-sonnet-5-5";
const MAX_OUTPUT_TOKENS = 300;
// Claude Sonnet 5.5 list price, USD per token.
const INPUT_USD_PER_TOKEN = 2 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 10 / 1_000_000;

export const SYSTEM_PROMPT = `You are an assistant to Raghav Kulkarni, Senior Demand Planner at Freshroots, a regional FMCG distributor in Maharashtra and Goa. A rules engine has already produced a flag and a recommended quantity for one SKU and marked it as an exception, meaning the rules alone are not enough to decide. Your job is to help Raghav decide quickly.

You will receive JSON with the SKU facts, recent weekly sales, weeks of stock cover, which rules fired, and why this SKU was marked an exception. You may also receive Raghav's last overrides on this SKU.

Write two things:
1. "rationale": two or three plain sentences explaining why the rules disagree or why they may not fit this SKU, using only the numbers provided.
2. "check_first": one sentence naming the single most useful thing Raghav should verify before deciding.

Rules you must follow:
- Never state, suggest or change an order quantity. The rules engine owns the number.
- Use only the data provided. Do not invent distributor behaviour, competitor actions, prices or lead times. If something would be useful but was not provided, say so in check_first.
- Mention if festival uplift and a rising trend may be counting the same demand twice.
- Be direct and specific to this SKU. No filler, no hedging phrases.
- Return only valid JSON: {"rationale": string, "check_first": string}`;

export const rationaleSchema = z.object({
  rationale: z.string().trim().min(10).max(1200),
  check_first: z.string().trim().min(5).max(400),
});
export type Rationale = z.infer<typeof rationaleSchema>;

/** A past planner decision on this SKU. Deliberately has no free-text note and no user identity. */
export interface OverrideContext {
  as_of_date: string;
  status: "edited" | "rejected";
  recommended_qty: number | null;
  final_qty: number | null;
  reason_code: string;
}

export interface SkuFacts {
  sku_id: string;
  name: string;
  category: string;
  perishability: "high" | "low";
  standard_reorder_qty: number;
  distributor_id: string | null;
  lead_time_days: number | null;
  launch_date: string | null;
}

/** Build the JSON the model sees. Only SKU-level numbers and distributor IDs. */
export function buildExceptionContext(
  rec: Recommendation,
  sku: SkuFacts,
  asOfDate: string,
  overrides: OverrideContext[],
) {
  const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
  return {
    as_of_date: asOfDate,
    sku: {
      sku_id: sku.sku_id,
      name: sku.name,
      category: sku.category,
      perishability: sku.perishability,
      standard_reorder_qty: sku.standard_reorder_qty,
      distributor_id: sku.distributor_id,
      lead_time_days: sku.lead_time_days,
      launch_date: sku.launch_date,
    },
    weekly_sales_recent: rec.recent_sales,
    avg_12_weeks: r1(rec.avg12),
    avg_4_weeks: r1(rec.avg4),
    trend_pct: rec.trend_pct == null ? null : r1(rec.trend_pct * 100),
    festival_uplift_applied: rec.festival_applied,
    demand_used_for_cover: r1(rec.demand_adj),
    units_on_hand: rec.units_on_hand,
    units_on_order: rec.on_order_units,
    weeks_of_cover: r1(rec.weeks_cover),
    flag: rec.flag,
    all_flags: rec.flags,
    rules_fired: rec.rules_fired.map((t) => t.detail),
    exception_reasons: rec.exception_reasons,
    missing_weeks: rec.missing_weeks,
    planner_last_overrides: overrides.slice(0, 3),
  };
}

export interface RationaleAttempt {
  ok: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error: string | null;
}

export interface RationaleResult {
  rationale: Rationale | null;
  attempts: RationaleAttempt[];
}

export function costOf(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN;
}

/** Minimal surface we use, so tests can pass a fake. */
export interface MessagesClient {
  messages: Pick<Anthropic["messages"], "parse">;
}

let cached: Anthropic | null = null;
export function defaultClient(): Anthropic {
  if (!cached) cached = new Anthropic({ timeout: 30_000, maxRetries: 0 });
  return cached;
}

async function attemptOnce(client: MessagesClient, context: unknown): Promise<{ value: Rationale | null; attempt: RationaleAttempt }> {
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Lowest thinking setting on Sonnet 5.5 so the 300-token budget goes to the answer.
      // Non-default temperature is rejected by this model, so it is not sent.
      thinking: { type: "between_tools" },
      output_config: { effort: "low", format: zodOutputFormat(rationaleSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(context) }],
    });
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const base = { ...usage, cost_usd: costOf(usage.input_tokens, usage.output_tokens) };
    if (response.stop_reason === "refusal") {
      return { value: null, attempt: { ...base, ok: false, error: "refusal" } };
    }
    if (response.stop_reason === "max_tokens") {
      return { value: null, attempt: { ...base, ok: false, error: "max_tokens" } };
    }
    // Validate again with Zod even though the API constrains the format.
    const parsed = rationaleSchema.safeParse(response.parsed_output);
    if (!parsed.success) {
      return { value: null, attempt: { ...base, ok: false, error: `invalid_output: ${parsed.error.issues[0]?.message}` } };
    }
    return { value: parsed.data, attempt: { ...base, ok: true, error: null } };
  } catch (error) {
    const message =
      error instanceof Anthropic.APIError
        ? `api_error ${error.status ?? ""}: ${error.message}`.slice(0, 300)
        : error instanceof Error
          ? error.message.slice(0, 300)
          : "unknown_error";
    return { value: null, attempt: { ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, error: message } };
  }
}

/** One call, one retry. Never throws: on failure the rationale is null and the UI shows "Rationale unavailable". */
export async function generateRationale(client: MessagesClient, context: unknown): Promise<RationaleResult> {
  const attempts: RationaleAttempt[] = [];
  for (let i = 0; i < 2; i++) {
    const { value, attempt } = await attemptOnce(client, context);
    attempts.push(attempt);
    if (value) return { rationale: value, attempts };
  }
  return { rationale: null, attempts };
}
