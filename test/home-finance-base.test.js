import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const home = await fs.readFile(new URL('../public/home.html', import.meta.url), 'utf8');
const script = home.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const card = home.match(/^function financeCard\(r\).*$/m)?.[0];
const summary = home.match(/^function valuationSummary\(r\).*$/m)?.[0];

test('home inline JavaScript remains valid', () => {
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

for (const lang of ['it', 'en']) {
  test(`home finance card shows only base metrics (${lang})`, () => {
    const context = vm.createContext({
      state: { lang }, t: key => key, h: String, eur: String, fmt: String, pct: String,
      valuationSummary: () => '', originLabel: () => '',
      finance: () => ({ p: 100, purchaseCosts: 12, transformation: 75, projectCost: 187,
        saleBase: 300, sellingBase: 9, totalBase: 196, profitBase: 104, roi: 53,
        rate: .12, sellingRate: .03, finalUnits: 3, costPerUnit: 25, costPerTrilocale: 30,
        saleLow: 9001, saleHigh: 9002, sellingLow: 9003, sellingHigh: 9004,
        profitLow: 9005, profitHigh: 9006, roiLow: 9007, roiHigh: 9008 }),
    });
    const html = vm.runInContext(`${card}; financeCard({})`, context);
    assert.equal((html.match(/class="finance-metric/g) || []).length, 9);
    for (const value of [100, 12, 75, 187, 300, 9, 196, 104, 53]) {
      assert.ok(html.includes(`<b>${value}</b>`));
    }
    assert.doesNotMatch(html, /900[1-8]|Exit low|Exit high|P\/L low|P\/L high/);
  });
}

test('home valuation explanation no longer lists low and high multipliers', () => {
  assert.doesNotMatch(summary, /s\.low|s\.high/);
  assert.match(summary, /s\.base/);
});
