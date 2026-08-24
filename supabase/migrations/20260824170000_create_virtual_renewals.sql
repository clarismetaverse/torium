create table if not exists public.renewal_styles (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name text not null check (char_length(name) between 2 and 120),
  description text,
  palette jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virtual_renewals (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique check (external_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,179}$'),
  source_listing_row_id bigint references public.triage_source_listings(id) on delete set null,
  run_id text references public.triage_runs(run_id) on delete set null,
  source_channel text not null check (source_channel in ('idealista', 'immobiliare')),
  source_listing_id text not null check (char_length(source_listing_id) between 1 and 180),
  source_url text not null check (source_url ~ '^https://'),
  style_id text not null references public.renewal_styles(id),
  title text,
  subtitle text,
  narrative text,
  location_label text,
  status text not null default 'draft' check (status in ('draft', 'processing', 'published', 'failed', 'archived')),
  version integer not null default 1 check (version between 1 and 1000000),
  generation_provider text,
  generation_model text,
  prompt_version text,
  agent_job_id text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_channel, source_listing_id, style_id, version)
);

create table if not exists public.virtual_renewal_assets (
  id uuid primary key default gen_random_uuid(),
  renewal_id uuid not null references public.virtual_renewals(id) on delete cascade,
  asset_key text not null check (asset_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,179}$'),
  asset_kind text not null check (asset_kind in ('renewal', 'original', 'floor_plan', 'material', 'detail')),
  view_id text,
  view_name text,
  room_type text,
  layout_type text not null default 'landscape' check (layout_type in ('hero', 'landscape', 'portrait', 'diptych', 'plan', 'original', 'detail')),
  sort_order integer not null default 0,
  source_url text check (source_url is null or source_url ~ '^https://'),
  storage_bucket text,
  storage_path text,
  upload_status text not null default 'ready' check (upload_status in ('pending', 'ready', 'failed', 'archived')),
  mime_type text check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 15728640),
  width integer check (width is null or width between 1 and 30000),
  height integer check (height is null or height between 1 and 30000),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  caption text,
  alt_text text,
  is_cover boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_url is not null or (storage_bucket is not null and storage_path is not null)),
  unique (renewal_id, asset_key)
);

create index if not exists virtual_renewals_listing_idx
  on public.virtual_renewals (source_channel, source_listing_id, status);

create index if not exists virtual_renewals_publication_idx
  on public.virtual_renewals (status, sort_order, published_at desc);

create index if not exists virtual_renewal_assets_sequence_idx
  on public.virtual_renewal_assets (renewal_id, sort_order, asset_key);

alter table public.renewal_styles enable row level security;
alter table public.virtual_renewals enable row level security;
alter table public.virtual_renewal_assets enable row level security;

revoke all on table public.renewal_styles from anon, authenticated;
revoke all on table public.virtual_renewals from anon, authenticated;
revoke all on table public.virtual_renewal_assets from anon, authenticated;
grant select, insert, update, delete on table public.renewal_styles to service_role;
grant select, insert, update, delete on table public.virtual_renewals to service_role;
grant select, insert, update, delete on table public.virtual_renewal_assets to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'torium-renewals',
  'torium-renewals',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into public.renewal_styles (id, name, description, palette)
values
  ('a1_quiet_luxury', 'Quiet Mediterranean Luxury', 'Materiali naturali, toni caldi e lusso discreto.', '{"mood":"quiet_luxury","accent":"limestone"}'::jsonb),
  ('a2_organic_icon', 'Organic Mediterranean Icon', 'Volumi scultorei, artigianato e paesaggio come parte dell''architettura.', '{"mood":"organic_icon","accent":"terracotta"}'::jsonb),
  ('a3_private_estate_hnwi', 'Private Estate HNWI', 'Privacy, rappresentanza e comfort da residenza internazionale.', '{"mood":"private_estate","accent":"deep_olive"}'::jsonb)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    palette = excluded.palette,
    is_active = true,
    updated_at = now();
