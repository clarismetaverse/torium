-- Supabase grants ALL on every new table in the public schema to anon and
-- authenticated through default privileges, so the "grant select, update" in
-- the previous migration widened nothing but also narrowed nothing: the role
-- kept INSERT, DELETE and TRUNCATE on public.investor_alerts.
--
-- Row-level security already refused those operations - the table is FORCE RLS
-- and has no INSERT or DELETE policy - so this changes no behaviour. It closes
-- the gap between what the grant says and what the design intends, so that a
-- policy added carelessly later cannot open a door the grant had left unlocked.
--
-- Creating an alert stays a server decision, made with the service role.

revoke all on table public.investor_alerts from anon, authenticated;
grant select, update on table public.investor_alerts to authenticated;

-- The delivery ledger and the reconciliation log are server-only in full.
revoke all on table public.investor_alert_digests from anon, authenticated;
revoke all on table public.investor_alert_runs from anon, authenticated;
