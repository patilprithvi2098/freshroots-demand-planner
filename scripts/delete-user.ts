// Delete a sign-in account (by username or full email). Their past decisions stay in the audit trail.
// Usage: npm run delete-user -- <username-or-email>
import { emailForUsername } from "../lib/usernames";
import { adminClient } from "./_admin";

async function main() {
  const who = process.argv[2];
  if (!who) {
    console.error("Usage: npm run delete-user -- <username-or-email>");
    process.exit(1);
  }
  const email = who.includes("@") ? who.toLowerCase() : emailForUsername(who);
  const db = adminClient();
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    console.log(`No account for ${who}.`);
    return;
  }
  // Keep history: decisions and audit rows reference the user, so null them instead of failing.
  await db.from("recommendations").update({ decided_by: null }).eq("decided_by", user.id);
  await db.from("audit_log").update({ actor: null }).eq("actor", user.id);
  await db.from("upload_batches").update({ uploaded_by: null }).eq("uploaded_by", user.id);
  await db.from("rule_config").update({ created_by: null }).eq("created_by", user.id);
  const { error: delErr } = await db.auth.admin.deleteUser(user.id);
  if (delErr) throw delErr;
  console.log(`Deleted ${who}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
