import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const home = await fs.readFile(new URL('../public/home.html', import.meta.url), 'utf8');
const valuationMemory = await fs.readFile(new URL('../docs/TORIUM_VALUATION_STATE_AND_AVM_TARGET.md', import.meta.url), 'utf8');

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

test('home exposes detailed neighborhood labels, distribution and filtering', () => {
  assert.match(home, /id="neighborhoodFilter"/);
  assert.match(home, /id="neighborhoodCoverage"/);
  assert.match(home, /const neighborhood=r=>/);
  assert.match(home, /const macroArea=r=>/);
  assert.match(home, /const area=r=>neighborhood\(r\)\|\|macroArea\(r\)/);
  assert.match(home, /function drawNeighborhoodCoverage\(/);
  assert.match(home, /state\.neighborhood==='all'\|\|neighborhoodKey\(x\.r\)===state\.neighborhood/);
  assert.match(home, /chip area-primary/);
  assert.match(home, /chip area-secondary/);
});

test('home recomputes visible ROI statistics for the selected neighborhood', () => {
  assert.match(home, /const o=state\.output\|\|\{\},rs=filteredResults\(\),rank=ranked\(\)/);
  assert.match(home, /roiValues=rs\.filter\(r=>dataQuality\(r\)\.valid\)/);
  assert.match(home, /roiMedian=roiValues\.length/);
  assert.match(home, /roiMedian!==null&&roiMedian>=0/);
  assert.match(home, /roiAverage!==null&&roiAverage>=0/);
});

test('home exposes ROI base as the only ranking option', () => {
  const select = home.match(/<select id="criterion">([\s\S]*?)<\/select>/)?.[1] || '';
  assert.match(select, /value="roiBase"/);
  assert.doesNotMatch(select, /value="torium"|value="balanced"|value="profitBase"|value="roiLow"/);
  assert.match(home, /criterion:'roiBase'/);
  assert.match(home, /const rankingCriteria=\(\)=>\(\{roiBase:criteria\(\)\.roiBase\}\)/);
  assert.doesNotMatch(home, /\|\|\(doorScore\(b\.r\)-doorScore\(a\.r\)\)/);
});

test('home supports 5000-item runs without rendering every card at once', () => {
  assert.match(home, /profile:'milano_broad',limit:5000/);
  assert.match(home, /run_id:runId,limit:5000,mode:'deterministic'/);
  assert.match(home, /visibleLimit:100/);
  assert.match(home, /state\.visibleLimit\+=200/);
  assert.match(home, /id="loadMoreDeals"/);
  assert.match(home, /api\/output\?summary=1&file=/);
  assert.doesNotMatch(home, /slice\(0,60\)/);
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

test('home applies the data quality gate before every ranking criterion', () => {
  assert.match(home, /const dataQuality=r=>/);
  assert.match(home, /Number\(dataQuality\(b\.r\)\.valid\)-Number\(dataQuality\(a\.r\)\.valid\)/);
  assert.match(home, /signal-data-quality/);
  assert.match(home, /Dati da verificare/);
  assert.match(home, /Data needs review/);
  assert.match(home, /qualityReasons/);
});

test('home keeps change-of-use deals visible but ranks them after residential deals', () => {
  assert.match(home, /const changeOfUseRisk=r=>/);
  assert.match(home, /const lowPriorityRisk=r=>Number\(changeOfUseRisk\(r\)\|\|constructionRisk\(r\)\)/);
  assert.match(home, /lowPriorityRisk\(a\.r\)-lowPriorityRisk\(b\.r\)/);
  assert.match(home, /signal-change-use/);
  assert.match(home, /Cambio d’uso · priorità bassa/);
  assert.match(home, /Change of use · low priority/);
});

test('home gives under-construction listings low priority without excluding them', () => {
  assert.match(home, /const constructionRisk=r=>/);
  assert.match(home, /in\\s\+\(\?:fase\\s\+di\\s\+\)\?costruzione\|nuova\\s\+costruzione\|cantiere/);
  assert.match(home, /lowPriorityRisk\(a\.r\)-lowPriorityRisk\(b\.r\)/);
  assert.match(home, /In costruzione · priorità bassa/);
  assert.match(home, /Under construction · low priority/);
});

test('home shows transformation cost against all final units', () => {
  assert.match(home, /costPerFinalUnitEur/);
  assert.match(home, /costPerTrilocaleEur/);
  assert.match(home, /finalUnits/);
  assert.match(home, /unità finali/);
  assert.doesNotMatch(home, /costPerNewUnitEur/);
});

test('home discloses provisional methodology and the AVM target', () => {
  assert.match(home, /id="methodology"/);
  assert.match(home, /function drawMethodology\(/);
  assert.match(home, /Unit economics del frazionamento/);
  assert.match(home, /Stima provvisoria €\/mq/);
  assert.match(home, /Costi acquisto: 12% del prezzo/);
  assert.match(home, /monolocale\/bilocale €25\.000; trilocale €30\.000/);
  assert.match(home, /Prezzi richiesti, non compravendite concluse/);
  assert.match(home, /TORIUM AVM/);
  assert.match(home, /Methodology and assumptions/);
  assert.match(home, /Complete AVM/);
  assert.doesNotMatch(home, /San Gottardo uses a specific blended benchmark/);
  assert.doesNotMatch(home, /San Gottardo usa un benchmark specifico combinato/);
});

test('valuation memory records current formulas, caveats and future architecture', () => {
  assert.match(valuationMemory, /max_doors_unit_type_costs_v4_sales_cost_3pct/);
  assert.match(valuationMemory, /milan_city_exit_v3_provisional_2026_07/);
  assert.match(valuationMemory, /Monolocale \| EUR 25,000/);
  assert.match(valuationMemory, /Trilocale \| EUR 30,000/);
  assert.match(valuationMemory, /asking prices, not confirmed transaction prices/i);
  assert.match(valuationMemory, /Stage 4 - Complete AVM/);
  assert.match(valuationMemory, /backtest error against observed outcomes/i);
});

test('home inline script is valid JavaScript', () => {
  const script = home.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
