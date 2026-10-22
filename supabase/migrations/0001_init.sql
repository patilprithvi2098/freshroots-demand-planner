-- Freshroots Demand Planning Assistant: schema, roles and row level security.
-- Business data only: SKUs, units and distributors. No customer personal data.

create extension if not exists pgcrypto;

-- ---------- roles ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('planner', 'procurement', 'viewer')),
  created_at timestamptz not null default now()
);

-- Role of the signed-in user. SECURITY DEFINER so policies can call it without recursing into profiles RLS.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;

-- New auth users get a profile. Role defaults to viewer; planners are set by the invite script.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'viewer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- master data ----------

create table public.distributors (
  distributor_id text primary key,
  name text not null,
  region text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table public.skus (
  sku_id text primary key,
  name text not null,
  category text not null,
  perishability text not null check (perishability in ('high', 'low')),
  standard_reorder_qty integer not null check (standard_reorder_qty > 0),
  unit_of_measure text not null,
  distributor_id text, -- not a foreign key: masters can be uploaded in any order
  launch_date date,
  unit_price numeric(12, 2) check (unit_price >= 0),
  lead_time_days integer check (lead_time_days >= 0),
  created_at timestamptz not null default now()
);

create table public.weekly_sales (
  id uuid primary key default gen_random_uuid(),
  sku_id text not null references public.skus (sku_id) on delete cascade,
  iso_week text not null check (iso_week ~ '^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$'),
  units_sold integer not null check (units_sold >= 0),
  distributor_id text,
  distributor_key text generated always as (coalesce(distributor_id, '')) stored,
  created_at timestamptz not null default now(),
  unique (sku_id, iso_week, distributor_key)
);
create index weekly_sales_week_idx on public.weekly_sales (iso_week);

create table public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  sku_id text not null references public.skus (sku_id) on delete cascade,
  location text not null,
  units_on_hand integer not null check (units_on_hand >= 0),
  as_of_date date not null,
  created_at timestamptz not null default now(),
  unique (sku_id, location, as_of_date)
);
create index inventory_snapshots_date_idx on public.inventory_snapshots (as_of_date);

create table public.open_purchase_orders (
  po_id text primary key,
  sku_id text not null references public.skus (sku_id) on delete cascade,
  qty integer not null check (qty >= 0),
  ordered_date date not null,
  expected_date date,
  status text not null,
  created_at timestamptz not null default now()
);

create table public.calendar (
  year_month text primary key check (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  year integer not null,
  month integer not null check (month between 1 and 12),
  is_festival_month boolean not null default false,
  created_at timestamptz not null default now()
);

-- Raghav's past decisions, used only for backtest agreement.
create table public.historical_decisions (
  id uuid primary key default gen_random_uuid(),
  sku_id text not null,
  iso_week text not null,
  action text not null check (action in ('reorder_now', 'pause_next_order', 'no_action')),
  qty numeric,
  created_at timestamptz not null default now(),
  unique (sku_id, iso_week)
);

create table public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  file_type text not null check (file_type in (
    'sku_master', 'weekly_sales', 'current_inventory', 'distributor_master', 'calendar',
    'open_purchase_orders', 'historical_decisions'
  )),
  filename text not null,
  file_hash text not null,
  uploaded_by uuid references auth.users (id),
  row_count integer not null,
  status text not null check (status in ('confirmed', 'failed')),
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
-- Re-uploading an identical file is rejected.
create unique index upload_batches_hash_uq on public.upload_batches (file_hash) where status = 'confirmed';

-- ---------- rules and runs ----------

create table public.rule_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  params jsonb not null,
  created_by uuid references auth.users (id),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index rule_config_one_active on public.rule_config (active) where active;

-- Old versions are never edited.
create or replace function public.rule_config_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.params is distinct from old.params or new.version <> old.version then
    raise exception 'rule_config versions are immutable; insert a new version instead';
  end if;
  return new;
end;
$$;
create trigger rule_config_no_edit before update on public.rule_config
  for each row execute function public.rule_config_immutable();

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  run_date timestamptz not null default now(),
  as_of_date date not null,
  triggered_by text not null, -- user uuid or 'cron'
  config_version integer not null references public.rule_config (version),
  status text not null check (status in ('running', 'completed', 'failed', 'superseded')),
  sku_count integer not null default 0,
  flagged_count integer not null default 0,
  exception_count integer not null default 0,
  features jsonb not null default '{}'::jsonb,
  skipped jsonb not null default '[]'::jsonb,
  stale_inventory_confirmed boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
-- Lock per as-of date: only one run in flight and one live (completed) run per as-of date.
create unique index runs_one_running_per_date on public.runs (as_of_date) where status = 'running';
create unique index runs_one_completed_per_date on public.runs (as_of_date) where status = 'completed';

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  sku_id text not null references public.skus (sku_id),
  -- Snapshot so procurement never needs to read the SKU master.
  sku_name text not null,
  distributor_id text,
  perishability text not null,
  flag text not null check (flag in ('stockout_risk', 'overstock_risk', 'high_demand', 'no_action')),
  flags text[] not null default '{}',
  rules_fired jsonb not null default '[]'::jsonb,
  weeks_cover numeric,
  trend_pct numeric,
  avg12 numeric,
  demand_adj numeric,
  units_on_hand integer,
  on_order_units integer,
  festival_applied boolean not null default false,
  recent_sales jsonb not null default '[]'::jsonb,
  rupee_exposure numeric,
  rank integer not null,
  recommended_action text not null check (recommended_action in ('reorder_now', 'pause_next_order', 'manual_review', 'no_action')),
  recommended_qty integer check (recommended_qty >= 0),
  is_exception boolean not null default false,
  exception_reasons text[] not null default '{}',
  rationale text,
  check_first text,
  ai_status text not null default 'not_needed' check (ai_status in ('not_needed', 'pending', 'ok', 'failed', 'skipped_cap')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'edited', 'rejected')),
  final_qty integer check (final_qty >= 0),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  override_reason_code text check (override_reason_code in (
    'known_event', 'new_product', 'supplier_constraint', 'rule_too_strict', 'rule_too_loose', 'other'
  )),
  override_note text check (char_length(override_note) <= 1000),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, sku_id),
  -- Edits and rejections require a reason.
  check (status not in ('edited', 'rejected') or override_reason_code is not null)
);
create index recommendations_sku_idx on public.recommendations (sku_id, created_at desc);
create index recommendations_released_idx on public.recommendations (released_at) where released_at is not null;

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.runs (id) on delete cascade,
  recommendation_id uuid references public.recommendations (id) on delete cascade,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index ai_calls_created_idx on public.ai_calls (created_at);

create table public.outcomes (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null unique references public.recommendations (id) on delete cascade,
  measured_at date not null,
  stock_after_4_weeks integer,
  stockout_weeks integer not null default 0 check (stockout_weeks >= 0),
  written_off_units integer check (written_off_units >= 0),
  created_at timestamptz not null default now()
);

create table public.backtest_results (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  config_version integer not null,
  weeks_replayed integer not null,
  agreement_pct numeric,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references auth.users (id),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------- row level security ----------
-- Planner: read and write everything. Procurement: released recommendations only.
-- Viewer: no table access; dashboard aggregates are computed server-side after a role check.

do $$
declare t text;
begin
  foreach t in array array[
    'distributors', 'skus', 'weekly_sales', 'inventory_snapshots', 'open_purchase_orders', 'calendar',
    'historical_decisions', 'upload_batches', 'rule_config', 'runs', 'recommendations', 'ai_calls',
    'outcomes', 'backtest_results', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy planner_all on public.%I for all to authenticated using (public.app_role() = ''planner'') with check (public.app_role() = ''planner'')',
      t
    );
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
create policy planner_reads_profiles on public.profiles for select to authenticated using (public.app_role() = 'planner');
-- No insert/update policies: roles change only through the service-role invite script.

create policy procurement_released on public.recommendations
  for select to authenticated
  using (public.app_role() = 'procurement' and released_at is not null);

-- Procurement may record that it exported the list.
create policy procurement_audit_insert on public.audit_log
  for insert to authenticated
  with check (public.app_role() = 'procurement' and actor = auth.uid() and action = 'export');

-- ---------- seed: default rule config v1 ----------

insert into public.rule_config (version, params, active) values (
  1,
  '{
    "festival_uplift_pct": 25,
    "avg_window_weeks": 12,
    "trend_window_weeks": 4,
    "trend_threshold_pct": 20,
    "trend_reorder_multiplier": 1.5,
    "low_perishability": {"min_weeks": 6, "max_weeks": 14},
    "high_perishability": {"min_weeks": 3, "max_weeks": 4},
    "new_launch_weeks": 8,
    "stale_inventory_days": 4,
    "distributor_share_shift_pp": 15,
    "max_ai_calls_per_run": 80,
    "max_missing_weeks": 2,
    "max_qty_multiple": 3
  }'::jsonb,
  true
);

-- Save a new rule config version and make it the active one, atomically. Runs with the caller's rights (planner RLS).
create or replace function public.save_rule_config(new_params jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare next_version integer;
begin
  if public.app_role() is distinct from 'planner' then
    raise exception 'only planners can change rule config';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.rule_config;
  update public.rule_config set active = false where active;
  insert into public.rule_config (version, params, created_by, active)
  values (next_version, new_params, auth.uid(), true);
  insert into public.audit_log (actor, action, entity, entity_id, detail)
  values (auth.uid(), 'config_change', 'rule_config', next_version::text, jsonb_build_object('params', new_params));
  return next_version;
end;
$$;
revoke all on function public.save_rule_config(jsonb) from public, anon;
grant execute on function public.save_rule_config(jsonb) to authenticated;
