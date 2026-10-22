// Create a user who can sign in with a magic link, with a role.
// Usage: npm run invite -- raghav@freshroots.in planner
import { adminClient } from "./_admin";

const ROLES = ["planner", "procurement", "viewer"] as const;

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !ROLES.includes(role as (typeof ROLES)[number])) {
    console.error("Usage: npm run invite -- <email> <planner|procurement|viewer>");
    process.exit(1);
  }
  const db = adminClient();
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, app_metadata: { role } });
  let userId = data.user?.id;
  if (error) {
    if (!/already/i.test(error.message)) throw error;
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    userId = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  }
  if (!userId) throw new Error("User not found after create");
  // Role changes go through the service role only; there is no client-side policy to update roles.
  const { error: pErr } = await db.from("profiles").upsert({ id: userId, email, role });
  if (pErr) throw pErr;
  console.log(`${email} is a ${role}. They can sign in at /login with a magic link.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
