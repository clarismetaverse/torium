-- Web push delivery for investor alerts.
--
-- Additive only. Nothing here changes an existing table or policy.
--
-- `investor_alerts` already holds the decision that a property is worth an
-- investor's attention, and `investor_alert_digests` records that the email
-- channel carried it. This migration adds the second channel the alerts design
-- anticipated: a browser subscription to push to, and a ledger of what was
-- pushed, so the decision and the delivery stay separate.

create table if not exists public.investor_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The endpoint is a capability URL: whoever holds it can make that browser
  -- show a notification. It is unique across the table because it identifies
  -- one browser installation, and a browser belongs to whoever is signed in on
  -- it now, not to whoever subscribed first.
  endpoint text not null,
  p256dh text not null,
  auth text not null,

  -- Enough for an investor to recognise a device in the account page and
  -- revoke it. Derived server-side from coarse platform hints; never the full
  -- user agent string, never an IP address.
  device_label text,

  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_delivered_at timestamptz,

  -- A push service answers 404 or 410 when a subscription is gone for good.
  -- Those rows are disabled rather than deleted so a device that disappears is
  -- visible in support, and transient failures are counted separately.
  failure_count integer not null default 0,
  disabled_at timestamptz,
  disabled_reason text,

  constraint investor_push_subscriptions_endpoint_unique unique (endpoint),
  constraint investor_push_subscriptions_endpoint_https check (endpoint like 'https://%')
);

comment on table public.investor_push_subscriptions is
  'One row per browser installation an investor has allowed TORIUM to notify. Payloads are encrypted to these keys, so the push service forwards bytes it cannot read.';

create index if not exists investor_push_subscriptions_active_idx
  on public.investor_push_subscriptions (user_id)
  where disabled_at is null;

alter table public.investor_push_subscriptions enable row level security;
alter table public.investor_push_subscriptions force row level security;
revoke all on table public.investor_push_subscriptions from anon, authenticated;
grant select on table public.investor_push_subscriptions to authenticated;

-- Investors see their own devices so they can revoke one. Registering a
-- subscription is a server decision, because claiming an endpoint may mean
-- taking it from the account that used the same browser before: there is no
-- insert, update or delete policy.
drop policy if exists "Investors read own push subscriptions" on public.investor_push_subscriptions;
create policy "Investors read own push subscriptions"
  on public.investor_push_subscriptions for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

-- One push per device per run. The unique constraint is what makes the sender
-- safe to re-run: a second pass claims nothing and sends nothing.
create table if not exists public.investor_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.investor_push_subscriptions(id) on delete cascade,
  run_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'expired')),
  alert_count integer not null default 0,
  -- Failure reason only. Never a listing, an address or a recipient.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint investor_push_deliveries_unique unique (subscription_id, run_id)
);

comment on table public.investor_push_deliveries is
  'Delivery ledger for web push. One row per subscription and run; the unique constraint makes the push job safe to re-run.';

create index if not exists investor_push_deliveries_user_recent_idx
  on public.investor_push_deliveries (user_id, created_at desc);

alter table public.investor_push_deliveries enable row level security;
alter table public.investor_push_deliveries force row level security;
revoke all on table public.investor_push_deliveries from anon, authenticated;

drop trigger if exists set_investor_push_subscriptions_updated_at on public.investor_push_subscriptions;

drop trigger if exists set_investor_push_deliveries_updated_at on public.investor_push_deliveries;
create trigger set_investor_push_deliveries_updated_at
  before update on public.investor_push_deliveries
  for each row execute function public.set_updated_at();
