create table if not exists public.triage_listing_assets (
  id bigint generated always as identity primary key,
  run_id text not null references public.triage_runs(run_id) on delete cascade,
  asset_key text not null check (asset_key ~ '^[a-f0-9]{64}$'),
  asset_type text not null check (asset_type in ('photo', 'floor_plan')),
  source_url text not null,
  source_host text not null,
  storage_path text,
  cache_status text not null default 'remote' check (cache_status in ('remote', 'cached', 'failed')),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 10485760),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  cached_at timestamptz,
  last_accessed_at timestamptz,
  expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, asset_key)
);

create index if not exists triage_listing_assets_run_status_idx
  on public.triage_listing_assets (run_id, cache_status);

create index if not exists triage_listing_assets_expiry_idx
  on public.triage_listing_assets (expires_at)
  where cache_status = 'cached';

alter table public.triage_listing_assets enable row level security;
revoke all on table public.triage_listing_assets from anon, authenticated;
grant select, insert, update, delete on table public.triage_listing_assets to service_role;
revoke all on sequence public.triage_listing_assets_id_seq from anon, authenticated;
grant usage, select on sequence public.triage_listing_assets_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'torium-listing-assets',
  'torium-listing-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
