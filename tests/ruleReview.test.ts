import { describe, expect, it } from "vitest";
import { ruleParamsSchema, DEFAULT_PARAMS } from "@/lib/rules/config";
import { applyChange, proposeRuleChanges, type ReviewDecision, type ReviewOutcome } from "@/lib/ruleReview";

let n = 0;
function d(over: Partial<ReviewDecision>): ReviewDecision {
  n++;
  return {
    recommendation_id: `r${n}`,
    run_id: `run${n % 5}`,
    sku_id: "SKU001",
    sku_name: "Freshroots Mango Drink 200ml",
    perishability: "low",
    flag: "stockout_risk",
    flags: ["stockout_risk"],
    festival_applied: false,
    recommended_action: "reorder_now",
    recommended_qty: 500,
    status: "edited",
    final_qty: 650,
    override_reason_code: "rule_too_strict",
    ...over,
  };
}

const base = (decisions: ReviewDecision[], outcomes = new Map<string, ReviewOutcome>(), decided = new Set<string>()) =>
  proposeRuleChanges({ decisions, outcomes, params: DEFAULT_PARAMS, configVersion: 1, decided });

describe("rule review (loop 2)", () => {
  it("needs at least 3 overrides of the same kind", () => {
    expect(base([d({}), d({})])).toEqual([]);
  });

  it("raised high-demand reorders propose a higher multiplier", () => {
    const rows = [1, 2, 3].map(() => d({ flags: ["stockout_risk", "high_demand"], final_qty: 900, recommended_qty: 750 }));
    const [p] = base(rows);
    expect(p.kind).toBe("raise_reorders");
    expect(p.change).toEqual({ path: "trend_reorder_multiplier", label: "High-demand multiplier", from: 1.5, to: 1.75 });
    expect(p.key).toBe("raise_reorders:low:v1");
    expect(p.support).toBe("unmeasured");
  });

  it("raised reorders without a trend point at the SKU master, not a rule", () => {
    const rows = [
      d({ sku_id: "SKU003", recommended_qty: 300, final_qty: 400 }),
      d({ sku_id: "SKU003", recommended_qty: 300, final_qty: 400 }),
      d({ sku_id: "SKU013", recommended_qty: 120, final_qty: 200 }),
    ];
    const [p] = base(rows);
    expect(p.change).toBeNull();
    expect(p.skuNote).toBe("SKU003: usually 400, SKU013: usually 200");
  });

  it("kept ordering when the rule said pause proposes a higher maximum cover for that shelf life", () => {
    const rows = [1, 2, 3].map(() => d({ perishability: "high", flag: "overstock_risk", recommended_action: "pause_next_order", recommended_qty: 0, final_qty: 100 }));
    const [p] = base(rows);
    expect(p.change).toMatchObject({ path: "high_perishability.max_weeks", from: 4, to: 5 });
  });

  it("cut festival reorders on trending SKUs propose a lower festival uplift", () => {
    const rows = [1, 2, 3].map(() => d({ festival_applied: true, flags: ["stockout_risk", "high_demand"], final_qty: 500, recommended_qty: 750 }));
    const [p] = base(rows);
    expect(p.kind).toBe("festival_double_count");
    expect(p.change).toMatchObject({ path: "festival_uplift_pct", from: 25, to: 20 });
  });

  it("rejected stock-out reorders propose a lower minimum cover", () => {
    const rows = [1, 2, 3].map(() => d({ status: "rejected", final_qty: null }));
    const [p] = base(rows);
    expect(p.change).toMatchObject({ path: "low_perishability.min_weeks", from: 6, to: 5 });
  });

  it("is suppressed when measured outcomes show the rule did better than the changes", () => {
    const rows = [1, 2, 3].map(() => d({ flags: ["stockout_risk", "high_demand"], final_qty: 900 }));
    const peers = [1, 2].map(() => d({ status: "approved", final_qty: 500 }));
    const outcomes = new Map<string, ReviewOutcome>([
      ...rows.map((r) => [r.recommendation_id, { result: "overstocked", driver: "override" }] as const),
      ...peers.map((r) => [r.recommendation_id, { result: "ok", driver: "rule" }] as const),
    ]);
    expect(base([...rows, ...peers], outcomes)).toEqual([]);
  });

  it("is marked supported when measured outcomes favour the changes", () => {
    const rows = [1, 2, 3].map(() => d({ flags: ["stockout_risk", "high_demand"], final_qty: 900 }));
    const outcomes = new Map<string, ReviewOutcome>(rows.map((r) => [r.recommendation_id, { result: "ok", driver: "override" }]));
    const [p] = base(rows, outcomes);
    expect(p.support).toBe("supported");
    expect(p.evidence).toMatchObject({ override_ok: 3, override_measured: 3 });
  });

  it("does not repeat a proposal Raghav already decided for this rule version", () => {
    const rows = [1, 2, 3].map(() => d({ flags: ["stockout_risk", "high_demand"], final_qty: 900 }));
    expect(base(rows, new Map(), new Set(["raise_reorders:low:v1"]))).toEqual([]);
  });

  it("applying a change gives valid parameters and leaves the rest untouched", () => {
    const next = applyChange(DEFAULT_PARAMS, { path: "high_perishability.max_weeks", label: "", from: 4, to: 5 });
    expect(next.high_perishability).toEqual({ min_weeks: 3, max_weeks: 5 });
    expect(next.low_perishability).toEqual(DEFAULT_PARAMS.low_perishability);
    expect(DEFAULT_PARAMS.high_perishability.max_weeks).toBe(4);
    expect(ruleParamsSchema.safeParse(next).success).toBe(true);
  });
});
