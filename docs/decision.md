# Which problem first? Demand Planning

Deepa Nair, Head of Operations, has ₹15 lakh, 90 days, no AI team, a 3-person IT team managing SAP and one
data analyst. Her CEO wants something running by Q1. She put three areas on the table: **Demand Planning**,
**Distributor Service** and **Operations Intelligence**.

**Decision: build Demand Planning first.** Distributor Service fails a Kill Switch because the data doesn't
exist yet. Operations Intelligence passes the Kill Switches, but it needs an owner before anything else, and
what it needs first is a threshold alert, not AI.

## Deliverable 1: the Nine Checks

**How to read the groups:** any NO in Kill Switches means don't build it. Any NO in Sizing means build
something smaller. Any NO in Boundary means put a human exactly there.

### Kill Switches

| # | Check | Demand Planning | Distributor Service | Operations Intelligence |
|---|---|---|---|---|
| 01 | **Problem real?** | **YES.** Raghav Kulkarni spends about two working days a month on data work, and his forecast reaches procurement 3–4 weeks old. Cost: ₹28–34 lakh a quarter. | **YES.** A 4-person CS team handles 50–80 WhatsApp messages a day with no tracking. Three distributors lost last year; a ₹28-lakh Nashik account missed a scheme. | **YES.** A ₹22 lakh procurement was approved on Monday's report. Distributors cut orders on Wednesday, and the write-off was ₹9 lakh. |
| 02 | **Workflow repeated?** | **YES.** Monthly today. Raghav could run it twice a week if the data were organised. | **YES.** Every day, including queries at 7pm and on Sundays that wait until morning. | **YES.** Priya Sharma's report every Monday; procurement approvals once a week. |
| 03 | **Input available?** | **YES.** Three years of distributor-level sales in SAP, which IT confirms can be exported as structured files. POs are in Zoho Inventory. | **NO.** WhatsApp isn't archived, query categories were never defined, and response times were never measured. The 60–70% repetitive-query figure is a hypothesis with no data behind it. | **YES.** Two years of clean SAP data and 12 well-defined metrics. The pipeline to Excel is manual but straightforward. |

### Sizing

| # | Check | Demand Planning | Distributor Service | Operations Intelligence |
|---|---|---|---|---|
| 04 | **Output valuable?** | **YES.** Each flagged SKU gets a flag and a quantity from the rules. Exceptions also get Claude's explanation and what to check first. Raghav approves, changes or rejects it. | **UNCERTAIN.** A drafted reply could be useful, but nobody knows which questions matter most. | **NO.** The missing piece is someone acting when a metric moves. A threshold alert does that; an AI summary adds "insights" nobody owns. |
| 05 | **Impact measurable?** | **YES.** Quarterly stockout and write-off loss, with a baseline in the brief. | **NO.** There is no baseline for response time or resolution rate. | **UNCERTAIN.** One costed incident (₹9 lakh), but no recurring figure. |
| 08 | **ROI worth it?** | **YES.** Reaching ₹25 lakh saves ₹3–9 lakh a quarter, so the full ₹15 lakh budget pays back in about 2–5 quarters. The build itself runs on free hosting tiers with a capped AI spend. | **UNCERTAIN.** A lost distributor costs ₹1.5–2 lakh to replace and ₹18–25 lakh a year in revenue, but the share of queries AI could answer is unknown. | **UNCERTAIN.** An alert is cheap, but one incident doesn't justify an AI build. |

### Boundary

| # | Check | Demand Planning | Distributor Service | Operations Intelligence |
|---|---|---|---|---|
| 06 | **Failure risk OK?** | **YES.** The worst case is one wrong order line, and Raghav sees every line before procurement does. The AI can't set a quantity, and rule quantities are capped at 3× standard. | **NO.** A wrong answer on scheme eligibility or a credit note goes straight to a distributor, the company's main channel asset. A human must approve replies. | **YES.** A false alert costs a few minutes of checking, as long as a person decides. |
| 07 | **Judgment protected?** | **YES.** Raghav can approve, change or reject anything. Overrides need a reason code, and the rules never retune themselves. | **UNCERTAIN.** Depends on whether a person sees each reply before it goes out, which the brief leaves open. | **YES.** Alerts inform; procurement and the CEO still decide. |
| 09 | **Owner clear?** | **YES.** Raghav owns the input and every line. Procurement places the orders. Deepa owns the outcome and the kill decision. | **UNCERTAIN.** There is a CS lead, but no handoff protocol and no owner per query type. | **NO.** The brief says so itself: the open question is "who acts when a metric moves, and how fast". Put a named person exactly here first. |

### Verdicts

| Area | Verdict | Binding reason |
|---|---|---|
| **Demand Planning** | **Build** | All nine checks pass |
| **Distributor Service** | **Don't build yet** | Check 03 fails: the input doesn't exist. Checks 05 and 06 also fail |
| **Operations Intelligence** | **Build smaller, later** | Passes the Kill Switches, but checks 04 and 09 fail: name an owner first, then add an alert rather than AI |

> **Open questions before build (Demand Planning):** none block the build. API access to SAP and Zoho isn't
> confirmed in the brief, so data enters as uploaded files.
>
> **Open questions for the other two:**
> - Distributor Service, 03 and 05: what do the queries actually look like? → tag every WhatsApp query for 4–6 weeks.
> - Operations Intelligence, 09: who acts when a metric moves? → Deepa names an owner and a threshold for each of the 12 metrics.

**Tempting but wrong:**

- *"Let the AI forecast and set the order quantities."* → Killed by checks 06 and 07. Raghav's five rules already cover 80–85% of decisions, and nobody could trace an AI quantity back to a rule.
- *"Let the rules retune themselves from Raghav's overrides."* → Killed by checks 07 and 09. Changes are proposed instead, and Raghav decides ([feedback-loops.md](feedback-loops.md)).
- *"Put a WhatsApp bot in front of distributors now."* → Killed by check 03, and by check 06 if it replies unsupervised.
- *"Give the CEO a real-time AI dashboard."* → Killed by checks 04 and 09. Faster data doesn't help if nobody is assigned to act on it.

## Deliverable 2: the Five Pre-Build Decisions

The framework runs these on every option that survives the Kill Switches: Demand Planning and Operations
Intelligence. Writing them for both is what settles the choice.

### Why Operations Intelligence loses at this step

| Decision | Operations Intelligence |
|---|---|
| Outcome | Fewer procurement decisions made on data that has since moved. No agreed number exists |
| Baseline | One ₹9 lakh incident; no count of how often it happens. Priya's 4 hours are explicitly not the bottleneck |
| Workflow change | Depends on an owner who hasn't been named, and on procurement moving beyond weekly approvals |
| Measurement | Could count alerts acted on, but can't connect them to rupees without more incidents |
| Kill criterion | Can't be set honestly without a baseline |

**Next step for it:** name owners and thresholds. Once Demand Planning's twice-weekly SAP files exist, a daily
alert on distributor order drops is a small addition on the same data. Such an alert would have caught the
₹9 lakh incident on the Wednesday.

**Next step for Distributor Service:** for 4–6 weeks the CS team tags every WhatsApp query with a category
and a response time (a shared sheet is enough). That turns the 60–70% hypothesis into a number and becomes the
training and test set for an assistant next quarter.

The rest of this section is the chosen option, Demand Planning.

### i. Outcome Definition

- **The end goal:** Freshroots stops losing money on SKUs that ran out or expired, because procurement orders against this week's demand and not last month's.
- **Primary metric:** combined stockout and write-off loss moves from **₹28–34 lakh a quarter** to **₹25 lakh or below** within two full quarters of going live.
- **Why this metric and not another:** it is the money the brief says is being lost. Time saved or forecast accuracy could both improve while the loss stays the same.
- **What counts:** lost sales on SKUs that ran out, and write-offs, mainly on perishable SKUs.
- **What doesn't count:** the ₹9 lakh raw-material write-off (Operations Intelligence), distributor churn (Distributor Service), and hours saved, which is a benefit but not the goal.

### ii. Baseline

- **Current workflow:** once a month, Raghav (1) pulls sales and inventory from SAP, (2) runs the calculations in Excel, (3) produces a forecast for 400 SKUs across 1,200 distributors, (4) hands it to procurement, who place orders. The brief gives about two working days for the whole job, not a time per step.
- **Current performance against the end goal:** ₹18–22 lakh a quarter in stockouts plus ₹10–12 lakh in overstock write-offs, so ₹28–34 lakh.
- **Current cost:** about two of Raghav's working days every month, plus the loss above.
- **Where the current process fails the end goal:** by the time the forecast reaches procurement, the data is 3–4 weeks old, so festival demand and competitor schemes are missed. Raghav says the manual data work is the bottleneck: "If the data were already organised for me, I could run the same analysis twice a week." The 15–20% of decisions made on judgment are also undocumented.

### iii. Workflow Change

**New workflow, twice a week:**

1. Raghav uploads the latest SAP files on the Data page. *(Changed: still manual, but checked automatically and previewed.)*
2. He runs planning. The rules engine flags every SKU, sets quantities and marks exceptions. *(Replaces the Excel work.)*
3. Claude explains only the exceptions. *(New.)*
4. Raghav reviews on the Overview and Review screens: bulk-approves straightforward lines, decides judgement lines, and gives a reason for any change. *(Now a short review instead of data work.)*
5. He sends the approved lines to procurement. Procurement previews, then creates and issues the POs in Zoho. *(Changed: one step instead of a hand-off.)*
6. Four weeks later the app compares each decision with what happened. *(New.)*

**How each change serves the end goal:**

| Change | Why the loss should fall |
|---|---|
| Twice a week, not monthly | Orders use data days old, not weeks, so festival and scheme shifts are caught in time |
| Rules run on every SKU | All 400 SKUs get checked each cycle, and the riskiest come first by rupee exposure |
| Explanations on exceptions only | Raghav's time goes to the 15–20% where his judgment changes the result |
| Outcomes after four weeks | Shows whether the rule or the override was right, so bad rules get corrected |

- **Human touchpoints:** approving, changing or rejecting each line (Raghav); confirming unusually large quantities and issuing orders (procurement); the kill decision (Deepa).
- **What the user never sees:** file validation and duplicate detection, the run lock, the AI retry and spend cap, order claiming that prevents duplicate POs, the audit log, and the daily Zoho status sync.

### iv. Measurement Plan

- **Leading indicator (week 1):** two reviews completed, and data age at release (send date minus stock date) under 7 days, against 3–4 weeks today.
- **Primary metric (week 4):** the first estimated rupee loss, from the first decisions with four weeks of later data, measured against the ₹25 lakh target.
- **Guardrail metrics:** stockout weeks and perishable units written off must not rise; override rate stays at or below 40%; AI spend stays under the monthly cap.
- **End-goal validation:** the quarterly loss after two full quarters, checked against finance's own figures.
- **How measured:** every run, decision, override and outcome is stored. The Performance page shows accept and override rates, stockout weeks, write-offs, estimated loss, AI spend and the kill-criteria lights. Data age isn't on that page yet; it comes from stored run and decision dates.

**Known limit:** the app estimates loss as stockout weeks × adjusted demand × unit price, plus written-off units × unit price. The brief's ₹28–34 lakh wasn't necessarily worked out the same way, so the first quarter should be compared with finance's figure before trusting the two side by side. SKUs with no unit price aren't counted, and the page says so.

### v. Kill Criterion

- **Kill if any of these is true:**
  1. Combined loss is still above ₹28 lakh after two full quarters. This is the end-goal test.
  2. Backtest agreement on rule-governed SKUs is below 75% at the end of week 2. An early warning that the rules don't match how Raghav decides.
  3. Override rate is above 40% for 3 runs in a row. An early warning that he isn't trusting the output.
- **Fallback:** Raghav's monthly Excel process, using the plain-language rules on the Rules page.
- **Who decides:** Deepa Nair. The three lights are on the Performance page.

**Evidence so far:** on synthetic data, agreement with simulated planner decisions was 80.6%, above the 75% line. The rules also passed the acceptance test on the sample files ([stress-test.md](stress-test.md)). Synthetic results show the logic works. They don't show the loss will fall; only live use can.
