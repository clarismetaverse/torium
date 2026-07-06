function normalizeAlias(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const MILAN_IDEALISTA_NEIGHBORHOODS = [
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-01',
    idealista_zone_id: '01',
    idealista_zone_name: 'Centro',
    idealista_neighborhood_name: 'Centro Storico',
    aliases: ['centro', 'centro-storico', 'historic-center'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-21',
    idealista_zone_id: '21',
    idealista_zone_name: 'Navigli - Darsena',
    idealista_neighborhood_name: 'Navigli - Darsena',
    aliases: ['navigli', 'darsena', 'navigli-darsena'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-22',
    idealista_zone_id: '22',
    idealista_zone_name: 'Porta Genova - Ticinese',
    idealista_neighborhood_name: 'Porta Genova - Ticinese',
    aliases: ['porta-genova', 'ticinese', 'porta-genova-ticinese', 'corso-san-gottardo', 'san-gottardo'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-23',
    idealista_zone_id: '23',
    idealista_zone_name: 'Barona',
    idealista_neighborhood_name: 'Barona',
    aliases: ['barona'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-24',
    idealista_zone_id: '24',
    idealista_zone_name: 'Famagosta',
    idealista_neighborhood_name: 'Famagosta',
    aliases: ['famagosta'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-31',
    idealista_zone_id: '31',
    idealista_zone_name: 'Corvetto - Rogoredo',
    idealista_neighborhood_name: 'Corvetto - Rogoredo',
    aliases: ['corvetto', 'rogoredo', 'corvetto-rogoredo'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-38',
    idealista_zone_id: '38',
    idealista_zone_name: 'NoLo',
    idealista_neighborhood_name: 'NoLo',
    aliases: ['nolo', 'north-of-loreto'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-42',
    idealista_zone_id: '42',
    idealista_zone_name: 'Bovisa',
    idealista_neighborhood_name: 'Bovisa',
    aliases: ['bovisa'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-43',
    idealista_zone_id: '43',
    idealista_zone_name: 'Dergano',
    idealista_neighborhood_name: 'Dergano',
    aliases: ['dergano'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-54',
    idealista_zone_id: '54',
    idealista_zone_name: 'Lambrate',
    idealista_neighborhood_name: 'Lambrate',
    aliases: ['lambrate'],
  },
  {
    idealista_location_id: '0-EU-IT-25-1-001-015146-01-62',
    idealista_zone_id: '62',
    idealista_zone_name: 'Giambellino',
    idealista_neighborhood_name: 'Giambellino',
    aliases: ['giambellino'],
  },
];

const PRIORITY_ALIASES = new Set(['porta-genova-ticinese', 'barona', 'corvetto-rogoredo', 'nolo', 'bovisa', 'dergano', 'lambrate', 'giambellino']);

export const MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS = MILAN_IDEALISTA_NEIGHBORHOODS.filter((location) =>
  [location.idealista_neighborhood_name, location.idealista_zone_name, ...(location.aliases || [])]
    .some((alias) => PRIORITY_ALIASES.has(normalizeAlias(alias)))
);

const LOCATION_BY_ID = new Map(MILAN_IDEALISTA_NEIGHBORHOODS.map((location) => [location.idealista_location_id, location]));
const LOCATION_BY_ALIAS = new Map();
for (const location of MILAN_IDEALISTA_NEIGHBORHOODS) {
  for (const alias of [location.idealista_neighborhood_name, location.idealista_zone_name, ...(location.aliases || [])]) {
    LOCATION_BY_ALIAS.set(normalizeAlias(alias), location);
  }
}

export function findMilanIdealistaLocation(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return LOCATION_BY_ID.get(raw) || LOCATION_BY_ALIAS.get(normalizeAlias(raw)) || null;
}

export function parseMilanIdealistaSelections({ locationIds, neighborhoods } = {}) {
  const tokens = String(locationIds || neighborhoods || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const selected = tokens.length
    ? tokens.map((token) => {
        const location = findMilanIdealistaLocation(token);
        if (!location) throw new Error(`Unknown Milan Idealista neighborhood/location: ${token}`);
        return location;
      })
    : MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS;

  return Array.from(new Map(selected.map((location) => [location.idealista_location_id, location])).values());
}
