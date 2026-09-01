create table if not exists public.investor_alert_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  neighborhood_ids text[] not null default '{}',
  min_price_eur integer check (min_price_eur is null or min_price_eur >= 0),
  max_price_eur integer check (max_price_eur is null or max_price_eur >= 0),
  min_size_mq integer check (min_size_mq is null or min_size_mq > 0),
  max_size_mq integer check (max_size_mq is null or max_size_mq > 0),
  max_price_per_sqm_eur integer check (max_price_per_sqm_eur is null or max_price_per_sqm_eur > 0),
  min_door_score smallint check (min_door_score is null or min_door_score between 0 and 100),
  min_roi_base_pct numeric(8, 2) check (min_roi_base_pct is null or min_roi_base_pct between -100 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint investor_alert_preferences_price_range_check check (
    min_price_eur is null or max_price_eur is null or min_price_eur <= max_price_eur
  ),
  constraint investor_alert_preferences_size_range_check check (
    min_size_mq is null or max_size_mq is null or min_size_mq <= max_size_mq
  ),
  constraint investor_alert_preferences_neighborhood_limit_check check (
    cardinality(neighborhood_ids) <= 32
  )
);

comment on table public.investor_alert_preferences is
  'Invite-only investor notification preferences. Delivery scheduling is intentionally out of scope.';

alter table public.investor_alert_preferences enable row level security;
alter table public.investor_alert_preferences force row level security;

revoke all on table public.investor_alert_preferences from anon;
grant select, insert, update, delete on table public.investor_alert_preferences to authenticated;

drop policy if exists "Investors can read own alert preferences" on public.investor_alert_preferences;
create policy "Investors can read own alert preferences"
  on public.investor_alert_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Investors can create own alert preferences" on public.investor_alert_preferences;
create policy "Investors can create own alert preferences"
  on public.investor_alert_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Investors can update own alert preferences" on public.investor_alert_preferences;
create policy "Investors can update own alert preferences"
  on public.investor_alert_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Investors can delete own alert preferences" on public.investor_alert_preferences;
create policy "Investors can delete own alert preferences"
  on public.investor_alert_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);
