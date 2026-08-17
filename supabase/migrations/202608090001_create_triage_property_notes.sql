create table if not exists public.triage_property_notes (
  id bigint generated always as identity primary key,
  run_id text not null references public.triage_runs(run_id) on delete cascade,
  listing_index integer not null check (listing_index >= 0),
  note text not null default '' check (char_length(note) <= 4000),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint triage_property_notes_run_listing_key unique (run_id, listing_index)
);

alter table public.triage_property_notes enable row level security;

revoke all on table public.triage_property_notes from anon, authenticated;
grant select, insert, update on table public.triage_property_notes to service_role;

revoke all on sequence public.triage_property_notes_id_seq from anon, authenticated;
grant usage, select on sequence public.triage_property_notes_id_seq to service_role;
