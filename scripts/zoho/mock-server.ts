// Local Zoho Inventory mock server, so the PO flow can be tried before a Zoho account exists.
//
//   npx tsx scripts/zoho/mock-server.ts            # listens on http://localhost:4010
//
// Then in .env.local:
//   ZOHO_API_BASE=http://localhost:4010
//   ZOHO_ACCOUNTS_BASE=http://localhost:4010
//   ZOHO_CLIENT_ID=mock  ZOHO_CLIENT_SECRET=mock  ZOHO_REFRESH_TOKEN=mock  ZOHO_ORG_ID=60000000001

import { createServer } from "node:http";
import { handleZoho, newMockState } from "./mock";

const port = Number(process.env.PORT ?? 4010);
const state = newMockState();

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    const r = handleZoho(state, req.method ?? "GET", `http://localhost:${port}${req.url}`, headers, body || null);
    console.log(`${req.method} ${req.url?.split("?")[0]} → ${r.status}`);
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r.json));
  });
}).listen(port, () => console.log(`Zoho Inventory mock on http://localhost:${port}`));
