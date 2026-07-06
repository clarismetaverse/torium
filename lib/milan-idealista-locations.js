export const MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS = [
  {
    id: '0-EU-IT-MI-01-001-135-09-003',
    name: 'NoLo - Brianza - Pasteur',
    zoneId: '0-EU-IT-MI-01-001-135-09',
    zoneName: 'Greco - Turro',
    aliases: ['nolo', 'pasteur', 'brianza'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-08-002',
    name: 'Bovisa',
    zoneId: '0-EU-IT-MI-01-001-135-08',
    zoneName: 'Comasina - Bicocca',
    aliases: ['bovisa'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-08-008',
    name: 'Dergano',
    zoneId: '0-EU-IT-MI-01-001-135-08',
    zoneName: 'Comasina - Bicocca',
    aliases: ['dergano'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-05-005',
    name: 'Bocconi',
    zoneId: '0-EU-IT-MI-01-001-135-05',
    zoneName: 'Navigli - Bocconi',
    aliases: ['bocconi'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-05-002',
    name: 'Navigli - Porta Genova',
    zoneId: '0-EU-IT-MI-01-001-135-05',
    zoneName: 'Navigli - Bocconi',
    aliases: ['navigli', 'porta genova'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-03-008',
    name: 'Isola',
    zoneId: '0-EU-IT-MI-01-001-135-03',
    zoneName: 'Garibaldi - Porta Venezia',
    aliases: ['isola'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-10-002',
    name: 'Città Studi',
    zoneId: '0-EU-IT-MI-01-001-135-10',
    zoneName: 'Città Studi - Lambrate',
    aliases: ['citta studi', 'città studi'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-10-003',
    name: 'Lambrate',
    zoneId: '0-EU-IT-MI-01-001-135-10',
    zoneName: 'Città Studi - Lambrate',
    aliases: ['lambrate'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-12-002',
    name: 'Corvetto',
    zoneId: '0-EU-IT-MI-01-001-135-12',
    zoneName: 'Corvetto - Rogoredo',
    aliases: ['corvetto'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-15-002',
    name: 'Barona - San Paolo',
    zoneId: '0-EU-IT-MI-01-001-135-15',
    zoneName: 'Famagosta - Naviglio Grande',
    aliases: ['barona'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-16-004',
    name: 'Lorenteggio - Giambellino',
    zoneId: '0-EU-IT-MI-01-001-135-16',
    zoneName: 'Lorenteggio - Bande Nere',
    aliases: ['giambellino', 'lorenteggio'],
  },
  {
    id: '0-EU-IT-MI-01-001-135-05-004',
    name: 'Gottardo',
    zoneId: '0-EU-IT-MI-01-001-135-05',
    zoneName: 'Navigli - Bocconi',
    aliases: ['corso san gottardo', 'san gottardo', 'gottardo'],
  },
];

export function normalizeLocationToken(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getMilanIdealistaLocationsByIds(ids) {
  const requested = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const locations = MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS.filter((location) => requested.has(location.id));
  const missing = [...requested].filter((id) => !locations.some((location) => location.id === id));
  if (missing.length) throw new Error(`Unknown Milan Idealista location IDs: ${missing.join(', ')}`);
  return locations;
}

export function getMilanIdealistaLocationsByTokens(tokens) {
  const requested = tokens.map(normalizeLocationToken).filter(Boolean);
  const locations = [];
  for (const token of requested) {
    const match = MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS.find((location) => {
      const candidates = [location.name, ...location.aliases].map(normalizeLocationToken);
      return candidates.includes(token);
    });
    if (!match) throw new Error(`Unknown Milan Idealista location token: ${token}`);
    if (!locations.some((location) => location.id === match.id)) locations.push(match);
  }
  return locations;
}
