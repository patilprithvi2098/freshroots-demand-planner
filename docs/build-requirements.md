# Build Requirements Brief (draft)

> **Status: draft for confirmation.** The framework asks the builder to write this in their own words. It was
> drafted from the brief, the spec and the finished build, after Stage 0 was skipped by choice. It has not been
> reviewed and agreed.

## 1. The problem and the core verb

**Problem:** Raghav Kulkarni's demand forecast reaches procurement 3–4 weeks old because preparing it takes two
days of manual data work a month, and Freshroots loses ₹28–34 lakh a quarter on stockouts and write-offs.

**Core verb:** **get procurement ordering against this week's demand**, with Raghav still making the call.

## 2. The primary user and their day

Twice a week, Raghav opens the Overview. He sees where the cycle stands and what is running low or overstocked.
He uploads fresh files if needed, runs planning, bulk-approves the straightforward lines, decides the judgement
lines and sends the result to procurement. He leaves with every flagged SKU decided and nothing left to chase.

## 3. Must-have requirements

Every requirement serves the same outcome: combined loss at ₹25 lakh a quarter or below.

| # | Requirement | Comes from the brief | Status |
|---|---|---|---|
| R1 | Load SKU, sales, stock, distributor and calendar files, with validation and preview | "three years of distributor-level sales data in SAP… exported as structured files" | Built |
| R2 | Apply Raghav's five documented rules, the same way every time, to every SKU | "this logic governs approximately 80–85%" | Built; acceptance test passes |
| R3 | Mark the cases rules can't settle, and explain only those with AI | "new product launches, unusual distributor behaviour, one-off market events" | Built |
| R4 | The AI never sets a quantity | "handles on judgment" stays with Raghav | Built |
| R5 | Raghav approves, changes or rejects every line; changes need a reason | "The process runs on Raghav's judgment" | Built |
| R6 | A review short enough to run twice a week | "I could run the same analysis twice a week" | Built; time not yet measured with Raghav |
| R7 | Approved lines reach procurement, who place POs in Zoho | "Purchase orders are managed in Zoho Inventory" | Built; goes further than the spec |
| R8 | Track the rupee loss and the kill criteria | "₹28–34 lakhs every quarter" | Built; loss needs four weeks of later data |
| R9 | Measure what happened after each decision, and propose rule changes for Raghav to accept | The undocumented 15–20% | Built |
| R10 | Work at real scale: 400 SKUs, 1,200 distributors, three years of data | "400 active SKUs across 1,200 distributors" | Tested on synthetic data |

## 4. Explicit exclusions

| Left out | Why | What it costs |
|---|---|---|
| **Automatic SAP feed** (export folder or SFTP) | Needs Freshroots' IT team to schedule the export | **The biggest gap.** Raghav still uploads files by hand, and the manual data work is the bottleneck he named. It is reduced, not removed |
| **Scheduled Tuesday and Friday runs** | Only useful once files arrive by themselves | Raghav has to remember to start each cycle |
| **Reading open POs and lead times from Zoho** | Orders placed through the app are tracked, but other open POs still arrive by file | Stock on order can be understated if the file is out of date |
| **Lead time in the rules** | Raghav's five rules don't use it, so changing that is his decision | On synthetic data, 12% of stockout flags were already too late to act on |
| **Error monitoring and backups** (spec Phase 3) | Needed for real use rather than the demo | Failures are seen only in the hosting logs, and backups rely on the database provider |
| **Distributor Service and Operations Intelligence** | They fail the Nine Checks for now ([decision.md](decision.md)) | Those problems continue until their own first steps happen |

## 5. How it will be judged or measured

| Test | Answered by |
|---|---|
| The brief: "Using the 9-checks and the Pre-Build Decision Checklist, determine which…" | [decision.md](decision.md) |
| The brief: "Build the solution, end-to-end" | R1–R7 on the live site |
| Do the rules work? | R2: acceptance test and [stress-test.md](stress-test.md) |
| Does the loss fall to ₹25 lakh? | R8: only live use over two quarters can show this |

## 6. The one result to show first

Open the Overview with stock as of 19 October 2026: **7 SKUs to review, 2 needing judgement.** Then open SKU001.
The rules flag a stockout risk with high demand and a quantity of 750, and Claude points out that the festival
uplift and the rising trend may be counting the same demand twice. Raghav makes the call.
