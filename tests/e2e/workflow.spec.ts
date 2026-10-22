// End-to-end planner → procurement → viewer workflow against a DEVELOPMENT database.
// Skipped unless E2E_ALLOW_WRITES=1 and E2E_SUPABASE_REF are set (see README).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { authFile, hasSession } from "./auth";
import { countWrites, guardDialogs } from "./helpers";

const allowed = process.env.E2E_ALLOW_WRITES === "1" && !!process.env.E2E_SUPABASE_REF;
test.describe.configure({ mode: "serial" });
test.skip(!allowed || !hasSession("planner"), "Set E2E_ALLOW_WRITES=1 and E2E_SUPABASE_REF to run the write workflow on a dev project.");

const sample = (f: string) => path.join(process.cwd(), "sample-data", f);
const zone = (page: Page, label: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: label, exact: true }) }).last();
const item = (page: Page, sku: string) => page.locator(`li[data-sku="${sku}"]`);
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

test.beforeAll(() => {
  execFileSync("npx", ["tsx", "--env-file=.env.local", "scripts/e2e-reset.ts"], { stdio: "inherit", env: process.env });
});

test.describe("planner", () => {
  test.use({ storageState: authFile("planner") });
  test.beforeEach(({ page }) => guardDialogs(page));

  test("data: preview, confirm, duplicate rejected, invalid rows listed", async ({ page }) => {
    await page.goto("/data");
    const z = zone(page, "SKU master");
    await z.locator('input[type="file"]').setInputFiles(sample("sku_master.csv"));
    await expect(z.getByText("sku_master.csv: 15 rows, 15 valid.")).toBeVisible();
    await expect(z.getByRole("table")).toContainText("Freshroots Mango Drink 200ml");
    await z.getByRole("button", { name: "Confirm and save" }).click();
    await expect(z.getByText(/Saved 15 rows/)).toBeVisible();

    // Same file again: identical hash is rejected.
    await z.locator('input[type="file"]').setInputFiles(sample("sku_master.csv"));
    await expect(z.getByText(/This exact file has already been uploaded/)).toBeVisible();
    await expect(z.getByRole("button", { name: "Confirm and save" })).toBeDisabled();

    // Invalid rows are rejected with row numbers; nothing can be saved.
    const s = zone(page, "Weekly sales");
    await s.locator('input[type="file"]').setInputFiles({
      name: "bad_sales.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("SKU_ID,Week,Units_Sold\nSKU001,2026-W43,-4\nSKU001,2026-43,10\nSKU001,2026-W44,2.5\n"),
    });
    await expect(s.getByText("Row 2: Units_Sold: Units_Sold must be a non-negative whole number")).toBeVisible();
    await expect(s.getByText(/Row 3: Week/)).toBeVisible();
    await expect(s.getByText(/Row 4: Units_Sold/)).toBeVisible();
    await expect(s.getByRole("button", { name: "Confirm and save" })).toBeDisabled();

    // Non-CSV files are refused.
    await s.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(s.getByText("Only .csv files are accepted.")).toBeVisible();
  });

  test("overview: run planning from the cycle card, then tiles and stock health", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByText("No plan yet for this cycle")).toBeVisible();
    await page.getByRole("button", { name: "Run planning" }).click();
    await expect(page.getByText(/7 SKUs flagged, 2 exceptions/)).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByRole("link", { name: /Running low\s*5\s*SKUs/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Too much stock\s*2\s*SKUs/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Needs judgement\s*2\s*SKUs/ })).toBeVisible();
    await expect(page.getByText("Festival month: demand raised 25% before checking stock")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review 7 SKUs" })).toBeVisible();

    // Stock health opens the pop-up.
    await page.getByRole("button", { name: /^Quinoa 500g.*22\.2/ }).click();
    const dialog = page.getByRole("dialog", { name: "Freshroots Quinoa 500g" });
    await expect(dialog).toContainText("above the 14-week maximum. Suggested: pause the next order.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("review: ranking, tabs and the SKU pop-up", async ({ page }) => {
    await page.goto("/queue");
    const order = await page.locator("li[data-sku]").evaluateAll((els) => els.map((e) => e.getAttribute("data-sku")));
    expect(order).toEqual(["SKU011", "SKU004", "SKU013", "SKU001", "SKU003", "SKU006", "SKU007"]);

    // Judgement SKUs are marked and cannot be bulk-selected.
    await expect(item(page, "SKU001")).toContainText("Needs judgement");
    await expect(item(page, "SKU001").getByRole("checkbox")).toHaveCount(0);
    await expect(item(page, "SKU003").getByRole("checkbox")).toHaveCount(1);
    await expect(item(page, "SKU001")).toContainText("750");
    await expect(item(page, "SKU006")).toContainText("22.2");
    await expect(item(page, "SKU006")).toContainText("Pause");

    await tab(page, "Needs judgement").click();
    await expect(page.locator("li[data-sku]")).toHaveCount(2);
    await tab(page, "Too much stock").click();
    await expect(page.locator("li[data-sku]")).toHaveCount(2);
    await tab(page, "All SKUs").click();
    await expect(page.locator("li[data-sku]")).toHaveCount(15);
    await tab(page, "To decide").click();

    await page.getByRole("button", { name: "Open details for SKU001" }).click();
    const panel = page.getByRole("dialog", { name: "Freshroots Mango Drink 200ml" });
    await expect(panel.getByRole("img", { name: /Weekly units sold/ })).toBeVisible();
    await expect(panel).toContainText("900 units last 3.4 weeks at 269 a week (festival demand), below the 6-week minimum. Suggested: order 750 units now.");
    await expect(panel).toContainText("Festival month: demand raised 25% from 214.9 to 268.6 units a week.");
    await expect(panel).toContainText("Reorder now at 1.5x the standard 500 = 750 units.");
    await expect(panel).toContainText("4 of 7");
    // Arrow keys move to the next SKU in the list.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: "Freshroots Brown Rice 1kg" })).toBeVisible();
    // Rationales are written after the run; accept either outcome.
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(
        async () => {
          const t = await page.getByRole("dialog", { name: "Freshroots Mango Drink 200ml" }).textContent();
          if (!/Check this first:|Rationale unavailable/.test(t ?? "")) {
            await page.reload();
            await page.getByRole("button", { name: "Open details for SKU001" }).click();
            return false;
          }
          return true;
        },
        { timeout: 60_000, intervals: [3_000] },
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("change and reject need a reason and a valid quantity; nothing is sent until valid", async ({ page }) => {
    await page.goto("/queue");
    const writes = countWrites(page, "/queue");
    await page.getByRole("button", { name: "Open details for SKU001" }).click();
    await page.getByRole("button", { name: "Change quantity" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit quantity for SKU001" });
    await expect(dialog.getByLabel("Final quantity")).toHaveValue("750");

    await dialog.getByLabel("Final quantity").fill("abc");
    await dialog.getByRole("button", { name: "Save edit" }).click();
    expect(writes.count).toBe(0);

    await dialog.getByLabel(/Reason/).selectOption("known_event");
    await dialog.getByLabel("Final quantity").fill("-5");
    await dialog.getByRole("button", { name: "Save edit" }).click();
    await expect(dialog.getByText("Quantity must be a whole number, 0 or more.")).toBeVisible();
    await dialog.getByLabel("Final quantity").fill("1".repeat(300));
    await dialog.getByRole("button", { name: "Save edit" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(writes.count).toBeLessThanOrEqual(1); // a 300-digit number may reach the server, which rejects it

    await dialog.getByLabel("Final quantity").fill("600");
    await dialog.getByLabel(/Note/).fill("Diwali stock already ordered by the depot");
    await dialog.getByRole("button", { name: "Save edit" }).click();
    await expect(page.getByText("SKU001 edited to 600.")).toBeVisible();
    await page.keyboard.press("Escape");
    await tab(page, "Decided").click();
    await expect(item(page, "SKU001")).toContainText("Changed");
    await expect(item(page, "SKU001")).toContainText("→ 600");

    await tab(page, "To decide").click();
    await page.getByRole("button", { name: "Open details for SKU007" }).click();
    await page.getByRole("dialog", { name: "Freshroots Coconut Water 330ml" }).getByRole("button", { name: "Reject" }).click();
    const rej = page.getByRole("dialog", { name: "Reject recommendation for SKU007" });
    await expect(rej.getByLabel(/Reason/)).toBeFocused();
    await rej.getByLabel(/Reason/).selectOption("rule_too_strict");
    await rej.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("SKU007 rejected.")).toBeVisible();
  });

  test("bulk approve skips judgement SKUs; send releases approved and changed rows", async ({ page }) => {
    await page.goto("/queue");
    await page.getByLabel("Select all 5 straightforward SKUs").check();
    await page.getByRole("button", { name: "Approve 5 selected" }).click();
    await expect(page.getByText("Approved 5.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send 6 to procurement" })).toBeEnabled();
    await expect(page.getByText("All done. Every SKU has a decision.")).toBeVisible();

    // Cancelling the confirmation sends nothing.
    await page.getByRole("button", { name: "Send 6 to procurement" }).click();
    await expect(page.getByRole("button", { name: "Send 6 to procurement" })).toBeEnabled();

    page.removeAllListeners("dialog");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Send 6 to procurement" }).click();
    await expect(page.getByText("Sent 6 order lines to procurement.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send 0 to procurement" })).toBeDisabled();
    await tab(page, "Decided").click();
    await expect(item(page, "SKU003")).toContainText("Sent to procurement");

    await page.goto("/overview");
    await expect(page.getByRole("link", { name: /Plan sent/ })).toBeVisible();
  });

  test("rerun after sending is blocked with a clear message", async ({ page }) => {
    await page.goto("/data");
    await page.getByRole("button", { name: "Run planning" }).click();
    await expect(page.getByText(/already been released to procurement/)).toBeVisible();
  });

  test("backtest replays five weeks", async ({ page }) => {
    await page.goto("/backtest");
    await page.getByRole("button", { name: "Run backtest" }).click();
    await expect(page.getByText("2026-W38")).toBeVisible({ timeout: 30_000 });
    const week42 = page.getByRole("row", { name: /^2026-W42 19 Oct 2026/ });
    await expect(week42).toContainText("Full rules");
    await expect(week42.getByRole("cell").last()).toHaveText("7");
  });

  test("rules: saving creates a new version and validates", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Version 1 (active)")).toBeVisible();
    await page.getByLabel("Average window (weeks)").fill("3");
    await page.getByRole("button", { name: "Save as new version" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByLabel("Festival uplift (%)").fill("30");
    await page.getByRole("button", { name: "Save as new version" }).click();
    await expect(page.getByText("Saved as version 2. New runs will use it.")).toBeVisible();
    await expect(page.getByText("Version 2 (active)")).toBeVisible();
    await expect(page.getByText(/demand = avg12 × 1.3/)).toBeVisible();
  });
});

test.describe("procurement", () => {
  test.use({ storageState: authFile("procurement"), acceptDownloads: true });

  test("sees only released final quantities and exports an escaped CSV", async ({ page }) => {
    await page.goto("/procurement");
    await expect(page.getByRole("row")).toHaveCount(7); // header + 6 lines
    await expect(page.getByRole("row").filter({ hasText: "SKU001" })).toContainText("600");
    await expect(page.getByRole("row").filter({ hasText: "SKU007" })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: "SKU006" })).toContainText("Pause / do not order");
    await expect(page.getByText("Diwali")).toHaveCount(0); // planner notes never shown

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    const csv = readFileSync(await download.path(), "utf8");
    const lines = csv.trim().split(/\r\n/);
    expect(lines[0]).toBe("Released_At,SKU_ID,SKU_Name,Distributor_ID,Action,Final_Qty");
    expect(lines).toHaveLength(7);
    expect(lines.some((l) => l.includes("SKU001") && l.endsWith(",600"))).toBe(true);
    for (const cell of lines.flatMap((l) => l.split(","))) expect(cell).not.toMatch(/^[=+\-@]/);
  });

  test("cannot reach planner screens", async ({ page }) => {
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/procurement$/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/procurement$/);
  });
});

test.describe("viewer", () => {
  test.use({ storageState: authFile("viewer") });

  test("dashboard shows metrics and three kill-criteria lights", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Kill criteria" })).toBeVisible();
    const lights = page.getByRole("listitem").filter({ hasText: /Backtest agreement|Planner override rate|Combined stockout/ });
    await expect(lights).toHaveCount(3);
    await expect(page.getByText("Accept rate")).toBeVisible();
    // 7 decided: 5 approved, 1 edited, 1 rejected → 71.4% accepted, 28.6% overridden.
    await expect(page.getByText("71.4%")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "28.6%" })).toBeVisible();
  });

  test("cannot reach planner or procurement screens", async ({ page }) => {
    for (const p of ["/overview", "/queue", "/data", "/upload", "/procurement"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
  });
});
