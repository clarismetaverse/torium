import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const page = await fs.readFile(new URL('../public/villas.html', import.meta.url), 'utf8');
const home = await fs.readFile(new URL('../public/home.html', import.meta.url), 'utf8');

test('villas use a separate frontend with area, intent and feature filters', () => {
  assert.match(page, /TORIUM · Ville/);
  assert.match(page, /Acquisto \+ ristrutturazione/);
  assert.match(page, /Turismo \/ hold/);
  assert.match(page, /Con giardino/);
  assert.match(page, /Con piscina/);
  assert.match(page, /Sotto benchmark dinamico/);
  assert.match(page, /\/api\/villa-runs/);
});

test('fractioning home links to the separate villa experience', () => {
  assert.match(home, /href="\/villas"/);
});
