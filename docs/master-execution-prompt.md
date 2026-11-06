# Master execution prompt

This is the build prompt the project started from, kept word for word below the line. It is Deliverable 6 of the
framework. The nine checks and pre-build decisions now in [decision.md](decision.md) were rewritten afterwards.

## What changed during the build

| The prompt says | What was built | Why |
|---|---|---|
| Email magic links | Username and password | Asked for by the product owner |
| Temperature 0.2 | Default temperature, low effort | Claude Sonnet 5.5 rejects other sampling settings |
| Review queue as the home screen | Overview first, details in a pop-up | Feedback on the first version |
| Procurement reads and exports | Procurement also creates and issues POs in Zoho | Added at the product owner's request |
| Phase 3 outcome capture | Built, with a rule-review loop on top | Two of the kill criteria need it |
| Phase 3 SAP feed, scheduled runs, monitoring, backups | Not built | See [build-requirements.md](build-requirements.md) |
| CI on every pull request | Workflow file is ready in `ci/`, not switched on | Needs a GitHub token with the `workflow` scope |

---

You are building the Freshroots Demand Planning Assistant for Freshroots. Here is the full context:
Company Context
Freshroots is a 200-person regional FMCG company that distributes packaged snacks and staples across Maharashtra and Goa. It has grown steadily over 12 years through distributor relationships and trade margins. It sells 400 active SKUs through 1,200 distributors. It is not a startup and not an MNC.
Systems and people: SAP ERP holds sales and inventory data and is managed by a 3-person IT team. Purchase orders are placed in Zoho Inventory by the procurement team. Raghav Kulkarni, Senior Demand Planner for six years, builds the monthly forecast by hand in Excel and is the primary user of this system. Priya Sharma is the data analyst and does not use this system. Deepa Nair, Head of Operations, owns the budget and the outcome. The CEO asked for something running by Q1.
Constraints: budget of 15 lakh rupees, 90 days, no AI team, and no confirmed API access to SAP or Zoho. Data therefore enters through CSV upload in Phases 1 and 2.
The problem in numbers: demand planning errors cost 28 to 34 lakh rupees per quarter (stockout lost sales 18 to 22 lakh, overstock write-offs mostly on perishables 10 to 12 lakh). The monthly cycle means data is 3 to 4 weeks old by the time procurement acts.
The End Goal
Freshroots stops losing money on SKUs that ran out or expired, by cutting combined stockout and write-off loss from 28 to 34 lakh rupees per quarter to 25 lakh or below within two full quarters of going live, because procurement orders against this week's demand and not last month's.
What This System Does
Twice a week (Tuesday and Friday morning) a planner uploads or triggers a run on the latest SAP sales and inventory files. A validator checks the data. A deterministic rules engine applies Raghav's five documented rules to every SKU and produces, for each one, a flag (stockout risk, overstock risk, high demand, or no action), a recommended order quantity, and a trace of which rules fired. SKUs that do not fit the rules cleanly are marked as exceptions, and only those are sent to Claude Sonnet 5.5, which writes a short rationale and a "check this first" line for Raghav. The AI never sets or changes a quantity. Raghav reviews a ranked queue, approves, edits or rejects each recommendation (edits and rejections require a reason), and releases the approved list to procurement, who place the POs in Zoho. Every run, recommendation, override and four-week outcome is stored so the loss metric and the kill criteria can be tracked. Raghav replaces about two days of monthly data work with a short twice-weekly review and keeps full control of the decision.
Technical Architecture

* Frontend: Next.js (App Router) with TypeScript and Tailwind CSS. Screens: login, upload, runs, review queue, procurement view, backtest, metrics dashboard, settings.
* Backend: Next.js route handlers and server actions on Vercel. The rules engine is a pure TypeScript module in `lib/rules/` with no I/O, fully unit tested with Vitest. Validation with Zod.
* Database: Supabase Postgres with row level security. Tables are listed in the Data Model section.
* AI Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`) through the Anthropic Messages API, called server-side only. It receives one exception SKU per call as JSON (SKU facts, the 16 or more most recent weekly sales, weeks of cover, the rule trace, the exception reason, and the planner's last three overrides on that SKU). It returns JSON with `rationale` and `check_first`. Temperature 0.2, max 300 output tokens.
* External APIs: Anthropic Messages API only in Phases 1 and 2. Phase 3 adds the SAP export folder or SFTP drop and the Zoho Inventory API (open purchase orders and PO-to-receipt lead times).
* Auth: Supabase Auth with email magic links. Roles stored in a `profiles` table: `planner` (Raghav, full access), `procurement` (read the approved list and export it), `viewer` (Deepa, read-only dashboard).
* Deployment: GitHub repository, Vercel for the app and cron, Supabase for the database. GitHub Actions runs lint, type check and Vitest on every pull request. Environment variables hold all keys.

Data Model
Key fields only. Use snake_case. All tables have `id` (uuid) and `created_at` unless a natural key is given.

* `profiles`: id (auth user), email, role (planner, procurement, viewer).
* `distributors`: distributor_id (PK), name, region, status.
* `skus`: sku_id (PK), name, category, perishability (high or low), standard_reorder_qty, unit_of_measure, distributor_id, launch_date (nullable), unit_price (nullable), lead_time_days (nullable).
* `weekly_sales`: sku_id, iso_week (text like `2026-W42`), units_sold, distributor_id (nullable). Unique on sku_id, iso_week and coalesce(distributor_id, '').
* `inventory_snapshots`: sku_id, location, units_on_hand, as_of_date.
* `open_purchase_orders` (optional feature): po_id, sku_id, qty, ordered_date, expected_date, status.
* `calendar`: year_month (PK), year, month, is_festival_month.
* `upload_batches`: file_type, filename, file_hash, uploaded_by, row_count, status, warnings (jsonb).
* `rule_config`: version (int), params (jsonb), created_by, active (bool). Default params: festival_uplift_pct 25, avg_window_weeks 12, trend_window_weeks 4, trend_threshold_pct 20, trend_reorder_multiplier 1.5, low_perishability {min_weeks 6, max_weeks 14}, high_perishability {min_weeks 3, max_weeks 4}, new_launch_weeks 8, stale_inventory_days 4, distributor_share_shift_pp 15, max_ai_calls_per_run 80.
* `runs`: run_date, as_of_date, triggered_by, config_version, status, sku_count, flagged_count, exception_count.
* `recommendations`: run_id, sku_id, flag (stockout_risk, overstock_risk, high_demand, no_action), rules_fired (jsonb), weeks_cover, trend_pct, recommended_action, recommended_qty, is_exception, exception_reasons (text[]), rationale, check_first, status (pending, approved, edited, rejected), final_qty, decided_by, decided_at, override_reason_code, override_note, released_at.
* `outcomes`: recommendation_id, measured_at, stock_after_4_weeks, stockout_weeks, written_off_units (nullable).
* `backtest_results`: run_at, config_version, weeks_replayed, agreement_pct (nullable), detail (jsonb).
* `audit_log`: actor, action, entity, entity_id, detail (jsonb).

Input CSV schemas (the sample files, which the loaders must accept exactly):

* `sku_master.csv`: SKU_ID, SKU_Name, Category, Perishability, Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID.
* `weekly_sales.csv`: SKU_ID, Week, Units_Sold.
* `current_inventory.csv`: SKU_ID, Location, Units_On_Hand, As_Of_Date.
* `distributor_master.csv`: Distributor_ID, Distributor_Name, Region, Status.
* `calendar.csv`: Year, Month, Year_Month, Is_Festival_Month.

Optional extra columns the loaders must also accept when present: Distributor_ID on weekly sales, Unit_Price, Lead_Time_Days and Launch_Date on the SKU master, and a separate open POs file.
AI Prompt Design
Use this system prompt for the exception rationale call:

```
You are an assistant to Raghav Kulkarni, Senior Demand Planner at Freshroots, a regional FMCG distributor in Maharashtra and Goa. A rules engine has already produced a flag and a recommended quantity for one SKU and marked it as an exception, meaning the rules alone are not enough to decide. Your job is to help Raghav decide quickly.

You will receive JSON with the SKU facts, recent weekly sales, weeks of stock cover, which rules fired, and why this SKU was marked an exception. You may also receive Raghav's last overrides on this SKU.

Write two things:
1. "rationale": two or three plain sentences explaining why the rules disagree or why they may not fit this SKU, using only the numbers provided.
2. "check_first": one sentence naming the single most useful thing Raghav should verify before deciding.

Rules you must follow:
- Never state, suggest or change an order quantity. The rules engine owns the number.
- Use only the data provided. Do not invent distributor behaviour, competitor actions, prices or lead times. If something would be useful but was not provided, say so in check_first.
- Mention if festival uplift and a rising trend may be counting the same demand twice.
- Be direct and specific to this SKU. No filler, no hedging phrases.
- Return only valid JSON: {"rationale": string, "check_first": string}

```

Validate the response with Zod. If it fails validation or the call errors, retry once, then store `rationale` as null. The UI must show "Rationale unavailable" and everything else must still work.
Key Screens / User Flows

1. Login. Email magic link. Redirect by role: planner to the review queue, procurement to the procurement view, viewer to the dashboard.
2. Upload (planner). Five drop zones, one per file type. After a file is chosen, show a preview of the first 20 rows, row count, and validation warnings or errors. Nothing is saved until the planner clicks Confirm. Re-uploading a file with an identical hash is rejected with a clear message.
3. Runs (planner). A "Run now" button, the as-of dates of the latest sales and inventory data, and run history. If inventory is older than 4 days, show a banner and require an explicit confirm before running. Running creates a `runs` row and all `recommendations`.
4. Review queue (planner), the home screen. Table of flagged SKUs. Columns: SKU, name, perishability, weeks of cover, trend %, flag, recommended qty, rules fired, exception badge, status. Sorted by rupee exposure when unit price exists, otherwise by lowest weeks of cover. Filters: flag, exception only, status. Clicking a row opens a side panel with a 16-week sales chart, the rule trace in plain words, and the AI rationale and check_first for exceptions. Actions: Approve, Edit quantity, Reject. Edit and Reject open a dialog requiring a reason code (known event, new product, supplier constraint, rule too strict, rule too loose, other) and an optional note. Bulk approve is allowed only for non-exception rows. A "Release to procurement" button sends all approved and edited rows and sets `released_at`.
5. Procurement view. Read-only list of released recommendations with SKU, final quantity and distributor, plus CSV export. Escape cells starting with `=`, `+`, `-` or `@` on export.
6. Backtest. Replays the rules over every historical week in the data and shows flags per week, the share of SKUs flagged in festival and non-festival months, and (if a historical recommendations CSV is uploaded) the agreement percentage with Raghav's past decisions on rule-governed SKUs.
7. Metrics dashboard (viewer and planner, Phase 2). Recommendation accept rate, override rate by run, stockout weeks, perishable write-offs, estimated loss against the 25 lakh target, and a kill-criteria panel with a traffic light for each of the three conditions in the Human-in-the-Loop section.
8. Settings (planner). View and edit `rule_config` parameters. Every save creates a new version and never edits an old one. Runs record the version they used.

Use Indian number formatting (en-IN) and the rupee symbol everywhere money appears.
Scoring / Ranking Logic
There is no score. The engine evaluates each SKU in this order and must be deterministic.

1. Eligibility. If the SKU has fewer than 12 weeks of sales, mark it an exception with reason `insufficient_history`. If `launch_date` is within the last 8 weeks, mark it an exception with reason `new_launch`. Skip the remaining steps for these.
2. Averages. `avg12` is the mean of the last 12 weeks of units. `avg4` is the mean of the last 4 weeks. `trend_pct = avg4 / avg12 - 1`, computed on raw sales so the festival uplift never inflates it. If `avg12` is 0 and stock is above 0, mark an exception with reason `dead_stock`. If both are 0, no action.
3. Festival uplift. If the as-of date falls in a month with `is_festival_month` true (March, October, November in the calendar file), `demand_adj = avg12 * 1.25`. Otherwise `demand_adj = avg12`.
4. Cover. `weeks_cover = (units_on_hand + on_order_units) / demand_adj`. `on_order_units` is 0 when no open PO data exists.
5. Thresholds by perishability. Low: stockout risk if cover is below 6, overstock risk if above 14. High: stockout risk if cover is below 3, overstock risk if above 4. The perishable window replaces the 6 and 14 week thresholds.
6. Trend rule. If `trend_pct` is above 20%, set the high_demand flag.
7. Recommended action and quantity.
   * Stockout risk: reorder now at `standard_reorder_qty`, or 1.5 times that if high_demand is also set.
   * Overstock risk: pause the next order, quantity 0.
   * High_demand only: reorder at 1.5 times `standard_reorder_qty`.
   * None of the above: no action, hidden from the queue by default.
8. Exception rules. Mark as an exception, with the reason recorded, when any of these is true: overstock risk and high_demand together (`conflicting_signals`); festival uplift applied and high_demand both true (`possible_double_count`); a high-perishability SKU gets an overstock pause in a festival month while `trend_pct` is above 0 (`perishable_pause_in_festival`); more than 2 of the last 12 weeks are missing (`data_gaps`); a distributor's share of the SKU's units in the last 4 weeks differs from its 12-week share by more than 15 percentage points (`distributor_shift`, only when distributor-level sales exist); and the SKU is new, short on history or dead stock from the steps above.
9. Ranking. Order by flag severity (stockout risk, then overstock risk, then high_demand), then by estimated rupee exposure descending when `unit_price` exists (stockout: shortfall weeks times demand_adj times unit price; overstock: excess units times unit price), otherwise by lowest weeks of cover for stockouts and highest for overstock. Ties break by SKU_ID ascending.
10. Floors and ceilings. Quantities are integers, never negative, and never above 3 times `standard_reorder_qty`.

Acceptance test on the sample data (as-of 2026-10-19, October is a festival month): the engine must flag SKU001 as stockout risk with high_demand, quantity 750 and exception `possible_double_count`; SKU003, SKU004, SKU011 and SKU013 as stockout risk; SKU006 as overstock risk; and SKU007 as overstock risk with exception `perishable_pause_in_festival`. Weeks of cover to one decimal must be: SKU001 3.4, SKU003 4.4, SKU004 1.8, SKU006 22.2, SKU007 4.1, SKU011 1.8, SKU013 3.2. SKU002, SKU005, SKU008, SKU009, SKU010, SKU012, SKU014 and SKU015 must produce no action. Seven SKUs are flagged in total and two are exceptions.
Human-in-the-Loop
Nothing reaches procurement without the planner's approval. Raghav can approve, edit the quantity, or reject any recommendation. Edits and rejections require a reason code and allow a note, and every override is stored on the recommendation with who made it and when. The engine never changes its own rules from overrides. Instead, the dashboard flags any SKU overridden 3 or more times in 5 runs as "rules may not fit this SKU." The last three overrides on a SKU are passed to the AI as context for its rationale.
The override UI is a dialog with a quantity field (edit only), a required reason dropdown, and an optional note. Exceptions are visually distinct and cannot be bulk approved.
The kill criteria from the planning stage appear on the dashboard as three traffic lights, visible to Deepa, who alone decides whether to shut the system down: backtest agreement on rule-governed SKUs below 75% at the end of week 2; planner override rate above 40% for 3 consecutive runs; combined loss still above 28 lakh rupees after two full quarters. The fallback is Raghav's monthly Excel process, so keep an export of the rule logic in plain language on the Settings screen.
Security & Privacy

* The data is business data (SKUs, units, distributors). It contains no personal data. Do not collect or store customer names, phone numbers or payment details.
* The AI receives only SKU-level numbers and distributor IDs. It never receives user emails or any free-text notes written by users.
* The Anthropic API key and Supabase service key live only in server-side environment variables and are never sent to the browser.
* Enable row level security on every table. Planner can read and write everything. Procurement can read only released recommendations. Viewer can read only dashboard aggregates.
* Uploads: CSV only, maximum 10 MB and 200,000 rows, validated with Zod, parsed server-side, stored with a file hash.
* Rate limits: maximum 10 runs per day, maximum 80 AI calls per run, and a monthly AI spend cap in an environment variable. When the cap is hit, stop calling the AI and continue without rationales.
* Write every approval, override, release, config change and upload to `audit_log`.
* Escape spreadsheet formula characters on all CSV exports.

Edge Cases

1. Missing weeks or gaps in sales. Never zero-fill silently. Warn on upload, and mark the SKU an exception with `data_gaps` if more than 2 of the last 12 weeks are missing.
2. Stale inventory. If the snapshot is older than 4 days at run time, show a banner and require an explicit confirm before running.
3. SKU mismatches. SKUs in sales but not in the master, or the reverse, are skipped and listed in the upload warnings.
4. Duplicate uploads and rows. Reject an identical file hash. For duplicate keys within a file, keep the last row and warn.
5. Anthropic API failure, timeout or spend cap. Retry once. If it still fails, deliver the rules output with `rationale` null and the message "Rationale unavailable". The queue must never block on the AI.
6. Conflicting signals. Overstock plus high demand becomes an exception and is never auto-resolved.
7. Zero demand. If `avg12` is 0 with stock on hand, mark `dead_stock`. If both are 0, no action.
8. Invalid rows. Negative or non-integer units, unknown perishability values and malformed ISO weeks are rejected with the row number.
9. Planner overrides the AI or the rules. Store the final quantity and reason. Procurement sees only the final quantity.
10. Concurrent runs. Lock per as-of date so two runs cannot create duplicate recommendations.
11. ISO week edge cases. Support 53-week years, and determine festival status from the as-of date's month.
12. Missing optional data. If unit price, lead time, launch date, distributor-level sales or open POs are absent, switch off only the features that need them, show which are off, and never fail the run.

Build Order
Phase 1 (weeks 1 to 4): MVP that delivers value.

* Scaffold the repository, Supabase schema, row level security and auth roles.
* Build the five CSV loaders with validation and the upload screen, and seed the database from the five sample files.
* Build the rules engine as a pure module with unit tests that pass the acceptance test above.
* Build runs, the review queue with approve, edit and reject, the release action, the procurement view with CSV export, and the backtest replay screen.

Phase 2 (weeks 5 to 8): polish and trust.

* Add the Claude Sonnet 5.5 rationale step for exceptions with Zod validation, retry and spend cap.
* Add override reason codes, the override history context, and the repeated-override flag.
* Build the metrics dashboard with the three kill-criteria traffic lights, the settings screen with versioned rule config, and the full edge case handling and tests.
* Accessibility pass, empty states and error states.

Phase 3 (weeks 9 to 12): scale and automate.

* Add scheduled runs with Vercel Cron on Tuesday and Friday at 06:00 IST (cron expression `30 0 * * 2,5` in UTC), with a manual run still available.
* Replace manual uploads with the SAP export folder or SFTP ingestion, and add the Zoho Inventory API for open POs and real lead times.
* Add the four-week outcome capture job, monitoring and error tracking, a spend dashboard, backups, and onboarding for procurement users.

Definition of done for every phase: TypeScript strict mode with no errors, all Vitest tests passing in CI, no secrets in the repository, and a short README describing setup, environment variables and how to run the acceptance test.
