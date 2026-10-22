// LOCAL DEVELOPMENT ONLY: print a one-time sign-in link for an existing user,
// so you can test without receiving email. Never run against production.
// Usage: npm run dev-link -- raghav@example.com
import { adminClient } from "./_admin";

async function main() {
  const email = process.argv[2];
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  if (!email) {
    console.error("Usage: npm run dev-link -- <email>");
    process.exit(1);
  }
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) {
    console.error("Refusing: dev-link only works when NEXT_PUBLIC_SITE_URL is localhost.");
    process.exit(1);
  }
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  console.log(`${site}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
