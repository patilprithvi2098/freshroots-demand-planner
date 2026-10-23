import { beforeEach, describe, expect, it } from "vitest";
import { createPurchaseOrderOnce, createZohoClient, zohoConfigFromEnv, ZohoError, type ZohoClient } from "@/lib/integrations/zoho";
import { planPurchaseOrders, poReference, type ReleasedLine } from "@/lib/integrations/zohoPo";
import { MOCK_ORG_ID, mockFetch, newMockState, type MockState } from "@/scripts/zoho/mock";

const line = (over: Partial<ReleasedLine>): ReleasedLine => ({
  recommendation_id: "r1",
  sku_id: "SKU001",
  sku_name: "Mango Drink",
  distributor_id: "DIST001",
  final_qty: 500,
  zoho_item_id: "I1",
  zoho_vendor_id: "V1",
  lead_time_days: 7,
  unit_price: 20,
  zoho_po_id: null,
  ...over,
});

describe("planPurchaseOrders", () => {
  const opts = { asOfDate: "2026-10-19", orderDate: "2026-10-20" };

  it("one PO per vendor, lines sorted by SKU, delivery date from the slowest lead time", () => {
    const plan = planPurchaseOrders(
      [
        line({ recommendation_id: "r3", sku_id: "SKU004", zoho_item_id: "I4", distributor_id: "DIST002", zoho_vendor_id: "V2", final_qty: 150 }),
        line({ recommendation_id: "r2", sku_id: "SKU003", zoho_item_id: "I3", lead_time_days: 14, final_qty: 300 }),
        line({}),
      ],
      opts,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.orders).toHaveLength(2);
    const v1 = plan.orders.find((o) => o.vendor_id === "V1")!;
    expect(v1.line_items.map((l) => [l.item_id, l.quantity])).toEqual([
      ["I1", 500],
      ["I3", 300],
    ]);
    expect(v1.delivery_date).toBe("2026-11-03");
    expect(v1.date).toBe("2026-10-20");
    expect(v1.recommendation_ids).toEqual(["r1", "r2"]);
  });

  it("never orders pauses (qty 0) or lines that already have a PO", () => {
    const plan = planPurchaseOrders([line({ final_qty: 0 }), line({ recommendation_id: "r2", zoho_po_id: "PO9" })], opts);
    expect(plan.orders).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["zero_qty", "already_ordered"]);
  });

  it("reports unmapped SKUs and distributors instead of guessing", () => {
    const plan = planPurchaseOrders(
      [line({ zoho_item_id: null }), line({ recommendation_id: "r2", zoho_vendor_id: null }), line({ recommendation_id: "r3", distributor_id: null })],
      opts,
    );
    expect(plan.orders).toEqual([]);
    expect(plan.problems.map((p) => p.reason).sort()).toEqual(["missing_distributor", "missing_zoho_item", "missing_zoho_vendor"]);
  });

  it("reference: stable for the same lines, new for lines released later, within Zoho's 50 characters", () => {
    expect(poReference("2026-10-19", "DIST001", ["b", "a"])).toBe(poReference("2026-10-19", "DIST001", ["a", "b"]));
    expect(poReference("2026-10-19", "DIST001", ["a", "c"])).not.toBe(poReference("2026-10-19", "DIST001", ["a", "b"]));
    expect(poReference("2026-10-19", "D".repeat(80), ["a"]).length).toBeLessThanOrEqual(50);
  });
});

describe("Zoho Inventory client (against the mock)", () => {
  let state: MockState;
  let client: ZohoClient;

  beforeEach(async () => {
    state = newMockState();
    const cfg = zohoConfigFromEnv({
      ZOHO_CLIENT_ID: "id",
      ZOHO_CLIENT_SECRET: "secret",
      ZOHO_REFRESH_TOKEN: "refresh",
      ZOHO_ORG_ID: MOCK_ORG_ID,
      ZOHO_API_BASE: "http://zoho.test",
      ZOHO_ACCOUNTS_BASE: "http://zoho.test",
    })!;
    client = createZohoClient(cfg, mockFetch(state));
    const vendor = await client.createVendor({ contact_name: "NutriFlow", company_name: "NutriFlow Distributors" });
    const item = await client.createItem({ name: "Mango Drink", sku: "SKU001", unit: "Units", rate: 25, purchase_rate: 20 });
    expect([vendor.contact_id, item.item_id]).toEqual(["3000001", "4000001"]);
  });

  const draft = () =>
    planPurchaseOrders([line({ zoho_item_id: "4000001", zoho_vendor_id: "3000001" })], { asOfDate: "2026-10-19", orderDate: "2026-10-20" }).orders[0];

  it("is not configured without all four secrets", () => {
    expect(zohoConfigFromEnv({ ZOHO_CLIENT_ID: "x" })).toBeNull();
  });

  it("creates a draft PO with the planner's quantity and reuses the access token", async () => {
    const { po, created } = await createPurchaseOrderOnce(client, draft());
    expect(created).toBe(true);
    expect(po.status).toBe("draft");
    expect(state.purchaseorders[0].line_items[0]).toMatchObject({ item_id: "4000001", quantity: 500 });
    expect(state.tokensIssued).toBe(1);
  });

  it("a retry with the same lines finds the existing PO instead of ordering twice", async () => {
    await createPurchaseOrderOnce(client, draft());
    const again = await createPurchaseOrderOnce(client, draft());
    expect(again.created).toBe(false);
    expect(state.purchaseorders).toHaveLength(1);
  });

  it("retries once after rate limiting", async () => {
    state.rateLimitOnce = true;
    const { created } = await createPurchaseOrderOnce(client, draft());
    expect(created).toBe(true);
  }, 10_000);

  it("surfaces Zoho errors with their code, and creates nothing", async () => {
    state.failNextCreates = 1;
    await expect(client.createPurchaseOrder(draft())).rejects.toBeInstanceOf(ZohoError);
    await expect(client.createPurchaseOrder({ ...draft(), vendor_id: "nope" })).rejects.toThrow(/Invalid vendor/);
    expect(state.purchaseorders).toHaveLength(0);
  });

  it("pages through items and vendors", async () => {
    for (let i = 2; i <= 450; i++) await client.createItem({ name: `Item ${i}`, sku: `SKU${i}`, unit: "Units", rate: 1, purchase_rate: 1 });
    expect(await client.listItems()).toHaveLength(450);
    expect(await client.listVendors()).toHaveLength(1);
  });
});
