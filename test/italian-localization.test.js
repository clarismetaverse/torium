import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  normalizeItalianFloor,
  translateAnalysisItemToItalian,
} from '../lib/italian-localization.js';
import { normalizeSourceListing } from '../lib/source-normalizers.js';

test('normalizes Spanish Idealista floor abbreviations into Italian labels', () => {
  assert.equal(normalizeItalianFloor('BJ'), 'Piano terra');
  assert.equal(normalizeItalianFloor('bajo'), 'Piano terra');
  assert.equal(normalizeItalianFloor('EN'), 'Ammezzato');
  assert.equal(normalizeItalianFloor('ático'), 'Attico');
  assert.equal(normalizeItalianFloor('S1'), '1° piano interrato');
  assert.equal(normalizeItalianFloor('3ª'), '3° piano');
});

test('source normalization persists the Italian floor label for future runs', () => {
  const normalized = normalizeSourceListing({ id: '1', title: 'Casa', floor: 'bajo' }, { source_channel: 'idealista' });
  assert.equal(normalized.floor, 'Piano terra');
  assert.equal(normalized.listing.floor, 'Piano terra');
});

test('translates deterministic and technical analysis signals for existing runs', () => {
  assert.equal(
    translateAnalysisItemToItalian('Technical validation of the final unit layout and exact saleable surface.'),
    'Validazione tecnica della distribuzione finale delle unità e della superficie vendibile effettiva.',
  );
  assert.equal(translateAnalysisItemToItalian('market_sentiment:positive'), 'Andamento di mercato: positivo');
  assert.equal(translateAnalysisItemToItalian('projected_units:3'), 'Unità finali stimate: 3');
  assert.equal(
    translateAnalysisItemToItalian('condition_renew_spread_signal'),
    'Immobile da ristrutturare: potenziale margine di valorizzazione.',
  );
});

test('AI valuation prompt requires Italian prose in every analysis section', async () => {
  const prompt = await fs.readFile(new URL('../prompts/triage-valuation-red-flags.md', import.meta.url), 'utf8');
  assert.match(prompt, /must contain clear Italian prose/);
  assert.match(prompt, /positive_signals/);
  assert.match(prompt, /human_due_diligence_questions/);
});
