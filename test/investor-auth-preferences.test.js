import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { normalizePreferences } from '../api/investor-preferences.js';

test('investor preferences accept only canonical essential filters', () => {
  const value = normalizePreferences({
    neighborhood_ids: ['navigli', 'centro', 'navigli', 'invented-zone'],
    min_price_eur: '300000',
    max_price_eur: '900000',
    min_size_mq: '100',
    max_size_mq: '',
    max_price_per_sqm_eur: '6500',
    min_door_score: '70',
    min_roi_base_pct: '12.55',
    portal_presence: 'shared',
    price_spread: true,
    frequency: 'daily',
  });

  assert.deepEqual(value.neighborhood_ids, ['navigli', 'centro']);
  assert.equal(value.min_price_eur, 300000);
  assert.equal(value.max_price_eur, 900000);
  assert.equal(value.max_size_mq, null);
  assert.equal(value.min_roi_base_pct, 12.55);
  assert.equal('portal_presence' in value, false);
  assert.equal('price_spread' in value, false);
  assert.equal('frequency' in value, false);
});

test('investor preferences reject inverted ranges', () => {
  assert.throws(
    () => normalizePreferences({ min_price_eur: 900000, max_price_eur: 300000 }),
    /Minimum price/,
  );
  assert.throws(
    () => normalizePreferences({ min_size_mq: 200, max_size_mq: 100 }),
    /Minimum size/,
  );
});

test('investor preference migration uses RLS ownership policies', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260901154307_investor_alert_preferences.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /to authenticated[\s\S]*auth\.uid\(\)/i);
  assert.match(sql, /for update[\s\S]*using[\s\S]*with check/i);
  assert.doesNotMatch(sql, /frequency|price_spread|portal_presence/i);
});

test('private product views load the shared authentication guard', async () => {
  for (const name of ['home.html', 'index.html', 'villas.html', 'renewals.html', 'account.html']) {
    const html = await readFile(new URL('../public/' + name, import.meta.url), 'utf8');
    assert.match(html, /src="\/auth-client\.js"/);
  }
  const login = await readFile(new URL('../public/login.html', import.meta.url), 'utf8');
  assert.doesNotMatch(login, /src="\/auth-client\.js"/);
  assert.match(login, /autocomplete="current-password"/);
});

test('login and account inline scripts are valid JavaScript', async () => {
  for (const name of ['login.html', 'account.html']) {
    const html = await readFile(new URL('../public/' + name, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    for (const source of scripts) assert.doesNotThrow(() => new Script(source));
  }
});
