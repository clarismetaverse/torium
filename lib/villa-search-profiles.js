export const VILLA_GEO_PROFILES = Object.freeze({
  como: Object.freeze({
    id: 'como',
    label: 'Lago di Como',
    city: 'Como',
    requestedArea: 'Lago di Como · raggio 35 km',
    latitude: 45.9842,
    longitude: 9.2572,
    distanceKm: 35,
    regionFilter: null,
  }),
  toscana: Object.freeze({
    id: 'toscana',
    label: 'Toscana',
    city: 'Toscana',
    requestedArea: 'Toscana',
    // Four overlapping tiles avoid treating the whole region as one city and
    // keep the geography reusable for both source actors.
    tiles: Object.freeze([
      Object.freeze({ id: 'north', label: 'Toscana nord', latitude: 43.8430, longitude: 10.5079, distanceKm: 58 }),
      Object.freeze({ id: 'central', label: 'Toscana centrale', latitude: 43.5320, longitude: 11.3130, distanceKm: 58 }),
      Object.freeze({ id: 'south', label: 'Toscana sud', latitude: 42.7635, longitude: 11.1090, distanceKm: 62 }),
      Object.freeze({ id: 'coast', label: 'Costa Toscana', latitude: 43.1450, longitude: 10.7800, distanceKm: 62 }),
    ]),
    regionFilter: 'Toscana',
  }),
  sardegna: Object.freeze({
    id: 'sardegna',
    label: 'Sardegna',
    city: 'Sardegna',
    requestedArea: 'Sardegna',
    // Four overlapping tiles cover the island without relying on a single
    // oversized radius. Returned records must still pass the region check.
    tiles: Object.freeze([
      Object.freeze({ id: 'north_east', label: 'Sardegna nord-est · Gallura', latitude: 40.9236, longitude: 9.4964, distanceKm: 62 }),
      Object.freeze({ id: 'north_west', label: 'Sardegna nord-ovest', latitude: 40.7259, longitude: 8.5590, distanceKm: 66 }),
      Object.freeze({ id: 'central', label: 'Sardegna centrale', latitude: 40.0240, longitude: 8.9740, distanceKm: 68 }),
      Object.freeze({ id: 'south', label: 'Sardegna sud', latitude: 39.2238, longitude: 9.1217, distanceKm: 68 }),
    ]),
    regionFilter: 'Sardegna',
    // Sardinia currently has a much thinner strict-renovation inventory than
    // the other presets. Keep renovation as the preferred value-add signal,
    // but also admit villas in good condition that can be repositioned with
    // lighter works, outdoor improvements or tourism-oriented restyling.
    candidateConditionOverrides: Object.freeze({
      renovation: Object.freeze({
        idealista: Object.freeze(['renew', 'good']),
        immobiliare: Object.freeze(['toBeRenovated', 'good']),
      }),
    }),
  }),
});

export const VILLA_INTENTS = Object.freeze({
  renovation: Object.freeze({
    id: 'renovation',
    label: 'Acquisto + ristrutturazione',
    candidateIdealistaCondition: ['renew'],
    candidateImmobiliareCondition: 'toBeRenovated',
    comparableIdealistaCondition: ['good'],
    comparableImmobiliareCondition: 'excellent',
  }),
  tourism: Object.freeze({
    id: 'tourism',
    label: 'Turismo / hold',
    candidateIdealistaCondition: ['good', 'renew'],
    candidateImmobiliareCondition: 'good',
    comparableIdealistaCondition: ['good'],
    comparableImmobiliareCondition: 'excellent',
  }),
});

export function resolveVillaGeoProfile(value) {
  const id = String(value || '').trim().toLowerCase();
  const profile = VILLA_GEO_PROFILES[id];
  if (!profile) throw new Error(`Area ville non valida: ${value}. Usa como, toscana o sardegna.`);
  return profile;
}

export function resolveVillaIntent(value) {
  const id = String(value || '').trim().toLowerCase();
  const intent = VILLA_INTENTS[id];
  if (!intent) throw new Error(`Strategia ville non valida: ${value}. Usa renovation o tourism.`);
  return intent;
}

export function villaGeoTiles(profile) {
  if (Array.isArray(profile.tiles) && profile.tiles.length) return profile.tiles;
  return [{
    id: profile.id,
    label: profile.requestedArea,
    latitude: profile.latitude,
    longitude: profile.longitude,
    distanceKm: profile.distanceKm,
  }];
}

function compact(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

export function buildVillaIdealistaPayload({ tile, condition, maxItems, intent }) {
  return compact({
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    latitude: tile.latitude,
    longitude: tile.longitude,
    distanceKm: tile.distanceKm,
    homeType: ['villa', 'detachedHouse', 'semiDetachedHouse', 'countryHouse'],
    condition,
    propertyStatus: ['free'],
    minSize: intent === 'tourism' ? '120' : '140',
    minPrice: '0',
    sortBy: 'mostRecent',
    maxItems,
    fetchDetails: false,
    fetchStats: false,
  });
}

export function buildVillaImmobiliarePayload({ tile, condition, maxItems, intent }) {
  return compact({
    maxItems,
    latitude: tile.latitude,
    longitude: tile.longitude,
    distanceKm: tile.distanceKm,
    operation: 'buy',
    sortType: 'mostRecent',
    minSize: intent === 'tourism' ? 120 : 140,
    minRooms: intent === 'tourism' ? 4 : 3,
    maxRooms: 0,
    bedrooms: 0,
    propertyType: 'house',
    propertyCondition: condition,
    excludeAuctions: true,
  });
}

export function buildVillaSourceQueries({
  area,
  intent,
  maxItemsPerSource,
  idealistaActorId,
  immobiliareActorId,
  sources = ['idealista', 'immobiliare'],
}) {
  const geo = resolveVillaGeoProfile(area);
  const investmentIntent = resolveVillaIntent(intent);
  const tiles = villaGeoTiles(geo);
  const candidatePerTile = Math.max(1, Math.ceil(maxItemsPerSource / tiles.length));
  const comparablePerTile = Math.max(10, Math.ceil(candidatePerTile * 0.45));
  const conditionOverride = geo.candidateConditionOverrides?.[intent];
  const idealistaCandidateCondition = conditionOverride?.idealista || investmentIntent.candidateIdealistaCondition;
  const immobiliareCandidateConditions = conditionOverride?.immobiliare || [investmentIntent.candidateImmobiliareCondition];
  const immobiliareCandidatePerCondition = Math.max(1, Math.ceil(candidatePerTile / immobiliareCandidateConditions.length));
  const queries = [];

  for (const tile of tiles) {
    if (sources.includes('idealista')) {
      queries.push({
        actor: 'idealista', actor_id: idealistaActorId, source_channel: 'idealista', source_platform_name: 'idealista',
        query_name: `villa-${intent}-candidate`, query_area: tile.label, query_municipality: geo.city,
        query_province: geo.id === 'como' ? 'CO' : null, source_area_enforced: true,
        comparison_role: 'candidate', region_filter: geo.regionFilter,
        payload: buildVillaIdealistaPayload({ tile, condition: idealistaCandidateCondition, maxItems: candidatePerTile, intent }),
      });
      queries.push({
        actor: 'idealista', actor_id: idealistaActorId, source_channel: 'idealista', source_platform_name: 'idealista',
        query_name: 'villa-exit-comparable', query_area: tile.label, query_municipality: geo.city,
        query_province: geo.id === 'como' ? 'CO' : null, source_area_enforced: true,
        comparison_role: 'exit_comparable', region_filter: geo.regionFilter,
        payload: buildVillaIdealistaPayload({ tile, condition: investmentIntent.comparableIdealistaCondition, maxItems: comparablePerTile, intent }),
      });
    }

    if (sources.includes('immobiliare')) {
      for (const condition of immobiliareCandidateConditions) {
        queries.push({
          actor: 'immobiliare-structured', actor_id: immobiliareActorId, source_channel: 'immobiliare', source_platform_name: 'immobiliare',
          query_name: immobiliareCandidateConditions.length > 1
            ? `villa-${intent}-candidate-${condition}`
            : `villa-${intent}-candidate`,
          query_area: tile.label, query_municipality: geo.city,
          query_province: geo.id === 'como' ? 'CO' : null, source_area_enforced: true,
          comparison_role: 'candidate', region_filter: geo.regionFilter,
          payload: buildVillaImmobiliarePayload({ tile, condition, maxItems: immobiliareCandidatePerCondition, intent }),
        });
      }
      queries.push({
        actor: 'immobiliare-structured', actor_id: immobiliareActorId, source_channel: 'immobiliare', source_platform_name: 'immobiliare',
        query_name: 'villa-exit-comparable', query_area: tile.label, query_municipality: geo.city,
        query_province: geo.id === 'como' ? 'CO' : null, source_area_enforced: true,
        comparison_role: 'exit_comparable', region_filter: geo.regionFilter,
        payload: buildVillaImmobiliarePayload({ tile, condition: investmentIntent.comparableImmobiliareCondition, maxItems: comparablePerTile, intent }),
      });
    }
  }
  return { geo, investmentIntent, queries };
}
