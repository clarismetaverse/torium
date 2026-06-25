const DEFAULT_BASE_URL = 'https://www.immobiliare.it/vendita-case';

const AREA_SLUGS = {
  'corso san gottardo': 'corso-san-gottardo',
  'san gottardo': 'corso-san-gottardo',
  barona: 'barona',
  corvetto: 'corvetto',
  nolo: 'nolo',
  bovisa: 'bovisa',
  dergano: 'dergano',
  lambrate: 'lambrate',
  giambellino: 'giambellino',
  certosa: 'certosa',
  precotto: 'precotto',
  'bande nere': 'bande-nere',
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function areaToSlug(area) {
  const normalized = String(area || '').toLowerCase().trim();
  return AREA_SLUGS[normalized] || slugify(area);
}

function setBooleanParam(params, key, enabled, value = 'on') {
  if (enabled) params.set(key, value);
}

export function buildImmobiliareSearchUrl(options = {}) {
  const citySlug = slugify(options.city || 'milano');
  const areaSlug = areaToSlug(options.area || '');
  const requiresLift = options.requireLift === true;
  const suffix = requiresLift ? '/con-ascensore/' : '/';
  const path = areaSlug
    ? `${DEFAULT_BASE_URL}/${citySlug}/${areaSlug}${suffix}`
    : `${DEFAULT_BASE_URL}/${citySlug}${suffix}`;

  const url = new URL(path);
  const params = url.searchParams;

  params.set('superficieMinima', String(options.minSize ?? 80));
  params.set('localiMinimo', String(options.minRooms ?? 1));
  params.set('localiMassimo', String(options.maxRooms ?? 12));

  if (options.conditionCode !== null && options.conditionCode !== undefined && options.conditionCode !== 'off') {
    params.set('stato', String(options.conditionCode));
  }

  if (options.bathrooms !== null && options.bathrooms !== undefined && options.bathrooms !== 'off') {
    params.set('bagni', String(options.bathrooms));
  }

  if (options.ownershipCode !== null && options.ownershipCode !== undefined && options.ownershipCode !== 'off') {
    params.set('tipoProprieta', String(options.ownershipCode));
  }

  if (options.heatingCode !== null && options.heatingCode !== undefined && options.heatingCode !== 'off') {
    params.set('riscaldamenti[0]', String(options.heatingCode));
  }

  if (options.garageCode !== null && options.garageCode !== undefined && options.garageCode !== 'off') {
    params.set('boxAuto[0]', String(options.garageCode));
  }

  setBooleanParam(params, 'arredato', options.furnished === true);
  setBooleanParam(params, 'cantina', options.cellar === true);
  setBooleanParam(params, 'balcone', options.balcony === true);
  setBooleanParam(params, 'terrazzo', options.terrace === true);
  setBooleanParam(params, 'noAste', options.excludeAuctions === true, 'on');

  if (options.keywords) params.set('criterioTestuale', String(options.keywords));
  if (options.minPrice) params.set('prezzoMinimo', String(options.minPrice));
  if (options.maxPrice) params.set('prezzoMassimo', String(options.maxPrice));

  return url.toString();
}

export function buildImmobiliareStartUrls(areas, options = {}) {
  return areas.map((area) => ({
    area,
    startUrl: buildImmobiliareSearchUrl({ ...options, area }),
  }));
}
