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
    listing?.floor,
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

export function hasExcludedOwnershipOrOccupancy(listing) {
  const text = listingText(listing);

  return includesAny(text, [
    'nuda proprieta',
    'bareownership',
    'bare ownership',
    'usufrutto',
    'usufruttuario',
    'diritto di abitazione',
    'occupato',
    'occupata',
    'immobile occupato',
    'locato',
    'locata',
    'affittato',
    'affittata',
    'tenant',
    'tenanted',
  ]);
}

export function hasExcludedNonResidentialUse(listing) {
  const text = listingText(listing);
  const floor = normalizeText(listing?.floor);

  const nonResidentialSignals = includesAny(text, [
    'magazzino',
    'laboratorio',
    'autorimessa',
    'garage',
    'box',
    'deposito',
    'c/2',
    'c2',
    'c/6',
    'c6',
    'c/3',
    'c3',
    'negozio',
    'loft accatastato',
    'immobile non residenziale',
    'da trasformare in unita abitative',
    'trasformare in unita abitative',
  ]);

  const basementSignals = floor === 'ss' || floor === 's1' || floor === 's2' || includesAny(text, [
    'piano ss',
    'piano s1',
    'piano s2',
    'seminterrato',
    'semintterrato',
    'sottosuolo',
    'interrato',
  ]);

  return nonResidentialSignals || basementSignals;
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

  if (hasExcludedOwnershipOrOccupancy(listing)) {
    reasons.push('ownership_or_occupancy_excluded');
  }

  if (hasExcludedNonResidentialUse(listing)) {
    reasons.push('non_residential_or_basement_excluded');
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
