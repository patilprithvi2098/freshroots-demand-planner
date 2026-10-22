import "server-only";
import { isFlagged, runEngine } from "@/lib/rules/engine";
import { daysBetween } from "@/lib/rules/isoWeek";
import type { Recommendation } from "@/lib/rules/types";
import type { Json } from "@/lib/supabase/database.types";
import { env } from "@/lib/env";
import { audit, startOfTodayIstUtc, todayIst, type Db } from "./db";
import { getActiveConfig, getDataFreshness, loadEngineInput } from "./engineInput";

export class RunBlockedError extends Error {
  constructor(
    message: string,
    readonly code: "stale_inventory" | "rate_limited" | "locked" | "no_data" | "already_released",
  ) {
    super(message);
  }
}

export interface StartRunOptions {
  triggeredBy: string; // user uuid or "cron"
  actorId: string | null;
  confirmStaleInventory: boolean;
  now?: Date;
}

export interface StartRunResult {
  runId: string;
  asOfDate: string;
  flagged: number;
  exceptions: number;
}

/** Persist one engine recommendation as a DB row. */
function toRow(runId: string, rank: number, r: Recommendation) {
  const needsAi = r.is_exception;
  return {
    run_id: runId,
    sku_id: r.sku_id,
    sku_name: r.name,
    distributor_id: r.distributor_id,
    perishability: r.perishability,
    flag: r.flag,
    flags: r.flags,
    rules_fired: r.rules_fired as unknown as Json,
    weeks_cover: r.weeks_cover,
    trend_pct: r.trend_pct,
    avg12: r.avg12,
    demand_adj: r.demand_adj,
    units_on_hand: r.units_on_hand,
    on_order_units: r.on_order_units,
    festival_applied: r.festival_applied,
    recent_sales: r.recent_sales as unknown as Json,
    rupee_exposure: r.rupee_exposure,
    rank,
    recommended_action: r.recommended_action,
    recommended_qty: r.recommended_qty,
    is_exception: r.is_exception,
    exception_reasons: r.exception_reasons,
    ai_status: needsAi ? "pending" : "not_needed",
  };
}

/**
 * Create a run and all its recommendations. The AI step is separate (enrichRun) so the queue never waits on it.
 * Locking: a partial unique index allows one 'running' and one 'completed' run per as-of date.
 */
export async function startRun(db: Db, opts: StartRunOptions): Promise<StartRunResult> {
  const now = opts.now ?? new Date();
  const freshness = await getDataFreshness(db);
  if (!freshness.latestInventoryDate || !freshness.latestSalesWeek) {
    throw new RunBlockedError("Upload sales and inventory data before running.", "no_data");
  }
  const asOfDate = freshness.latestInventoryDate;
  const config = await getActiveConfig(db);

  const age = daysBetween(asOfDate, todayIst(now));
  const stale = age > config.params.stale_inventory_days;
  if (stale && !opts.confirmStaleInventory) {
    throw new RunBlockedError(
      `Inventory is ${age} days old (as of ${asOfDate}). Confirm to run on stale stock.`,
      "stale_inventory",
    );
  }

  const { count } = await db
    .from("runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfTodayIstUtc(now));
  if ((count ?? 0) >= env.maxRunsPerDay()) {
    throw new RunBlockedError(`Run limit reached (${env.maxRunsPerDay()} per day).`, "rate_limited");
  }

  // A previous completed run for the same as-of date is superseded, unless something from it was released.
  const { data: previous } = await db
    .from("runs")
    .select("id")
    .eq("as_of_date", asOfDate)
    .eq("status", "completed")
    .maybeSingle();
  if (previous) {
    const { count: released } = await db
      .from("recommendations")
      .select("id", { count: "exact", head: true })
      .eq("run_id", previous.id)
      .not("released_at", "is", null);
    if ((released ?? 0) > 0) {
      throw new RunBlockedError(
        `The run for ${asOfDate} has already been released to procurement. Upload newer data to run again.`,
        "already_released",
      );
    }
  }

  const { data: run, error: runError } = await db
    .from("runs")
    .insert({
      as_of_date: asOfDate,
      triggered_by: opts.triggeredBy,
      config_version: config.version,
      status: "running",
      stale_inventory_confirmed: stale,
    })
    .select("id")
    .single();
  if (runError || !run) {
    if (runError?.code === "23505") {
      throw new RunBlockedError(`A run for ${asOfDate} is already in progress.`, "locked");
    }
    throw new Error(runError?.message ?? "Could not create run");
  }

  try {
    const input = await loadEngineInput(db, asOfDate, config.params);
    const result = runEngine(input);
    const rows = result.recommendations.map((r, i) => toRow(run.id, i + 1, r));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("recommendations").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    const flagged = result.recommendations.filter(isFlagged);
    const exceptions = result.recommendations.filter((r) => r.is_exception);

    if (previous) {
      const { error } = await db.from("runs").update({ status: "superseded" }).eq("id", previous.id);
      if (error) throw new Error(error.message);
    }
    const { error: doneError } = await db
      .from("runs")
      .update({
        status: "completed",
        sku_count: result.recommendations.length,
        flagged_count: flagged.length,
        exception_count: exceptions.length,
        features: result.features as unknown as Json,
        skipped: result.skipped as unknown as Json,
      })
      .eq("id", run.id);
    if (doneError) throw new Error(doneError.message);

    await audit(db, opts.actorId, "run", "runs", run.id, {
      as_of_date: asOfDate,
      config_version: config.version,
      flagged: flagged.length,
      exceptions: exceptions.length,
      stale_inventory_confirmed: stale,
      superseded: previous?.id ?? null,
    });
    return { runId: run.id, asOfDate, flagged: flagged.length, exceptions: exceptions.length };
  } catch (e) {
    await db
      .from("runs")
      .update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "failed" })
      .eq("id", run.id);
    throw e;
  }
}
