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
  const path = areaSlug
    ? `${DEFAULT_BASE_URL}/${citySlug}/${areaSlug}/con-ascensore/`
    : `${DEFAULT_BASE_URL}/${citySlug}/con-ascensore/`;

  const url = new URL(path);
  const params = url.searchParams;

  params.set('superficieMinima', String(options.minSize ?? 80));
  params.set('localiMinimo', String(options.minRooms ?? 1));
  params.set('localiMassimo', String(options.maxRooms ?? 12));
  params.set('stato', String(options.conditionCode ?? 5));
  params.set('bagni', String(options.bathrooms ?? 1));
  params.set('tipoProprieta', String(options.ownershipCode ?? 1));

  if (options.heatingCode !== null && options.heatingCode !== undefined) {
    params.set('riscaldamenti[0]', String(options.heatingCode));
  }

  if (options.garageCode !== null && options.garageCode !== undefined) {
    params.set('boxAuto[0]', String(options.garageCode));
  }

  setBooleanParam(params, 'arredato', options.furnished !== false);
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
