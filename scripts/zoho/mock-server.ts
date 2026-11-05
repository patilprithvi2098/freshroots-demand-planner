// Local Zoho Inventory mock server, so the PO flow can be tried before a Zoho account exists.
//
//   npx tsx scripts/zoho/mock-server.ts            # listens on http://localhost:4010
//
// Then in .env.local:
//   ZOHO_API_BASE=http://localhost:4010
//   ZOHO_ACCOUNTS_BASE=http://localhost:4010
//   ZOHO_CLIENT_ID=mock  ZOHO_CLIENT_SECRET=mock  ZOHO_REFRESH_TOKEN=mock  ZOHO_ORG_ID=60000000001

import { createServer } from "node:http";
import { handleZoho, mockReceive, newMockState } from "./mock";

const port = Number(process.env.PORT ?? 4010);
const state = newMockState();
// MOCK_ZOHO_LENIENT=1: accept any vendor/item id (browser tests run against a database linked to real Zoho ids).
state.lenient = process.env.MOCK_ZOHO_LENIENT === "1";

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    const url = new URL(`http://localhost:${port}${req.url}`);
    // Test-only hooks, never part of the Zoho API: record a delivery, or read the state.
    if (url.pathname === "/__test/receive" && req.method === "POST") {
      const po = state.purchaseorders.find((p) => p.purchaseorder_number === url.searchParams.get("po_number"));
      if (po) mockReceive(state, po.purchaseorder_id, url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10));
      res.writeHead(po ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: Boolean(po) }));
      return;
    }
    if (url.pathname === "/__test/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.purchaseorders));
      return;
    }
    const r = handleZoho(state, req.method ?? "GET", url.toString(), headers, body || null);
    console.log(`${req.method} ${req.url?.split("?")[0]} → ${r.status}`);
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r.json));
  });
}).listen(port, () => console.log(`Zoho Inventory mock on http://localhost:${port}`));
