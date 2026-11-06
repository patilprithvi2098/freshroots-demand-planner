// Loading and not-found screens, and the reduced-motion setting.
import { expect, test } from "@playwright/test";
import { authFile, hasSession } from "./auth";

test("an unknown address shows a page with a way back", async ({ page }) => {
  const res = await page.goto("/login/no-such-screen");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the planner" })).toBeVisible();
});

test.describe("signed in", () => {
  test.use({ storageState: authFile("planner") });
  test.skip(!hasSession("planner"), "No planner session");

  async function slowNavigation(page: import("@playwright/test").Page) {
    await page.goto("/overview");
    await page.route("**/queue**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByRole("link", { name: /^Review/ }).first().click();
    return page.getByTestId("page-loading");
  }

  test("moving to a slow screen shows a loading state at once, then the screen", async ({ page }) => {
    const loading = await slowNavigation(page);
    await expect(loading).toBeVisible();
    await expect(page).toHaveURL(/\/queue/, { timeout: 15_000 });
    await expect(loading).toBeHidden({ timeout: 15_000 });
  });

  test("the loading state doesn't pulse when the system asks for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const loading = await slowNavigation(page);
    await expect(loading).toBeVisible();
    const animation = await loading.locator("[aria-hidden] div").first().evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });
});
