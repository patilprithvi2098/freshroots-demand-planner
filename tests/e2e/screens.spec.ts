import { test } from "@playwright/test";
import { authFile, PUBLIC_PAGES, ROLE_PAGES } from "./pages";

// Full-page screenshots for a visual design review. Run on demand:
//   npx playwright test tests/e2e/screens.spec.ts --project=chrome
const WIDTHS = [375, 768, 1440];
const run = process.env.SCREENS === "1";

for (const p of [...PUBLIC_PAGES.map((x) => ({ ...x, role: null })), ...ROLE_PAGES]) {
  test.describe(() => {
    if (p.role) test.use({ storageState: authFile(p.role) });
    for (const w of WIDTHS) {
      test(`screenshot: ${p.name} at ${w}px`, async ({ page }) => {
        test.skip(!run, "Set SCREENS=1 to capture screenshots");
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(p.path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `test-results/screens/${p.name}-${w}.png`, fullPage: true });
      });
    }
  });
}
