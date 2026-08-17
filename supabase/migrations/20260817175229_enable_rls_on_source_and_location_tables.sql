-- These tables are accessed by TORIUM's server-side API using service_role.
-- No public RLS policies are intentional: anon/authenticated access is denied.
alter table public.triage_source_listings enable row level security;
alter table public.milan_idealista_locations enable row level security;
