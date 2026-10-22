import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";

// Signs in each test user with a one-time link generated locally (scripts/dev-login-link.ts),
// so no email is sent and no password is used. Sessions are saved per role.
export const USERS = {
  planner: { email: "planner@freshroots.test", home: "/queue" },
  procurement: { email: "procurement@freshroots.test", home: "/procurement" },
  viewer: { email: "viewer@freshroots.test", home: "/dashboard" },
} as const;

mkdirSync("playwright/.auth", { recursive: true });

for (const [role, u] of Object.entries(USERS)) {
  setup(`sign in as ${role}`, async ({ page }) => {
    const link = execFileSync("npx", ["tsx", "--env-file=.env.local", "scripts/dev-login-link.ts", u.email], { encoding: "utf8" })
      .trim()
      .split("\n")
      .pop()!;
    const url = new URL(link);
    await page.goto(`${url.pathname}${url.search}`);
    await expect(page).toHaveURL(new RegExp(`${u.home}$`));
    await page.context().storageState({ path: `playwright/.auth/${role}.json` });
  });
}
