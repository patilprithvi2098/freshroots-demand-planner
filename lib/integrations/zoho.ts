// Zoho Inventory REST client (India data centre by default). Server only: holds OAuth secrets.
// Creates purchase orders as drafts; procurement issues them inside Zoho Inventory.
//
// Env (server only, never NEXT_PUBLIC_):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID
//   ZOHO_DC=in                  accounts.zoho.<dc> / www.zohoapis.<dc>
//   ZOHO_API_BASE, ZOHO_ACCOUNTS_BASE   optional overrides (the local mock in scripts/zoho/mock-server.ts)

import type { PoDraft } from "./zohoPo";

export class ZohoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "ZohoError";
  }
}

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  apiBase: string;
  accountsBase: string;
}

export function zohoConfigFromEnv(env: Record<string, string | undefined> = process.env): ZohoConfig | null {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID } = env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORG_ID) return null;
  const dc = env.ZOHO_DC ?? "in";
  return {
    clientId: ZOHO_CLIENT_ID,
    clientSecret: ZOHO_CLIENT_SECRET,
    refreshToken: ZOHO_REFRESH_TOKEN,
    orgId: ZOHO_ORG_ID,
    apiBase: (env.ZOHO_API_BASE ?? `https://www.zohoapis.${dc}`).replace(/\/$/, ""),
    accountsBase: (env.ZOHO_ACCOUNTS_BASE ?? `https://accounts.zoho.${dc}`).replace(/\/$/, ""),
  };
}

export interface ZohoPurchaseOrder {
  purchaseorder_id: string;
  purchaseorder_number: string;
  reference_number?: string;
  status: string;
  vendor_id?: string;
  date?: string;
  delivery_date?: string;
}

export interface ZohoItem {
  item_id: string;
  name: string;
  sku?: string;
}

export interface ZohoContact {
  contact_id: string;
  contact_name: string;
  contact_type?: string;
}

type Fetch = typeof fetch;

export function createZohoClient(cfg: ZohoConfig, fetchImpl: Fetch = fetch) {
  let token: { value: string; expires: number } | null = null;

  async function accessToken(force = false): Promise<string> {
    if (!force && token && token.expires > Date.now()) return token.value;
    const res = await fetchImpl(`${cfg.accountsBase}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cfg.refreshToken,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      throw new ZohoError(`Zoho token refresh failed: ${body.error ?? res.status}`, res.status, null);
    }
    // Refresh a minute early.
    token = { value: body.access_token, expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
    return token.value;
  }

  async function call<T>(method: "GET" | "POST" | "PUT", path: string, query: Record<string, string> = {}, json?: unknown): Promise<T> {
    const url = new URL(`${cfg.apiBase}/inventory/v1${path}`);
    url.searchParams.set("organization_id", cfg.orgId);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Zoho-oauthtoken ${await accessToken(attempt > 0 && attempt < 2)}`,
          ...(json ? { "Content-Type": "application/json" } : {}),
        },
        body: json ? JSON.stringify(json) : undefined,
      });
      // One retry with a fresh token on 401; short backoff on rate limiting.
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
      if (!res.ok || (body.code != null && body.code !== 0)) {
        throw new ZohoError(`Zoho ${method} ${path}: ${body.message ?? res.statusText}`, res.status, body.code ?? null);
      }
      return body;
    }
  }

  async function listAll<T>(path: string, key: string, query: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const body = await call<Record<string, unknown> & { page_context?: { has_more_page?: boolean } }>("GET", path, {
        ...query,
        page: String(page),
        per_page: "200",
      });
      out.push(...((body[key] as T[]) ?? []));
      if (!body.page_context?.has_more_page) return out;
    }
  }

  return {
    async listOrganizations() {
      const body = await call<{ organizations: { organization_id: string; name: string }[] }>("GET", "/organizations");
      return body.organizations;
    },

    /** Draft purchase order. Zoho numbers it; the reference number makes retries safe. */
    async createPurchaseOrder(po: PoDraft): Promise<ZohoPurchaseOrder> {
      const body = await call<{ purchaseorder: ZohoPurchaseOrder }>("POST", "/purchaseorders", {}, {
        vendor_id: po.vendor_id,
        reference_number: po.reference_number,
        date: po.date,
        delivery_date: po.delivery_date,
        line_items: po.line_items,
        notes: "Created by the Freshroots demand planning assistant after planner approval.",
      });
      return body.purchaseorder;
    },

    async findPurchaseOrderByReference(reference: string): Promise<ZohoPurchaseOrder | null> {
      const body = await call<{ purchaseorders: ZohoPurchaseOrder[] }>("GET", "/purchaseorders", { reference_number: reference });
      return body.purchaseorders.find((p) => p.reference_number === reference) ?? null;
    },

    async getPurchaseOrder(id: string): Promise<ZohoPurchaseOrder> {
      return (await call<{ purchaseorder: ZohoPurchaseOrder }>("GET", `/purchaseorders/${encodeURIComponent(id)}`)).purchaseorder;
    },

    listItems: () => listAll<ZohoItem>("/items", "items"),
    listVendors: () => listAll<ZohoContact>("/contacts", "contacts", { contact_type: "vendor" }),

    async createItem(item: { name: string; sku: string; unit: string; rate: number; purchase_rate: number }) {
      return (await call<{ item: ZohoItem }>("POST", "/items", {}, { ...item, item_type: "inventory", product_type: "goods" })).item;
    },

    /** Update an item's selling and purchase rates. */
    async updateItemRates(itemId: string, rates: { rate: number; purchase_rate: number }) {
      return (await call<{ item: ZohoItem }>("PUT", `/items/${encodeURIComponent(itemId)}`, {}, rates)).item;
    },

    async createVendor(v: { contact_name: string; company_name: string }) {
      return (await call<{ contact: ZohoContact }>("POST", "/contacts", {}, { ...v, contact_type: "vendor" })).contact;
    },
  };
}

export type ZohoClient = ReturnType<typeof createZohoClient>;

/** Create a draft PO unless one with the same reference already exists (a retry after a lost response). */
export async function createPurchaseOrderOnce(client: ZohoClient, po: PoDraft) {
  const existing = await client.findPurchaseOrderByReference(po.reference_number);
  if (existing) return { po: existing, created: false };
  return { po: await client.createPurchaseOrder(po), created: true };
}
