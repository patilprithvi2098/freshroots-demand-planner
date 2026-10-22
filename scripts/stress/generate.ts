// Seeded, deterministic synthetic data for the rules-engine stress test.
//
// Produces CSV text in exactly the input schemas lib/csv/loaders.ts accepts, plus a ground-truth
// sidecar: each SKU's demand pattern and its week-by-week simulated latent demand, realised demand,
// sales (censored by stock), stock, purchase orders, lost sales and spoilage.
//
//   npx tsx scripts/stress/generate.ts [seed]      → writes sample-data/stress/*.csv and truth.json
//
// Tests import generateStressData() and work in memory; nothing here touches the network or a database.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dateOfMs, mondayDate, mondayMs, monthOfWeek, WEEK_MS, weekRange } from "./isoweek";

export const FIRST_WEEK = "2024-W01";
export const LAST_WEEK = "2026-W53"; // 2026 is a 53-week ISO year
export const TRAIN_LAST_WEEK = "2025-W52"; // training = 2024-W01..2025-W52 (104 weeks)
export const TEST_FIRST_WEEK = "2026-W01"; // test = 2026-W01..2026-W53 (53 weeks, held out)
export const FESTIVAL_MONTHS = ["03", "10", "11"];
export const DEFAULT_SEED = 20261022;

export type Pattern =
  | "steady"
  | "rising"
  | "falling"
  | "festival"
  | "perishable"
  | "new_launch"
  | "dead_stock"
  | "data_gaps"
  | "distributor_shift"
  | "dirty_rows";

/** How many of the 400 SKUs get each pattern. */
export const PATTERN_COUNTS: Record<Pattern, number> = {
  steady: 120,
  rising: 40,
  falling: 30,
  festival: 60,
  perishable: 50,
  new_launch: 20,
  dead_stock: 15,
  data_gaps: 20,
  distributor_shift: 25,
  dirty_rows: 20,
};

export interface SkuTruth {
  sku_id: string;
  pattern: Pattern;
  perishability: "high" | "low";
  base_weekly: number;
  standard_reorder_qty: number;
  lead_weeks: number;
  lead_time_days: number;
  unit_price: number;
  festival_multiplier: number;
  /** Week index where the pattern changes (ramp start, decline start, death, distributor shift). */
  change_index: number | null;
  launch_index: number | null;
  distributors: string[];
  /** Share per distributor before and after the shift (equal for non-shift SKUs). */
  shares_before: number[];
  shares_after: number[];
  /** Weeks with no sales rows at all (data_gaps SKUs and dead SKUs that stop reporting). */
  gap_weeks: string[];
  locations: string[];
}

export interface SkuSeries {
  latent: number[]; // expected demand (pattern × festival), before noise
  demand: number[]; // realised demand
  sold: number[]; // min(demand, stock available)
  lost: number[];
  on_hand_end: number[]; // after sales and spoilage; this is the Monday snapshot
  arrivals: number[];
  ordered: number[];
  spoiled: number[];
  has_row: boolean[]; // a sales row exists for the week
}

export interface PoRecord {
  po_id: string;
  sku_id: string;
  qty: number;
  /** Week index at whose end the order was placed (ordered on the following Monday). */
  order_index: number;
  /** Week index at whose start the goods arrive (order_index + 1 + lead weeks). */
  arrival_index: number;
  ordered_date: string;
  expected_date: string;
}

export interface StressDataset {
  seed: number;
  weeks: string[];
  trainWeeks: string[];
  testWeeks: string[];
  truth: SkuTruth[];
  series: Record<string, SkuSeries>;
  pos: PoRecord[];
  festivalMonths: string[];
  csv: {
    sku_master: string;
    weekly_sales: string;
    current_inventory: string;
    distributor_master: string;
    calendar: string;
    open_purchase_orders: string;
  };
  injected: {
    duplicate_sales_rows: number;
    conflicting_duplicate_rows: number;
    invalid_sales_rows: number;
    orphan_sales_rows: number;
    invalid_sku_rows: number;
    invalid_inventory_rows: number;
    duplicate_inventory_rows: number;
  };
}

// ---------- PRNG ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float() {
    return this.next();
  }
  uniform(lo: number, hi: number) {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number) {
    return Math.floor(this.uniform(lo, hi + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  normal() {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  pick<T>(xs: T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
  shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

const HIGH_PERISHABLE_PROB: Record<Pattern, number> = {
  steady: 0.12,
  rising: 0.15,
  falling: 0.15,
  festival: 0.3,
  perishable: 1,
  new_launch: 0.2,
  dead_stock: 0,
  data_gaps: 0.15,
  distributor_shift: 0.15,
  dirty_rows: 0.1,
};

const CATEGORY_BY_PERISHABILITY = { high: ["Dairy Alt", "Fresh Juice", "Bakery"], low: ["Beverage", "Snack", "Staple", "Spice"] };

const csvLine = (cells: (string | number)[]) => cells.join(",");

export function generateStressData(seed = DEFAULT_SEED): StressDataset {
  const rng = new Rng(seed);
  const weeks = weekRange(FIRST_WEEK, LAST_WEEK);
  const n = weeks.length; // 157
  const trainWeeks = weeks.filter((w) => w <= TRAIN_LAST_WEEK);
  const testWeeks = weeks.filter((w) => w >= TEST_FIRST_WEEK);
  const isFestivalWeek = weeks.map((w) => FESTIVAL_MONTHS.includes(monthOfWeek(w).slice(5)));
  const testStart = weeks.indexOf(TEST_FIRST_WEEK);

  const distributorIds = Array.from({ length: 1200 }, (_, i) => `DIST${String(i + 1).padStart(4, "0")}`);
  const patterns = rng.shuffle(
    (Object.entries(PATTERN_COUNTS) as [Pattern, number][]).flatMap(([p, c]) => Array<Pattern>(c).fill(p)),
  );

  const truth: SkuTruth[] = [];
  const series: Record<string, SkuSeries> = {};
  const pos: PoRecord[] = [];

  patterns.forEach((pattern, idx) => {
    const sku_id = `FR${String(idx + 1).padStart(4, "0")}`;
    const perishability: "high" | "low" = rng.chance(HIGH_PERISHABLE_PROB[pattern]) ? "high" : "low";
    const high = perishability === "high";
    const base = Math.exp(rng.uniform(Math.log(15), Math.log(600)));
    const leadWeeks = high ? rng.int(1, 2) : rng.int(1, 3);
    const std = Math.max(10, Math.round((base * (high ? rng.uniform(1.2, 2.2) : rng.uniform(3, 6))) / 10) * 10);
    const festivalMult =
      pattern === "festival" ? rng.uniform(1.4, 1.9) : pattern === "perishable" ? rng.uniform(1, 1.2) : rng.uniform(1, 1.15);

    // Pattern multiplier per week.
    let change: number | null = null;
    let launch: number | null = null;
    let mult = (_i: number) => 1;
    if (pattern === "rising" || pattern === "falling") {
      const c = rng.int(60, 140);
      const d = rng.int(8, 20);
      const g = pattern === "rising" ? rng.uniform(1.6, 2.5) : rng.uniform(0.35, 0.65);
      change = c;
      mult = (i) => (i < c ? 1 : i < c + d ? 1 + ((g - 1) * (i - c)) / d : g);
    } else if (pattern === "new_launch") {
      const l = idx % 2 === 0 ? rng.int(52, 95) : rng.int(testStart, 145);
      launch = l;
      mult = (i) => (i < l ? 0 : Math.min(1, 0.3 + (0.7 * (i - l)) / 6));
    } else if (pattern === "dead_stock") {
      const c = rng.int(70, 140);
      change = c;
      mult = (i) => (i < c - 4 ? 1 : i < c ? (c - i) / 5 : 0);
    }

    // Distributors and their shares.
    const nDist = pattern === "distributor_shift" ? rng.int(2, 4) : rng.int(1, 4);
    const dists = rng.shuffle(distributorIds).slice(0, nDist).sort();
    const raw = dists.map(() => rng.uniform(0.5, 1.5));
    const sum = raw.reduce((a, b) => a + b, 0);
    const before = raw.map((r) => r / sum);
    let after = before;
    if (pattern === "distributor_shift") {
      const c = rng.int(60, 140);
      change = c;
      const moved = Math.min(before[0] - 0.02, rng.uniform(0.25, 0.5));
      after = before.map((s, k) => (k === 0 ? s - moved : k === 1 ? s + moved : s));
    }

    // Weeks with no sales rows.
    const gap = new Set<number>();
    if (pattern === "data_gaps") {
      for (let i = 0; i < n; i++) if (rng.chance(0.06)) gap.add(i);
      for (const start of [rng.int(20, testStart - 6), rng.int(testStart, n - 6)]) {
        const len = rng.int(3, 5);
        for (let k = 0; k < len; k++) gap.add(start + k);
      }
    }
    const deadStopsReporting = pattern === "dead_stock" && idx % 2 === 1;

    const locations = rng.chance(0.1) ? ["Pune Central Warehouse", "Goa Depot"] : ["Pune Central Warehouse"];

    // ---- simulation ----
    const s: SkuSeries = {
      latent: [],
      demand: [],
      sold: [],
      lost: [],
      on_hand_end: [],
      arrivals: Array(n).fill(0),
      ordered: Array(n).fill(0),
      spoiled: [],
      has_row: [],
    };
    const firstIdx = launch ?? 0;
    let onHand = launch != null ? Math.round(std * 1.5) : Math.round(base * (high ? rng.uniform(2, 3.5) : rng.uniform(5, 10)));
    // Each planner habit sits around Raghav's bands, so most weeks are inside them and some drift out.
    const reorderPointWeeks = high ? rng.uniform(2.5, 3.5) : rng.uniform(6, 8);
    const orderUpToWeeks = reorderPointWeeks + (high ? rng.uniform(0.5, 1.5) : rng.uniform(3, 6));
    let onOrder = 0;
    for (let i = 0; i < n; i++) {
      const latent = base * mult(i) * (isFestivalWeek[i] ? festivalMult : 1);
      const noise = latent * 0.08 * rng.normal() + Math.sqrt(latent * 1.5) * rng.normal();
      const demand = i < firstIdx ? 0 : Math.max(0, Math.round(latent + noise));
      const arriving = s.arrivals[i];
      onOrder -= arriving;
      const available = onHand + arriving;
      const sold = Math.min(demand, available);
      let end = available - sold;
      const spoiled = high ? Math.floor(end * 0.04) : 0;
      end -= spoiled;
      onHand = end;
      s.latent.push(latent);
      s.demand.push(demand);
      s.sold.push(sold);
      s.lost.push(demand - sold);
      s.spoiled.push(spoiled);
      s.on_hand_end.push(end);
      const reported = i >= firstIdx && !gap.has(i) && !(deadStopsReporting && change != null && i >= change);
      s.has_row.push(reported);
      if (deadStopsReporting && change != null && i >= change && i >= firstIdx) gap.add(i);

      // The historical planner: reviews at week end on the trailing 8-week average of SALES (censored),
      // and when stock + on order falls below a reorder point, orders up to a target in multiples of the
      // standard quantity. Occasional missed reviews, double orders and a rare fat-finger order.
      if (i < firstIdx) continue;
      const from = Math.max(firstIdx, i - 7);
      const trailing = s.sold.slice(from, i + 1).reduce((a, b) => a + b, 0) / (i + 1 - from);
      const position = end + onOrder;
      if (trailing > 0 && position < reorderPointWeeks * trailing && !rng.chance(0.05)) {
        let qty = std * Math.min(3, Math.max(1, Math.round((orderUpToWeeks * trailing - position) / std)));
        if (rng.chance(0.03)) qty *= 2;
        if (rng.chance(0.005)) qty = std * 5;
        const arrival = i + 1 + leadWeeks; // ordered next Monday, received leadWeeks later
        if (arrival < n) s.arrivals[arrival] += qty;
        s.ordered[i] += qty;
        onOrder += qty;
        pos.push({
          po_id: "",
          sku_id,
          qty,
          order_index: i,
          arrival_index: arrival,
          ordered_date: dateOfMs(mondayMs(weeks[i]) + WEEK_MS),
          expected_date: dateOfMs(mondayMs(weeks[0]) + arrival * WEEK_MS),
        });
      }
    }

    series[sku_id] = s;
    truth.push({
      sku_id,
      pattern,
      perishability,
      base_weekly: Math.round(base * 10) / 10,
      standard_reorder_qty: std,
      lead_weeks: leadWeeks,
      lead_time_days: Math.max(3, leadWeeks * 7 - rng.int(0, 3)),
      unit_price: Math.round(rng.uniform(15, 450) * 100) / 100,
      festival_multiplier: Math.round(festivalMult * 1000) / 1000,
      change_index: change,
      launch_index: launch,
      distributors: dists,
      shares_before: before,
      shares_after: after,
      gap_weeks: [...gap].sort((a, b) => a - b).filter((i) => i >= firstIdx).map((i) => weeks[i]),
      locations,
    });
  });

  pos.sort((a, b) => a.order_index - b.order_index || (a.sku_id < b.sku_id ? -1 : 1));
  pos.forEach((p, i) => (p.po_id = `PO${String(i + 1).padStart(6, "0")}`));

  // ---------- CSV: SKU master ----------
  const skuLines = ["SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID,Unit_Price,Lead_Time_Days,Launch_Date"];
  for (const t of truth) {
    skuLines.push(
      csvLine([
        t.sku_id,
        `Freshroots Item ${t.sku_id.slice(2)}`,
        rng.pick(CATEGORY_BY_PERISHABILITY[t.perishability]),
        t.perishability === "high" ? "High" : "Low",
        t.standard_reorder_qty,
        "Units",
        t.distributors[0],
        t.unit_price.toFixed(2),
        t.lead_time_days,
        t.launch_index != null ? mondayDate(weeks[t.launch_index]) : "",
      ]),
    );
  }
  // One invalid master row (Perishability "Medium") for a SKU that is not part of the 400.
  skuLines.push("FR0401,Freshroots Item 0401,Snack,Medium,100,Units,DIST0001,10.00,7,");

  // ---------- CSV: weekly sales (one row per distributor) ----------
  const salesLines: string[] = [];
  let duplicate = 0;
  let conflicting = 0;
  for (const t of truth) {
    const s = series[t.sku_id];
    const shiftAt = t.pattern === "distributor_shift" ? t.change_index! : Infinity;
    for (let i = 0; i < n; i++) {
      if (!s.has_row[i]) continue;
      const shares = i >= shiftAt ? t.shares_after : t.shares_before;
      // Split the week's units across distributors with a little noise; parts sum exactly to sold.
      const noisy = shares.map((sh) => Math.max(0, sh * (1 + 0.06 * rng.normal())));
      const total = noisy.reduce((a, b) => a + b, 0) || 1;
      const exact = noisy.map((x) => (x / total) * s.sold[i]);
      const parts = exact.map(Math.floor);
      let rest = s.sold[i] - parts.reduce((a, b) => a + b, 0);
      const order = exact.map((x, k) => [x - Math.floor(x), k] as const).sort((a, b) => b[0] - a[0]);
      for (let k = 0; rest > 0; k++, rest--) parts[order[k % order.length][1]]++;
      t.distributors.forEach((d, k) => {
        const line = csvLine([t.sku_id, weeks[i], parts[k], d]);
        if (t.pattern === "dirty_rows" && conflicting < 10 && rng.chance(0.01)) {
          // Re-export with a wrong value first; the loader keeps the last row, which is the right one.
          salesLines.push(csvLine([t.sku_id, weeks[i], parts[k] + 37, d]));
          conflicting++;
        }
        salesLines.push(line);
        if (t.pattern === "dirty_rows" && rng.chance(0.04)) {
          salesLines.push(line);
          duplicate++;
        }
      });
    }
  }
  // Invalid rows the loader must reject, and orphan rows the engine must skip.
  const invalid = [
    ...Array.from({ length: 12 }, (_, k) => `FR0002,2026-W${String(10 + k).padStart(2, "0")},-5,DIST0001`),
    ...Array.from({ length: 12 }, () => "FR0003,2026-W12,abc,DIST0001"),
    ...Array.from({ length: 12 }, (_, k) => `FR${String(10 + k).padStart(4, "0")},2025-W53,10,DIST0001`), // 2025 has 52 weeks
    ...Array.from({ length: 6 }, () => "FR0004,2026-W54,10,DIST0001"),
    ...Array.from({ length: 6 }, () => "FR0005,2026-53,10,DIST0001"),
    ...Array.from({ length: 6 }, () => ",2026-W20,10,DIST0001"),
    ...Array.from({ length: 6 }, () => "FR0006,2026-W20,12.5,DIST0001"),
  ];
  const orphan = weekRange("2026-W01", "2026-W20").map((w) => `FR9999,${w},15,DIST0001`);
  for (const line of [...invalid, ...orphan]) {
    salesLines.splice(Math.floor(rng.float() * salesLines.length), 0, line);
  }
  salesLines.unshift("SKU_ID,Week,Units_Sold,Distributor_ID");

  // ---------- CSV: inventory (a snapshot every Monday, for the week just ended) ----------
  const invLines = ["SKU_ID,Location,Units_On_Hand,As_Of_Date"];
  let dupInv = 0;
  for (const t of truth) {
    const s = series[t.sku_id];
    for (let i = t.launch_index ?? 0; i < n; i++) {
      const asOf = dateOfMs(mondayMs(weeks[i]) + WEEK_MS);
      if (t.locations.length === 1) invLines.push(csvLine([t.sku_id, t.locations[0], s.on_hand_end[i], asOf]));
      else {
        const pune = Math.round(s.on_hand_end[i] * 0.7);
        invLines.push(csvLine([t.sku_id, t.locations[0], pune, asOf]));
        invLines.push(csvLine([t.sku_id, t.locations[1], s.on_hand_end[i] - pune, asOf]));
      }
      if (t.pattern === "dirty_rows" && i === n - 1) {
        invLines.push(invLines[invLines.length - 1]);
        dupInv++;
      }
    }
  }
  invLines.push("FR0007,Pune Central Warehouse,-3,2026-06-01");

  // ---------- CSV: distributors, calendar, POs ----------
  const regions = ["Maharashtra", "Goa"];
  const distLines = ["Distributor_ID,Distributor_Name,Region,Status"];
  distributorIds.forEach((d, i) =>
    distLines.push(csvLine([d, `Distributor ${i + 1}`, regions[i % 2], i % 37 === 0 ? "Inactive" : "Active"])),
  );

  const calLines = ["Year,Month,Year_Month,Is_Festival_Month"];
  for (let y = 2024; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2027 && m > 3) break;
      const mm = String(m).padStart(2, "0");
      calLines.push(csvLine([y, m, `${y}-${mm}`, FESTIVAL_MONTHS.includes(mm) ? "TRUE" : "FALSE"]));
    }
  }
  const festivalMonths = calLines.slice(1).filter((l) => l.endsWith("TRUE")).map((l) => l.split(",")[2]);

  // Status as seen on the final as-of date (Monday after 2026-W53).
  const finalIndex = n; // as-of = Monday of week index n
  const poLines = ["PO_ID,SKU_ID,Qty,Ordered_Date,Expected_Date,Status"];
  for (const p of pos) {
    const status = p.arrival_index < finalIndex ? "received" : "open";
    poLines.push(csvLine([p.po_id, p.sku_id, p.qty, p.ordered_date, p.expected_date, status]));
  }

  return {
    seed,
    weeks,
    trainWeeks,
    testWeeks,
    truth,
    series,
    pos,
    festivalMonths,
    csv: {
      sku_master: skuLines.join("\n") + "\n",
      weekly_sales: salesLines.join("\n") + "\n",
      current_inventory: invLines.join("\n") + "\n",
      distributor_master: distLines.join("\n") + "\n",
      calendar: calLines.join("\n") + "\n",
      open_purchase_orders: poLines.join("\n") + "\n",
    },
    injected: {
      duplicate_sales_rows: duplicate,
      conflicting_duplicate_rows: conflicting,
      invalid_sales_rows: invalid.length,
      orphan_sales_rows: orphan.length,
      invalid_sku_rows: 1,
      invalid_inventory_rows: 1,
      duplicate_inventory_rows: dupInv,
    },
  };
}

/** Write the CSVs and the ground-truth sidecar to sample-data/stress/. */
export function writeStressData(ds: StressDataset, dir = path.join(__dirname, "..", "..", "sample-data", "stress")) {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(ds.csv)) writeFileSync(path.join(dir, `${name}.csv`), text);
  writeFileSync(
    path.join(dir, "ground_truth.json"),
    JSON.stringify(
      {
        seed: ds.seed,
        weeks: ds.weeks,
        train_weeks: [ds.trainWeeks[0], ds.trainWeeks[ds.trainWeeks.length - 1]],
        test_weeks: [ds.testWeeks[0], ds.testWeeks[ds.testWeeks.length - 1]],
        festival_months: ds.festivalMonths,
        injected: ds.injected,
        skus: ds.truth,
        series: ds.series,
      },
      null,
      0,
    ),
  );
  return dir;
}

if (process.argv[1] && /generate\.ts$/.test(process.argv[1])) {
  const seed = Number(process.argv[2] ?? DEFAULT_SEED);
  const ds = generateStressData(seed);
  const dir = writeStressData(ds);
  const rows = (t: string) => t.split("\n").length - 2;
  console.log(`seed ${seed} → ${dir}`);
  for (const [name, text] of Object.entries(ds.csv)) console.log(`  ${name}.csv: ${rows(text)} data rows`);
  console.log("  injected:", ds.injected);
}
