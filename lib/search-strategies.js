export const SEARCH_STRATEGIES = Object.freeze({
  legacy_low_price_m2: Object.freeze({
    id: 'legacy_low_price_m2',
    scoringMode: 'legacy_physical_plus_economic_v1',
    idealistaSortBy: 'lowestPriceM2',
    includeEconomicDoorSignals: true,
    shortlistTieBreaker: 'lowest_price_m2',
  }),
  neutral_fractionability: Object.freeze({
    id: 'neutral_fractionability',
    scoringMode: 'physical_fractionability_only_v1',
    idealistaSortBy: 'mostRecent',
    includeEconomicDoorSignals: false,
    shortlistTieBreaker: 'physical_signals_only',
  }),
  villa_dynamic_market: Object.freeze({
    id: 'villa_dynamic_market',
    scoringMode: 'villa_dynamic_market_opportunity_v1',
    idealistaSortBy: 'mostRecent',
    includeEconomicDoorSignals: false,
    shortlistTieBreaker: 'villa_opportunity_score',
  }),
});

export function resolveSearchStrategy(value = 'legacy_low_price_m2') {
  const normalized = String(value || '').trim().toLowerCase();
  const strategy = SEARCH_STRATEGIES[normalized];
  if (!strategy) {
    throw new Error(`Unsupported TORIUM_SEARCH_STRATEGY=${value}. Expected one of: ${Object.keys(SEARCH_STRATEGIES).join(', ')}`);
  }
  return strategy;
}

export function buildStrategySearchName(baseName, strategy) {
  const suffixes = Object.keys(SEARCH_STRATEGIES).map((id) => `-${id}`);
  const cleanBaseName = suffixes.reduce(
    (name, suffix) => name.endsWith(suffix) ? name.slice(0, -suffix.length) : name,
    baseName
  );
  return `${cleanBaseName}-${strategy.id}`;
}

export function compareShortlistItems(a, b, strategy) {
  const scoreDifference = (b.door_score ?? 0) - (a.door_score ?? 0);
  if (scoreDifference !== 0) return scoreDifference;

  if (strategy.shortlistTieBreaker === 'lowest_price_m2') {
    return (a.price_by_area ?? Number.POSITIVE_INFINITY) - (b.price_by_area ?? Number.POSITIVE_INFINITY);
  }

  return 0;
}
