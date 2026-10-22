// TEST FIXTURE: clear runs, decisions, uploads and config versions in a DEVELOPMENT project so the
// end-to-end workflow can be repeated. Master data (SKUs, sales, inventory) is kept.
// Refuses to run unless E2E_ALLOW_WRITES=1 and the Supabase URL matches E2E_SUPABASE_REF.
import { adminClient } from "./_admin";

async function main() {
  const ref = process.env.E2E_SUPABASE_REF;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (process.env.E2E_ALLOW_WRITES !== "1" || !ref || !url.startsWith(`https://${ref}.supabase.co`)) {
    console.error("Refusing to reset: set E2E_ALLOW_WRITES=1 and E2E_SUPABASE_REF to the development project ref.");
    process.exit(1);
  }
  const db = adminClient();
  const none = "00000000-0000-0000-0000-000000000000";
  const steps = [
    db.from("runs").delete().neq("id", none), // cascades to recommendations, ai_calls, outcomes
    db.from("upload_batches").delete().neq("id", none),
    db.from("backtest_results").delete().neq("id", none),
    db.from("historical_decisions").delete().neq("id", none),
    db.from("audit_log").delete().neq("id", none),
  ];
  for (const s of steps) {
    const { error } = await s;
    if (error) throw error;
  }
  const { error: e1 } = await db.from("rule_config").update({ active: false }).gt("version", 1);
  if (e1) throw e1;
  const { error: e2 } = await db.from("rule_config").delete().gt("version", 1);
  if (e2) throw e2;
  const { error: e3 } = await db.from("rule_config").update({ active: true }).eq("version", 1);
  if (e3) throw e3;
  console.log("reset ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
