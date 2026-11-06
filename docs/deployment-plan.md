# Phased deployment plan

> **Written after the build, from the commit history.** It records what happened and doesn't pretend the plan
> came first. The spec's phases were planned in weeks; the build ran over a much shorter stretch with AI assistance.

Requirement numbers (R1–R10) refer to the [Build Requirements Brief](build-requirements.md).

| Phase | What it delivers | Done when | Deployed where | Rollback if it breaks | Spec time box → actual |
|---|---|---|---|---|---|
| **0. Skeleton** | App scaffold, schema, security rules, sign-in | The live address loads and a user can sign in | Vercel + Supabase | Promote the previous Vercel deployment | Part of weeks 1–4 → 22 Oct |
| **1. Core flow, thin** (R1, R2, R5, R7) | Uploads, rules engine, runs, review, send to procurement, CSV export, backtest | Acceptance test passes on the sample files: 7 flagged, 2 exceptions, every value matches | Same | Same; the fallback is Raghav's Excel process | Weeks 1–4 → 22 Oct |
| **2. Depth and trust** (R3, R4, R8) | Claude explanations, reason codes, Performance page with kill lights, versioned rules, edge cases, accessibility | Unit tests pass; accessibility scan clean; "Rationale unavailable" works when the AI fails | Same | Same; without an AI key, the app runs on rules alone | Weeks 5–8 → 22–24 Oct |
| **Polish** (R6) | Redesign around Raghav's cycle, Overview, pop-up, SKU images, critique fixes | Browser tests pass at phone and desktop widths | Same | Same | Not in spec → 22–24 Oct |
| **3a. Learning** (R9) | Outcome loop, rule-review loop | Browser test walks through both loops | Same | Same; migrations only move forward, so a code rollback leaves the new columns in place, unused | Weeks 9–12 → 4 Nov |
| **3b. Ordering** (R7) | Create and issue POs in Zoho, delivery status sync | Tests against a local Zoho mock pass, including failures and two people clicking at once | Same | Same; ordering can be turned off by removing the Zoho settings, leaving CSV export | Goes further than the spec → 5 Nov |
| **Hardening** (R10) | Keep-alive job, Mumbai hosting, faster loading, full-scale stress test, loading and error screens | Stress run reports no issues at 400 SKUs and about 150,000 sales rows | Same | Same | Partly weeks 9–12 → 4–6 Nov |
| **3c. Automation (not built)** | SAP feed, scheduled runs, monitoring, backups | Needs Freshroots' IT team | – | – | Weeks 9–12 → open |

## Cut line and freeze

No deadline was recorded for this plan, so these are stated as rules, with dates still to fill in.

- **Cut line:** no new features from now on, only fixes. Automatic SAP and scheduled runs stay excluded.
- **Freeze:** names, branding and copy freeze 48 hours before the submission deadline. After that, only bug fixes ship.
- **Submission deadline:** _to fill in_

## Final check (not done yet)

The framework needs **someone who didn't build it** to do this on the live site:

- [ ] Sign in as `raghav` with the details from the submission
- [ ] Overview shows 7 SKUs to review, 2 needing judgement
- [ ] Open SKU001: stockout risk, high demand, quantity 750, with Claude's explanation
- [ ] Change one quantity and give a reason, then reject one line and approve the rest
- [ ] Send to procurement, and confirm the Orders page lists those lines with quantities that match
- [ ] Performance shows the kill-criteria lights, and Backtest shows agreement
- [ ] Rules shows the rules in plain language
- [ ] Proofread every screen for spelling and wording
- [ ] Open every link in the README, including the repo and live site
- [ ] Afterwards, restore the demo: `npm run demo-reset -- --yes`
