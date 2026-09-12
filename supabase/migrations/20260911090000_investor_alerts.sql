-- Investor alerts: what TORIUM decided to tell an investor about, and whether
-- it has been delivered.
--
-- Additive only. Nothing here changes an existing table or policy.
--
-- The design keeps the decision and the delivery apart. `investor_alerts` is
-- the record that a property is worth this investor's attention; the digest
-- tables record that a channel carried it. A second channel - web push once the
-- PWA supports it - becomes another delivery row, not a second source of truth.

create table if not exists public.investor_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Identity that survives the next run. Built by the application from the
  -- portal listing id, falling back to the canonical URL. When neither exists
  -- the key is run-scoped and `property_key_is_stable` is false, which means a
  -- re-run may legitimately produce a second alert for the same apartment.
  property_key text not null,
  property_key_is_stable boolean not null default true,

  run_id text,
  listing_index integer,
  source_channel text,
  source_listing_id text,
  source_url text,

  -- Snapshot taken at match time. The digest renders from this row alone, so a
  -- later run cannot silently rewrite what the investor was told.
  title text,
  zone_id text,
  neighborhood text,
  price_eur integer,
  size_mq integer,
  price_by_area integer,
  door_score integer,
  roi_base_pct numeric(8, 2),
  thumbnail_url text,

  matched_at timestamptz not null default now(),
  delivered_at timestamptz,
  seen_at timestamptz,
  dismissed_at timestamptz,

  -- Idempotency lives in the database, not in the matching code. Two
  -- reconciliation passes racing on the same property cannot produce two
  -- alerts, whatever the application does.
  constraint investor_alerts_user_property_unique unique (user_id, property_key)
);

comment on table public.investor_alerts is
  'One row per property TORIUM decided to alert one investor about. Deduplicated on a run-independent property key.';

create index if not exists investor_alerts_user_recent_idx
  on public.investor_alerts (user_id, matched_at desc);

create index if not exists investor_alerts_pending_delivery_idx
  on public.investor_alerts (user_id, matched_at)
  where delivered_at is null;

create index if not exists investor_alerts_run_idx
  on public.investor_alerts (run_id);

alter table public.investor_alerts enable row level security;
alter table public.investor_alerts force row level security;
revoke all on table public.investor_alerts from anon;
grant select, update on table public.investor_alerts to authenticated;

-- Investors read their own alerts, and may only mark them seen or dismissed.
-- Creating an alert is a server decision: there is no insert policy.
drop policy if exists "Investors read own alerts" on public.investor_alerts;
create policy "Investors read own alerts"
  on public.investor_alerts for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

drop policy if exists "Investors acknowledge own alerts" on public.investor_alerts;
create policy "Investors acknowledge own alerts"
  on public.investor_alerts for update to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  )
  with check ((select auth.uid()) = user_id);

-- One delivery attempt per investor, per channel, per day. The unique
-- constraint is what makes a re-run of the digest job safe: it cannot send the
-- same digest twice, even if two workers start at once.
create table if not exists public.investor_alert_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'web_push')),
  digest_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  alert_count integer not null default 0,
  provider_message_id text,
  -- Failure reason only. Never a recipient address or message body.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint investor_alert_digests_unique unique (user_id, channel, digest_date)
);

comment on table public.investor_alert_digests is
  'Delivery ledger for investor alert digests. One row per user, channel and day; the unique constraint makes the digest job safe to re-run.';

create index if not exists investor_alert_digests_pending_idx
  on public.investor_alert_digests (status, digest_date)
  where status = 'pending';

alter table public.investor_alert_digests enable row level security;
alter table public.investor_alert_digests force row level security;
revoke all on table public.investor_alert_digests from anon, authenticated;

-- Reconciliation bookkeeping, so a matching pass can be observed and resumed
-- without reading the whole alert table.
create table if not exists public.investor_alert_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  investors_considered integer not null default 0,
  properties_inspected integer not null default 0,
  alerts_created integer not null default 0,
  -- Counts per rejection reason. No listing content, no personal data.
  rejection_counts jsonb not null default '{}'::jsonb,
  error text
);

comment on table public.investor_alert_runs is
  'Observability for investor alert reconciliation passes. Counts only, never listing content or personal data.';

alter table public.investor_alert_runs enable row level security;
alter table public.investor_alert_runs force row level security;
revoke all on table public.investor_alert_runs from anon, authenticated;

drop trigger if exists set_investor_alert_digests_updated_at on public.investor_alert_digests;
create trigger set_investor_alert_digests_updated_at
  before update on public.investor_alert_digests
  for each row execute function public.set_updated_at();
