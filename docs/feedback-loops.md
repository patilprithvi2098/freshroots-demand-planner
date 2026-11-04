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

## What is built (2026-11-04)

| Loop | Stage | Where |
|---|---|---|
| 1 | Signal: write-offs | `write_offs.csv` upload (Data page → Optional), table `write_offs` |
| 1 | Capture: outcome per decision | `lib/outcomes.ts` (pure, tested) |
| 1 | Store | `outcomes` gets `result`, `driver`, `evidence`, horizon weeks (migration `0004_feedback_loops.sql`) |
| 1 | When it runs | After every sales, stock or write-off upload, in the daily cron (`/api/cron/keepalive`), and in `npm run demo-reset` (`lib/services/outcomeJob.ts`) |
| 1 | Retrieve | SKU pop-up "What happened after past decisions"; Claude receives `past_outcomes` (labels and numbers only) |
| 1 | Apply / Measurement | Performance page "Did the decisions work?": rule against override success, SKUs where the rule keeps missing; loss estimate uses the measured stock-outs and write-offs |
| 2 | Retrieve → Apply | `lib/ruleReview.ts` (pure, tested): 3+ consistent changes in the last 5 runs made with the current rules → a proposal, suppressed when outcomes show the rule did better |
| 2 | Gate | Rules page "Rule review": Accept saves a new rule version and backtests it; Dismiss records it. Decisions are stored in `rule_proposal_decisions`. Corrections made under an older rule version never propose a second change |
| Both | Proof | `tests/e2e/loops.spec.ts`: three runs with the same correction → proposal → accepted → version 2; four weeks of follow-up data → outcomes measured, shown on the Performance page and in the pop-up |

Driver ("rule" or "override") is always read from the decision as it stands now, so a line decided after its
outcome was first measured is attributed correctly.

## Build order

1. **Loop 1, outcome computation**: a pure function from later sales, stock and write-offs to an outcome
   per decision, tested on the sample data and the stress set (`lib/outcomes.ts`).
2. **Loop 1, storage and job**: a migration for the outcome labels and `write_offs`, a `write_offs.csv`
   upload type, and an outcome job that runs after each upload and daily from the existing cron.
3. **Loop 1, apply and measure**: the Performance page (rule against override hit rate, quarterly loss),
   the SKU pop-up ("Last 3 outcomes"), and Claude's context.
4. **Loop 2**: the rule-review proposals on the Rules page, gated by Raghav and backtested.
