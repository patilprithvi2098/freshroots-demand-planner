import { describe, expect, it } from "vitest";
import { latestReceiveDate, mapZohoStatus } from "@/lib/services/zohoOrders";

describe("Zoho PO status → open-PO status", () => {
  it.each([
    ["draft", undefined, "open"],
    ["open", "", "open"],
    ["issued", "partially_received", "partially_received"],
    ["open", "received", "received"],
    ["billed", undefined, "received"],
    ["closed", undefined, "received"],
    ["cancelled", "received", "cancelled"],
    // Zoho also reports receipt in the PO status itself, in either case.
    ["Partially_Received", undefined, "partially_received"],
    ["received", undefined, "received"],
  ])("%s / %s → %s", (status, received, expected) => {
    expect(mapZohoStatus(status, received)).toBe(expected);
  });
});

describe("delivery date from purchase receives", () => {
  it("takes the latest receive date, or null without any", () => {
    expect(latestReceiveDate([{ date: "2026-11-10" }, { date: "2026-11-14" }, { date: "2026-11-12" }])).toBe("2026-11-14");
    expect(latestReceiveDate([])).toBeNull();
    expect(latestReceiveDate(undefined)).toBeNull();
  });
});
