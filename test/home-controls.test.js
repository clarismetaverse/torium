import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const home = await fs.readFile(new URL('../public/home.html', import.meta.url), 'utf8');

test('home run controls do not require a PIN or unsupported browser prompts', () => {
  assert.doesNotMatch(home, /id="runPin"/);
  assert.doesNotMatch(home, /function requireRunPin\(/);
  assert.doesNotMatch(home, /Authorization['"]?\s*:/);
  assert.doesNotMatch(home, /\bprompt\s*\(/);
});

test('reload and valuation actions have distinct labels and behaviors', () => {
  assert.match(home, />Avvia run seria · Milano</);
  assert.match(home, /profile:'milano_broad'/);
  assert.match(home, />Ricalcola valuation &amp; ROI<|>Ricalcola valuation & ROI</);
  assert.match(home, />Ricarica dati</);
  assert.match(home, /function refreshData\(/);
  assert.match(home, /<section class="toolbar actions-hidden">/);
  assert.match(home, /<button id="newNeutralRun" hidden>/);
  assert.match(home, /<button id="valueRun" hidden>/);
  assert.match(home, /<button id="refresh" class="secondary" hidden>/);
});

test('home supports persistent Italian and English UI copy', () => {
  assert.match(home, /id="languageSwitch"/);
  assert.match(home, /localStorage\.getItem\('torium-language'\)/);
  assert.match(home, /dashboard scouting e frazionabilità/);
  assert.match(home, /scouting & fractionability dashboard/);
});

test('deal previews expose only evidence-backed fractioning and floor-plan tags', () => {
  assert.match(home, /markedForFractioning=r=>/);
  assert.match(home, /frazion\\w\*/);
  assert.match(home, /suddividere\|dividere/);
  assert.match(home, /hasFloorPlan=r=>/);
  assert.match(home, /signal-split/);
  assert.match(home, /signal-plan/);
  assert.match(home, /needsRenovation=r=>/);
  assert.match(home, /signal-renovation/);
  assert.match(home, /Da ristrutturare/);
  assert.match(home, /Needs renovation/);
  assert.match(home, /Planimetria presente/);
});

test('home inline script is valid JavaScript', () => {
  const script = home.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
