import { describe, expect, it, vi } from "vitest";
import { buildExceptionContext, generateRationale, type MessagesClient } from "@/lib/ai/rationale";
import { runEngine } from "@/lib/rules/engine";
import { loadSampleInput } from "./helpers";

function fakeClient(responses: unknown[]): MessagesClient & { calls: number } {
  let i = 0;
  const c = {
    calls: 0,
    messages: {
      parse: vi.fn(async () => {
        c.calls++;
        const r = responses[i++];
        if (r instanceof Error) throw r;
        return r;
      }),
    },
  };
  return c as unknown as MessagesClient & { calls: number };
}

const ok = (parsed: unknown) => ({
  stop_reason: "end_turn",
  parsed_output: parsed,
  usage: { input_tokens: 1000, output_tokens: 100 },
});

describe("exception rationale", () => {
  const rec = runEngine(loadSampleInput()).recommendations.find((r) => r.sku_id === "SKU001")!;
  const ctx = buildExceptionContext(
    rec,
    { sku_id: "SKU001", name: rec.name, category: "Beverage", perishability: "low", standard_reorder_qty: 500, distributor_id: "DIST001", lead_time_days: null, launch_date: null },
    "2026-10-19",
    [{ as_of_date: "2026-10-01", status: "edited", recommended_qty: 500, final_qty: 400, reason_code: "known_event" }],
  );

  it("context has numbers and reasons but no emails or notes", () => {
    const json = JSON.stringify(ctx);
    expect(json).toContain("possible_double_count");
    expect(json).not.toMatch(/@|note/i);
    expect(ctx.weekly_sales_recent).toHaveLength(16);
  });

  it("returns a validated rationale", async () => {
    const c = fakeClient([ok({ rationale: "Festival uplift and a 21% trend both raise demand.", check_first: "Check whether the October lift is the festival itself." })]);
    const r = await generateRationale(c, ctx);
    expect(r.rationale?.check_first).toMatch(/October/);
    expect(c.calls).toBe(1);
    expect(r.attempts[0].cost_usd).toBeCloseTo(1000 * 2e-6 + 100 * 10e-6);
  });

  it("retries once on invalid output, then gives up with null", async () => {
    const c = fakeClient([ok({ rationale: "x" }), ok({ nope: true })]);
    const r = await generateRationale(c, ctx);
    expect(r.rationale).toBeNull();
    expect(c.calls).toBe(2);
  });

  it("retries once on API error and recovers", async () => {
    const c = fakeClient([new Error("timeout"), ok({ rationale: "Two signals disagree on this SKU.", check_first: "Check open POs." })]);
    const r = await generateRationale(c, ctx);
    expect(r.rationale).not.toBeNull();
    expect(r.attempts.map((a) => a.ok)).toEqual([false, true]);
  });

  it("treats a refusal as unavailable", async () => {
    const c = fakeClient([{ ...ok(null), stop_reason: "refusal" }, { ...ok(null), stop_reason: "refusal" }]);
    expect((await generateRationale(c, ctx)).rationale).toBeNull();
  });
});
