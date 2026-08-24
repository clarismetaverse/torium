alter table public.triage_runs
  drop constraint if exists triage_runs_search_strategy_check;

alter table public.triage_runs
  add constraint triage_runs_search_strategy_check
  check (
    search_strategy is null
    or search_strategy in (
      'legacy_low_price_m2',
      'neutral_fractionability',
      'villa_dynamic_market'
    )
  );
