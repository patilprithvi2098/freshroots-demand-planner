import { readFileSync } from "node:fs";

export type Role = "planner" | "procurement" | "viewer";
export const authFile = (role: Role) => `playwright/.auth/${role}.json`;

/** True when auth.setup signed this role in (its session file has cookies). */
export function hasSession(role: Role): boolean {
  try {
    return JSON.parse(readFileSync(authFile(role), "utf8")).cookies.length > 0;
  } catch {
    return false;
  }
}

/** Temporary role users created by auth.setup.ts and deleted by auth.teardown.ts. */
export const TEMP_USERS = { procurement: "e2e-procurement", viewer: "e2e-viewer" } as const;
