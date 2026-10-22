import { describe, expect, it } from "vitest";
import { crossFileWarnings, parseCsv } from "@/lib/csv/loaders";
import { sampleText } from "./helpers";

describe("CSV loaders accept the sample files exactly", () => {
  it.each([
    ["sku_master", "sku_master.csv", 15],
    ["weekly_sales", "weekly_sales.csv", 240],
    ["current_inventory", "current_inventory.csv", 15],
    ["distributor_master", "distributor_master.csv", 4],
    ["calendar", "calendar.csv", 24],
  ] as const)("%s", (type, file, count) => {
    const r = parseCsv(type, sampleText(file));
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(count);
    expect(r.warnings).toEqual([]);
  });
});

describe("validation", () => {
  it("rejects negative, non-integer units and malformed weeks with row numbers", () => {
    const r = parseCsv("weekly_sales", "SKU_ID,Week,Units_Sold\nA,2026-W01,-5\nA,2026-W02,3.5\nA,2026-42,4\nA,2026-W04,4\n");
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(r.rows).toHaveLength(1);
  });

  it("rejects unknown perishability", () => {
    const r = parseCsv(
      "sku_master",
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nA,a,c,Medium,10,Units,D\n",
    );
    expect(r.errors[0]).toMatchObject({ row: 2 });
    expect(r.errors[0].message).toMatch(/Perishability/);
  });

  it("accepts optional SKU columns", () => {
    const r = parseCsv(
      "sku_master",
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID,Unit_Price,Lead_Time_Days,Launch_Date\nA,a,c,High,10,Units,D,42.5,7,2026-09-01\n",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ unit_price: 42.5, lead_time_days: 7, launch_date: "2026-09-01", perishability: "high" });
  });

  it("accepts Distributor_ID on weekly sales", () => {
    const r = parseCsv("weekly_sales", "SKU_ID,Week,Units_Sold,Distributor_ID\nA,2026-W01,5,D1\nA,2026-W01,6,D2\n");
    expect(r.rows).toHaveLength(2);
  });

  it("keeps the last row for duplicate keys and warns", () => {
    const r = parseCsv("weekly_sales", "SKU_ID,Week,Units_Sold\nA,2026-W01,5\nA,2026-W01,9\n");
    expect(r.rows).toEqual([{ sku_id: "A", iso_week: "2026-W01", units_sold: 9, distributor_id: null }]);
    expect(r.warnings[0]).toMatch(/duplicate/);
  });

  it("warns about gaps without zero-filling", () => {
    const r = parseCsv("weekly_sales", "SKU_ID,Week,Units_Sold\nA,2026-W01,5\nA,2026-W04,5\n");
    expect(r.rows).toHaveLength(2);
    expect(r.warnings.join()).toMatch(/A: 2 week\(s\) missing/);
  });

  it("reports missing columns", () => {
    const r = parseCsv("current_inventory", "SKU_ID,Units_On_Hand\nA,5\n");
    expect(r.errors[0].message).toMatch(/Location/);
  });

  it("lists SKU mismatches across files", () => {
    expect(crossFileWarnings(["A", "B"], ["A", "C"], ["A"])).toEqual([
      "SKUs in sales but not in the SKU master will be skipped: C",
      "SKUs in the master with no sales rows will be skipped: B",
    ]);
  });
});
