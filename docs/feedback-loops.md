# Feedback loops: where the build needs them

Framework: **Act → Signal → Capture → Store → Retrieve → Apply**, with **Measurement** watching the whole
circuit from underneath. A loop that is missing any stage doesn't learn: it only acts.

## What the system does today

| Stage | What exists | Gap |
|---|---|---|
| Act | The rules engine recommends a flag and a quantity for every SKU; Claude explains exceptions | — |
| Signal | Raghav approves, changes or rejects each line, with a reason code | **What actually happened to the SKU afterwards is never observed** |
| Capture | Decisions, reasons and notes are saved on `recommendations`; every action goes to `audit_log` | No capture of stock-outs or write-offs after a decision |
| Store | `recommendations`, `audit_log`; an `outcomes` table exists | `outcomes` is never written |
| Retrieve | Claude gets the SKU's last 3 overrides; the Review page suggests "Use 600" from Raghav's last 4 runs | Nothing retrieves results ("last time you cut this order, it ran out") |
| Apply | Prefilled quantities; "rules may not fit this SKU" flag after 3 overrides in 5 runs | Nothing turns evidence into a better rule, by design: the engine never changes its own rules |
| Measurement | Kill-criteria lights on the Performance page | Loss and agreement lights stay grey: they need outcomes |

## Where a loop is necessary

### Loop 1: Outcome loop (necessary, build first)

**Why it's necessary:** the end goal is loss in rupees (stock-outs and write-offs), and a loss can only be
seen after the decision. Without this loop the system can't tell whether its own recommendations, or
Raghav's overrides, were right. Two of the three kill criteria (loss after two quarters; whether the rules
fit) can't be measured, so Deepa can't make the go/no-go call the plan depends on.

| Stage | Build |
|---|---|
| Act | A released order (or a pause), as decided by Raghav |
| Signal | The next four weeks of SAP sales and stock snapshots, plus write-offs (a new optional `write_offs.csv` upload) |
| Capture | An outcome job runs after each upload. For every decision whose four weeks are covered, it computes stock-out weeks, stock left after 4 weeks, and units written off |
| Store | `outcomes` gets one row per decision, labelled with what happened (`stocked_out`, `wrote_off`, `overstocked`, `ok`) and who drove it (`rule` if the recommendation was accepted, `override` if Raghav changed or rejected it) |
| Retrieve | Per SKU: the last outcomes and whether the rule or the override was right. Shown in the SKU pop-up and passed to Claude with the overrides |
| Apply | The Performance page shows rule hit rate against override hit rate, and the rupee loss for the quarter; SKUs where the rule keeps missing are listed for Raghav to review |
| Measurement | The ₹25 lakh target and the ₹28 lakh kill light now have real numbers; override rate is read alongside whether overrides helped |

### Loop 2: Override → rule review (necessary, after Loop 1)

**Why it's necessary:** the rules are static and cover 80–85% of decisions. If Raghav keeps correcting the
same thing ("rule too strict" on perishables in festival months), that knowledge is lost unless it reaches
the rules. The engine must never retune itself, so Apply has to be a **proposal Raghav accepts**.

| Stage | Build |
|---|---|
| Act | The rules recommend |
| Signal | Overrides with reason codes, plus Loop 1's verdict on whether each override helped |
| Capture / Store | Already captured on `recommendations`; Loop 1 adds the result |
| Retrieve | Group overrides by reason code, perishability, category and month |
| Apply | A "Rule review" card on the Rules page: for example, *"You raised perishable orders in festival months 6 times; 5 of those avoided a stock-out. Try a festival uplift of 35% for perishables?"* Accepting creates a new rule version, which is backtested before the next run |
| Measurement | Override rate per rule version; backtest agreement before and after the change |

### Loop 3: Explanation quality (useful, not necessary)

Claude's rationale is Act; whether Raghav found it useful is Signal. A thumbs up or down on each
explanation, stored per rule version and prompt version, would show whether the explanations help. With
2–20 exceptions a run there is too little volume to tune a prompt automatically, so this stays a simple
rating that a person reads.

## Not a loop: data quality

Upload warnings (gaps, duplicates, unknown SKUs) are already shown and stored. They need a person to fix the
SAP export, not a learning loop.

## Build order

1. **Loop 1, outcome computation**: a pure function from later sales, stock and write-offs to an outcome
   per decision, tested on the sample data and the stress set (`lib/outcomes.ts`).
2. **Loop 1, storage and job**: a migration for the outcome labels and `write_offs`, a `write_offs.csv`
   upload type, and an outcome job that runs after each upload and daily from the existing cron.
3. **Loop 1, apply and measure**: the Performance page (rule against override hit rate, quarterly loss),
   the SKU pop-up ("Last 3 outcomes"), and Claude's context.
4. **Loop 2**: the rule-review proposals on the Rules page, gated by Raghav and backtested.
