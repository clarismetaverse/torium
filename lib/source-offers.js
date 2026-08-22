import crypto from 'node:crypto';

const SUPPORTED_SOURCES = new Set(['idealista', 'immobiliare']);

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedListing(item) {
  return item?.normalized_v1 || item?.listing?.normalized_v1 || null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function sourceOfferFromListing(item) {
  const normalized = normalizedListing(item);
  const sourceChannel = String(item?.source_channel || normalized?.source_channel || '').toLowerCase();
  if (!SUPPORTED_SOURCES.has(sourceChannel)) return null;
  const status = normalized?.asking_price?.status || item?.price_status ||
    (finitePositive(item?.price_eur) ? 'known' : 'missing');
  const amount = status === 'known'
    ? finitePositive(normalized?.asking_price?.amount_eur ?? item?.price_eur)
    : null;
  return {
    source_channel: sourceChannel,
    source_listing_id: clean(item?.source_listing_id || normalized?.source_listing_id),
    source_url: clean(item?.source_url || normalized?.canonical_url),
    asking_price_eur: amount,
    price_status: amount ? 'known' : status,
    price_per_sqm_eur: amount
      ? finitePositive(normalized?.asking_price?.price_per_sqm_eur ?? item?.price_by_area)
      : null,
    observed_at: clean(normalized?.asking_price?.observed_at || item?.observed_at || item?.created_at),
  };
}

export function mergeSourceOffers(values) {
  const offers = values
    .flatMap((value) => Array.isArray(value?.source_offers) ? value.source_offers : [sourceOfferFromListing(value)])
    .filter(Boolean);
  const byIdentity = new Map();
  for (const offer of offers) {
    const key = `${offer.source_channel}:${offer.source_listing_id || offer.source_url || 'unknown'}`;
    const existing = byIdentity.get(key);
    if (!existing || (!finitePositive(existing.asking_price_eur) && finitePositive(offer.asking_price_eur))) {
      byIdentity.set(key, offer);
    }
  }
  return [...byIdentity.values()].sort((left, right) => left.source_channel.localeCompare(right.source_channel));
}

export function compareSourceOfferPrices(offers) {
  const all = mergeSourceOffers((offers || []).map((offer) => ({ source_offers: [offer] })));
  const known = all.filter((offer) => finitePositive(offer.asking_price_eur));
  const channels = [...new Set(all.map((offer) => offer.source_channel))];
  const prices = [...new Set(known.map((offer) => offer.asking_price_eur))];
  const sorted = [...known].sort((left, right) => left.asking_price_eur - right.asking_price_eur);
  const lowest = sorted[0] || null;
  const highest = sorted.at(-1) || null;
  const difference = lowest && highest ? highest.asking_price_eur - lowest.asking_price_eur : null;
  const differencePct = difference !== null && lowest.asking_price_eur > 0
    ? difference / lowest.asking_price_eur * 100
    : null;
  const comparable = channels.length >= 2 && known.length >= 2;
  const hasDifference = comparable && difference > 0;
  return {
    is_multi_source: channels.length >= 2,
    source_count: channels.length,
    offer_count: all.length,
    known_price_count: known.length,
    distinct_price_count: prices.length,
    is_price_comparable: comparable,
    has_price_difference: hasDifference,
    price_difference_eur: hasDifference ? difference : 0,
    price_difference_pct: hasDifference ? Math.round(differencePct * 10) / 10 : 0,
    lowest_asking_price_eur: lowest?.asking_price_eur ?? null,
    highest_asking_price_eur: highest?.asking_price_eur ?? null,
    lowest_price_source: lowest?.source_channel ?? null,
    highest_price_source: highest?.source_channel ?? null,
    // Conservative: ROI is never inflated by silently choosing the cheaper portal.
    underwriting_reference_eur: highest?.asking_price_eur ?? null,
    negotiation_target_eur: lowest?.asking_price_eur ?? null,
    negotiation_signal: hasDifference ? 'cross_portal_price_difference' : null,
  };
}

export function canonicalPropertyGroupKey(members) {
  const identities = members.map((item) => {
    const normalized = normalizedListing(item);
    const source = item?.source_channel || normalized?.source_channel || 'other';
    const id = item?.source_listing_id || normalized?.source_listing_id || item?.source_url || normalized?.canonical_url || '';
    return `${source}:${id}`;
  }).sort();
  return `property:v2:${crypto.createHash('sha256').update(identities.join('|')).digest('hex').slice(0, 24)}`;
}

export function mergeUnifiedProperty(members) {
  const ranked = [...members].sort((left, right) => {
    if (Boolean(left.pre_triage_excluded) !== Boolean(right.pre_triage_excluded)) return left.pre_triage_excluded ? 1 : -1;
    return (right.door_score ?? 0) - (left.door_score ?? 0);
  });
  const representative = ranked[0];
  const sourceOffers = mergeSourceOffers(members);
  const priceComparison = compareSourceOfferPrices(sourceOffers);
  const price = priceComparison.underwriting_reference_eur ?? representative.price_eur ?? null;
  const size = finitePositive(representative.size_mq);
  const canonicalKey = canonicalPropertyGroupKey(members);
  for (const member of members) member.canonical_source_key = canonicalKey;
  return {
    ...representative,
    canonical_source_key: canonicalKey,
    price_eur: price,
    price_by_area: price && size ? Math.round(price / size) : representative.price_by_area,
    listing: representative.listing ? {
      ...representative.listing,
      price,
      priceByArea: price && size ? Math.round(price / size) : representative.listing.priceByArea,
    } : representative.listing,
    source_offers: sourceOffers,
    price_comparison: priceComparison,
    origin_source_channels: [...new Set(sourceOffers.map((offer) => offer.source_channel))],
    origin_source_urls: [...new Set(sourceOffers.map((offer) => offer.source_url).filter(Boolean))],
  };
}

export function summarizePriceDifferences(properties) {
  const comparisons = (properties || []).map((property) => property?.price_comparison ||
    compareSourceOfferPrices(property?.source_offers || [])).filter(Boolean);
  const multi = comparisons.filter((comparison) => comparison.is_multi_source);
  const comparable = comparisons.filter((comparison) => comparison.is_price_comparable);
  const different = comparable.filter((comparison) => comparison.has_price_difference);
  return {
    multi_source_property_count: multi.length,
    price_comparable_property_count: comparable.length,
    different_price_property_count: different.length,
    different_price_share_pct: comparable.length ? Math.round(different.length / comparable.length * 1000) / 10 : 0,
    median_price_difference_eur: median(different.map((comparison) => comparison.price_difference_eur)),
    median_price_difference_pct: median(different.map((comparison) => comparison.price_difference_pct)),
    max_price_difference_eur: different.length ? Math.max(...different.map((comparison) => comparison.price_difference_eur)) : null,
    max_price_difference_pct: different.length ? Math.max(...different.map((comparison) => comparison.price_difference_pct)) : null,
    underwriting_price_rule: 'highest_known_cross_portal_asking_price',
    negotiation_target_rule: 'lowest_known_cross_portal_asking_price',
  };
}

