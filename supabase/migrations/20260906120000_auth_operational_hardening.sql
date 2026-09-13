-- TORIUM Phase 0 authentication hardening, part 2.
--
-- Additive only. Nothing here relaxes an existing policy or grants a new
-- privilege to anon or authenticated.

-- 1. Widen the audit vocabulary.
--
-- Failed logins, membership-denied logins and self-service requests were not
-- expressible before, so the most security-relevant events were invisible.
-- Rows stay pseudonymous: metadata carries an HMAC subject, never an email
-- address, password, token or raw IP address.
alter table public.torium_auth_events
  drop constraint if exists torium_auth_events_event_type_check;

alter table public.torium_auth_events
  add constraint torium_auth_events_event_type_check check (
    event_type in (
      'login_succeeded',
      'login_failed',
      'login_denied_membership',
      'logout',
      'invite_requested',
      'invite_accepted',
      'recovery_requested',
      'recovery_link_opened',
      'password_changed'
    )
  );

create index if not exists torium_auth_events_type_time_idx
  on public.torium_auth_events (event_type, occurred_at desc);

-- 2. Durable, instance-independent rate limiting.
--
-- Module-global counters in a serverless function only bound a single warm
-- instance, so a burst spread across instances was effectively unlimited. This
-- counter is shared by every instance. Subjects are HMAC digests produced by
-- the API, so no address or email address is stored here.
create table if not exists public.torium_rate_limits (
  bucket text not null,
  subject text not null,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0,
  primary key (bucket, subject)
);

comment on table public.torium_rate_limits is
  'Shared authentication rate-limit counters. Subjects are pseudonymous HMAC digests, never raw addresses or email addresses.';

create index if not exists torium_rate_limits_window_idx
  on public.torium_rate_limits (window_started_at);

alter table public.torium_rate_limits enable row level security;
alter table public.torium_rate_limits force row level security;
revoke all on table public.torium_rate_limits from anon, authenticated;

create or replace function public.torium_rate_limit_hit(
  p_bucket text,
  p_subject text,
  p_window_seconds integer,
  p_max_hits integer
)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => greatest(1, p_window_seconds));
  v_started timestamptz;
  v_hits integer;
begin
  insert into public.torium_rate_limits as limits (bucket, subject, window_started_at, hits)
  values (p_bucket, p_subject, v_now, 1)
  on conflict (bucket, subject) do update
    set hits = case
          when limits.window_started_at < v_now - v_window then 1
          else limits.hits + 1
        end,
        window_started_at = case
          when limits.window_started_at < v_now - v_window then v_now
          else limits.window_started_at
        end
  returning limits.window_started_at, limits.hits into v_started, v_hits;

  allowed := v_hits <= greatest(1, p_max_hits);
  retry_after := greatest(
    1,
    ceil(extract(epoch from ((v_started + v_window) - v_now)))::integer
  );
  return next;
end;
$$;

revoke all on function public.torium_rate_limit_hit(text, text, integer, integer) from public;
revoke all on function public.torium_rate_limit_hit(text, text, integer, integer) from anon, authenticated;
grant execute on function public.torium_rate_limit_hit(text, text, integer, integer) to service_role;

-- Housekeeping for expired counters. Callable by the service role only.
create or replace function public.torium_rate_limit_prune(p_older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.torium_rate_limits
  where window_started_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.torium_rate_limit_prune(interval) from public;
revoke all on function public.torium_rate_limit_prune(interval) from anon, authenticated;
grant execute on function public.torium_rate_limit_prune(interval) to service_role;

-- 3. Close the two mutable search_path advisories.
--
-- Both functions only assign to NEW and call built-ins resolved from
-- pg_catalog, so pinning an empty search_path cannot change their behaviour.
alter function public.set_updated_at() set search_path = '';
alter function public.set_idealista_location_fields_from_query_payload() set search_path = '';
