function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const zone = (id, name, aliases = []) => ({ id, name, aliases: [name, ...aliases] });

// Canonical Milan search/analytics taxonomy. Names follow Immobiliare.it zones;
// aliases absorb labels emitted by Idealista and common neighborhood wording.
export const MILAN_CANONICAL_ZONES = [
  zone('centro', 'Centro', ['centro storico', 'duomo', 'san babila', 'carrobbio', 'cinque vie', 'brera', 'montenapoleone', 'quadrilatero della moda', 'missori', 'largo augusto', 'borgogna', 'cadorna', 'castello', 'lanza']),
  zone('garibaldi-moscova-porta-nuova', 'Garibaldi - Moscova - Porta Nuova', ['garibaldi', 'moscova', 'porta nuova', 'turati', 'corso como']),
  zone('quadronno-palestro-guastalla', 'Quadronno - Palestro - Guastalla', ['quadronno', 'palestro', 'guastalla', 'mercalli']),
  zone('arco-pace-arena-pagano', 'Arco della Pace - Arena - Pagano', ['arco della pace', 'arena', 'pagano', 'magenta', 'ariosto', 'de angeli', 'vercelli', 'wagner', 'vincenzo monti']),
  zone('genova-ticinese', 'Genova - Ticinese', ['corso genova', 'porta genova', 'ticinese']),
  zone('porta-venezia-indipendenza', 'Porta Venezia - Indipendenza', ['porta venezia', 'indipendenza', 'regina giovanna', 'buenos aires', 'piave', 'tricolore']),
  zone('solari-washington', 'Solari - Washington', ['solari', 'washington', 'san vittore', 'dezza', 'frua']),
  zone('fiera-sempione-citylife-portello', 'Fiera - Sempione - CityLife - Portello', ['fiera', 'sempione', 'city life', 'citylife', 'portello', 'tre torri', 'amendola', 'buonarroti', 'monte rosa', 'lotto']),
  zone('porta-romana-cadore-montenero', 'Porta Romana - Cadore - Montenero', ['porta romana', 'cadore', 'montenero', 'cinque giornate']),
  zone('navigli', 'Navigli', ['naviglio', 'gottardo', 'san gottardo', 'bocconi']),
  zone('centrale-repubblica', 'Centrale - Repubblica', ['centrale', 'repubblica', 'mauro macchi', 'settembrini', 'melchiorre gioia']),
  zone('cenisio-sarpi-isola', 'Cenisio - Sarpi - Isola', ['cenisio', 'sarpi', 'isola', 'farini', 'zara']),
  zone('citta-studi-susa', 'Città Studi - Susa', ['citta studi', 'susa', 'argonne', 'corsica', 'morgagni', 'bacone', 'romagna', 'teodosio', 'porpora']),
  zone('napoli-soderini', 'Napoli - Soderini', ['napoli', 'soderini', 'lorenteggio giambellino', 'giambellino']),
  zone('porta-vittoria-lodi', 'Porta Vittoria - Lodi', ['porta vittoria', 'lodi', 'calvairate', 'sulmona', 'martini', 'insubria']),
  zone('maggiolina-istria', 'Maggiolina - Istria', ['maggiolina', 'istria', 'ca granda', 'pratocentenaro', 'prato centenaro', 'greco', 'segnano']),
  zone('san-siro-trenno', 'San Siro - Trenno', ['san siro', 'trenno', 'ippodromo', 'qt8', 'monte stella', 'morgantini', 'segesta']),
  zone('bande-nere-inganni', 'Bande Nere - Inganni', ['bande nere', 'inganni', 'gambara', 'primaticcio']),
  zone('ripamonti-vigentino', 'Ripamonti - Vigentino', ['ripamonti', 'vigentino', 'fondazione prada', 'scalo romana', 'pezzotti', 'meda', 'tibaldi', 'val di sole', 'fatima']),
  zone('pasteur-rovereto', 'Pasteur - Rovereto', ['pasteur', 'rovereto', 'nolo', 'brianza', 'casoretto', 'parco trotter']),
  zone('udine-lambrate', 'Udine - Lambrate', ['udine', 'lambrate', 'ortica', 'rubattino', 'feltre', 'parco lambro']),
  zone('famagosta-barona', 'Famagosta - Barona', ['famagosta', 'barona', 'san paolo', 'romolo', 'naviglio grande', 'san cristoforo', 'tre castelli', 'faenza']),
  zone('precotto-turro', 'Precotto - Turro', ['precotto', 'turro', 'gorla', 'viale monza', 'villa san giovanni']),
  zone('corvetto-rogoredo', 'Corvetto - Rogoredo', ['corvetto', 'rogoredo', 'porto di mare']),
  zone('abbiategrasso-chiesa-rossa', 'Abbiategrasso - Chiesa Rossa', ['abbiategrasso', 'chiesa rossa', 'gratosoglio']),
  zone('bicocca-niguarda', 'Bicocca - Niguarda', ['bicocca', 'niguarda', 'bignami', 'ponale']),
  zone('certosa-cascina-merlata', 'Viale Certosa - Cascina Merlata', ['certosa', 'cascina merlata', 'accursio', 'ghisolfa', 'musocco', 'roserio', 'quarto oggiaro', 'cascina dei pomi', 'prealpi', 'testori']),
  zone('ponte-lambro-santa-giulia', 'Ponte Lambro - Santa Giulia', ['ponte lambro', 'santa giulia']),
  zone('forlanini', 'Forlanini', ['forlanini', 'mecenate']),
  zone('cimiano-crescenzago-adriano', 'Cimiano - Crescenzago - Adriano', ['cimiano', 'crescenzago', 'adriano', 'ponte nuovo']),
  zone('affori-bovisa', 'Affori - Bovisa', ['affori', 'bovisa', 'dergano', 'maciachini', 'comasina', 'bruzzano']),
  zone('bisceglie-baggio-olmi', 'Bisceglie - Baggio - Olmi', ['bisceglie', 'baggio', 'quartiere olmi', 'olmi', 'quarto cagnino', 'san carlo']),
];

const aliasEntries = MILAN_CANONICAL_ZONES
  .flatMap((item) => item.aliases.map((alias) => ({ zone: item, alias: normalize(alias) })))
  .filter((item) => item.alias)
  .sort((a, b) => b.alias.length - a.alias.length);

export function resolveMilanCanonicalZone(...values) {
  const normalizedValues = values.flat().map(normalize).filter(Boolean);
  for (const value of normalizedValues) {
    const exact = aliasEntries.find((entry) => entry.alias === value);
    if (exact) return exact.zone;
  }
  for (const value of normalizedValues) {
    const contained = aliasEntries.find((entry) => value.includes(entry.alias));
    if (contained) return contained.zone;
  }
  return null;
}

export function canonicalMilanAreaLabel(input = {}) {
  return resolveMilanCanonicalZone(
    input.neighborhood,
    input.district,
    input.area,
    input.query_area,
    input.title,
    input.address,
  );
}
