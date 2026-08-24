create index if not exists virtual_renewals_source_listing_row_idx
  on public.virtual_renewals (source_listing_row_id);

create index if not exists virtual_renewals_run_id_idx
  on public.virtual_renewals (run_id);

create index if not exists virtual_renewals_style_id_idx
  on public.virtual_renewals (style_id);
