function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

function resultIdentity(result, fallback) {
  const listing = result?.listing || {};
  const source = result?.source_row || {};
  const candidates = [
    source.source_listing_id,
    result?.source_listing_id,
    listing.propertyCode,
    source.canonical_source_key,
    source.source_key,
    result?.url,
    result?.source_url,
    listing.url,
  ];
  const exact = candidates.find((value) => value !== null && value !== undefined && String(value).trim());
  if (exact !== undefined) return `exact:${String(exact).trim().toLowerCase()}`;

  const address = source.address || result?.address || listing.address;
  const price = listing.price ?? result?.price_eur ?? result?.price;
  const size = listing.size ?? result?.size_mq ?? result?.size;
  if (address && price != null && size != null) {
    return `fallback:${String(address).trim().toLowerCase()}|${price}|${size}`;
  }
  return `row:${fallback}`;
}

function outputResults(output) {
  return array(output?.results).length ? output.results : array(output?.result_links);
}

export function combineRunOutputs(components = []) {
  const byIdentity = new Map();
  let inputResultCount = 0;

  for (const [componentIndex, component] of components.entries()) {
    const output = component.output || {};
    const runId = component.runId;
    const strategy = output.search_strategy || component.searchStrategy || 'legacy_low_price_m2';
    for (const [resultIndex, result] of outputResults(output).entries()) {
      inputResultCount += 1;
      const identity = resultIdentity(result, `${componentIndex}:${resultIndex}`);
      const existing = byIdentity.get(identity);
      if (existing) {
        existing.origin_run_ids = unique([...existing.origin_run_ids, runId]);
        existing.origin_search_strategies = unique([...existing.origin_search_strategies, strategy]);
        continue;
      }
      byIdentity.set(identity, {
        ...result,
        source_ranking_score: result?.ranking_score ?? result?.score ?? null,
        source_listing_index: result.listing_index ?? resultIndex,
        origin_run_ids: [runId],
        origin_search_strategies: [strategy],
      });
    }
  }

  const results = [...byIdentity.values()].map((result, index) => ({
    ...result,
    id: index,
    listing_index: index,
  }));
  const outputs = components.map((component) => component.output || {});

  return {
    search_name: 'milanoFractioningCombined-neutral-plus-legacy',
    city: unique(outputs.map((output) => output.city))[0] || 'Milano',
    investor_profile: unique(outputs.map((output) => output.investor_profile))[0] || null,
    search_strategy: 'combined_neutral_legacy',
    scoring_mode: 'cross_run_frontend_view_v1',
    scraped_count: outputs.reduce((sum, output) => sum + Number(output.scraped_count ?? output.raw_source_count ?? 0), 0),
    raw_source_count: outputs.reduce((sum, output) => sum + Number(output.raw_source_count ?? output.scraped_count ?? 0), 0),
    eligible_count: outputs.reduce((sum, output) => sum + Number(output.eligible_count ?? 0), 0),
    filtered_out_count: outputs.reduce((sum, output) => sum + Number(output.filtered_out_count ?? 0), 0),
    gpt_analyzed_count: outputs.reduce((sum, output) => sum + Number(output.gpt_analyzed_count ?? 0), 0),
    requested_areas: unique(outputs.flatMap((output) => array(output.requested_areas))),
    source_channels: unique(outputs.flatMap((output) => array(output.source_channels))),
    component_runs: components.map((component) => ({
      run_id: component.runId,
      search_strategy: component.output?.search_strategy || component.searchStrategy || 'legacy_low_price_m2',
      result_count: outputResults(component.output).length,
    })),
    merge_summary: {
      input_result_count: inputResultCount,
      duplicates_removed: inputResultCount - results.length,
      unique_result_count: results.length,
    },
    result_links: [],
    results,
  };
}

export function rescoreCombinedResults(output, scoreResult) {
  return {
    ...output,
    results: array(output?.results).map((result) => {
      const doorEngine = scoreResult(result);
      return {
        ...result,
        source_ranking_score: result.source_ranking_score ?? result.ranking_score ?? result.score ?? null,
        ranking_score: doorEngine?.doorScore ?? null,
        door_engine: doorEngine,
      };
    }),
  };
}
