// Tabs on the Review page. Shared by the server page (to read ?view=) and the client list.
import { needsReview, type SkuRow } from "@/lib/skuRow";

export const VIEWS = [
  { key: "todo", label: "To decide" },
  { key: "judgement", label: "Needs judgement" },
  { key: "stockout", label: "Running low" },
  { key: "overstock", label: "Too much stock" },
  { key: "rising", label: "Demand rising" },
  { key: "decided", label: "Decided" },
  { key: "all", label: "All SKUs" },
] as const;
export type View = (typeof VIEWS)[number]["key"];

export const VIEW_FILTER: Record<View, (r: SkuRow) => boolean> = {
  todo: (r) => needsReview(r) && r.status === "pending" && !r.released_at,
  judgement: (r) => r.is_exception,
  stockout: (r) => r.flag === "stockout_risk",
  overstock: (r) => r.flag === "overstock_risk",
  rising: (r) => r.flags.includes("high_demand"),
  decided: (r) => r.status !== "pending",
  all: () => true,
};

export function parseView(v: string | undefined): View {
  return VIEWS.some((x) => x.key === v) ? (v as View) : "todo";
}
