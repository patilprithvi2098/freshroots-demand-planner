// Acceptance test from the spec, run against the real sample files in sample-data/.
import { describe, expect, it } from "vitest";
import { isFlagged, runEngine } from "@/lib/rules/engine";
import { loadSampleInput } from "./helpers";

const result = runEngine(loadSampleInput("2026-10-19"));
const bySku = new Map(result.recommendations.map((r) => [r.sku_id, r]));
const get = (id: string) => {
  const r = bySku.get(id);
  if (!r) throw new Error(`${id} missing from results`);
  return r;
};

describe("acceptance: sample data as of 2026-10-19 (October is a festival month)", () => {
  it("treats the as-of date as a festival month and ends the window at 2026-W42", () => {
    expect(result.festival_month).toBe(true);
    expect(result.end_week).toBe("2026-W42");
    expect(result.skipped).toEqual([]);
  });

  it("SKU001: stockout risk with high_demand, qty 750, exception possible_double_count", () => {
    const r = get("SKU001");
    expect(r.flag).toBe("stockout_risk");
    expect(r.flags).toContain("high_demand");
    expect(r.recommended_action).toBe("reorder_now");
    expect(r.recommended_qty).toBe(750);
    expect(r.is_exception).toBe(true);
    expect(r.exception_reasons).toEqual(["possible_double_count"]);
  });

  it.each(["SKU003", "SKU004", "SKU011", "SKU013"])("%s: stockout risk", (id) => {
    const r = get(id);
    expect(r.flag).toBe("stockout_risk");
    expect(r.recommended_action).toBe("reorder_now");
    expect(r.is_exception).toBe(false);
  });

  it("SKU006: overstock risk, pause (qty 0)", () => {
    const r = get("SKU006");
    expect(r.flag).toBe("overstock_risk");
    expect(r.recommended_qty).toBe(0);
    expect(r.is_exception).toBe(false);
  });

  it("SKU007: overstock risk with exception perishable_pause_in_festival", () => {
    const r = get("SKU007");
    expect(r.flag).toBe("overstock_risk");
    expect(r.recommended_qty).toBe(0);
    expect(r.exception_reasons).toEqual(["perishable_pause_in_festival"]);
  });

  it.each([
    ["SKU001", 3.4],
    ["SKU003", 4.4],
    ["SKU004", 1.8],
    ["SKU006", 22.2],
    ["SKU007", 4.1],
    ["SKU011", 1.8],
    ["SKU013", 3.2],
  ])("%s weeks of cover rounds to %s", (id, cover) => {
    expect(Number(get(id).weeks_cover!.toFixed(1))).toBe(cover);
  });

  it.each(["SKU002", "SKU005", "SKU008", "SKU009", "SKU010", "SKU012", "SKU014", "SKU015"])(
    "%s: no action",
    (id) => {
      const r = get(id);
      expect(r.flag).toBe("no_action");
      expect(r.flags).toEqual([]);
      expect(r.recommended_action).toBe("no_action");
      expect(r.is_exception).toBe(false);
    },
  );

  it("flags seven SKUs in total, two of them exceptions", () => {
    const flagged = result.recommendations.filter(isFlagged);
    expect(flagged.map((r) => r.sku_id).sort()).toEqual(
      ["SKU001", "SKU003", "SKU004", "SKU006", "SKU007", "SKU011", "SKU013"],
    );
    expect(flagged.filter((r) => r.is_exception).map((r) => r.sku_id).sort()).toEqual(["SKU001", "SKU007"]);
  });

  it("ranks stockouts first (lowest cover first, ties by SKU_ID), then overstock (highest cover first)", () => {
    const flagged = result.recommendations.filter(isFlagged).map((r) => r.sku_id);
    expect(flagged).toEqual(["SKU011", "SKU004", "SKU013", "SKU001", "SKU003", "SKU006", "SKU007"]);
  });

  it("is deterministic", () => {
    expect(runEngine(loadSampleInput("2026-10-19"))).toEqual(result);
  });
});
