import { describe, expect, it } from "vitest";
import { buildHistory, historyText, historyWorthShowing, type PastDecision } from "@/lib/skuHistory";
import { matchesSearch } from "@/lib/reviewViews";

const d = (run: string, status: string, final: number | null, reason: string | null = null, sku = "SKU001"): PastDecision => ({
  run_id: run,
  run_date: run,
  sku_id: sku,
  status,
  recommended_qty: 500,
  final_qty: final,
  override_reason_code: reason,
});

describe("Raghav's per-SKU history", () => {
  it("counts changes in the last 4 runs and takes the median of his changed quantities", () => {
    const h = buildHistory([
      d("2026-09-01", "edited", 900, "known_event"), // fifth-newest: outside the window
      d("2026-09-22", "edited", 600, "rule_too_strict"),
      d("2026-09-29", "approved", 500),
      d("2026-10-06", "edited", 650, "known_event"),
      d("2026-10-13", "edited", 620, "known_event"),
    ]).get("SKU001")!;
    expect(h).toEqual({ decided: 4, changed: 3, rejected: 0, usualQty: 620, lastReason: "known_event" });
    expect(historyWorthShowing(h)).toBe(true);
    expect(historyText(h)).toBe("You changed it in 3 of your last 4 runs, usually to 620.");
  });

  it("stays quiet for one-off overrides and ignores undecided rows", () => {
    const h = buildHistory([d("2026-10-06", "edited", 650), d("2026-10-13", "approved", 500), d("2026-10-20", "pending", null)]).get("SKU001")!;
    expect(h.decided).toBe(2);
    expect(h.usualQty).toBeNull();
    expect(historyWorthShowing(h)).toBe(false);
  });

  it("describes rejections and changes together", () => {
    const h = buildHistory([d("1", "rejected", 0, "supplier_constraint"), d("2", "edited", 300), d("3", "rejected", 0)]).get("SKU001")!;
    expect(historyText(h)).toBe("You changed it in 1 and rejected it in 2 of your last 3 runs.");
  });
});

describe("Review search", () => {
  const sku = { sku_id: "SKU013", sku_name: "Freshroots Peanut Butter 300g" };
  it.each(["sku013", "013", "peanut", "BUTTER 300", "  peanut "])("matches %s", (q) => expect(matchesSearch(sku, q)).toBe(true));
  it("blank matches everything; unrelated text matches nothing", () => {
    expect(matchesSearch(sku, "")).toBe(true);
    expect(matchesSearch(sku, "honey")).toBe(false);
  });
});
