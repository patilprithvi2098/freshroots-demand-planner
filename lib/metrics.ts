// Dashboard metrics and kill criteria. Pure functions over rows already loaded from the database.

export const LOSS_TARGET_RUPEES = 25_00_000; // ₹25 lakh per quarter
export const KILL_LOSS_RUPEES = 28_00_000; // ₹28 lakh per quarter after two full quarters
export const KILL_AGREEMENT = 0.75;
export const KILL_OVERRIDE_RATE = 0.4;

export type Light = "green" | "amber" | "red" | "grey";

export interface MetricRec {
  id: string;
  run_id: string;
  sku_id: string;
  sku_name: string;
  perishability: string;
  status: string;
  is_exception: boolean;
  demand_adj: number | null;
}

export interface MetricRun {
  id: string;
  as_of_date: string;
  run_date: string;
  status: string;
}

export interface MetricOutcome {
  recommendation_id: string;
  measured_at: string;
  stockout_weeks: number;
  written_off_units: number | null;
}

export interface RunOverrideStat {
  run_id: string;
  as_of_date: string;
  decided: number;
  approved: number;
  overridden: number;
  override_rate: number | null;
}

export interface KillCriterion {
  key: "agreement" | "override_rate" | "loss";
  label: string;
  light: Light;
  value: string;
  detail: string;
}

export interface DashboardMetrics {
  accept_rate: number | null;
  override_rate: number | null;
  runs: RunOverrideStat[];
  stockout_weeks: number;
  perishable_written_off_units: number;
  estimated_quarter_loss: number | null;
  loss_note: string;
  repeated_overrides: { sku_id: string; sku_name: string; overrides: number; runs: number }[];
  kill: KillCriterion[];
}

const DECIDED = new Set(["approved", "edited", "rejected"]);
const OVERRIDDEN = new Set(["edited", "rejected"]);

/** Runs that count: completed (live) ones, oldest first. */
export function overrideStats(runs: MetricRun[], recs: MetricRec[]): RunOverrideStat[] {
  return runs
    .filter((r) => r.status === "completed" || r.status === "superseded")
    .sort((a, b) => (a.run_date < b.run_date ? -1 : 1))
    .map((run) => {
      const rs = recs.filter((r) => r.run_id === run.id && DECIDED.has(r.status));
      const overridden = rs.filter((r) => OVERRIDDEN.has(r.status)).length;
      return {
        run_id: run.id,
        as_of_date: run.as_of_date,
        decided: rs.length,
        approved: rs.length - overridden,
        overridden,
        override_rate: rs.length ? overridden / rs.length : null,
      };
    })
    .filter((s) => s.decided > 0);
}

/** SKUs overridden 3 or more times in the last 5 runs: "rules may not fit this SKU". */
export function repeatedOverrides(stats: RunOverrideStat[], recs: MetricRec[], minOverrides = 3, lastRuns = 5) {
  const recent = new Set(stats.slice(-lastRuns).map((s) => s.run_id));
  const bySku = new Map<string, { sku_name: string; overrides: number; runs: Set<string> }>();
  for (const r of recs) {
    if (!recent.has(r.run_id) || !OVERRIDDEN.has(r.status)) continue;
    const e = bySku.get(r.sku_id) ?? { sku_name: r.sku_name, overrides: 0, runs: new Set<string>() };
    e.overrides++;
    e.runs.add(r.run_id);
    bySku.set(r.sku_id, e);
  }
  return [...bySku]
    .filter(([, e]) => e.overrides >= minOverrides)
    .map(([sku_id, e]) => ({ sku_id, sku_name: e.sku_name, overrides: e.overrides, runs: e.runs.size }))
    .sort((a, b) => b.overrides - a.overrides || (a.sku_id < b.sku_id ? -1 : 1));
}

export function computeMetrics(input: {
  runs: MetricRun[];
  recs: MetricRec[];
  outcomes: MetricOutcome[];
  unitPriceBySku: Map<string, number | null>;
  latestAgreement: { pct: number | null; run_at: string } | null;
  goLiveDate: string | null;
  today: string;
}): DashboardMetrics {
  const stats = overrideStats(input.runs, input.recs);
  const decided = input.recs.filter((r) => DECIDED.has(r.status));
  const overridden = decided.filter((r) => OVERRIDDEN.has(r.status)).length;

  const recById = new Map(input.recs.map((r) => [r.id, r]));
  let stockoutWeeks = 0;
  let perishableWriteOff = 0;
  let loss = 0;
  let priced = 0;
  let unpriced = 0;
  const quarterStart = quarterStartOf(input.today);
  for (const o of input.outcomes) {
    const rec = recById.get(o.recommendation_id);
    if (!rec) continue;
    stockoutWeeks += o.stockout_weeks;
    if (rec.perishability === "high") perishableWriteOff += o.written_off_units ?? 0;
    if (o.measured_at < quarterStart) continue;
    const price = input.unitPriceBySku.get(rec.sku_id);
    if (price == null || rec.demand_adj == null) {
      unpriced++;
      continue;
    }
    priced++;
    loss += o.stockout_weeks * rec.demand_adj * price + (o.written_off_units ?? 0) * price;
  }
  const estimatedLoss = priced > 0 ? loss : null;
  const lossNote =
    input.outcomes.length === 0
      ? "No four-week outcomes recorded yet."
      : priced === 0
        ? "Unit prices are missing, so loss cannot be estimated in rupees."
        : unpriced > 0
          ? `Estimate covers ${priced} outcomes; ${unpriced} lack a unit price.`
          : `Estimate from ${priced} outcomes this quarter.`;

  return {
    accept_rate: decided.length ? (decided.length - overridden) / decided.length : null,
    override_rate: decided.length ? overridden / decided.length : null,
    runs: stats,
    stockout_weeks: stockoutWeeks,
    perishable_written_off_units: perishableWriteOff,
    estimated_quarter_loss: estimatedLoss,
    loss_note: lossNote,
    repeated_overrides: repeatedOverrides(stats, input.recs),
    kill: killCriteria(stats, input.latestAgreement, estimatedLoss, input.goLiveDate, input.today),
  };
}

function quarterStartOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, "0")}-01`;
}

/** Full calendar quarters completed between go-live and today. */
export function fullQuartersSince(goLive: string, today: string): number {
  const q = (d: string) => {
    const [y, m] = d.split("-").map(Number);
    return y * 4 + Math.floor((m - 1) / 3);
  };
  const [, gm, gd] = goLive.split("-").map(Number);
  const startsQuarter = (gm - 1) % 3 === 0 && gd === 1;
  const firstFull = startsQuarter ? q(goLive) : q(goLive) + 1;
  return Math.max(0, q(today) - firstFull);
}

export function killCriteria(
  stats: RunOverrideStat[],
  agreement: { pct: number | null; run_at: string } | null,
  quarterLoss: number | null,
  goLiveDate: string | null,
  today: string,
): KillCriterion[] {
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const a: KillCriterion =
    agreement?.pct == null
      ? {
          key: "agreement",
          label: "Backtest agreement on rule-governed SKUs (end of week 2)",
          light: "grey",
          value: "No data",
          detail: "Run a backtest with Raghav's historical decisions uploaded.",
        }
      : {
          key: "agreement",
          label: "Backtest agreement on rule-governed SKUs (end of week 2)",
          light: agreement.pct < KILL_AGREEMENT ? "red" : agreement.pct < KILL_AGREEMENT + 0.05 ? "amber" : "green",
          value: pct(agreement.pct),
          detail: `Kill if below 75%. Latest backtest ${agreement.run_at.slice(0, 10)}.`,
        };

  const lastThree = stats.slice(-3);
  const over = lastThree.filter((s) => (s.override_rate ?? 0) > KILL_OVERRIDE_RATE).length;
  const o: KillCriterion =
    stats.length === 0
      ? {
          key: "override_rate",
          label: "Planner override rate (3 consecutive runs)",
          light: "grey",
          value: "No decisions yet",
          detail: "Kill if above 40% for 3 consecutive runs.",
        }
      : {
          key: "override_rate",
          label: "Planner override rate (3 consecutive runs)",
          light: lastThree.length === 3 && over === 3 ? "red" : over > 0 ? "amber" : "green",
          value: lastThree.map((s) => (s.override_rate == null ? "–" : pct(s.override_rate))).join(" · "),
          detail: `Kill if above 40% for 3 consecutive runs. ${over} of the last ${lastThree.length} runs are above 40%.`,
        };

  const quarters = goLiveDate ? fullQuartersSince(goLiveDate, today) : 0;
  const l: KillCriterion =
    quarterLoss == null
      ? {
          key: "loss",
          label: "Combined stockout + write-off loss per quarter",
          light: "grey",
          value: "No estimate",
          detail: `Kill if still above ₹28 lakh after two full quarters. ${quarters} full quarter(s) since go-live.`,
        }
      : {
          key: "loss",
          label: "Combined stockout + write-off loss per quarter",
          light:
            quarterLoss > KILL_LOSS_RUPEES ? (quarters >= 2 ? "red" : "amber") : quarterLoss > LOSS_TARGET_RUPEES ? "amber" : "green",
          value: formatLakh(quarterLoss),
          detail: `Target ₹25 lakh or below. Kill if above ₹28 lakh after two full quarters (${quarters} so far).`,
        };
  return [a, o, l];
}

export function formatLakh(rupees: number): string {
  return `₹${(rupees / 1_00_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} lakh`;
}
