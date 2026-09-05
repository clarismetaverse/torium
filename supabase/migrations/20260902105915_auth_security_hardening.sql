create table if not exists public.torium_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'investor')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.torium_memberships is
  'Server-managed TORIUM access allowlist and application role. Never derived from user-editable metadata.';

create index if not exists torium_memberships_role_status_idx
  on public.torium_memberships (role, status);

alter table public.torium_memberships enable row level security;
alter table public.torium_memberships force row level security;
revoke all on table public.torium_memberships from anon;
grant select on table public.torium_memberships to authenticated;

drop policy if exists "Members can read own membership" on public.torium_memberships;
create policy "Members can read own membership"
  on public.torium_memberships for select to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.torium_auth_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (
    event_type in (
      'login_succeeded',
      'logout',
      'invite_accepted',
      'recovery_link_opened',
      'password_changed'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

comment on table public.torium_auth_events is
  'Minimal server-side authentication audit trail. No raw IP addresses, passwords or tokens.';

create index if not exists torium_auth_events_user_time_idx
  on public.torium_auth_events (user_id, occurred_at desc);

alter table public.torium_auth_events enable row level security;
alter table public.torium_auth_events force row level security;
revoke all on table public.torium_auth_events from anon, authenticated;

drop policy if exists "Investors can read own alert preferences" on public.investor_alert_preferences;
create policy "Investors can read own alert preferences"
  on public.investor_alert_preferences for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

drop policy if exists "Investors can create own alert preferences" on public.investor_alert_preferences;
create policy "Investors can create own alert preferences"
  on public.investor_alert_preferences for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

drop policy if exists "Investors can update own alert preferences" on public.investor_alert_preferences;
create policy "Investors can update own alert preferences"
  on public.investor_alert_preferences for update to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

drop policy if exists "Investors can delete own alert preferences" on public.investor_alert_preferences;
create policy "Investors can delete own alert preferences"
  on public.investor_alert_preferences for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.torium_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );
