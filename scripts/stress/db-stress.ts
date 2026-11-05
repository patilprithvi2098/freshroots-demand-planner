// FULL-SCALE STRESS RUN against the database in .env.local, using the app's own services end to end:
// uploads → planning → Claude explanations → review → release → Zoho ordering (LOCAL MOCK ONLY, with
// injected failures and concurrent clicks) → delivery sync → outcomes → rule review → page loaders.
//
// Synthetic data only (SKUs FR0001…, distributors DIST0001…). Cleans up after itself; run
// `npm run demo-reset -- --yes` afterwards to restore the sample plan.
//
// Usage: npx tsx --conditions=react-server --env-file=.env.local scripts/stress/db-stress.ts --yes
// Never talks to a real Zoho organisation: the Zoho client is built on the in-process mock.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createZohoClient } from "../../lib/integrations/zoho";
import { parseCsv } from "../../lib/csv/loaders";
import { addIsoWeeks, mondayOfIsoWeek } from "../../lib/rules/isoWeek";
import { loadDashboard } from "../../lib/services/dashboard";
import { enrichRun } from "../../lib/services/enrich";
import { measureOutcomes } from "../../lib/services/outcomeJob";
import { loadPlanning } from "../../lib/services/overview";
import { releasedItems } from "../../lib/services/procurement";
import * as review from "../../lib/services/review";
import { loadProposals } from "../../lib/services/ruleReview";
import { RunBlockedError, startRun } from "../../lib/services/runs";
import { confirmUpload } from "../../lib/services/uploads";
import { placeZohoOrders, previewZohoOrders, syncZohoStatuses } from "../../lib/services/zohoOrders";
import { MOCK_ORG_ID, mockFetch, mockReceive, newMockState } from "../zoho/mock";
import { adminClient } from "../_admin";
import { generateStressData } from "./generate";

const NONE = "00000000-0000-0000-0000-000000000000";
const report: { step: string; ms: number; detail: Record<string, unknown> }[] = [];
const issues: string[] = [];

async function step<T>(name: string, fn: () => Promise<T>, detail: (r: T) => Record<string, unknown> = () => ({})): Promise<T> {
  const t = performance.now();
  try {
    const r = await fn();
    const ms = Math.round(performance.now() - t);
    report.push({ step: name, ms, detail: detail(r) });
    console.log(`✓ ${name.padEnd(58)} ${String(ms).padStart(7)} ms  ${JSON.stringify(detail(r))}`);
    return r;
  } catch (e) {
    const ms = Math.round(performance.now() - t);
    const msg = e instanceof Error ? e.message : String(e);
    report.push({ step: name, ms, detail: { error: msg } });
    issues.push(`${name}: ${msg}`);
    console.log(`✗ ${name.padEnd(58)} ${String(ms).padStart(7)} ms  ERROR ${msg}`);
    throw e;
  }
}

function expect(cond: boolean, what: string) {
  if (!cond) {
    issues.push(what);
    console.log(`  ⚠ ${what}`);
  }
}

/** Rebuild a CSV from only the valid rows (the generator deliberately adds bad rows to test the loaders). */
function cleanCsv(header: string, rows: string[][]): string {
  return [header, ...rows.map((r) => r.join(","))].join("\n");
}

async function cleanup(db: ReturnType<typeof adminClient>) {
  await db.from("runs").delete().neq("id", NONE);
  await db.from("open_purchase_orders").delete().neq("po_id", "");
  await db.from("rule_proposal_decisions").delete().neq("id", NONE);
  await db.from("rule_config").update({ active: false }).gt("version", 1);
  await db.from("rule_config").delete().gt("version", 1);
  await db.from("rule_config").update({ active: true }).eq("version", 1);
  await db.from("write_offs").delete().like("sku_id", "FR%");
  // Synthetic SKUs cascade to their sales and stock snapshots.
  for (let i = 0; i < 5; i++) {
    const { error } = await db.from("skus").delete().like("sku_id", "FR%");
    if (!error) break;
  }
  await db.from("distributors").delete().like("distributor_id", "DIST____");
  await db.from("upload_batches").delete().like("filename", "stress_%");
  await db.from("calendar").delete().or("year_month.lt.2025-01,year_month.gt.2026-12");
}

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("This replaces the plan in the database in .env.local with synthetic data and cleans up after. Re-run with --yes.");
    process.exit(1);
  }
  const db = adminClient();
  const { data: planner } = await db.from("profiles").select("id").eq("role", "planner").limit(1).single();
  const { data: procurement } = await db.from("profiles").select("id").eq("role", "procurement").limit(1).maybeSingle();
  if (!planner) throw new Error("No planner account");
  const actor = planner.id;
  const buyer = procurement?.id ?? planner.id;

  await step("cleanup before", () => cleanup(db));
  // Clear today's runs so the 10-runs-a-day limit doesn't stop the stress run.
  await db.from("runs").delete().neq("id", NONE);

  // ---------- data ----------
  const ds = await step("generate synthetic data (400 SKUs, 1,200 distributors, 157 weeks)", async () => generateStressData(), (d) => ({ weeks: d.weeks.length }));

  const sku = parseCsv("sku_master", ds.csv.sku_master);
  const sales = parseCsv("weekly_sales", ds.csv.weekly_sales);
  const dists = parseCsv("distributor_master", ds.csv.distributor_master);
  const cal = parseCsv("calendar", ds.csv.calendar);
  const inv = parseCsv("current_inventory", ds.csv.current_inventory);

  // Plan as of the Monday after week 140, so four later weeks of sales exist for the outcome loop.
  const asOfWeek = ds.weeks[140];
  const asOfDate = mondayOfIsoWeek(addIsoWeeks(asOfWeek, 1));
  const invRows = inv.rows.filter((r) => r.as_of_date === asOfDate);
  expect(invRows.length > 300, `expected stock snapshots on ${asOfDate}, got ${invRows.length}`);

  const toCsv = {
    distributors: cleanCsv("Distributor_ID,Distributor_Name,Region,Status", dists.rows.map((d) => [d.distributor_id, d.name, d.region, d.status])),
    calendar: cleanCsv("Year,Month,Year_Month,Is_Festival_Month", cal.rows.map((c) => [String(c.year), String(c.month), c.year_month, c.is_festival_month ? "TRUE" : "FALSE"])),
    skus: cleanCsv(
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID,Unit_Price,Lead_Time_Days,Launch_Date",
      sku.rows.map((s) => [s.sku_id, s.name.replace(/,/g, " "), s.category, s.perishability === "high" ? "High" : "Low", String(s.standard_reorder_qty), s.unit_of_measure, s.distributor_id ?? "", s.unit_price == null ? "" : String(s.unit_price), s.lead_time_days == null ? "" : String(s.lead_time_days), s.launch_date ?? ""]),
    ),
    sales: cleanCsv("SKU_ID,Week,Units_Sold,Distributor_ID", sales.rows.filter((r) => r.sku_id.startsWith("FR") && r.sku_id !== "FR9999").map((r) => [r.sku_id, r.iso_week, String(r.units_sold), r.distributor_id ?? ""])),
    stock: cleanCsv("SKU_ID,Location,Units_On_Hand,As_Of_Date", invRows.map((r) => [r.sku_id, r.location, String(r.units_on_hand), r.as_of_date])),
  };

  await step("upload distributors (1,200)", () => confirmUpload(db, actor, "distributor_master", "stress_distributors.csv", toCsv.distributors), (r) => ({ saved: r.saved }));
  await step("upload calendar", () => confirmUpload(db, actor, "calendar", "stress_calendar.csv", toCsv.calendar), (r) => ({ saved: r.saved }));
  await step("upload SKU master (400, with prices, lead times, launch dates)", () => confirmUpload(db, actor, "sku_master", "stress_skus.csv", toCsv.skus), (r) => ({ saved: r.saved }));
  await step(`upload weekly sales by distributor (${sales.rows.length.toLocaleString("en-IN")} rows)`, () => confirmUpload(db, actor, "weekly_sales", "stress_sales.csv", toCsv.sales), (r) => ({ saved: r.saved, warnings: r.warnings.length }));
  await step(`upload stock as of ${asOfDate}`, () => confirmUpload(db, actor, "current_inventory", "stress_stock.csv", toCsv.stock), (r) => ({ saved: r.saved }));
  // Duplicate upload must be refused.
  await step("re-upload identical sales file (must be refused)", async () => {
    try {
      await confirmUpload(db, actor, "weekly_sales", "stress_sales.csv", toCsv.sales);
      return "accepted";
    } catch {
      return "refused";
    }
  }, (r) => ({ result: r })).then((r) => expect(r === "refused", "identical re-upload was accepted"));

  // Zoho ids for the synthetic catalogue (the lenient mock accepts them).
  await step("link synthetic SKUs and distributors to Zoho ids", async () => {
    for (const s of sku.rows.filter((x) => x.sku_id.startsWith("FR"))) await db.from("skus").update({ zoho_item_id: `S-${s.sku_id}` }).eq("sku_id", s.sku_id);
    const used = [...new Set(sku.rows.map((s) => s.distributor_id).filter((d): d is string => !!d))];
    for (const d of used) await db.from("distributors").update({ zoho_vendor_id: `V-${d}` }).eq("distributor_id", d);
    return used.length;
  }, (n) => ({ distributors_linked: n }));

  // ---------- planning ----------
  await step("run planning (400 SKUs)", () => startRun(db, { triggeredBy: actor, actorId: actor, confirmStaleInventory: true }), (r) => ({ flagged: r.flagged, exceptions: r.exceptions }));
  const concurrent = await step("two runs at once on the same data (lock)", async () => {
    const res = await Promise.allSettled([
      startRun(db, { triggeredBy: actor, actorId: actor, confirmStaleInventory: true }),
      startRun(db, { triggeredBy: actor, actorId: actor, confirmStaleInventory: true }),
    ]);
    return res.map((r) => (r.status === "fulfilled" ? "ran" : r.reason instanceof RunBlockedError ? r.reason.code : String(r.reason)));
  }, (r) => ({ results: r }));
  expect(concurrent.filter((r) => r === "ran").length <= 2 && !concurrent.some((r) => r.includes("duplicate")), "concurrent runs produced an unexpected error");
  const { data: liveRun } = await db.from("runs").select("id, as_of_date").eq("status", "completed").order("run_date", { ascending: false }).limit(1).single();
  // The run plans as of the newest stock date in the database (the demo's own stock may be newer than the synthetic set).
  const { count: completed } = await db.from("runs").select("id", { count: "exact", head: true }).eq("status", "completed").eq("as_of_date", liveRun!.as_of_date);
  expect(completed === 1, `expected exactly one live run for ${liveRun!.as_of_date}, found ${completed}`);
  const runId = liveRun!.id;

  if (process.argv.includes("--skip-ai")) console.log("- Claude explanations skipped (--skip-ai)");
  else await step("Claude explanations for exceptions (real API, capped at 80)", () => enrichRun(db, runId), (r) => r as unknown as Record<string, unknown>);

  // ---------- review ----------
  const { data: lines } = await db.from("recommendations").select("id, sku_id, is_exception, status, flag, flags, recommended_action, recommended_qty").eq("run_id", runId);
  const all = lines ?? [];
  const exceptions = all.filter((l) => l.is_exception);
  const plain = all.filter((l) => !l.is_exception && l.recommended_action !== "no_action");
  const highDemand = plain.filter((l) => l.recommended_action === "reorder_now" && (l.flag === "high_demand" || l.flags.includes("high_demand"))).slice(0, 6);
  await step(`change ${highDemand.length} high-demand reorders (+20%)`, async () => {
    for (const l of highDemand) await review.edit(db, actor, { id: l.id, qty: Math.round((l.recommended_qty ?? 0) * 1.2), reason: "rule_too_strict" });
    return highDemand.length;
  });
  const toBulk = plain.filter((l) => !highDemand.includes(l)).map((l) => l.id);
  await step(`bulk approve ${toBulk.length} straightforward lines`, () => review.bulkApprove(db, actor, toBulk), (r) => r);
  await step(`approve or reject ${exceptions.length} judgement lines one by one`, async () => {
    let i = 0;
    for (const l of exceptions) {
      if (i++ % 3 === 0) await review.reject(db, actor, { id: l.id, reason: "known_event" });
      else await review.approve(db, actor, l.id);
    }
    return exceptions.length;
  });
  const bulkExc = await step("bulk approve must skip judgement lines", async () => {
    const pending = all.filter((l) => l.is_exception).map((l) => l.id);
    return review.bulkApprove(db, actor, pending);
  }, (r) => r);
  expect(bulkExc.approved === 0, "bulk approve approved a judgement line");
  const released = await step("send to procurement", () => review.release(db, actor, runId), (r) => r);
  await step("released lines can no longer be changed", async () => {
    const first = all.find((l) => !l.is_exception && l.recommended_action === "reorder_now");
    try {
      if (first) await review.approve(db, actor, first.id);
      return "changed";
    } catch {
      return "refused";
    }
  }, (r) => ({ result: r })).then((r) => expect(r === "refused", "a released line could still be changed"));

  // ---------- ordering (local mock) ----------
  const state = newMockState();
  state.lenient = true;
  const zoho = createZohoClient(
    { clientId: "mock", clientSecret: "mock", refreshToken: "mock", orgId: MOCK_ORG_ID, apiBase: "http://zoho.mock", accountsBase: "http://zoho.mock" },
    mockFetch(state),
  );
  const preview = await step("preview orders", () => previewZohoOrders(db), (p) => ({ orders: p.orders.length, lines: p.orders.reduce((a, o) => a + o.lines.length, 0), above_cap: p.aboveCap, problems: p.problems.length }));

  // Fault injection: one create fails, one issue fails, one rate limit.
  state.failNextCreates = 1;
  state.failNextIssues = 1;
  state.rateLimitOnce = true;
  const first = await step("issue orders with injected Zoho failures (2 tabs at once)", async () => {
    const [a, b] = await Promise.all([
      placeZohoOrders(db, zoho, buyer, { confirmAboveCap: true }),
      placeZohoOrders(db, zoho, buyer, { confirmAboveCap: true }),
    ]);
    return { a, b };
  }, ({ a, b }) => ({
    created: a.created.length + b.created.length,
    failed: a.failed.length + b.failed.length,
    busy: a.busy + b.busy,
  }));
  const retry = await step("retry: re-issue drafts and send what failed", () => placeZohoOrders(db, zoho, buyer, { confirmAboveCap: true }), (r) => ({ created: r.created.length, issued_drafts: r.issuedDrafts, failed: r.failed.length }));
  const again = await step("third click: nothing left to send", () => placeZohoOrders(db, zoho, buyer, { confirmAboveCap: true }), (r) => ({ created: r.created.length, failed: r.failed.length }));

  const refs = state.purchaseorders.map((p) => p.reference_number);
  expect(new Set(refs).size === refs.length, `duplicate purchase orders in Zoho: ${refs.length - new Set(refs).size}`);
  expect(state.purchaseorders.length === preview.orders.length, `expected ${preview.orders.length} POs, Zoho has ${state.purchaseorders.length}`);
  expect(state.purchaseorders.every((p) => p.status === "issued"), `${state.purchaseorders.filter((p) => p.status !== "issued").length} PO(s) not issued`);
  expect(again.created.length === 0, "a third click created more orders");
  const orderedQty = state.purchaseorders.flatMap((p) => p.line_items.map((l) => l.quantity)).reduce((a, b) => a + b, 0);
  const previewQty = preview.orders.flatMap((o) => o.lines.map((l) => l.qty)).reduce((a, b) => a + b, 0);
  expect(orderedQty === previewQty, `ordered ${orderedQty} units but the preview showed ${previewQty}`);
  void first;
  void retry;

  // Deliveries for half the orders, then sync.
  await step("record deliveries for half the orders in Zoho", async () => {
    state.purchaseorders.slice(0, Math.ceil(state.purchaseorders.length / 2)).forEach((p) => mockReceive(state, p.purchaseorder_id, addDaysIso(asOfDate, 9)));
    return state.purchaseorders.length;
  });
  const sync = await step("sync Zoho status and delivery dates", () => syncZohoStatuses(db, zoho), (r) => r);
  const { count: withDates } = await db.from("open_purchase_orders").select("po_id", { count: "exact", head: true }).not("received_date", "is", null);
  expect((withDates ?? 0) > 0, "no delivery dates came back from Zoho");
  void sync;

  // ---------- loops ----------
  await step("upload write-offs (outcome loop signal)", () => {
    const wo = cleanCsv("SKU_ID,Week,Units_Written_Off", sku.rows.filter((s) => s.perishability === "high").slice(0, 20).map((s) => [s.sku_id, addIsoWeeks(asOfWeek, 2), "15"]));
    return confirmUpload(db, actor, "write_offs", "stress_writeoffs.csv", wo);
  }, (r) => ({ saved: r.saved }));
  const outcomes = await step("measure outcomes (4 weeks after the plan)", () => measureOutcomes(db), (r) => r as unknown as Record<string, unknown>);
  expect(outcomes.measured > 300, `expected outcomes for most of the 400 lines, got ${outcomes.measured}`);
  const proposals = await step("rule review proposals", () => loadProposals(db), (r) => ({ proposals: r.proposals.map((p) => p.title) }));
  expect(proposals.proposals.length > 0, "no rule proposal from 6 consistent high-demand raises");

  // ---------- page loaders at scale ----------
  for (let i = 1; i <= 3; i++) await step(`load Overview / Review data (400 SKUs), try ${i}`, () => loadPlanning(db), (p) => ({ rows: p.rows.length }));
  await step("load Performance dashboard", () => loadDashboard(db), (d) => ({ measured: d.outcome_loop.measured, rule_rate: d.outcome_loop.rule.rate, override_rate: d.outcome_loop.override.rate }));
  await step("load Orders list", () => releasedItems(db, 60, db), (r) => ({ lines: r.length, received: r.filter((x) => x.order_status === "received").length }));

  await step("cleanup after", () => cleanup(db));

  const out = { at: new Date().toISOString(), as_of: asOfDate, released: released.released, mock_purchase_orders: state.purchaseorders.length, issues, steps: report };
  const dir = path.join(process.cwd(), "sample-data", "stress", "results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "db-stress.json"), JSON.stringify(out, null, 2));
  console.log(issues.length ? `\n${issues.length} ISSUE(S):\n- ${issues.join("\n- ")}` : "\nNo issues found.");
}

function addDaysIso(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

main().catch(async (e) => {
  console.error("STOPPED:", e instanceof Error ? e.message : e);
  try {
    await cleanup(adminClient());
    console.error("cleaned up synthetic data");
  } catch {}
  process.exit(1);
});
