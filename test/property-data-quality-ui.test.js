import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const detail = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('property detail explains failed data quality checks in both languages', () => {
  assert.match(detail, /function renderDataQuality\(/);
  assert.match(detail, /function drawDataQuality\(/);
  assert.match(detail, /Data Quality Gate: verifica richiesta/);
  assert.match(detail, /Data Quality Gate: review required/);
  assert.match(detail, /signal-data-quality/);
});

test('detail ordering keeps failed quality records after valid records', () => {
  assert.match(detail, /Number\(dataQuality\(b\.r\)\.valid\)-Number\(dataQuality\(a\.r\)\.valid\)/);
});

test('detail ordering gives change-of-use deals low priority without excluding them', () => {
  assert.match(detail, /const changeOfUseRisk=r=>/);
  assert.match(detail, /const lowPriorityRisk=r=>Number\(changeOfUseRisk\(r\)\|\|constructionRisk\(r\)\)/);
  assert.match(detail, /lowPriorityRisk\(a\.r\)-lowPriorityRisk\(b\.r\)/);
  assert.match(detail, /signal-change-use/);
  assert.match(detail, /Cambio d’uso · priorità bassa/);
  assert.match(detail, /Change of use · low priority/);
});

test('detail ordering gives under-construction listings low priority', () => {
  assert.match(detail, /const constructionRisk=r=>/);
  assert.match(detail, /lowPriorityRisk\(a\.r\)-lowPriorityRisk\(b\.r\)/);
  assert.match(detail, /In costruzione · priorità bassa/);
  assert.match(detail, /Under construction · low priority/);
});

test('detail starts the selected run and run-list requests together and reuses output cache', () => {
  assert.match(detail, /const listPromise=fetch\('\/api\/outputs'\)/);
  assert.match(detail, /const outputPromise=requested\?loadOutput\(requested\):null/);
  assert.doesNotMatch(detail, /\/api\/output\?file='\+encodeURIComponent\(id\)\+'(&|\\?)t=/);
});

test('financial scenarios are collapsed accordions with exit value in the summary', () => {
  assert.match(detail, /<details class="scenario">/);
  assert.match(detail, /<summary>/);
  assert.match(detail, /class="scenario-exit"/);
  assert.match(detail, /class="scenario-body"/);
  assert.doesNotMatch(detail, /<details class="scenario" open>/);
});

test('financial cost boxes explain their assumptions in Italian and English', () => {
  assert.match(detail, /Prezzo di acquisto utilizzato nella simulazione/);
  assert.match(detail, /Stima aggregata provvisoria applicata al prezzo/);
  assert.match(detail, /Costo stimato su tutte le unità finali previste/);
  assert.match(detail, /Acquisto \+ costi di acquisto \+ trasformazione/);
  assert.match(detail, /Purchase price used in the simulation/);
  assert.match(detail, /Estimated cost across all projected final units/);
  assert.match(detail, /<small>\$\{h\(subtitle\)\}<\/small>/);
});

test('property detail shows the 25k cost against final units', () => {
  assert.match(detail, /costPerFinalUnitEur/);
  assert.match(detail, /costPerTrilocaleEur/);
  assert.match(detail, /f\.finalUnits/);
  assert.doesNotMatch(detail, /costPerNewUnitEur/);
});

test('property detail inline script is valid JavaScript', () => {
  const script = detail.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('property detail preserves neighborhood filtering and shows macro-area context', () => {
  assert.match(detail, /neighborhood:q\.get\('neighborhood'\)\|\|null/);
  assert.match(detail, /const rawNeighborhood=r=>/);
  assert.match(detail, /const area=r=>h\(rawNeighborhood\(r\)\|\|rawMacroArea\(r\)/);
  assert.match(detail, /function drawAreaContext\(/);
  assert.match(detail, /function drawNeighborhoodBackLink\(/);
  assert.match(detail, /results\(o\)\.filter\(item=>rawNeighborhood\(item\)/);
});

test('property detail always uses ROI base as its only ranking', () => {
  assert.match(detail, /sort:'roiBase'/);
  assert.match(detail, /const sortModes=\(\)=>state\.lang==='it'\?\{roiBase:'ROI base'\}/);
  assert.match(detail, /state\.sortMode='roiBase'/);
  assert.doesNotMatch(detail, /\|\|\(physicalScore\(b\.r\)-physicalScore\(a\.r\)\)/);
});
