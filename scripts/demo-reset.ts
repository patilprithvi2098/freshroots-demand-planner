// Restore the demo: clear runs, decisions, uploads, backtests and extra rule versions, reload the five
// sample files, and run planning once, the same way the Run planning button does (including Claude
// explanations when ANTHROPIC_API_KEY is set). Accounts and the audit trail of sign-ins are kept.
// Usage: npm run demo-reset -- --yes
// Run with `--conditions=react-server` (the npm script does this) so the app's server modules load.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/csv/loaders";
import { runBacktest } from "../lib/rules/backtest";
import type { Json } from "../lib/supabase/database.types";
import { enrichRun } from "../lib/services/enrich";
import { getActiveConfig, loadEngineInput } from "../lib/services/engineInput";
import { startRun } from "../lib/services/runs";
import { adminClient } from "./_admin";

const NONE = "00000000-0000-0000-0000-000000000000";

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("This clears all runs and decisions in the database in .env.local. Re-run with: npm run demo-reset -- --yes");
    process.exit(1);
  }
  const db = adminClient();
  for (const table of ["runs", "upload_batches", "backtest_results", "historical_decisions"] as const) {
    const { error } = await db.from(table).delete().neq("id", NONE);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  await db.from("rule_config").update({ active: false }).gt("version", 1);
  await db.from("rule_config").delete().gt("version", 1);
  await db.from("rule_config").update({ active: true }).eq("version", 1);

  const read = (f: string) => readFileSync(path.join(process.cwd(), "sample-data", f), "utf8");
  const rows = <T>(r: { rows: T[]; errors: unknown[] }, name: string) => {
    if (r.errors.length) throw new Error(`${name} has errors`);
    return r.rows;
  };
  const steps = [
    db.from("distributors").upsert(rows(parseCsv("distributor_master", read("distributor_master.csv")), "distributors")),
    db.from("calendar").upsert(rows(parseCsv("calendar", read("calendar.csv")), "calendar")),
    db.from("skus").upsert(rows(parseCsv("sku_master", read("sku_master.csv")), "skus")),
  ];
  for (const s of steps) {
    const { error } = await s;
    if (error) throw new Error(error.message);
  }
  for (const [table, file, type, conflict] of [
    ["weekly_sales", "weekly_sales.csv", "weekly_sales", "sku_id,iso_week,distributor_key"],
    ["inventory_snapshots", "current_inventory.csv", "current_inventory", "sku_id,location,as_of_date"],
  ] as const) {
    const { error } = await db.from(table).upsert(rows(parseCsv(type, read(file)), table) as never, { onConflict: conflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  // Record the five files in the upload history, as if uploaded on the Data page.
  const files = [
    ["distributor_master", "distributor_master.csv"],
    ["calendar", "calendar.csv"],
    ["sku_master", "sku_master.csv"],
    ["weekly_sales", "weekly_sales.csv"],
    ["current_inventory", "current_inventory.csv"],
  ] as const;
  const { error: bErr } = await db.from("upload_batches").insert(
    files.map(([file_type, filename]) => {
      const text = read(filename);
      return {
        file_type,
        filename,
        file_hash: createHash("sha256").update(text).digest("hex"),
        row_count: parseCsv(file_type, text).rows.length,
        status: "confirmed",
        warnings: [],
      };
    }),
  );
  if (bErr) throw new Error(`upload_batches: ${bErr.message}`);

  // The sample stock is dated 19 Oct 2026; confirm the stale-stock check so the demo always runs.
  const run = await startRun(db, { triggeredBy: "demo-reset", actorId: null, confirmStaleInventory: true });
  console.log(`Plan ready for stock as of ${run.asOfDate}: ${run.flagged} SKUs to review, ${run.exceptions} need judgement.`);
  // Backtest: replay the rules over every week in the sales history (no past decisions loaded,
  // so agreement stays empty until Raghav's real decisions are uploaded).
  const config = await getActiveConfig(db);
  const { asOfDate: _asOf, ...base } = await loadEngineInput(db, run.asOfDate, config.params, { allSales: true });
  const bt = runBacktest(base, []);
  const { error: btErr } = await db.from("backtest_results").insert({
    config_version: config.version,
    weeks_replayed: bt.weeks.length,
    agreement_pct: bt.agreement.pct,
    detail: bt as unknown as Json,
  });
  if (btErr) throw new Error(`backtest_results: ${btErr.message}`);
  console.log(`Backtest: ${bt.weeks.length} weeks replayed.`);

  const ai = await enrichRun(db, run.runId);
  console.log(`Explanations: ${ai.called - ai.failed} written by Claude, ${ai.failed} failed, ${ai.skipped} skipped (rule-based explanation shown).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
