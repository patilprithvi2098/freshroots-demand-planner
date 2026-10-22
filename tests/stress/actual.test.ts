// ACTUAL data: the real sample files in sample-data/*.csv (15 SKUs, as of 2026-10-19).
// An independent oracle (tests/stress/oracle.ts) recomputes every number from the spec rules and must
// agree with the engine on every SKU. The same oracle then cross-checks the engine on all 400 synthetic
// SKUs at as-of dates chosen to hit festival months and the 53-week year boundary.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv/loaders";
import { DEFAULT_PARAMS } from "@/lib/rules/config";
import { isFlagged, runEngine } from "@/lib/rules/engine";
import type { EngineInput, Recommendation } from "@/lib/rules/types";
import { asOfFor, engineInputAt, loadStress, saveResult, type Loaded } from "./harness";
import { oracle, type OracleRow } from "./oracle";

const read = (f: string) => readFileSync(path.join(__dirname, "..", "..", "sample-data", f), "utf8");

function actualInput(): EngineInput {
  const calendar = parseCsv("calendar", read("calendar.csv")).rows;
  return {
    asOfDate: "2026-10-19",
    skus: parseCsv("sku_master", read("sku_master.csv")).rows,
    weeklySales: parseCsv("weekly_sales", read("weekly_sales.csv")).rows,
    inventory: parseCsv("current_inventory", read("current_inventory.csv")).rows,
    openPurchaseOrders: null,
    festivalMonths: calendar.filter((c) => c.is_festival_month).map((c) => c.year_month),
    params: DEFAULT_PARAMS,
  };
}

const close = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 1e-9);

/** Field-by-field differences between the engine and the oracle for one SKU. */
function diff(e: Recommendation, o: OracleRow): string[] {
  const out: string[] = [];
  const check = (name: string, ok: boolean, ev: unknown, ov: unknown) => ok || out.push(`${e.sku_id} ${name}: engine ${JSON.stringify(ev)} vs oracle ${JSON.stringify(ov)}`);
  check("flag", e.flag === o.primary, e.flag, o.primary);
  check("flags", [...e.flags].sort().join() === [...o.flags].sort().join(), e.flags, o.flags);
  check("avg12", close(e.avg12, o.avg12), e.avg12, o.avg12);
  check("avg4", close(e.avg4, o.avg4), e.avg4, o.avg4);
  check("trend", close(e.trend_pct, o.trend), e.trend_pct, o.trend);
  check("demand", close(e.demand_adj, o.demand), e.demand_adj, o.demand);
  check("cover", close(e.weeks_cover, o.cover), e.weeks_cover, o.cover);
  check("action", e.recommended_action === o.action, e.recommended_action, o.action);
  check("qty", e.recommended_qty === o.qty, e.recommended_qty, o.qty);
  check("exceptions", [...e.exception_reasons].sort().join() === [...o.exceptions].sort().join(), e.exception_reasons, o.exceptions);
  return out;
}

describe("ACTUAL data: sample-data/*.csv as of 2026-10-19, engine vs independent oracle", () => {
  const input = actualInput();
  const engine = runEngine(input);
  const orc = oracle(input);
  const e = new Map(engine.recommendations.map((r) => [r.sku_id, r]));
  const o = new Map(orc.rows.map((r) => [r.sku_id, r]));

  it("both see 15 SKUs, end week 2026-W42, and a festival month", () => {
    expect(engine.recommendations).toHaveLength(15);
    expect(orc.rows).toHaveLength(15);
    expect(orc.end_week).toBe(engine.end_week);
    expect(engine.end_week).toBe("2026-W42");
    expect(orc.festival).toBe(true);
    expect(engine.festival_month).toBe(true);
  });

  it.each(Array.from({ length: 15 }, (_, i) => `SKU${String(i + 1).padStart(3, "0")}`))("%s: engine and oracle agree on every field", (id) => {
    expect(diff(e.get(id)!, o.get(id)!)).toEqual([]);
  });

  it("spec acceptance values hold in the oracle too (not only the engine)", () => {
    const s1 = o.get("SKU001")!;
    expect(s1.primary).toBe("stockout_risk");
    expect(s1.flags).toContain("high_demand");
    expect(s1.qty).toBe(750);
    expect(s1.exceptions).toEqual(["possible_double_count"]);
    for (const id of ["SKU003", "SKU004", "SKU011", "SKU013"]) expect(o.get(id)!.primary).toBe("stockout_risk");
    expect(o.get("SKU006")!.primary).toBe("overstock_risk");
    expect(o.get("SKU007")!.primary).toBe("overstock_risk");
    expect(o.get("SKU007")!.exceptions).toEqual(["perishable_pause_in_festival"]);
    const covers = { SKU001: 3.4, SKU003: 4.4, SKU004: 1.8, SKU006: 22.2, SKU007: 4.1, SKU011: 1.8, SKU013: 3.2 };
    for (const [id, c] of Object.entries(covers)) expect(Number(o.get(id)!.cover!.toFixed(1))).toBe(c);
    for (const id of ["SKU002", "SKU005", "SKU008", "SKU009", "SKU010", "SKU012", "SKU014", "SKU015"]) {
      expect(o.get(id)!.primary).toBe("no_action");
      expect(o.get(id)!.exceptions).toEqual([]);
    }
    const flagged = orc.rows.filter((r) => r.primary !== "no_action" || r.exceptions.length);
    expect(flagged).toHaveLength(7);
    expect(flagged.filter((r) => r.exceptions.length)).toHaveLength(2);
    expect(engine.recommendations.filter(isFlagged)).toHaveLength(7);
    saveResult("actual", {
      as_of: "2026-10-19",
      rows: orc.rows.map((r) => ({ ...r, engine_flag: e.get(r.sku_id)!.flag, engine_qty: e.get(r.sku_id)!.recommended_qty })),
    });
  });

  it("the actual sample cannot answer 'did the flag predict reality': it ends at the as-of week", () => {
    const lastWeek = input.weeklySales.map((r) => r.iso_week).sort().at(-1);
    expect(lastWeek).toBe(engine.end_week);
  });
});

describe("Oracle cross-check on 400 synthetic SKUs (festival months and the 53-week boundary)", () => {
  let L: Loaded;
  beforeAll(() => {
    L = loadStress();
  }, 120_000);

  const WEEKS = ["2025-W09", "2025-W40", "2025-W52", "2026-W01", "2026-W09", "2026-W13", "2026-W27", "2026-W44", "2026-W48", "2026-W52", "2026-W53"];

  it.each(WEEKS)("as of the Monday after %s: engine and oracle agree on all SKUs", (week) => {
    const t = L.ds.weeks.indexOf(week);
    const input = engineInputAt(L, t);
    expect(input.asOfDate).toBe(asOfFor(L.ds, t));
    const engine = runEngine(input);
    const orc = oracle(input);
    expect(orc.end_week).toBe(week);
    expect(engine.end_week).toBe(week);
    const o = new Map(orc.rows.map((r) => [r.sku_id, r]));
    expect(engine.recommendations.length).toBe(orc.rows.length);
    const problems = engine.recommendations.flatMap((r) => diff(r, o.get(r.sku_id)!));
    expect(problems.slice(0, 10)).toEqual([]);
  }, 60_000);

  it("mid-week as-of dates around the 53-week boundary pick the right end week", () => {
    const L2 = L;
    const cases: [string, string][] = [
      ["2026-12-27", "2026-W52"], // Sunday: W52 just completed
      ["2026-12-31", "2026-W52"], // Thursday of W53
      ["2027-01-03", "2026-W53"], // Sunday: W53 just completed
      ["2027-01-10", "2027-W01"],
    ];
    for (const [asOf, end] of cases) {
      const input = { ...engineInputAt(L2, L2.ds.weeks.length - 1), asOfDate: asOf };
      expect(runEngine(input).end_week).toBe(end);
      expect(oracle(input).end_week).toBe(end);
    }
  });
});
