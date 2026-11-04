-- Feedback loops (docs/feedback-loops.md).
-- Loop 1, outcomes: write-offs from SAP, and a labelled outcome per decision.
-- Loop 2, rule review: Raghav's accept/dismiss decisions on rule proposals.
-- Additive only: no existing column or row changes.

-- ---------- Loop 1: write-offs (Signal) ----------

create table public.write_offs (
  id uuid primary key default gen_random_uuid(),
  sku_id text not null references public.skus (sku_id) on delete cascade,
  iso_week text not null check (iso_week ~ '^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$'),
  units integer not null check (units >= 0),
  created_at timestamptz not null default now(),
  unique (sku_id, iso_week)
);
alter table public.write_offs enable row level security;
create policy planner_all on public.write_offs for all to authenticated
  using (public.app_role() = 'planner') with check (public.app_role() = 'planner');

alter table public.upload_batches drop constraint if exists upload_batches_file_type_check;
alter table public.upload_batches add constraint upload_batches_file_type_check check (file_type in (
  'sku_master', 'weekly_sales', 'current_inventory', 'distributor_master', 'calendar',
  'open_purchase_orders', 'historical_decisions', 'write_offs'
));

-- ---------- Loop 1: labelled outcomes (Capture, Store) ----------

alter table public.outcomes
  add column horizon_start_week text,
  add column horizon_end_week text,
  add column result text check (result in ('stocked_out', 'wrote_off', 'overstocked', 'ok')),
  add column driver text check (driver in ('rule', 'override', 'undecided')),
  add column evidence jsonb not null default '[]'::jsonb,
  add column updated_at timestamptz not null default now();
create index outcomes_measured_idx on public.outcomes (measured_at desc);

-- ---------- Loop 2: rule review (Apply, gated by the planner) ----------

create table public.rule_proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  proposal_key text not null,
  decision text not null check (decision in ('accepted', 'dismissed')),
  config_version_before integer not null,
  config_version_after integer,
  evidence jsonb not null default '{}'::jsonb,
  decided_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index rule_proposal_decisions_key_idx on public.rule_proposal_decisions (proposal_key, created_at desc);
alter table public.rule_proposal_decisions enable row level security;
create policy planner_all on public.rule_proposal_decisions for all to authenticated
  using (public.app_role() = 'planner') with check (public.app_role() = 'planner');
