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
