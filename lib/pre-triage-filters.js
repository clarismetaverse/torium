import { extractListingBasics } from './door-engine.js';

export function getPreTriageExclusion(listing) {
  const basics = extractListingBasics(listing);
  const reasons = [];

  if (basics.auctionSignal) {
    reasons.push('auction_excluded');
  }

  if (basics.changeOfUseSignal) {
    reasons.push('change_of_use_or_rural_fabric_excluded');
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
