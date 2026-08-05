alter table public.triage_runs
  add column if not exists search_strategy text,
  add column if not exists scoring_mode text;

alter table public.triage_runs
  drop constraint if exists triage_runs_search_strategy_check;

alter table public.triage_runs
  add constraint triage_runs_search_strategy_check
  check (search_strategy is null or search_strategy in ('legacy_low_price_m2', 'neutral_fractionability'));

create index if not exists triage_runs_search_strategy_created_at_idx
  on public.triage_runs (search_strategy, created_at desc);
