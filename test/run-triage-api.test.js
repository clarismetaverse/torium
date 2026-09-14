import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { resolveRequestedLimit, seriousProfileOptions } from '../api/run-triage.js';
import { buildIdealistaQueries, buildImmobiliareQueries, perQueryQuota, resolveMassiveRunConfig } from '../pipelines/triage-multisource-massive.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('run endpoint rejects non-POST requests', async () => {
  const response = responseRecorder();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 405);
});

test('run endpoint requires same-origin', async () => {
  const crossOrigin = responseRecorder();
  await handler({ method: 'POST', headers: { origin: 'https://attacker.example', host: 'torium.example' }, body: {} }, crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);
});

test('run endpoint rejects anonymous same-origin callers', async () => {
  const response = responseRecorder();
  await handler({
    method: 'POST',
    headers: { origin: 'https://torium.example', host: 'torium.example', 'x-forwarded-proto': 'https' },
    body: {},
  }, response);
  assert.equal(response.statusCode, 401);
});

test('serious run limit defaults to 600 and supports up to 5000', () => {
  assert.equal(resolveRequestedLimit(undefined), 600);
  assert.equal(resolveRequestedLimit(4000), 4000);
  assert.equal(resolveRequestedLimit(5000), 5000);
  assert.equal(resolveRequestedLimit(6000), 5000);
  assert.equal(resolveRequestedLimit('invalid'), 600);
});

test('multisource configuration can enforce an independent quota per portal', () => {
  const config = resolveMassiveRunConfig({
    runMode: 'serious',
    requestedAreas: ['Milano'],
    maxItemsPerQuery: 1000,
    maxItemsPerSource: 1000,
    maxTotalRawListings: 2000,
  }, {});
  assert.equal(config.maxItemsPerQuery, 1000);
  assert.equal(config.maxItemsPerSource, 1000);
  assert.equal(config.maxTotalRawListings, 2000);
});

test('Idealista scout targets the requested Milan location ID', () => {
  const [query] = buildIdealistaQueries(['corso-san-gottardo']);
  assert.equal(query.source_area_enforced, true);
  assert.equal(query.payload.location, '0-EU-IT-MI-01-001-135-05-004');
  assert.equal(query.query_area, 'corso-san-gottardo');
  assert.equal(query.payload.maxItems, 20);
});

test('the pipeline honours an explicit area list and quota', () => {
  const config = resolveMassiveRunConfig({
    runMode: 'serious',
    requestedAreas: ['Milano'],
    maxItemsPerQuery: 600,
    maxTotalRawListings: 600,
    topPrescoreLimit: 600,
    minSize: 100,
    idealistaCondition: ['renew'],
  }, {});

  assert.deepEqual(config.requestedAreas, ['Milano']);
  assert.equal(config.maxItemsPerQuery, 600);
  assert.equal(config.maxTotalRawListings, 600);
  assert.equal(config.topPrescoreLimit, 600);
  assert.equal(config.minSize, 100);
  assert.deepEqual(config.idealistaCondition, ['renew']);
});


test('a serious run asks for every mapped neighbourhood, not only for Milano', () => {
  // Asking for "Milano" resolves to no location id, so every query became the
  // same city-wide sweep and the budget followed listing density: 33 listings
  // in Città Studi at -20.9 per cent average modelled ROI against five in
  // Cimiano, the one area whose measured spread cleared its own break-even.
  const options = seriousProfileOptions(600, 1);
  const queries = buildIdealistaQueries(options.requestedAreas);
  const scoped = queries.filter((query) => query.source_area_enforced);

  assert.ok(scoped.length >= 12, 'every mapped neighbourhood is targeted by location id');
  assert.equal(queries.length - scoped.length, 1,
    'one broad query remains, so the unmapped rest of Milan is still seen');
  assert.ok(options.requestedAreas.includes('Milano'));
});

test('each source divides its own budget by its own number of areas', () => {
  // The two portals are partitioned differently - Idealista into the
  // neighbourhoods whose ids are known, Immobiliare into its macrozones - so a
  // single per-query quota would let one of them fetch several times the other.
  const options = seriousProfileOptions(600, 1);
  const config = resolveMassiveRunConfig(options);

  const idealistaAreas = options.requestedAreasBySource.idealista;
  const immobiliareAreas = options.requestedAreasBySource.immobiliare;
  const idealistaQuota = perQueryQuota(idealistaAreas, config);
  const immobiliareQuota = perQueryQuota(immobiliareAreas, config);

  assert.ok(idealistaQuota < 600 && immobiliareQuota < 600, 'neither gets the whole budget per query');
  assert.ok(idealistaQuota > immobiliareQuota,
    'the source split into fewer areas asks for more in each of them');
  for (const [areas, quota] of [[idealistaAreas, idealistaQuota], [immobiliareAreas, immobiliareQuota]]) {
    assert.ok(areas.length * quota >= 600, 'the areas together still cover the requested total');
  }
  assert.equal(options.maxTotalRawListings, 600, 'the overall cap is unchanged');
});

test('an immobiliare query is aimed by coordinates, because the area name is inert', () => {
  // Probed on 14 September 2026: the actor logs "Using area name=Cimiano,
  // Crescenzago, Adriano" and then returns listings from seven macrozones
  // across the city. The same request aimed by centre and radius returned
  // twenty listings, none of them outside the radius.
  const options = seriousProfileOptions(600, 1);
  const config = resolveMassiveRunConfig(options);
  const queries = buildImmobiliareQueries(options.requestedAreasBySource.immobiliare, undefined,
    perQueryQuota(options.requestedAreasBySource.immobiliare, config));

  const aimed = queries.find((query) => query.query_area === 'Cimiano, Crescenzago, Adriano');
  assert.ok(aimed.payload.latitude && aimed.payload.longitude, 'the query carries a centre');
  assert.equal(aimed.payload.distanceKm, 2);
  assert.equal(aimed.payload.area, undefined, 'the inert name is not sent at all');
  assert.equal(aimed.source_area_enforced, true,
    'the actor enforced the geography, so the text check must not throw the result away');

  const broad = queries.find((query) => query.query_area === 'Milano');
  assert.equal(broad.payload.latitude, undefined, 'the city-wide query keeps no centre');
  assert.equal(broad.source_area_enforced, false);
});

test('a small run still asks for enough per area to compare anything', () => {
  const options = seriousProfileOptions(50, 1);
  assert.ok(options.maxItemsPerQuery >= 20,
    'four listings per neighbourhood would measure nothing');
});
