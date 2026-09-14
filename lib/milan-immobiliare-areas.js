// How to make Immobiliare search one part of Milan at a time.
//
// Not by name. The actor takes an `area` parameter and its log even confirms
// it - "Using area name=Cimiano, Crescenzago, Adriano" - and then searches the
// whole municipality anyway: a probe on 14 September 2026 asked for that area
// and got eight listings spread across seven different macrozones. The
// parameter is accepted and inert, so partitioning by it would have produced
// thirty-three identical city-wide sweeps at thirty-three times the cost.
//
// By coordinates. The same actor takes a centre and a radius, documented as
// taking precedence over the named fields, and that one works: probed against
// Cimiano and the Duomo at a 2 km radius, every listing came back inside the
// radius asked for and in the macrozones around that centre.
//
// The centres below are the median latitude and longitude of the listings
// Immobiliare itself placed in each of its Milan macrozones, read out of
// `triage_source_listings`. They are where the portal says its own zones are,
// not a guess at where they should be.
//
// Why partition at all: a single city-wide sweep ordered by recency follows
// listing density, which follows price. On the run of 22 August 2026 that spent
// 33 slots on Città Studi at -20.9 per cent average modelled ROI and 15 on
// Moscova at -52.3, while Cimiano - the one area whose measured spread cleared
// its own break-even - got five.

export const MILAN_IMMOBILIARE_CENTRES = Object.freeze([
  { area: 'Abbiategrasso, Chiesa Rossa', latitude: 45.4189, longitude: 9.1944 },
  { area: 'Affori, Bovisa', latitude: 45.5157, longitude: 9.1645 },
  { area: 'Arco della Pace, Arena, Pagano', latitude: 45.4725, longitude: 9.1687 },
  { area: 'Bande Nere, Inganni', latitude: 45.4613, longitude: 9.1336 },
  { area: 'Bicocca, Niguarda', latitude: 45.5080, longitude: 9.2060 },
  { area: 'Bisceglie, Baggio, Olmi', latitude: 45.4683, longitude: 9.0933 },
  { area: 'Cenisio, Sarpi, Isola', latitude: 45.4889, longitude: 9.1799 },
  { area: 'Centrale, Repubblica', latitude: 45.4834, longitude: 9.2092 },
  { area: 'Centro', latitude: 45.4645, longitude: 9.1896 },
  { area: 'Cimiano, Crescenzago, Adriano', latitude: 45.5079, longitude: 9.2370 },
  { area: 'Città Studi, Susa', latitude: 45.4720, longitude: 9.2252 },
  { area: 'Corvetto, Rogoredo', latitude: 45.4358, longitude: 9.2179 },
  { area: 'Famagosta, Barona', latitude: 45.4407, longitude: 9.1474 },
  { area: 'Fiera, Sempione, City Life, Portello', latitude: 45.4808, longitude: 9.1532 },
  { area: 'Forlanini', latitude: 45.4589, longitude: 9.2487 },
  { area: 'Garibaldi, Moscova, Porta Nuova', latitude: 45.4766, longitude: 9.1885 },
  { area: 'Genova, Ticinese', latitude: 45.4579, longitude: 9.1728 },
  { area: 'Maggiolina, Istria', latitude: 45.4985, longitude: 9.2051 },
  { area: 'Napoli, Soderini', latitude: 45.4537, longitude: 9.1496 },
  { area: 'Navigli', latitude: 45.4503, longitude: 9.1812 },
  { area: 'Pasteur, Rovereto', latitude: 45.4909, longitude: 9.2170 },
  { area: 'Porta Romana, Cadore, Montenero', latitude: 45.4561, longitude: 9.2098 },
  { area: 'Porta Venezia, Indipendenza', latitude: 45.4691, longitude: 9.2116 },
  { area: 'Porta Vittoria, Lodi', latitude: 45.4472, longitude: 9.2212 },
  { area: 'Precotto, Turro', latitude: 45.5121, longitude: 9.2255 },
  { area: 'Quadronno, Palestro, Guastalla', latitude: 45.4608, longitude: 9.2029 },
  { area: 'Ripamonti, Vigentino', latitude: 45.4316, longitude: 9.2005 },
  { area: 'San Siro, Trenno', latitude: 45.4773, longitude: 9.1329 },
  { area: 'Solari, Washington', latitude: 45.4618, longitude: 9.1562 },
  { area: 'Udine, Lambrate', latitude: 45.4884, longitude: 9.2452 },
  { area: 'Uptown, Cascina Merlata, Viale Certosa', latitude: 45.4938, longitude: 9.1474 },
]);

// Milan is roughly 15 km across and these centres sit about 2 km apart, so the
// circles overlap. That is wanted: a gap between them would be a part of the
// city no query ever reaches, and a listing found twice is removed by the
// existing deduplication, which a listing never found is not.
export const MILAN_IMMOBILIARE_RADIUS_KM = 2;

export const MILAN_IMMOBILIARE_AREAS = Object.freeze(
  MILAN_IMMOBILIARE_CENTRES.map((centre) => centre.area));

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const BY_NORMALIZED = new Map(MILAN_IMMOBILIARE_CENTRES.map((centre) => [normalize(centre.area), centre]));

/**
 * The centre to search from for a given area label.
 *
 * Matching is deliberately narrow: the exact area name, or one of the
 * comma-separated parts of it ("Isola" inside "Cenisio, Sarpi, Isola"). A loose
 * match would quietly search the wrong half of the city, which is the failure
 * this module exists to prevent.
 */
export function findMilanImmobiliareCentre(value) {
  const wanted = normalize(value);
  if (!wanted) return null;
  const exact = BY_NORMALIZED.get(wanted);
  if (exact) return exact;

  for (const centre of MILAN_IMMOBILIARE_CENTRES) {
    if (centre.area.split(',').map((part) => normalize(part)).includes(wanted)) return centre;
  }
  return null;
}
