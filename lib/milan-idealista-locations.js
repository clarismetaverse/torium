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
    idealista_location_id: '0-EU-IT-MI-01-001-135-09-003',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-09',
    idealista_zone_name: 'Greco - Turro',
    idealista_neighborhood_name: 'NoLo - Brianza - Pasteur',
    aliases: ['nolo', 'brianza', 'pasteur', 'nolo-brianza-pasteur', 'north-of-loreto'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-08-002',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-08',
    idealista_zone_name: 'Farini - Bovisa',
    idealista_neighborhood_name: 'Bovisa',
    aliases: ['bovisa'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-08-008',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-08',
    idealista_zone_name: 'Farini - Bovisa',
    idealista_neighborhood_name: 'Dergano',
    aliases: ['dergano'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-05-005',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-05',
    idealista_zone_name: 'Navigli - Bocconi',
    idealista_neighborhood_name: 'Bocconi',
    aliases: ['bocconi'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-05-002',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-05',
    idealista_zone_name: 'Navigli - Bocconi',
    idealista_neighborhood_name: 'Navigli - Porta Genova',
    aliases: ['navigli', 'porta-genova', 'navigli-porta-genova', 'porta-genova-ticinese'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-03-008',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-03',
    idealista_zone_name: 'Garibaldi - Porta Nuova',
    idealista_neighborhood_name: 'Isola',
    aliases: ['isola'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-10-002',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-10',
    idealista_zone_name: 'Città Studi - Lambrate',
    idealista_neighborhood_name: 'Città Studi',
    aliases: ['citta-studi', 'città-studi'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-10-003',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-10',
    idealista_zone_name: 'Città Studi - Lambrate',
    idealista_neighborhood_name: 'Lambrate',
    aliases: ['lambrate'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-12-002',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-12',
    idealista_zone_name: 'Corvetto - Rogoredo',
    idealista_neighborhood_name: 'Corvetto',
    aliases: ['corvetto'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-15-002',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-15',
    idealista_zone_name: 'Famagosta - Barona',
    idealista_neighborhood_name: 'Barona - San Paolo',
    aliases: ['barona', 'san-paolo', 'barona-san-paolo'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-16-004',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-16',
    idealista_zone_name: 'Lorenteggio - Bande Nere',
    idealista_neighborhood_name: 'Lorenteggio - Giambellino',
    aliases: ['lorenteggio', 'giambellino', 'lorenteggio-giambellino'],
  },
  {
    idealista_location_id: '0-EU-IT-MI-01-001-135-05-004',
    idealista_zone_id: '0-EU-IT-MI-01-001-135-05',
    idealista_zone_name: 'Navigli - Bocconi',
    idealista_neighborhood_name: 'Gottardo',
    aliases: ['gottardo', 'corso-san-gottardo', 'san-gottardo'],
  },
];

const PRIORITY_ALIASES = new Set([
  'porta-genova-ticinese',
  'barona',
  'corvetto-rogoredo',
  'nolo',
  'bovisa',
  'dergano',
  'lambrate',
  'giambellino',
]);

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
