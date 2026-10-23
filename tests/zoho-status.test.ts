import { describe, expect, it } from "vitest";
import { mapZohoStatus } from "@/lib/services/zohoOrders";

describe("Zoho PO status → open-PO status", () => {
  it.each([
    ["draft", undefined, "open"],
    ["open", "", "open"],
    ["issued", "partially_received", "partially_received"],
    ["open", "received", "received"],
    ["billed", undefined, "received"],
    ["closed", undefined, "received"],
    ["cancelled", "received", "cancelled"],
  ])("%s / %s → %s", (status, received, expected) => {
    expect(mapZohoStatus(status, received)).toBe(expected);
  });
});
