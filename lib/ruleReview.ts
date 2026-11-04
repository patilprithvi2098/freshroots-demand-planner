// Loop 2 (override → rule review): Retrieve → Apply, gated by the planner. See docs/feedback-loops.md.
// Pure: Raghav's recent decisions and their measured outcomes in, rule-change proposals out.
// The engine never changes its own rules; a proposal becomes a new rule version only when Raghav accepts it.

import type { RuleParams } from "@/lib/rules/types";

export const MIN_OVERRIDES = 3;
export const LOOKBACK_RUNS = 5;

export interface ReviewDecision {
  recommendation_id: string;
  run_id: string;
  sku_id: string;
  sku_name: string;
  perishability: string; // high | low
  flag: string;
  flags: string[];
  festival_applied: boolean;
  recommended_action: string;
  recommended_qty: number | null;
  status: string; // approved | edited | rejected
  final_qty: number | null;
  override_reason_code: string | null;
}

export interface ReviewOutcome {
  result: string;
  driver: string;
}

export type ProposalKind = "raise_reorders" | "cut_reorders" | "allow_more_stock" | "festival_double_count";

export interface ParamChange {
  path: "trend_reorder_multiplier" | "festival_uplift_pct" | "low_perishability.min_weeks" | "low_perishability.max_weeks" | "high_perishability.min_weeks" | "high_perishability.max_weeks";
  label: string;
  from: number;
  to: number;
}

export interface Proposal {
  key: string;
  kind: ProposalKind;
  title: string;
  why: string;
  /** Null when the evidence points at SKU master data (standard reorder quantity), not a rule parameter. */
  change: ParamChange | null;
  skuNote: string | null;
  evidence: {
    overrides: number;
    skus: string[];
    reasons: Record<string, number>;
    /** From the outcome loop: how Raghav's changes and the rule's own suggestions turned out in this group. */
    override_ok: number;
    override_measured: number;
    rule_ok: number;
    rule_measured: number;
  };
  /** "supported": measured outcomes favour the changes; "unmeasured": not enough outcomes yet. */
  support: "supported" | "unmeasured";
}

const isOverride = (d: ReviewDecision) => d.status === "edited" || d.status === "rejected";
const perishLabel = (p: string) => (p === "high" ? "perishable" : "long-shelf-life");

function windowPath(p: string, end: "min" | "max"): ParamChange["path"] {
  return `${p === "high" ? "high" : "low"}_perishability.${end}_weeks` as ParamChange["path"];
}

function getParam(params: RuleParams, path: ParamChange["path"]): number {
  if (path === "trend_reorder_multiplier") return params.trend_reorder_multiplier;
  if (path === "festival_uplift_pct") return params.festival_uplift_pct;
  const [group, field] = path.split(".") as ["low_perishability" | "high_perishability", "min_weeks" | "max_weeks"];
  return params[group][field];
}

/** Return new params with one change applied. Pure; the caller validates with ruleParamsSchema. */
export function applyChange(params: RuleParams, change: ParamChange): RuleParams {
  const next: RuleParams = structuredClone(params);
  if (change.path === "trend_reorder_multiplier") next.trend_reorder_multiplier = change.to;
  else if (change.path === "festival_uplift_pct") next.festival_uplift_pct = change.to;
  else {
    const [group, field] = change.path.split(".") as ["low_perishability" | "high_perishability", "min_weeks" | "max_weeks"];
    next[group] = { ...next[group], [field]: change.to };
  }
  return next;
}

/** Classify one override into a pattern, or null when it doesn't fit one. */
function patternOf(d: ReviewDecision): ProposalKind | null {
  const rec = d.recommended_qty ?? 0;
  const fin = d.status === "rejected" ? 0 : (d.final_qty ?? 0);
  if (d.recommended_action === "reorder_now") {
    if (d.festival_applied && d.flags.includes("high_demand") && fin < rec) return "festival_double_count";
    if (fin > rec) return "raise_reorders";
    if (fin < rec) return "cut_reorders";
  }
  if (d.recommended_action === "pause_next_order" && fin > 0) return "allow_more_stock";
  return null;
}

const round = (n: number, step: number) => Math.round(n / step) * step;

export function proposeRuleChanges(input: {
  decisions: ReviewDecision[];
  outcomes: Map<string, ReviewOutcome>;
  params: RuleParams;
  configVersion: number;
  /** Proposal keys Raghav already accepted or dismissed for this rule version. */
  decided: Set<string>;
}): Proposal[] {
  const groups = new Map<string, { kind: ProposalKind; perishability: string; rows: ReviewDecision[] }>();
  for (const d of input.decisions) {
    if (!isOverride(d)) continue;
    const kind = patternOf(d);
    if (!kind) continue;
    // Festival double counting is one rule for all SKUs; the others depend on the shelf-life window.
    const perishability = kind === "festival_double_count" ? "all" : d.perishability;
    const k = `${kind}:${perishability}`;
    const g = groups.get(k) ?? { kind, perishability, rows: [] };
    g.rows.push(d);
    groups.set(k, g);
  }

  const proposals: Proposal[] = [];
  for (const [groupKey, g] of groups) {
    if (g.rows.length < MIN_OVERRIDES) continue;
    const key = `${groupKey}:v${input.configVersion}`;
    if (input.decided.has(key)) continue;

    // Outcome evidence: the overrides in this group, and the rule's own approved suggestions on the same kind of SKU.
    const overrideOutcomes = g.rows.map((d) => input.outcomes.get(d.recommendation_id)).filter((o): o is ReviewOutcome => !!o);
    const peerRule = input.decisions.filter(
      (d) =>
        d.status === "approved" &&
        (g.perishability === "all" || d.perishability === g.perishability) &&
        (g.kind === "allow_more_stock" ? d.recommended_action === "pause_next_order" : d.recommended_action === "reorder_now"),
    );
    const ruleOutcomes = peerRule.map((d) => input.outcomes.get(d.recommendation_id)).filter((o): o is ReviewOutcome => !!o);
    const okOf = (xs: ReviewOutcome[]) => xs.filter((o) => o.result === "ok").length;
    const ev = {
      overrides: g.rows.length,
      skus: [...new Set(g.rows.map((d) => d.sku_id))].sort(),
      reasons: g.rows.reduce<Record<string, number>>((acc, d) => {
        const r = d.override_reason_code ?? "other";
        acc[r] = (acc[r] ?? 0) + 1;
        return acc;
      }, {}),
      override_ok: okOf(overrideOutcomes),
      override_measured: overrideOutcomes.length,
      rule_ok: okOf(ruleOutcomes),
      rule_measured: ruleOutcomes.length,
    };
    // Suppress when the measured outcomes say the rule did better than the changes.
    if (ev.override_measured >= 2 && ev.rule_measured >= 2 && ev.override_ok / ev.override_measured < ev.rule_ok / ev.rule_measured) continue;
    const support: Proposal["support"] = ev.override_measured >= 2 && ev.override_ok / ev.override_measured >= 0.5 ? "supported" : "unmeasured";

    const p = input.params;
    const highDemandShare = g.rows.filter((d) => d.flags.includes("high_demand")).length / g.rows.length;
    const shelf = perishLabel(g.perishability);
    let change: ParamChange | null = null;
    let skuNote: string | null = null;
    let title = "";
    let why = "";

    if (g.kind === "festival_double_count") {
      const from = p.festival_uplift_pct;
      change = { path: "festival_uplift_pct", label: "Festival uplift (%)", from, to: Math.max(0, from - 5) };
      title = "Lower the festival uplift";
      why = `You cut ${g.rows.length} festival-month reorders on SKUs whose sales were already rising. The uplift and the trend may be counting the same festival demand.`;
    } else if (g.kind === "raise_reorders") {
      if (highDemandShare >= 0.5) {
        const from = p.trend_reorder_multiplier;
        change = { path: "trend_reorder_multiplier", label: "High-demand multiplier", from, to: Math.min(3, round(from + 0.25, 0.05)) };
        title = "Order more when demand is rising";
        why = `You raised ${g.rows.length} high-demand reorders on ${shelf} SKUs above the suggested quantity.`;
      } else {
        const typical = new Map<string, number[]>();
        for (const d of g.rows) typical.set(d.sku_id, [...(typical.get(d.sku_id) ?? []), d.final_qty ?? 0]);
        skuNote = [...typical]
          .map(([sku, qs]) => `${sku}: usually ${Math.round(qs.reduce((a, b) => a + b, 0) / qs.length)}`)
          .join(", ");
        title = "Standard reorder quantity looks low";
        why = `You raised ${g.rows.length} reorders on ${shelf} SKUs that weren't trending. The rule is fine; the standard quantity in the SKU master is likely too small. Update it in SAP.`;
      }
    } else if (g.kind === "cut_reorders") {
      if (highDemandShare >= 0.5) {
        const from = p.trend_reorder_multiplier;
        change = { path: "trend_reorder_multiplier", label: "High-demand multiplier", from, to: Math.max(1, round(from - 0.25, 0.05)) };
        title = "Order less when demand is rising";
        why = `You cut ${g.rows.length} high-demand reorders on ${shelf} SKUs below the suggested quantity.`;
      } else {
        const path = windowPath(g.perishability, "min");
        const from = getParam(p, path);
        const max = getParam(p, windowPath(g.perishability, "max"));
        const to = Math.max(0.5, from - 1);
        if (to >= max) continue;
        change = { path, label: `${shelf === "perishable" ? "Perishable" : "Long shelf life"}: minimum cover (weeks)`, from, to };
        title = `Flag ${shelf} stock-outs a little later`;
        why = `You cut or rejected ${g.rows.length} stock-out reorders on ${shelf} SKUs. The minimum cover may be set too high.`;
      }
    } else {
      const path = windowPath(g.perishability, "max");
      const from = getParam(p, path);
      change = { path, label: `${shelf === "perishable" ? "Perishable" : "Long shelf life"}: maximum cover (weeks)`, from, to: from + 1 };
      title = `Allow a little more ${shelf} stock before pausing`;
      why = `You kept ordering ${g.rows.length} times when the rule said pause on ${shelf} SKUs. The maximum cover may be set too low.`;
    }

    if (change && change.to === change.from) continue;
    proposals.push({ key, kind: g.kind, title, why, change, skuNote, evidence: ev, support });
  }
  return proposals.sort((a, b) => b.evidence.overrides - a.evidence.overrides || (a.key < b.key ? -1 : 1));
}
