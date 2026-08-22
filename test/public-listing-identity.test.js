import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicAddress,
  publicIdealistaUrl,
  publicSourceChannel,
  publicSourceUrl,
  safeIdealistaUrl,
  safeSourceUrl,
} from '../api/output.js';

test('public listing identity keeps the exact address and Idealista link', () => {
  const result = {
    listing: { address: 'Via Mac Mahon, 43' },
    source_row: { source_url: 'https://www.idealista.it/immobile/35833103/' },
  };
  assert.equal(publicAddress(result), 'Via Mac Mahon, 43');
  assert.equal(publicIdealistaUrl(result), 'https://www.idealista.it/immobile/35833103/');
});

test('legacy Idealista helper rejects non-Idealista and unsafe URLs', () => {
  assert.equal(safeIdealistaUrl('https://example.com/immobile/1'), null);
  assert.equal(safeIdealistaUrl('javascript:alert(1)'), null);
  assert.equal(safeIdealistaUrl('https://fake-idealista.it/immobile/1'), null);
  assert.equal(safeIdealistaUrl('https://idealista.it/immobile/1'), 'https://idealista.it/immobile/1');
});

test('public source identity supports validated Immobiliare links', () => {
  const result = {
    source_channel: 'immobiliare',
    source_row: {
      source_channel: 'immobiliare',
      raw_listing: { id: 130990790, geography: { street: 'Piazzale Lagosta, 4' } },
    },
  };
  assert.equal(publicSourceChannel(result), 'immobiliare');
  assert.equal(publicSourceUrl(result), 'https://www.immobiliare.it/annunci/130990790/');
  assert.equal(publicAddress(result), 'Piazzale Lagosta, 4');
  assert.equal(safeSourceUrl('https://www.immobiliare.it/annunci/130990790/'), 'https://www.immobiliare.it/annunci/130990790/');
  assert.equal(safeSourceUrl('https://fake-immobiliare.it/annunci/1/'), null);
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
});
