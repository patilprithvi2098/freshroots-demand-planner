import "server-only";
// Loop 2 (override → rule review): loads the evidence, and records Raghav's accept / dismiss decisions.
import { ruleParamsSchema } from "@/lib/rules/config";
import { driverOf } from "@/lib/outcomes";
import { applyChange, LOOKBACK_RUNS, proposeRuleChanges, type Proposal, type ReviewOutcome } from "@/lib/ruleReview";
import type { Json } from "@/lib/supabase/database.types";
import { runAndStoreBacktest } from "./backtest";
import { audit, fetchAll, type Db } from "./db";
import { getActiveConfig } from "./engineInput";

export async function loadProposals(db: Db): Promise<{ proposals: Proposal[]; configVersion: number; runsLooked: number }> {
  const config = await getActiveConfig(db);
  // Only runs made with the current rules count: corrections made under an older version are the evidence
  // that version was already changed for, so they must not propose a second change on their own.
  const { data: runs } = await db
    .from("runs")
    .select("id")
    .in("status", ["completed", "superseded"])
    .eq("config_version", config.version)
    .order("run_date", { ascending: false })
    .limit(LOOKBACK_RUNS);
  const runIds = (runs ?? []).map((r) => r.id);
  if (runIds.length === 0) return { proposals: [], configVersion: config.version, runsLooked: 0 };

  const decisions = await fetchAll((a, b) =>
    db
      .from("recommendations")
      .select("id, run_id, sku_id, sku_name, perishability, flag, flags, festival_applied, recommended_action, recommended_qty, status, final_qty, override_reason_code")
      .in("run_id", runIds)
      .neq("status", "pending")
      .order("id")
      .range(a, b),
  );
  const ids = decisions.map((d) => d.id);
  const outcomeRows = ids.length
    ? await fetchAll((a, b) => db.from("outcomes").select("recommendation_id, result, driver").in("recommendation_id", ids).not("result", "is", null).order("id").range(a, b))
    : [];
  const statusById = new Map(decisions.map((d) => [d.id, d.status]));
  const outcomes = new Map<string, ReviewOutcome>(
    outcomeRows.map((o) => [o.recommendation_id, { result: o.result!, driver: driverOf(statusById.get(o.recommendation_id) ?? "pending") }]),
  );
  const { data: decidedRows } = await db.from("rule_proposal_decisions").select("proposal_key").like("proposal_key", `%:v${config.version}`);

  const proposals = proposeRuleChanges({
    decisions: decisions.map((d) => ({ ...d, recommendation_id: d.id })),
    outcomes,
    params: config.params,
    configVersion: config.version,
    decided: new Set((decidedRows ?? []).map((r) => r.proposal_key)),
  });
  return { proposals, configVersion: config.version, runsLooked: runIds.length };
}

/** Accept: a parameter proposal becomes a new rule version and is backtested; an SKU-master note is just acknowledged. */
export async function acceptProposal(db: Db, actor: string, key: string): Promise<{ message: string }> {
  const { proposals, configVersion } = await loadProposals(db);
  const p = proposals.find((x) => x.key === key);
  if (!p) throw new Error("This proposal is no longer current. Refresh the page.");
  let after: number | null = null;
  let message = "Noted. Update the standard reorder quantity in the SAP SKU master, then re-upload it.";
  if (p.change) {
    const config = await getActiveConfig(db);
    const next = ruleParamsSchema.parse(applyChange(config.params, p.change));
    const { data, error } = await db.rpc("save_rule_config", { new_params: next as unknown as Json });
    if (error) throw new Error(error.message);
    after = data;
    const bt = await runAndStoreBacktest(db, actor).catch(() => null);
    message =
      `Rules saved as version ${after}: ${p.change.label} ${p.change.from} → ${p.change.to}. ` +
      (bt ? `Backtest replayed ${bt.result.weeks.length} weeks with the new rule. ` : "") +
      "The next planning run uses it.";
  }
  const { error } = await db.from("rule_proposal_decisions").insert({
    proposal_key: p.key,
    decision: "accepted",
    config_version_before: configVersion,
    config_version_after: after,
    evidence: p.evidence as unknown as Json,
    decided_by: actor,
  });
  if (error) throw new Error(error.message);
  await audit(db, actor, "rule_proposal_accepted", "rule_proposal_decisions", p.key, { change: p.change, evidence: p.evidence });
  return { message };
}

export async function dismissProposal(db: Db, actor: string, key: string): Promise<void> {
  const { proposals, configVersion } = await loadProposals(db);
  const p = proposals.find((x) => x.key === key);
  if (!p) return;
  const { error } = await db.from("rule_proposal_decisions").insert({
    proposal_key: p.key,
    decision: "dismissed",
    config_version_before: configVersion,
    evidence: p.evidence as unknown as Json,
    decided_by: actor,
  });
  if (error) throw new Error(error.message);
  await audit(db, actor, "rule_proposal_dismissed", "rule_proposal_decisions", p.key, { change: p.change });
}
