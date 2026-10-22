import { execFileSync } from "node:child_process";
import { test as teardown } from "@playwright/test";
import { TEMP_USERS } from "./auth";

teardown("delete temporary role users", async () => {
  teardown.skip(process.env.E2E_ALLOW_WRITES !== "1", "No temporary users were created");
  for (const username of Object.values(TEMP_USERS)) {
    execFileSync("npx", ["tsx", "--env-file=.env.local", "scripts/delete-user.ts", username], { stdio: "ignore" });
  }
});
