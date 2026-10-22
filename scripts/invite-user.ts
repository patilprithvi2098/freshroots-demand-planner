// Create (or update) a user who signs in with a username and password, and set their role.
// The password is read from NEW_USER_PASSWORD so it never lands in the repo or in argv.
// Usage: NEW_USER_PASSWORD='…' npm run invite -- raghav planner
import { emailForUsername, normaliseUsername, USERNAME_PATTERN } from "../lib/usernames";
import { adminClient } from "./_admin";

const ROLES = ["planner", "procurement", "viewer"] as const;

async function main() {
  const [rawUsername, role] = process.argv.slice(2);
  const password = process.env.NEW_USER_PASSWORD;
  const username = normaliseUsername(rawUsername ?? "");
  if (!USERNAME_PATTERN.test(username) || !ROLES.includes(role as (typeof ROLES)[number]) || !password) {
    console.error("Usage: NEW_USER_PASSWORD='…' npm run invite -- <username> <planner|procurement|viewer>");
    process.exit(1);
  }
  const email = emailForUsername(username);
  const db = adminClient();
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);
  let userId: string;
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, { password, app_metadata: { role } });
    if (error) throw error;
    userId = existing.id;
  } else {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role } });
    if (error) throw error;
    userId = data.user.id;
  }
  // Roles change only through the service role; there is no client-side policy to update them.
  const { error: pErr } = await db.from("profiles").upsert({ id: userId, email, role });
  if (pErr) throw pErr;
  console.log(`${username} is a ${role} and can sign in at /login.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
