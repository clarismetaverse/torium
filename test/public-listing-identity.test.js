import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, publicIdealistaUrl, safeIdealistaUrl } from '../api/output.js';

test('public listing identity keeps the exact address and Idealista link', () => {
  const result = {
    listing: { address: 'Via Mac Mahon, 43' },
    source_row: { source_url: 'https://www.idealista.it/immobile/35833103/' },
  };
  assert.equal(publicAddress(result), 'Via Mac Mahon, 43');
  assert.equal(publicIdealistaUrl(result), 'https://www.idealista.it/immobile/35833103/');
});

test('public listing link rejects non-Idealista and unsafe URLs', () => {
  assert.equal(safeIdealistaUrl('https://example.com/immobile/1'), null);
  assert.equal(safeIdealistaUrl('javascript:alert(1)'), null);
  assert.equal(safeIdealistaUrl('https://fake-idealista.it/immobile/1'), null);
  assert.equal(safeIdealistaUrl('https://idealista.it/immobile/1'), 'https://idealista.it/immobile/1');
});
