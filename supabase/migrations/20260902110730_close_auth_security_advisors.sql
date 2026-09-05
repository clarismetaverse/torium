alter view public.triage_best_properties set (security_invoker = true);
alter view public.triage_source_shortlist set (security_invoker = true);

create index if not exists torium_memberships_invited_by_idx
  on public.torium_memberships (invited_by);

drop policy if exists "Clients cannot read auth events" on public.torium_auth_events;
create policy "Clients cannot read auth events"
  on public.torium_auth_events for select to authenticated
  using (false);
