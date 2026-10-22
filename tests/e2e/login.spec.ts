import { expect, test } from "@playwright/test";
import { countWrites, guardDialogs, tabUntil } from "./helpers";

test.describe("login", () => {
  test.beforeEach(({ page }) => guardDialogs(page));

  test("signed-out users are sent to login from any page", async ({ page }) => {
    for (const p of ["/", "/queue", "/dashboard", "/procurement"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/login$/);
    }
    await expect(page.getByRole("heading", { name: "Demand Planning Assistant" })).toBeVisible();
  });

  test("empty fields are blocked before anything is sent", async ({ page }) => {
    await page.goto("/login");
    const writes = countWrites(page, "/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Username").fill("raghav");
    await page.getByRole("button", { name: "Sign in" }).click();
    expect(writes.count).toBe(0);
  });

  test("very long input is cut at the field limit", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("a".repeat(300));
    await expect(page.getByLabel("Username")).toHaveValue("a".repeat(40));
  });

  test("wrong password shows a clear error and clears the password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("raghav");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect username or password.")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("keyboard only: one request on double submit, then the overview", async ({ page }) => {
    const password = process.env.E2E_PASSWORD;
    test.skip(!password, "Set E2E_PASSWORD to test a successful sign-in");
    await page.goto("/login");
    const writes = countWrites(page, "/login");
    expect(await tabUntil(page, 'input[name="username"]')).toBe(true);
    await page.keyboard.type(process.env.E2E_USERNAME ?? "raghav");
    await page.keyboard.press("Tab");
    await page.keyboard.type(password!);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/overview$/);
    expect(writes.count).toBe(1);
  });

  test("an expired link shows a clear message", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=expired&type=magiclink");
    await expect(page).toHaveURL(/\/login\?error=link$/);
    await expect(page.getByText(/That sign-in link is invalid or has expired/)).toBeVisible();
  });
});
