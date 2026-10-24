# Which problem first? Demand Planning

Deepa Nair, Head of Operations, has ₹15 lakh, 90 days, no AI team, a 3-person SAP team and one data
analyst. Her CEO wants something running by Q1. She put three areas on the table:
**Demand Planning**, **Distributor Service** and **Operations Intelligence**.

**Decision: build Demand Planning first.** It is the only one of the three with a costed, recurring loss,
data that already exists, logic that is mostly written down, and a named owner who wants the change. The
other two are worth doing, but each fails a check that has to pass before building.

> Note on the framework: this write-up walks through nine checks and a pre-build checklist using the
> facts in Deepa's briefs. If your course defines the 9 checks or the checklist items with different
> names, map them onto the rows below; the evidence in each row stays the same.

## The nine checks

| # | Check | Demand Planning | Distributor Service | Operations Intelligence |
|---|---|---|---|---|
| 1 | **Is the problem costed?** | ✅ ₹28–34 lakh lost every quarter (stockouts ₹18–22 lakh, perishable write-offs ₹10–12 lakh) | ⚠️ Partly: three distributors lost, one ₹28 lakh account cut orders by 30%. No recurring figure. | ⚠️ One incident: a ₹9 lakh write-off. No recurring figure. |
| 2 | **Is the cause clear?** | ✅ The data is 3–4 weeks old by the time procurement acts, because preparing it by hand takes Raghav two days a month | ⚠️ Assumed: a 60–70% "repetitive queries" hypothesis that nobody has checked | ✅ Clear, but it isn't a data problem: no one acts on SAP signals between weekly reports |
| 3 | **Does the data exist?** | ✅ Three years of distributor-level sales in SAP, exportable as files | ❌ No: WhatsApp chats are not archived, query categories don't exist, response times have never been measured | ✅ Two years of clean SAP data; the 12 metrics are well defined |
| 4 | **Is the logic known?** | ✅ Raghav documented five rules that cover 80–85% of his decisions | ❌ No: categories and answers have never been defined | ✅ Metrics are defined, but who acts on a change is not |
| 5 | **Does AI add something rules can't?** | ✅ For the 15–20% of SKUs the rules can't settle: explain why, and what to check first. The rules set every quantity. | ⚠️ Possibly, once the data exists (answering routine queries) | ❌ Mostly not: what's missing is a daily alert and an owner, which needs no AI |
| 6 | **Is a wrong answer recoverable?** | ✅ Yes: a planner approves every line before procurement sees it | ⚠️ Risky: wrong answers go straight to distributors, the company's main asset | ✅ Yes, but the fix is in the process |
| 7 | **Does it fit 90 days, ₹15 lakh and no AI team?** | ✅ CSV uploads, a deterministic engine, one AI call per exception with a monthly spend cap | ❌ Needs WhatsApp Business integration, a knowledge base and query data first | ✅ Fits, but mostly as reporting work, not AI |
| 8 | **Can success be measured, and is there a point to stop?** | ✅ The quarterly loss figure exists; kill criteria are set (below) | ❌ No baseline exists to measure against | ⚠️ Lead time from signal to action can be measured; loss per quarter can't |
| 9 | **Does the user want it?** | ✅ Raghav: "If the data were already organised for me, I could run the same analysis twice a week." | ⚠️ The CS lead believes queries are routine, but has no data | ⚠️ The CEO and procurement would have to change how approvals work |

**Result:** Demand Planning passes all nine. Distributor Service fails 3, 4, 7 and 8 because the data
doesn't exist yet. Operations Intelligence fails 5: it's a real problem, but a process and alerting
problem, not an AI one.

## Pre-build decision checklist (Demand Planning)

| Item | Answer |
|---|---|
| End goal | Cut combined stockout and write-off loss from ₹28–34 lakh to ₹25 lakh or below per quarter, within two full quarters of going live |
| Primary user | Raghav Kulkarni, Senior Demand Planner: twice-weekly review instead of two days of monthly data work |
| Decision owner | Deepa Nair: owns the budget, the outcome and the kill decision |
| What the AI does | Explains only the exceptions (rationale and "check this first"). It never sets or changes a quantity |
| What stays human | Every order line: Raghav approves, changes or rejects it, with a reason code for any override |
| Data and integration | SAP exports and Zoho POs as CSV uploads in Phases 1–2; SFTP and the Zoho API in Phase 3. No API access is assumed |
| Cost control | Free tiers for hosting and database; AI capped at 80 calls a run and a monthly spend cap |
| Kill criteria | (1) Backtest agreement on rule-governed SKUs below 75% at the end of week 2; (2) override rate above 40% for 3 runs in a row; (3) loss still above ₹28 lakh after two full quarters |
| Fallback | Raghav's monthly Excel process, using the plain-language rules on the Rules page |
| Validation before go-live | Acceptance test on the sample data, and a stress test on 400 synthetic SKUs × 3 years ([stress-test.md](stress-test.md)) |

## What happens to the other two

- **Distributor Service: start collecting data now, build later.** For 4–6 weeks the CS team tags every
  WhatsApp query with a category and a response time (a shared sheet is enough). That turns the 60–70%
  hypothesis into a number, and it becomes the training and test set for an assistant in the next quarter.
- **Operations Intelligence: fix the process, then automate.** Name an owner for each of the 12 metrics
  and a threshold that triggers action. Once Demand Planning's twice-weekly SAP pipeline exists, a daily
  alert on distributor order drops is a small addition on the same data. The ₹9 lakh incident would have
  been caught by such an alert on the Wednesday.
