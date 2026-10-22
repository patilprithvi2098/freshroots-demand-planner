# Freshroots Demand Planning Assistant

Twice-weekly demand planning review for Freshroots. A deterministic rules engine applies Raghav's five
documented rules to every SKU, Claude explains only the exceptions, and the planner approves, edits or
rejects every recommendation before anything reaches procurement.

**Goal:** cut combined stockout and write-off loss from ₹28–34 lakh to ₹25 lakh or below per quarter
within two full quarters of going live.

## How it fits together

| Lane | Trigger | Input | Context | Processing | Output |
|---|---|---|---|---|---|
| Raghav (planner) | Opens the review queue | | | | Approves, edits or rejects |
| Scheduler (Phase 3) | Tuesday and Friday 06:00 IST | | | | |
| SAP and Zoho | | Sales, stock, open POs (CSV upload in Phases 1–2) | Festival calendar, lead times | | |
| Rules engine (`lib/rules/`) | | | | Applies the five rules | Flagged SKUs, quantities, rule trace |
| Claude Sonnet 5.5 (`lib/ai/`) | | | | Explains the exceptions only | Rationale + "check this first" per SKU |
| Database and web app | | | Past history and overrides | | Review queue, results stored |
| Procurement | | | | | Places the PO in Zoho |
| Raghav as reviewer | | | | Steps in on exceptions | |

The AI never sets or changes a quantity. If it fails or the spend cap is hit, the queue shows
"Rationale unavailable" and everything else still works.

## Stack

- Next.js 15 (App Router), TypeScript strict, Tailwind CSS 4
- Supabase Postgres with row level security, Supabase Auth (username and password)
- Rules engine: pure TypeScript in `lib/rules/`, no I/O, tested with Vitest
- Validation: Zod (CSV rows, server actions, AI output, rule config)
- AI: Anthropic Messages API, `claude-sonnet-5-5`, server-side only

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values below
```

Apply the migrations in `supabase/migrations/` to your Supabase project, in order (SQL editor or `supabase db push`).

```bash
npm run seed                                            # load the five sample files from sample-data/
NEW_USER_PASSWORD='…' npm run invite -- raghav planner  # create or update a user (planner | procurement | viewer)
npm run delete-user -- raghav                           # remove a user
npm run dev                                             # http://localhost:3000
```

Users sign in with a **username and password**. Supabase Auth stores the password; each username maps to an
internal address on the reserved `users.freshroots.invalid` domain, which can never receive mail. The login
screen never creates accounts; only `npm run invite` (service role) can create users or change roles.
Passwords are passed through the `NEW_USER_PASSWORD` environment variable and are never stored in the repo.

### Environment variables

| Name | Where it is used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Publishable/anon key, safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Admin scripts and the viewer dashboard aggregates. Never prefix with `NEXT_PUBLIC_` |
| `ANTHROPIC_API_KEY` | server only | Optional. Without it, exceptions show "Rationale unavailable" |
| `AI_MONTHLY_SPEND_CAP_USD` | server | Default 20. When reached, runs continue without rationales |
| `MAX_RUNS_PER_DAY` | server | Default 10 |
| `NEXT_PUBLIC_SITE_URL` | browser | Public base URL of the app |
| `CRON_SECRET` | server | Reserved for Phase 3 scheduled runs |

## Tests

```bash
npm test                 # all unit tests (Vitest)
npm run test:acceptance  # the spec's acceptance test on the real sample files
npm run typecheck
npm run lint
```

The acceptance test (`tests/acceptance.test.ts`) runs the engine on `sample-data/` as of 2026-10-19 and checks
every flag, quantity, exception and weeks-of-cover value from the specification.

### Browser tests (Playwright, installed Google Chrome)

```bash
E2E_PASSWORD='…' npm run test:e2e    # login, accessibility (WCAG 2.1 AA), layout at 375px and desktop
SCREENS=1 npx playwright test tests/e2e/screens.spec.ts --project=chrome   # screenshots for design review
```

`tests/e2e/workflow.spec.ts` walks the full planner → procurement → viewer flow and **writes to the
database**, so it only runs on a development project:

```bash
E2E_PASSWORD='…' E2E_ALLOW_WRITES=1 E2E_SUPABASE_REF=<dev-project-ref> npm run test:e2e
```

It first clears runs, decisions, uploads and extra rule versions in that project (`scripts/e2e-reset.ts`
refuses to run if the URL does not match the ref). The planner signs in through the login form with
`E2E_USERNAME` (default `raghav`) and `E2E_PASSWORD`. Procurement and viewer tests create temporary users with
random passwords and delete them afterwards.

CI (`.github/workflows/ci.yml`) runs lint, type check and Vitest on every pull request.

## Where things live

| Path | What |
|---|---|
| `lib/rules/engine.ts` | The rules engine (steps 1–10 of the spec) |
| `lib/rules/backtest.ts` | Replay over historical weeks, agreement with past decisions |
| `lib/rules/plainLanguage.ts` | The rules in plain words (shown on Settings as the Excel fallback) |
| `lib/csv/loaders.ts` | CSV parsing and validation for every input file |
| `lib/ai/rationale.ts` | System prompt, context builder, Claude call with Zod validation and one retry |
| `lib/services/` | Runs, AI enrichment, review actions, uploads, dashboard, procurement |
| `lib/metrics.ts` | Accept/override rates, repeated-override flag, kill-criteria lights |
| `app/(app)/` | Screens: queue, upload, runs, procurement, backtest, dashboard, settings |
| `supabase/migrations/` | Schema, RLS policies, default rule config |

## Decisions and deviations from the spec

- **Username and password sign-in** instead of email magic links, at the product owner's request. Only one
  account (`raghav`, planner) exists for now; add procurement and viewer users with `npm run invite`.

- **No `temperature: 0.2`.** Claude Sonnet 5.5 rejects non-default sampling parameters. The call uses
  thinking type `between_tools` and effort `low`, so the 300 output tokens go to the answer. Structured
  output (JSON schema) is enforced by the API and checked again with Zod.
- **No server-side refusal fallback.** A refusal is treated like any other AI failure ("Rationale unavailable").
- **Backtest without historical stock.** The sample data has one inventory snapshot, so only weeks with a
  snapshot from that time are replayed with the cover rules. Other weeks use the trend rule only, and the
  screen says so. Agreement is computed only on fully replayed, rule-governed SKU-weeks.
- **Historical decisions CSV format** (not in the spec): `SKU_ID, Week, Action (reorder | pause | no_action), Qty`.
- **Open POs CSV format** (not in the spec): `PO_ID, SKU_ID, Qty, Ordered_Date, Expected_Date, Status`.
  Status `open`, `ordered`, `in_transit` or `partially_received` counts as on order.
- **"Last 12 weeks"** means the 12 complete ISO weeks ending before the as-of date (as-of 2026-10-19 →
  2026-W31 to 2026-W42). Missing weeks are left out of averages, never counted as zero.
- **Run lock:** one running and one live run per as-of date (partial unique indexes). Re-running the same
  as-of date replaces the earlier run, unless something from it was already released.
- **Viewer dashboard** is computed on the server with the service key after a role check, because the
  viewer role has no table access under RLS.
- **Two extra rule parameters** are configurable: `max_missing_weeks` (2) and `max_qty_multiple` (3).
- **Deployment:** https://freshroots-demand-planner.vercel.app (Vercel, production).
- **Phase 3** (scheduled runs, SFTP/Zoho ingestion, four-week outcome capture job) is not built. The
  `outcomes` table and dashboard are ready for it; until then loss metrics show "No four-week outcomes recorded yet".
