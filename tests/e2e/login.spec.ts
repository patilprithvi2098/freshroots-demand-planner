import { expect, test } from "@playwright/test";
import { guardDialogs, stubWrites, tabUntil } from "./helpers";

test.describe("login", () => {
  test.beforeEach(({ page }) => guardDialogs(page));

  test("signed-out users are sent to login from any page", async ({ page }) => {
    for (const p of ["/", "/queue", "/dashboard", "/procurement"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/login$/);
    }
    await expect(page.getByRole("heading", { name: "Demand Planning Assistant" })).toBeVisible();
  });

  test("empty and invalid email are blocked before anything is sent", async ({ page }) => {
    const otp = await stubWrites(page, "**/auth/v1/otp**");
    await page.goto("/login");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByLabel("Work email").fill(`${"a".repeat(300)}@`);
    await page.keyboard.press("Enter");
    expect(otp.count).toBe(0);
  });

  test("valid email shows a confirmation, keyboard only, one request on double submit", async ({ page }) => {
    const otp = await stubWrites(page, "**/auth/v1/otp**", { delayMs: 800, body: {} });
    await page.goto("/login");
    expect(await tabUntil(page, "#email")).toBe(true);
    await page.keyboard.type("raghav@freshroots.test");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Check raghav@freshroots.test for a sign-in link");
    expect(otp.count).toBe(1);
  });

  test("an expired link shows a clear message", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=expired&type=magiclink");
    await expect(page).toHaveURL(/\/login\?error=link$/);
    await expect(page.getByText("That sign-in link is invalid or has expired.")).toBeVisible();
  });
});
