# Rules engine stress test

Date: 2026-10-22. Scope: `lib/rules/` (engine, backtest, ISO weeks) and `lib/csv/loaders.ts`, tested offline.
No database, no Anthropic API, no changes to `lib/`, `app/` or defaults.

```bash
npx vitest run tests/stress          # 75 tests, about 1 minute
npx tsx scripts/stress/generate.ts   # optional: write the synthetic CSVs + ground truth to sample-data/stress/
```

## Short answer

- **The rule arithmetic is correct.** An independent oracle, written from the spec text, matches the engine
  on every field (flags, averages, trend, demand, cover, action, quantity, exception reasons). It matched on
  all 15 actual sample SKUs and on all 400 synthetic SKUs at 11 as-of dates, including festival months and
  the 2026-W53 boundary. All spec acceptance values hold.
- **On unseen data the cover rules work.** Over the held-out 2026 test set, stockout precision is 70% and
  recall 80%; overstock precision is 84% and recall 62%. A stockout flag makes lost sales in the next 4 weeks
  2.7× more likely (18.4% against a 6.9% base rate).
- **Two defects would mislead the business:**
  1. `runBacktest` applies today's open POs to every past week. On the same planner decisions, agreement is
     **80.6% measured correctly but 54.8% through `runBacktest`**, so the backtest alone would trip the
     "agreement < 75%" kill criterion.
  2. The sales loader has a quadratic gap scan. A 200,000-row upload takes **25 s** to parse.
- **Weak or questionable rules:**
  - `high_demand` predicts the next 4 weeks poorly (38% precision, 28% recall).
  - The festival uplift is keyed to the as-of month only, so the months before a festival are under-flagged.
  - Lead time is never used, so 12% of stockout flags are already too late.
  - The exception rate is 7.4%, not the 15–20% in the brief. In festival weeks it peaks at 96 exceptions in
    one run, above the 80-call AI cap.
- **Components map: yes, it needs changes.** See the last section.

## Method

| Set | Source | Weeks | Use |
|---|---|---|---|
| TRAINING | synthetic, seed 20261022 | 2024-W01 … 2025-W52 (104) | Parameter sweeps around the defaults, reporting only. Truth horizons are cut at 2025-W52, so nothing from the test year leaks in. |
| TEST | synthetic, same seed, held out | 2026-W01 … 2026-W53 (53, a 53-week ISO year) | Weekly replay at the default parameters, scored against ground truth. |
| ACTUAL | `sample-data/*.csv` | 2026-W27 … 2026-W42, as of 2026-10-19 | Independent oracle against the engine, plus the spec acceptance values. |

**Generator** ([scripts/stress/generate.ts](../scripts/stress/generate.ts)). It is seeded and deterministic,
writes CSVs in the exact loader schemas, and writes a sidecar `ground_truth.json`. Scale: 400 SKUs, 1,200
distributors, 157 ISO weeks, 156k sales rows (one row per SKU, week and distributor), 69k weekly stock
snapshots and 20k POs with order and arrival dates.

| Pattern | SKUs | Pattern | SKUs |
|---|---:|---|---:|
| steady | 120 | new_launch (Launch_Date, half in the test year) | 20 |
| rising (×1.6–2.5 ramp) | 40 | dead_stock (half stop reporting) | 15 |
| falling (×0.35–0.65) | 30 | data_gaps (6% random + 3–5-week runs) | 20 |
| festival (×1.4–1.9 in Mar/Oct/Nov; others ×1.0–1.15) | 60 | distributor_shift (25–50 pp share move) | 25 |
| perishable (High, 4% weekly spoilage) | 50 | dirty_rows (duplicates, conflicting re-exports) | 20 |

The file also gets 60 invalid sales rows, 20 orphan-SKU rows, a bad master row and a bad inventory row.

**Simulation.**
- Demand is the latent pattern times the festival multiplier, plus noise.
- Sales are capped by stock, so sales are censored like real SAP data.
- A "historical planner" reviews weekly on a trailing 8-week sales average, orders up to a target in multiples
  of the standard quantity, and occasionally misses a review or double-orders.
- POs arrive after the lead time plus one week.

**Replay** ([tests/stress/harness.ts](../tests/stress/harness.ts)). Each week t runs `runEngine` as of the
Monday after t, with that Monday's stock snapshot and the POs open on that date (ordered before it, not yet
received). Sales and calendar go through the real `parseCsv`.

**Ground truth per SKU-week.** All truth uses realised demand and the default windows.

| Label | Definition |
|---|---|
| stockout | Stock plus already-open POs run out within the minimum window (6 weeks Low, 3 weeks High), with no new orders. |
| overstock | Stock plus open POs remain after the maximum window (14 / 4 weeks). |
| high_demand | Expected demand over t+1..t+4 is more than 1.2× expected demand over t−11..t. |
| reality | The simulated business actually lost sales in t+1..t+4. |

SKU-weeks where the engine abstains by design (insufficient_history, new_launch) are left out of flag
precision and recall. They are kept in the exception rate.

**Oracle** ([tests/stress/oracle.ts](../tests/stress/oracle.ts)). It is written from
`lib/rules/plainLanguage.ts` and the README "Decisions" section, and shares no code with `lib/rules`: it has
its own ISO-week math in [scripts/stress/isoweek.ts](../scripts/stress/isoweek.ts), its own aggregation, and
no ranking.

**Caveat.** Absolute precision and recall depend on the synthetic assumptions: the noise, the planner habits,
and festival multipliers that differ by SKU. The oracle checks, the loader checks, the runtime numbers, and
the backtest and loader defects do not depend on them.

## Results: ACTUAL (sample-data, as of 2026-10-19)

| Check | Result |
|---|---|
| Engine vs oracle, 15 SKUs × 10 fields | 0 differences |
| SKU001 | stockout + high_demand, qty 750, exception possible_double_count ✔ |
| SKU003 / 004 / 011 / 013 | stockout ✔ |
| SKU006 | overstock, qty 0 ✔ |
| SKU007 | overstock + perishable_pause_in_festival ✔ |
| Covers SKU001/003/004/006/007/011/013 | 3.4 / 4.4 / 1.8 / 22.2 / 4.1 / 1.8 / 3.2 ✔ |
| Other 8 SKUs | no action ✔ |
| Totals | 7 flagged, 2 exceptions ✔ |
| Engine vs oracle, 400 synthetic SKUs at 11 as-of dates (2025-W09 … 2026-W53, incl. Mar/Oct/Nov and the year boundary) | 0 differences |
| End week for 2026-12-27 / 12-31 / 2027-01-03 / 01-10 | W52 / W52 / W53 / 2027-W01 ✔ |

"Did the flag predict reality" cannot be answered from the actual sample, because its sales end at the as-of
week. It is measured on the synthetic data instead (TEST, last column below). In production it needs the
four-week outcome job.

## Results: TRAINING (2024-W12 … 2025-W52, 93 weekly runs × 400 SKUs per variant)

Only one parameter changes per row; everything else is at the default. `DEFAULT_PARAMS` is asserted unchanged
after the sweep.

| Variant | Flagged | Exceptions | Stockout (festival / non-festival) | Overstock | High demand | Stockout F1 | Overstock F1 | High demand P / R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **defaults** | 33.7% | 4.1% | 25.0% (45.7% / 18.7%) | 3.9% | 3.5% | 76.9% | 62.9% | 35.9% / 29.7% |
| trend 10% | 38.9% | 8.1% | 25.0% | 3.9% | 12.0% | 76.9% | 62.9% | 17.6% / 49.6% |
| trend 15% | 35.2% | 5.4% | 25.0% | 3.9% | 6.1% | 76.9% | 62.9% | 27.2% / 38.9% |
| trend 25% | 32.8% | 3.2% | 25.0% | 3.9% | 2.1% | 76.9% | 62.9% | 43.3% / 21.5% |
| trend 30% | 32.3% | 2.6% | 25.0% | 3.9% | 1.2% | 76.9% | 62.9% | 50.3% / 14.4% |
| trend 40% | 31.6% | 2.0% | 25.0% | 3.9% | 0.3% | 76.9% | 62.9% | 52.8% / 3.7% |
| festival 0% | 28.8% | 4.4% | 19.2% (20.8% / 18.7%) | 4.6% | 3.5% | 78.7% | 66.3% | 35.9% / 29.7% |
| festival 10% | 30.6% | 4.2% | 21.5% (30.5% / 18.7%) | 4.2% | 3.5% | 79.8% | 64.5% | 35.9% / 29.7% |
| festival 40% | 36.6% | 4.0% | 28.3% (59.4% / 18.7%) | 3.8% | 3.5% | 73.1% | 61.7% | 35.9% / 29.7% |
| festival 60% | 39.9% | 4.0% | 32.0% (74.9% / 18.7%) | 3.7% | 3.5% | 68.8% | 60.4% | 35.9% / 29.7% |
| Low 5–12 wks | 30.2% | 4.1% | 18.9% | 6.3% | 3.5% | 75.1% | 59.9% | 35.9% / 29.7% |
| Low 7–16 wks | 43.8% | 4.0% | 35.9% | 3.3% | 3.5% | 68.2% | 56.1% | 35.9% / 29.7% |
| Low 6–10 wks | 46.3% | 4.4% | 25.0% | 15.8% | 3.5% | 76.9% | 38.4% | 35.9% / 29.7% |
| Low 6–18 wks | 32.7% | 4.0% | 25.0% | 3.0% | 3.5% | 76.9% | 51.8% | 35.9% / 29.7% |
| High 2–3 wks | 29.8% | 4.7% | 12.2% | 12.6% | 3.5% | 46.9% | 46.8% | 35.9% / 29.7% |
| High 2–4 wks | 20.9% | 4.1% | 12.2% | 3.9% | 3.5% | 46.9% | 62.9% | 35.9% / 29.7% |
| High 3–5 wks | 31.9% | 4.0% | 25.0% | 2.2% | 3.5% | 76.9% | 49.9% | 35.9% / 29.7% |

What the sweep shows (reported, not applied):
- **Trend threshold.** It trades precision for recall. No setting gives `high_demand` both above 50%: the
  rule is weak, not mis-set.
- **Festival uplift.** A blanket +25% more than doubles stockout flags in festival months (45.7% against
  18.7% in other months). 0–10% scores better on this data, because only 60 of 400 SKUs really spike.
- **Cover windows.** The defaults sit at or near the best stockout F1. Narrowing the Low maximum to 10 weeks
  quadruples overstock flags.

## Results: TEST (held-out 2026-W01 … 2026-W53, 53 weekly runs × 400 SKUs, defaults)

| Pattern | SKU-weeks | Exception rate | Stockout P / R | Overstock P / R | High demand P / R | Stockout flag → lost sales in 4 wks (base rate) |
|---|---:|---:|---:|---:|---:|---:|
| steady | 6,360 | 0.5% | 60.8% / 81.0% | 84.9% / 67.8% | 0.0% / – | 12.6% (3.7%) |
| rising | 2,120 | 2.8% | 79.0% / 76.1% | 75.0% / 66.7% | 75.0% / 34.4% | 8.7% (3.4%) |
| falling | 1,590 | 1.6% | 54.3% / 76.3% | 76.3% / 47.9% | 0.0% / – | 13.5% (5.9%) |
| festival | 3,180 | 12.0% | 75.3% / 67.9% | 65.1% / 38.4% | 44.7% / 25.3% | 29.5% (11.0%) |
| perishable | 2,650 | 1.3% | 82.5% / 88.7% | 69.4% / 52.2% | 0.0% / – | 27.5% (23.4%) |
| new_launch | 850 | 13.5% | 54.5% / 68.8% | 63.6% / 38.9% | 31.3% / 58.8% | 0.0% (0.0%) |
| dead_stock | 795 | 73.0% | 35.3% / 85.7% | 100.0% / 83.0% | – / – | 0.0% (0.0%) |
| data_gaps | 1,060 | 26.2% | 57.1% / 83.6% | 86.7% / 70.3% | 0.0% / – | 11.6% (4.0%) |
| distributor_shift | 1,325 | 2.9% | 56.1% / 81.0% | 70.6% / 80.0% | 0.0% / – | 10.2% (2.4%) |
| dirty_rows | 1,060 | 0.9% | 53.7% / 72.3% | 97.1% / 82.5% | 0.0% / – | 0.0% (0.0%) |
| **ALL** | **20,990** | **7.4%** | **70.4% / 79.7%** | **83.7% / 62.4%** | **38.3% / 28.1%** | **18.4% (6.9%)** |

"0.0% / –" means `high_demand` fired only on noise: there were no true positives to find.

**Data-quality exceptions**

| Exception | Precision / recall |
|---|---|
| data_gaps | 100% / 100% |
| dead_stock | 100% / 100% |
| new_launch | 100% / 100% |
| distributor_shift | 94% / 91% |

**By month.** The festival months are March, October and November. The months right before a festival miss
stockouts.

| Month | Exceptions | Stockout P / R | Overstock P / R |
|---|---:|---:|---:|
| Feb (before Mar) | 2.7% | 89.0% / **67.4%** | 77.4% / 79.3% |
| Mar (festival) | 12.9% | **55.4%** / 93.5% | 97.2% / 40.9% |
| Apr–Aug | 4.3–6.5% | 76.6–86.4% / 72.7–81.1% | 77.4–92.9% / 56.6–76.4% |
| Sep (before Oct) | 5.9% | 92.4% / **57.6%** | 74.8% / 88.8% |
| Oct (festival) | 16.7% | 65.6% / 89.6% | 92.9% / 35.1% |
| Nov (festival) | 14.6% | **51.3%** / 96.4% | 90.5% / **26.4%** |

**Exception reasons over the year.** 722 data_gaps (446 of them from dead SKUs that stopped reporting),
536 dead_stock, 516 possible_double_count, 103 insufficient_history, 63 new_launch, 38
perishable_pause_in_festival, 34 distributor_shift, 26 conflicting_signals.

**Load per run.**

| Measure | Value |
|---|---|
| Exceptions per run | median 21, maximum 96 (2026-W43) |
| Flagged SKUs per run | median ≈ 149, maximum 250 |
| Exception rate | 7.4% overall; 14.6% in festival months, 4.8% in other months |

**Runtime.**

| Operation | Time |
|---|---|
| `runEngine` with 400 SKUs and 157 weeks of history (156k rows) | median 33 ms, max 39 ms |
| `runBacktest` over 146 weeks | 4.8–5.0 s |
| Oracle cross-check, 400 SKUs | well under 1 s per as-of date |

**Loaders at scale.**
- All 60 invalid rows are rejected with row numbers.
- The 313 duplicate keys produce a warning, and the last row wins.
- After de-duplication, every SKU-week total equals the simulated sales, including the 10 conflicting
  re-exports.
- The orphan SKU is skipped with a reason.

## Results: edge and load cases

| Case | Result |
|---|---|
| Empty file (each of the 7 types) | No crash. A "Missing required column(s)" error is raised, but the **first** error is PapaParse's "Unable to auto-detect delimiting character" at row 2 (finding 7). |
| Header-only file | 0 rows, 0 errors |
| Empty engine / backtest input | empty results, agreement `null` |
| 200,000-row sales file (1,250 SKUs × 160 weeks, 4.9 MB) | parses correctly in **25.1 s** (finding 2) |
| 200,001 rows | one clear limit error |
| All-zero sales | dead_stock exception with pause and qty 0 when stock > 0, no action when stock = 0; no NaN or Infinity; the backtest raises no `high_demand` |
| 53-week years | `lib/rules/isoWeek` matches the independent helper for every week 2015–2032; 2026-W53 is valid and 2025-W53 / 2027-W53 are rejected; a 12-week window across W53 averages correctly (engine = oracle) |
| Missing calendar | no uplift, `festival_calendar` feature off; same result as a non-festival month |
| Every optional column absent | loads and runs; all features off; `rupee_exposure` null; ranking still works |

## Engine bugs and questionable rules (none fixed; proposed fixes only)

### Bugs

**1. `runBacktest` uses today's open POs for every past week.**
Location: [lib/rules/backtest.ts:84](../lib/rules/backtest.ts) passes `base.openPurchaseOrders` unchanged into
each replayed week, and [lib/rules/types.ts:71](../lib/rules/types.ts) `OpenPoInput` has no dates, so it
cannot be filtered by week.

Effect on the test year:

| Measure | Value |
|---|---|
| SKU-weeks with a different primary flag than a time-correct replay | 7,320 of 20,887 (35%) |
| Agreement with the same planner decisions, time-correct | 80.6% |
| Agreement with the same planner decisions, via `runBacktest` | 54.8% |
| Flag share, `runBacktest` vs live-equivalent | 57% vs 37% |

Through `runBacktest`, agreement falls below the 75% kill line.

Proposed fix:
- Add `ordered_date` and `received_date | null` to `OpenPoInput`. The loader already reads `Ordered_Date` and
  `Expected_Date`.
- In the backtest, pass for each week only the POs with `ordered_date <= asOf` and
  `(received_date == null || received_date > asOf)`.
- When there is no PO history, run the backtest with POs set to `null` and label the agreement figure as
  "excludes stock on order".

**2. The quadratic gap scan in the sales loader.**
Location: [lib/csv/loaders.ts:419](../lib/csv/loaders.ts) runs
`while (weekWindow(last, span)[0] !== first && span < 600) span++`, which rebuilds the window for every
span: O(span²) date operations per SKU.

| File | Total parse time | Of which gap scan |
|---|---:|---:|
| 156k rows | 7.2 s | 6.2 s |
| 200k rows | 25.1 s | – |

The 600 cap also means a history longer than 600 weeks is silently not checked: a gap in a 650-week series
gives no warning.

Proposed fix: walk once from `first` to `last` with `addIsoWeeks(w, 1)`, collecting missing weeks (O(span)),
and drop the 600 cap. This should bring a 200k-row parse to about 1 s.

**3. Inventory rows without a location are summed across dates.**
Location: [lib/rules/engine.ts:62](../lib/rules/engine.ts) keys the snapshot by `row.location ?? i`, so two
snapshots of the same SKU a week apart count twice (300 + 300 = 600). The CSV loader always sets a location,
so this only affects programmatic callers such as the seed, the backtest or a future Zoho feed.

Proposed fix: key on `row.location ?? ""`.

### Questionable rules

**4. Festival uplift keyed only to the as-of month.**
Location: [lib/rules/engine.ts:377](../lib/rules/engine.ts) and [:243](../lib/rules/engine.ts). The cover
horizon is 6–14 weeks, but the uplift switches on and off with the as-of date's own month. As a result:
- Stockout recall drops to 67% in February and 58% in September.
- In festival months, stockout precision falls to 51–66% and overstock recall to 26–41%.

Proposed fix: compute demand per week over the cover horizon, uplifting only the weeks that fall in festival
months. Also allow a per-category uplift. The training sweep prefers about 10% for non-festival SKUs. This
is a spec change, so Raghav must agree to it.

**5. The trend rule runs on raw, censored sales.**
Location: [lib/rules/engine.ts:239](../lib/rules/engine.ts) and [:276](../lib/rules/engine.ts).
- `high_demand` has 38% precision and 28% recall on next-4-week demand.
- Festival spikes and post-stockout rebounds look like trends, so possible_double_count makes up a third of
  all exceptions.
- On rising SKUs, the 1.5× reorder still leaves 19% of reorders below minimum cover.

Proposed fixes:
- Compute the trend on de-seasonalised sales: divide festival-month weeks by the uplift.
- Skip weeks with a zero-stock snapshot.
- Keep possible_double_count only when the trend persists outside festival weeks.

**6. Lead time is loaded but never used.**
Location: there is no reference to `lead_time_days` in [lib/rules/engine.ts](../lib/rules/engine.ts) apart
from feature detection at line 131. 12.1% of stockout flags come when stock runs out before an order placed
that day can land; the figure is 21% for festival SKUs and 17% for perishables.

Proposed fix: flag stockout when cover is below `max(min_weeks, lead_time_weeks + 1)`, or add a `too_late`
exception asking for an expedite.

**7. The standard quantity does not always restore cover.**
Location: [lib/rules/engine.ts:295](../lib/rules/engine.ts). 5.8% of `reorder_now` recommendations leave
`(stock + on order + qty) / demand` below the minimum (19% for rising SKUs).

Proposed fix: either keep the spec rule and raise a `qty_below_min_cover` exception, or use
`max(standard, ceil(min_weeks × demand − position))` within the 3× cap.

**8. An empty upload shows a confusing error first.**
Location: [lib/csv/loaders.ts:356](../lib/csv/loaders.ts) passes PapaParse's "Unable to auto-detect
delimiting character" through as the first error, at a row 2 that does not exist.

Proposed fix: return early with "The file is empty" when `text.trim() === ""`.

**9. The exception rate and the AI cap do not fit the brief.**
- The exception rate is 7.4%, not the 15–20% the brief expects.
- The queue of flagged SKUs is about 5× larger: a median of 149 SKUs per run.
- In festival weeks, exceptions peak at 96 per run, above `max_ai_calls_per_run` = 80, so about 16 exceptions
  would show "Rationale unavailable" in the busiest weeks of the year.

[lib/services/enrich.ts:65](../lib/services/enrich.ts) already calls in queue-rank order, so the
exceptions that go without a rationale are the lowest-ranked ones. Proposed fix: either raise the cap for
festival months or fix finding 5. Finding 5 removes most possible_double_count exceptions, which are a third
of all exceptions.

## Does this testing need a change to the components map or the architecture?

**Yes.** The core architecture holds: a deterministic engine sets the quantities, Claude explains exceptions
only, and the planner approves. But the map has to change in five places:

1. **SAP and Zoho lane, Input.** Change "Sales, stock, open POs" to "Sales, **weekly stock snapshots, PO
   history with ordered / received dates**". Without PO history and past stock snapshots, the backtest
   (finding 1), the agreement kill criterion and outcome measurement are all wrong or impossible.
2. **Add a new lane: "Outcome tracker" (Phase 3 job).**

   | Trigger | Input | Processing | Output |
   |---|---|---|---|
   | 4 weeks after each run | sales and stock since the run | compares each flag with what happened (stockout / write-off) | `outcomes` table → dashboard and the ₹28 lakh and agreement kill criteria |

   This is the production version of this test's "did the flag predict reality" check. The README lists the
   job as not built, and the current map has no box for it.
3. **Raghav as reviewer lane, Processing.** Change "Steps in on exceptions" to "Reviews all flagged SKUs:
   bulk-approves rule-governed reorders and pauses, investigates exceptions". The data shows about 149
   flagged SKUs per run against about 21 exceptions. The override-rate kill criterion counts every decided
   SKU, not only exceptions.
4. **Rules engine lane, Context.** Either add "Lead times (from SKU master)" as an input the engine actually
   uses (finding 6, recommended), or remove "lead times" from the SAP and Zoho context column. Today the map
   claims a dependency that the engine ignores.
5. **Claude Sonnet 5.5 lane, Output.** Add "up to 80 per run, in queue-rank order; the rest show 'Rationale
   unavailable'". Festival weeks exceed the cap (96 exceptions), so the map should show this limit.

No new box is needed for ingestion speed **if** finding 2 is fixed. If it is not fixed, the Phase 3 scheduled
ingestion must run as a background job, not inside the upload request.

## Files

| Path | What |
|---|---|
| [scripts/stress/generate.ts](../scripts/stress/generate.ts) | Seeded generator and the CSV / ground-truth writer |
| [scripts/stress/isoweek.ts](../scripts/stress/isoweek.ts) | Independent ISO-week helpers (no `lib/` import) |
| [tests/stress/oracle.ts](../tests/stress/oracle.ts) | Independent spec oracle |
| [tests/stress/harness.ts](../tests/stress/harness.ts) | Loading, time-correct replay, ground truth, scoring |
| [tests/stress/actual.test.ts](../tests/stress/actual.test.ts) | ACTUAL data: oracle vs engine, acceptance values, 400-SKU cross-check |
| [tests/stress/training.test.ts](../tests/stress/training.test.ts) | TRAINING sweeps; defaults unchanged |
| [tests/stress/test-set.test.ts](../tests/stress/test-set.test.ts) | TEST replay, metrics, runtime, backtest at scale |
| [tests/stress/edge.test.ts](../tests/stress/edge.test.ts) | Edge and load cases |
| `sample-data/stress/*.csv`, `ground_truth.json` | Generated data (`npx tsx scripts/stress/generate.ts`) |
| `sample-data/stress/results/*.json` | Metrics written by each test run |

Tests named `FINDING:` pin the current behaviour behind findings 1–9. When a fix lands, the matching test
fails on purpose; update it to assert the fixed behaviour.
