// Plain-language explanation for each exception reason, built from the SKU's own numbers.
// Shown when Claude's rationale is unavailable, so the planner always knows why a SKU needs judgement.
import type { SkuRow } from "@/lib/skuRow";

const pct = (v: number | null) => (v == null ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const int = (v: number | null) => (v == null ? "–" : Math.round(v).toLocaleString("en-IN"));

export function ruleExplanation(r: SkuRow): { why: string[]; checkFirst: string } {
  const why: string[] = [];
  const checks: string[] = [];
  for (const reason of r.exception_reasons) {
    switch (reason) {
      case "possible_double_count":
        why.push(
          `Demand was raised for the festival, and sales in the last 4 weeks are already ${pct(r.trend_pct)} above average. Both may be counting the same festival demand, so the ${int(r.recommended_qty)}-unit order could be too high.`,
        );
        checks.push("Is the recent rise the festival itself, or demand that will last after it?");
        break;
      case "perishable_pause_in_festival":
        why.push(
          `This perishable SKU would be paused in a festival month while sales are rising (${pct(r.trend_pct)}). Pausing could leave it short before the next order arrives.`,
        );
        checks.push("How fast is festival stock actually moving at the depots?");
        break;
      case "conflicting_signals":
        why.push(`Stock is above the maximum, but demand is rising (${pct(r.trend_pct)}). Pausing and reordering both look reasonable.`);
        checks.push("Will the current stock clear at the new sales rate before it expires?");
        break;
      case "data_gaps":
        why.push("More than 2 of the last 12 weeks have no sales data, so the averages behind this suggestion are less reliable.");
        checks.push("Why are weeks missing in the SAP export for this SKU?");
        break;
      case "dead_stock":
        why.push(`No sales in the last 12 weeks, but ${int(r.units_on_hand)} units are on hand.`);
        checks.push("Is this SKU delisted, blocked, or mis-coded in SAP?");
        break;
      case "insufficient_history":
        why.push("There are fewer than 12 weeks of sales, so the rules can't size an order.");
        checks.push("What did the launch plan or similar SKUs sell in their first weeks?");
        break;
      case "new_launch":
        why.push("Launched in the last 8 weeks, so early sales don't show the steady rate yet.");
        checks.push("What is the agreed launch volume with the distributors?");
        break;
      case "distributor_shift":
        why.push("One distributor's share of this SKU's sales changed sharply in the last 4 weeks.");
        checks.push("Did a distributor run a scheme, lose a key account, or change its order pattern?");
        break;
    }
  }
  return { why, checkFirst: checks[0] ?? "Check the rule trace below." };
}
