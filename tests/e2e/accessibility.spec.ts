import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authFile, PUBLIC_PAGES, ROLE_PAGES } from "./pages";

async function audit(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    count: v.nodes.length,
    examples: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.split("\n").slice(1).join(" ").trim()}`),
  }));
  if (summary.length) console.log(`\n[${name}] ${JSON.stringify(summary, null, 2)}`);
  expect(summary, `${name} accessibility violations`).toEqual([]);
}

for (const p of PUBLIC_PAGES) {
  test(`accessibility: ${p.name}`, async ({ page }) => {
    await page.goto(p.path);
    await audit(page, p.name);
  });
}

for (const p of ROLE_PAGES) {
  test.describe(() => {
    test.use({ storageState: authFile(p.role) });
    test(`accessibility: ${p.name} (${p.role})`, async ({ page }) => {
      await page.goto(p.path);
      await audit(page, p.name);
    });
  });
}

test.describe(() => {
  test.use({ storageState: authFile("planner") });
  test("accessibility: queue side panel and override dialog", async ({ page }) => {
    await page.goto("/queue?all=1");
    const first = page.getByRole("button", { name: /^Open details for / }).first();
    test.skip((await first.count()) === 0, "No run in the database yet");
    await first.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await audit(page, "side-panel");
  });
});
