// In-memory stand-in for the parts of Zoho Inventory the app uses: OAuth refresh, organizations,
// items, vendors and purchase orders. Shapes follow the Zoho Inventory v1 API ({ code: 0, ... }).
// Used by tests (as a fetch implementation) and by scripts/zoho/mock-server.ts for local runs.

export interface MockState {
  items: { item_id: string; name: string; sku: string; rate: number; purchase_rate: number; unit: string }[];
  contacts: { contact_id: string; contact_name: string; company_name: string; contact_type: string }[];
  purchaseorders: {
    purchaseorder_id: string;
    purchaseorder_number: string;
    reference_number: string;
    vendor_id: string;
    date: string;
    delivery_date: string;
    status: string;
    line_items: { item_id: string; quantity: number; rate?: number }[];
  }[];
  tokensIssued: number;
  /** Test hooks: fail the next N purchase-order creates with HTTP 500 / force a 429 once. */
  failNextCreates: number;
  rateLimitOnce: boolean;
}

export const MOCK_ORG_ID = "60000000001";
export const MOCK_TOKEN = "mock-access-token";

export function newMockState(): MockState {
  return { items: [], contacts: [], purchaseorders: [], tokensIssued: 0, failNextCreates: 0, rateLimitOnce: false };
}

type Reply = { status: number; json: unknown };
const ok = (json: Record<string, unknown>): Reply => ({ status: 200, json: { code: 0, message: "success", ...json } });
const err = (status: number, code: number, message: string): Reply => ({ status, json: { code, message } });

export function handleZoho(state: MockState, method: string, rawUrl: string, headers: Record<string, string>, body: string | null): Reply {
  const url = new URL(rawUrl);
  if (url.pathname === "/oauth/v2/token") {
    const form = new URLSearchParams(body ?? "");
    if (!form.get("client_id") || !form.get("client_secret")) return { status: 400, json: { error: "invalid_client" } };
    state.tokensIssued++;
    return { status: 200, json: { access_token: MOCK_TOKEN, expires_in: 3600, api_domain: "https://www.zohoapis.in", token_type: "Bearer" } };
  }
  if (!url.pathname.startsWith("/inventory/v1/")) return err(404, 5, "Invalid URL Passed");
  if (headers.authorization !== `Zoho-oauthtoken ${MOCK_TOKEN}`) return err(401, 57, "You are not authorized to perform this operation");
  const path = url.pathname.slice("/inventory/v1".length);
  if (path === "/organizations") return ok({ organizations: [{ organization_id: MOCK_ORG_ID, name: "Freshroots (mock)" }] });
  if (url.searchParams.get("organization_id") !== MOCK_ORG_ID) return err(400, 6041, "Organization does not exist");
  if (state.rateLimitOnce) {
    state.rateLimitOnce = false;
    return err(429, 44, "Too many requests");
  }
  const data = body ? JSON.parse(body) : {};
  const page = (key: string, rows: unknown[]) => {
    const p = Number(url.searchParams.get("page") ?? 1);
    const per = Number(url.searchParams.get("per_page") ?? 200);
    return ok({ [key]: rows.slice((p - 1) * per, p * per), page_context: { page: p, per_page: per, has_more_page: p * per < rows.length } });
  };

  if (path === "/items" && method === "GET") return page("items", state.items);
  if (path === "/items" && method === "POST") {
    if (state.items.some((i) => i.sku === data.sku)) return err(400, 1001, `Item with SKU ${data.sku} already exists`);
    const item = { item_id: String(4_000_000 + state.items.length + 1), ...data };
    state.items.push(item);
    return ok({ item });
  }
  if (path === "/contacts" && method === "GET") {
    const type = url.searchParams.get("contact_type");
    return page("contacts", state.contacts.filter((c) => !type || c.contact_type === type));
  }
  if (path === "/contacts" && method === "POST") {
    const contact = { contact_id: String(3_000_000 + state.contacts.length + 1), ...data };
    state.contacts.push(contact);
    return ok({ contact });
  }
  if (path === "/purchaseorders" && method === "GET") {
    const ref = url.searchParams.get("reference_number");
    return page("purchaseorders", state.purchaseorders.filter((p) => !ref || p.reference_number === ref));
  }
  if (path === "/purchaseorders" && method === "POST") {
    if (state.failNextCreates > 0) {
      state.failNextCreates--;
      return err(500, 9999, "Internal error");
    }
    if (!state.contacts.some((c) => c.contact_id === data.vendor_id && c.contact_type === "vendor")) return err(400, 4001, "Invalid vendor");
    for (const l of data.line_items ?? []) {
      if (!state.items.some((i) => i.item_id === l.item_id)) return err(400, 1002, `Item ${l.item_id} does not exist`);
      if (!(l.quantity > 0)) return err(400, 1003, "Quantity must be greater than zero");
    }
    const po = {
      purchaseorder_id: String(5_000_000 + state.purchaseorders.length + 1),
      purchaseorder_number: `PO-${String(state.purchaseorders.length + 1).padStart(5, "0")}`,
      status: "draft",
      ...data,
    };
    state.purchaseorders.push(po);
    return ok({ purchaseorder: po });
  }
  const m = /^\/purchaseorders\/(\w+)$/.exec(path);
  if (m && method === "GET") {
    const po = state.purchaseorders.find((p) => p.purchaseorder_id === m[1]);
    return po ? ok({ purchaseorder: po }) : err(404, 1004, "Purchase order not found");
  }
  return err(404, 5, "Invalid URL Passed");
}

/** A fetch implementation backed by the mock, for tests. */
export function mockFetch(state: MockState): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const r = handleZoho(state, init?.method ?? "GET", String(input), headers, (init?.body as string | undefined) ?? null);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
