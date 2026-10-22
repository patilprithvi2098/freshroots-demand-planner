import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test as setup, type Page } from "@playwright/test";
import { authFile, TEMP_USERS } from "./auth";

// Sign-in goes through the real login form.
// - Planner: E2E_USERNAME (default "raghav") and E2E_PASSWORD from the environment, never committed.
// - Procurement and viewer: temporary users created only when E2E_ALLOW_WRITES=1, with a random
//   password that is never stored. auth.teardown.ts deletes them.
const writes = process.env.E2E_ALLOW_WRITES === "1";

mkdirSync("playwright/.auth", { recursive: true });

async function signIn(page: Page, username: string, password: string, home: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${home}$`));
}

setup("sign in as planner", async ({ page }) => {
  const password = process.env.E2E_PASSWORD;
  setup.skip(!password, "Set E2E_PASSWORD (and optionally E2E_USERNAME) to sign in as the planner");
  await signIn(page, process.env.E2E_USERNAME ?? "raghav", password!, "/queue");
  await page.context().storageState({ path: authFile("planner") });
});

for (const [role, username] of Object.entries(TEMP_USERS)) {
  setup(`sign in as temporary ${role}`, async ({ page }) => {
    // Without a session file, specs for this role skip themselves.
    writeFileSync(authFile(role as keyof typeof TEMP_USERS), JSON.stringify({ cookies: [], origins: [] }));
    setup.skip(!writes, "Temporary role users are only created when E2E_ALLOW_WRITES=1");
    const password = randomBytes(18).toString("base64url");
    execFileSync("npx", ["tsx", "--env-file=.env.local", "scripts/invite-user.ts", username, role], {
      env: { ...process.env, NEW_USER_PASSWORD: password },
      stdio: "ignore",
    });
    await signIn(page, username, password, role === "procurement" ? "/procurement" : "/dashboard");
    await page.context().storageState({ path: authFile(role as keyof typeof TEMP_USERS) });
  });
}
