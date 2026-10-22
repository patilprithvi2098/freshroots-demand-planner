import { expect, test } from "@playwright/test";
import { hasHorizontalOverflow } from "./helpers";
import { authFile, hasSession, ROLE_PAGES } from "./pages";

// Wide tables scroll inside their own box; the page itself must never scroll sideways.
for (const p of ROLE_PAGES) {
  test.describe(() => {
    test.use({ storageState: authFile(p.role) });
    test(`no horizontal page overflow: ${p.name}`, async ({ page }) => {
      test.skip(!hasSession(p.role), `No ${p.role} session`);
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });
}
