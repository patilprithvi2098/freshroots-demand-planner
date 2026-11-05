// Ordering end to end: Raghav releases, procurement previews, then creates and issues POs in Zoho.
// Runs against the LOCAL Zoho mock only (playwright.config.ts starts it and points the app at it), and a
// DEVELOPMENT database. Skipped unless E2E_ALLOW_WRITES=1 and E2E_SUPABASE_REF are set.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { authFile, hasSession } from "./auth";
import { guardDialogs } from "./helpers";

const allowed = process.env.E2E_ALLOW_WRITES === "1" && !!process.env.E2E_SUPABASE_REF;
test.describe.configure({ mode: "serial" });
test.skip(
  !allowed || !hasSession("planner") || !hasSession("procurement"),
  "Set E2E_ALLOW_WRITES=1 and E2E_SUPABASE_REF to run the ordering test on a dev project.",
);

const MOCK = "http://localhost:4010";

test.beforeAll(async () => {
  execFileSync("npx", ["tsx", "--env-file=.env.local", "scripts/e2e-reset.ts"], { stdio: "inherit", env: process.env });
  // Belt and braces: the app must be talking to the mock, not a real Zoho organisation.
  const res = await fetch(`${MOCK}/__test/state`);
  expect(res.ok).toBe(true);
});

test.describe("planner releases", () => {
  test.use({ storageState: authFile("planner") });
  test.beforeEach(({ page }) => guardDialogs(page));

  test("plan, change one quantity well above the cap, approve the rest, send", async ({ page }) => {
    await page.goto("/overview");
    await page.getByRole("button", { name: "Run planning" }).click();
    const confirm = page.getByRole("button", { name: "Yes, plan" });
    if (await confirm.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await confirm.click();
    await expect(page.getByText(/7 SKUs flagged/)).toBeVisible({ timeout: 60_000 });

    // SKU003's standard quantity is 300; 1,000 is above 3× and must be confirmed by procurement.
    await page.goto("/queue");
    await page.getByRole("button", { name: "Open details for SKU003" }).click();
    await page.getByRole("dialog", { name: "Freshroots Brown Rice 1kg" }).getByRole("button", { name: "Change quantity", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit quantity for SKU003" });
    await dialog.getByLabel("Final quantity").fill("1000");
    await dialog.getByLabel(/Reason/).selectOption("known_event");
    await dialog.getByRole("button", { name: "Save edit" }).click();
    await expect(page.getByText("SKU003 edited to 1,000.")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel(/Select all \d+ straightforward SKUs/).check();
    await page.getByRole("button", { name: /Approve \d+ selected/ }).click();
    await expect(page.getByText(/Approved \d+\./)).toBeVisible();
    page.removeAllListeners("dialog");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /^Send \d+ to procurement/ }).click();
    await expect(page.getByText(/Sent \d+ order lines to procurement\./)).toBeVisible();

    // Raghav sees status but doesn't place orders (the brief: procurement places the POs).
    await page.goto("/procurement");
    await expect(page.getByRole("button", { name: /Create and issue in Zoho/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh Zoho status" })).toBeVisible();
  });
});

test.describe("procurement creates and issues", () => {
  test.use({ storageState: authFile("procurement") });

  async function openPreview(page: Page) {
    await page.goto("/procurement");
    await page.getByRole("button", { name: /Create and issue in Zoho \(4\)/ }).click();
    return page.getByRole("dialog", { name: /Issue 3 purchase orders in Zoho\?/ });
  }

  test("preview groups lines per distributor and holds back a quantity above the cap until confirmed", async ({ page }) => {
    const preview = await openPreview(page);
    await expect(preview.getByRole("region", { name: /Order for / })).toHaveCount(3);
    await expect(preview).toContainText("4 lines");
    await expect(preview).toContainText("above 3× standard (300)");
    const issue = preview.getByRole("button", { name: "Issue 3 orders" });
    await expect(issue).toBeDisabled();
    await preview.getByLabel(/I've checked the 1 highlighted quantity/).check();
    await expect(issue).toBeEnabled();
    // Cancel sends nothing.
    await preview.getByRole("button", { name: "Cancel" }).click();
    const state = (await (await fetch(`${MOCK}/__test/state`)).json()) as unknown[];
    expect(state).toHaveLength(0);
  });

  test("issue: one PO per distributor, issued straight away, recorded on every line", async ({ page }) => {
    const preview = await openPreview(page);
    await preview.getByLabel(/I've checked the 1 highlighted quantity/).check();
    await preview.getByRole("button", { name: "Issue 3 orders" }).click();
    await expect(page.getByText(/Issued 3 purchase orders in Zoho Inventory \(PO-00001, PO-00002, PO-00003\)/)).toBeVisible({ timeout: 30_000 });

    const state = (await (await fetch(`${MOCK}/__test/state`)).json()) as { status: string; line_items: { quantity: number }[] }[];
    expect(state).toHaveLength(3);
    expect(state.every((p) => p.status === "issued")).toBe(true);
    expect(state.flatMap((p) => p.line_items.map((l) => l.quantity)).sort((a, b) => a - b)).toEqual([120, 150, 500, 1000]);

    await expect(page.getByText("Issued", { exact: true })).toHaveCount(4);
    // Nothing left to order: a second click can't send them again.
    await expect(page.getByRole("button", { name: /Create and issue in Zoho \(0\)/ })).toBeDisabled();
  });

  test("a delivery recorded in Zoho comes back with its date", async ({ page }) => {
    const r = await fetch(`${MOCK}/__test/receive?po_number=PO-00001&date=2026-10-28`, { method: "POST" });
    expect(r.ok).toBe(true);
    await page.goto("/procurement");
    await page.getByRole("button", { name: "Refresh Zoho status" }).click();
    await expect(page.getByText(/line\(s\) changed status/)).toBeVisible();
    await page.reload();
    await expect(page.getByText("Received 28 Oct 2026").first()).toBeVisible();
  });
});
