// One-time: exchange a Zoho Self Client grant code for a refresh token and save it to .env.local.
// Secrets are read from and written to .env.local only; nothing secret is printed.
//
// 1. In https://api-console.zoho.in → Self Client → Generate Code, scope:
//      ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.items.ALL,ZohoInventory.contacts.ALL,ZohoInventory.settings.READ
// 2. Put these three lines in .env.local (the code expires in minutes, so run step 3 straight away):
//      ZOHO_CLIENT_ID=...
//      ZOHO_CLIENT_SECRET=...
//      ZOHO_GRANT_CODE=...
// 3. npx tsx scripts/zoho/connect.ts
//
// Later, to pick up an organization created after connecting (no new code needed):
//    npx tsx scripts/zoho/connect.ts --orgs-only

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const file = path.join(__dirname, "..", "..", ".env.local");
const text = readFileSync(file, "utf8");
const env = Object.fromEntries(
  text
    .split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);

function setVar(src: string, name: string, value: string | null): string {
  const re = new RegExp(`^\\s*${name}\\s*=.*$\\n?`, "m");
  const without = src.replace(re, "");
  return value == null ? without : `${without.replace(/\n*$/, "\n")}${name}=${value}\n`;
}

async function main() {
  const dc = env.ZOHO_DC || "in";
  const accounts = env.ZOHO_ACCOUNTS_BASE || `https://accounts.zoho.${dc}`;
  const api = env.ZOHO_API_BASE || `https://www.zohoapis.${dc}`;
  const orgsOnly = process.argv.includes("--orgs-only");
  const needed = orgsOnly ? ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"] : ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_GRANT_CODE"];
  for (const k of needed) {
    if (!env[k]) throw new Error(`${k} is missing from .env.local (see the comment at the top of this script).`);
  }

  const res = await fetch(`${accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(
      orgsOnly
        ? { grant_type: "refresh_token", client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, refresh_token: env.ZOHO_REFRESH_TOKEN }
        : { grant_type: "authorization_code", client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, code: env.ZOHO_GRANT_CODE },
    ).toString(),
  });
  const body = (await res.json()) as { refresh_token?: string; access_token?: string; error?: string };
  if (!body.access_token || (!orgsOnly && !body.refresh_token)) {
    throw new Error(
      orgsOnly
        ? `Zoho refused the saved refresh token (${body.error ?? res.status}). Generate a new grant code and run without --orgs-only.`
        : `Zoho refused the grant code (${body.error ?? res.status}). Codes expire after a few minutes: generate a new one and rerun.`,
    );
  }

  let out = text;
  if (!orgsOnly) {
    out = setVar(out, "ZOHO_GRANT_CODE", null);
    out = setVar(out, "ZOHO_REFRESH_TOKEN", body.refresh_token!);
  }
  out = setVar(out, "ZOHO_DC", dc);

  const orgs = (await (
    await fetch(`${api}/inventory/v1/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${body.access_token}` } })
  ).json()) as { organizations?: { organization_id: string; name: string }[]; message?: string };
  const list = orgs.organizations ?? [];
  console.log("Zoho Inventory organizations:");
  for (const o of list) console.log(`  ${o.organization_id}  ${o.name}`);
  if (list.length === 0) {
    console.log(`  (none${orgs.message ? `: Zoho says "${orgs.message}"` : ""})`);
    console.log("Finish the organization setup at https://inventory.zoho.in, then run scripts/zoho/connect.ts --orgs-only.");
  } else if (list.length === 1 && !env.ZOHO_ORG_ID) out = setVar(out, "ZOHO_ORG_ID", list[0].organization_id);
  else if (!env.ZOHO_ORG_ID) console.log("Several organizations: set ZOHO_ORG_ID in .env.local to the test one.");

  writeFileSync(file, out);
  if (!orgsOnly) console.log("Saved ZOHO_REFRESH_TOKEN (not shown) and removed ZOHO_GRANT_CODE from .env.local.");
  if (out.includes("ZOHO_ORG_ID=") && !text.includes("ZOHO_ORG_ID=")) console.log("Saved ZOHO_ORG_ID.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
