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
  assert.match(home, />Ricalcola valuation &amp; ROI<|>Ricalcola valuation & ROI</);
  assert.match(home, />Ricarica dati</);
  assert.match(home, /function refreshData\(/);
});
