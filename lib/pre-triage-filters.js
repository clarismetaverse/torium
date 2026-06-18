import { extractListingBasics } from './door-engine.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function listingText(listing) {
  return [
    listing?.address,
    listing?.description,
    listing?.propertyType,
    listing?.detailedType?.typology,
    listing?.detailedType?.subTypology,
    listing?.suggestedTexts?.title,
    ...(Array.isArray(listing?.labels) ? listing.labels.map((label) => `${label?.name || ''} ${label?.text || ''}`) : []),
  ]
    .filter(Boolean)
    .map(normalizeText)
    .join(' ');
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

export function hasExcludedTypology(listing) {
  const text = listingText(listing);

  const excludedApiTypes = [
    'chalet',
    'countryhouse',
    'casadepueblo',
    'terracedhouse',
    'independanthouse',
    'independenthouse',
  ];

  const excludedTextSignals = [
    'villetta',
    'villetta a schiera',
    'casa indipendente',
    'casa di paese',
    'cascina',
    'casale',
    'rustico',
    'corte lombarda',
    'casali/cascine',
    'fabbricato rurale',
  ];

  return includesAny(text, excludedApiTypes) || includesAny(text, excludedTextSignals);
}

export function getPreTriageExclusion(listing) {
  const basics = extractListingBasics(listing);
  const reasons = [];

  if (basics.auctionSignal) {
    reasons.push('auction_excluded');
  }

  if (basics.changeOfUseSignal) {
    reasons.push('change_of_use_or_rural_fabric_excluded');
  }

  if (hasExcludedTypology(listing)) {
    reasons.push('typology_excluded_for_max_doors_profile');
  }

  return {
    excluded: reasons.length > 0,
    reasons,
    basics,
  };
}

export function summarizeExclusions(filteredOut) {
  return filteredOut.reduce((acc, item) => {
    for (const reason of item.exclusion.reasons) {
      acc[reason] = (acc[reason] || 0) + 1;
    }
    return acc;
  }, {});
}
