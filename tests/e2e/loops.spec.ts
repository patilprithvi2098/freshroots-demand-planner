// Both feedback loops end to end, against a DEVELOPMENT database (docs/feedback-loops.md).
// Uses synthetic follow-up data (sales for 2026-W43–W46, later stock snapshots) built from the sample files.
// Skipped unless E2E_ALLOW_WRITES=1 and E2E_SUPABASE_REF are set. Run `npm run demo-reset -- --yes` afterwards.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { authFile, hasSession } from "./auth";
import { guardDialogs } from "./helpers";

const allowed = process.env.E2E_ALLOW_WRITES === "1" && !!process.env.E2E_SUPABASE_REF;
test.describe.configure({ mode: "serial" });
test.skip(!allowed || !hasSession("planner"), "Set E2E_ALLOW_WRITES=1 and E2E_SUPABASE_REF to run the loop test on a dev project.");
test.use({ storageState: authFile("planner") });

const sample = (f: string) => readFileSync(path.join(process.cwd(), "sample-data", f), "utf8").trim().split(/\r?\n/);

/**
 * Sales for W43–W46: every SKU sells what it sold in W42, except SKU001, whose demand keeps rising
 * (360, 420, 450, 450) so it stays "high demand" in the runs as of 26 Oct and 2 Nov.
 */
function followUpSales(): string {
  const rows = sample("weekly_sales.csv").slice(1).map((l) => l.split(","));
  const w42 = rows.filter((r) => r[1] === "2026-W42");
  const sku001 = { "2026-W43": 360, "2026-W44": 420, "2026-W45": 450, "2026-W46": 450 } as const;
  const out = ["SKU_ID,Week,Units_Sold"];
  for (const week of Object.keys(sku001) as (keyof typeof sku001)[]) {
    for (const r of w42) out.push(`${r[0]},${week},${r[0] === "SKU001" ? sku001[week] : r[2]}`);
  }
  return out.join("\n");
}

/** The sample stock file re-dated; optionally with SKU004 at zero (a stock-out). */
function stockOn(date: string, sku004Zero = false): string {
  const [header, ...rows] = sample("current_inventory.csv");
  return [header, ...rows.map((l) => l.split(",")).map((r) => [r[0], r[1], sku004Zero && r[0] === "SKU004" ? "0" : r[2], date].join(","))].join("\n");
}

async function upload(page: Page, zone: string, name: string, text: string) {
  await page.goto("/data");
  const z = page.locator("section").filter({ has: page.getByRole("heading", { name: zone, exact: true }) }).last();
  await z.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await z.getByRole("button", { name: "Confirm and save" }).click();
  await expect(z.getByText(/Saved \d+ rows/)).toBeVisible();
}

async function runPlanning(page: Page) {
  await page.goto("/overview");
  await page.getByRole("button", { name: "Run planning" }).click();
  const confirm = page.getByRole("button", { name: "Yes, plan" });
  if (await confirm.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await confirm.click();
  await expect(page.getByText(/SKUs flagged/)).toBeVisible({ timeout: 60_000 });
}

/** Raghav raises SKU001's high-demand reorder to 900, the same correction each run. */
async function raiseSku001(page: Page) {
  await page.goto("/queue");
  await page.getByRole("button", { name: "Open details for SKU001" }).click();
  await page.getByRole("dialog", { name: "Freshroots Mango Drink 200ml" }).getByRole("button", { name: "Change quantity", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit quantity for SKU001" });
  await dialog.getByLabel("Final quantity").fill("900");
  await dialog.getByLabel(/Reason/).selectOption("rule_too_strict");
  await dialog.getByRole("button", { name: "Save edit" }).click();
  await expect(page.getByText("SKU001 edited to 900.")).toBeVisible();
}

test.beforeAll(() => {
  execFileSync("npx", ["tsx", "--env-file=.env.local", "scripts/e2e-reset.ts"], { stdio: "inherit", env: process.env });
});

test.beforeEach(({ page }) => guardDialogs(page));

test("loop 2: the same correction in three runs becomes a rule proposal Raghav can accept", async ({ page }) => {
  // Run 1: stock as of 19 Oct.
  await runPlanning(page);
  await raiseSku001(page);

  // Run 2: a week later. Sales for W43–W46 arrive (one file), and stock as of 26 Oct.
  await upload(page, "Weekly sales", "weekly_sales_w43_w46.csv", followUpSales());
  await upload(page, "Current inventory", "inventory_2026-10-26.csv", stockOn("2026-10-26"));
  await runPlanning(page);
  await raiseSku001(page);

  // Run 3: stock as of 2 Nov.
  await upload(page, "Current inventory", "inventory_2026-11-02.csv", stockOn("2026-11-02"));
  await runPlanning(page);
  await raiseSku001(page);

  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Rule review" }).or(page.locator("section").filter({ has: page.getByRole("heading", { name: "Rule review" }) }));
  await expect(card.getByText("Order more when demand is rising")).toBeVisible();
  await expect(card.getByText("1.5 → 1.75")).toBeVisible();
  await expect(card).toContainText("3 changes on SKU001");

  await card.getByRole("button", { name: "Accept: Order more when demand is rising" }).click();
  await expect(page.getByText(/Rules saved as version 2: High-demand multiplier 1.5 → 1.75/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Version 2 (active)")).toBeVisible();
  // Accepted proposals don't come back for the new version.
  await expect(page.getByText("Order more when demand is rising")).toHaveCount(0);
});

test("loop 1: four weeks later, outcomes are measured and shown", async ({ page }) => {
  // Stock as of 13 Nov (inside W46): SKU004 has run out. This completes the four weeks after the 19 Oct run.
  await upload(page, "Current inventory", "inventory_2026-11-13.csv", stockOn("2026-11-13", true));

  // The outcome job runs after the upload; poll the Performance page until it has numbers.
  await expect
    .poll(
      async () => {
        await page.goto("/dashboard");
        return page.getByText("No outcomes measured yet").count();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(0);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Did the decisions work?" }) });
  await expect(panel.getByText("Raghav's changes", { exact: true })).toBeVisible();
  await expect(panel).toContainText("went fine");

  // Retrieve: the pop-up shows what happened after the 19 Oct decision on SKU004.
  await page.goto("/queue?view=all");
  await page.getByRole("button", { name: "Open details for SKU004" }).click();
  const popup = page.getByRole("dialog", { name: "Freshroots Almond Milk 500ml" });
  await expect(popup.getByText("What happened after past decisions")).toBeVisible();
  await expect(popup.getByText("Ran out").first()).toBeVisible();
  await expect(popup).toContainText("Stock hit zero in 2026-W46.");
});
