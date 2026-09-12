-- Multiple search profiles per investor.
--
-- One saved profile forces a single strategy. In Milan the fractioning thesis
-- and a positioning thesis disagree: high ROI comes from low price per square
-- metre, which is not where the desirable districts are. An investor needs to
-- watch both without one filter cancelling the other.
--
-- The primary key moves from user_id to a per-profile id. Every existing row
-- keeps its data and becomes that investor's first profile.
--
-- Alerts stay deduplicated per user, not per profile: an apartment matching two
-- profiles is still one apartment, and the investor should hear about it once.
-- The profile that matched is recorded for context only.

alter table public.investor_alert_preferences
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists name text,
  add column if not exists is_active boolean not null default true;

-- Name the row that already exists before the uniqueness constraint lands.
update public.investor_alert_preferences
  set name = coalesce(name, 'Profilo principale');

alter table public.investor_alert_preferences
  alter column name set not null;

alter table public.investor_alert_preferences
  add constraint investor_alert_preferences_name_length_check
  check (char_length(name) between 1 and 60);

alter table public.investor_alert_preferences
  drop constraint if exists investor_alert_preferences_pkey;

alter table public.investor_alert_preferences
  add constraint investor_alert_preferences_pkey primary key (id);

-- Two profiles with the same name would be indistinguishable in the interface.
alter table public.investor_alert_preferences
  add constraint investor_alert_preferences_user_name_unique unique (user_id, name);

create index if not exists investor_alert_preferences_user_idx
  on public.investor_alert_preferences (user_id)
  where is_active;

comment on table public.investor_alert_preferences is
  'Investor search profiles. One investor may keep several: a yield-led profile and a location-led one select different properties, and a single profile cannot express both.';

-- Context on the alert: which profile produced it. Not part of the identity,
-- because deduplication stays per investor.
alter table public.investor_alerts
  add column if not exists matched_profile text;
