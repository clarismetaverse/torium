import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareRankingPool } from '../scripts/compare-ranking-pool.js';
import { runDoorEngine } from '../lib/door-engine.js';
import { resolveSearchStrategy } from '../lib/search-strategies.js';
import { calculateUnderwriting } from '../lib/financial-underwriting.js';
import { assessUnitEconomics, assessInvestment } from '../lib/investment-assessment.js';
import { buildAskingBenchmark, lookupAskingPrice } from '../lib/asking-price-benchmark.js';
import { allocateQueryBudget, executeQueryPlan } from '../lib/source-query-budget.js';
import { prepareInvestmentCandidates, runValuationFromSupabase } from '../lib/valuation-runner.js';
const profile = JSON.parse(readFileSync(new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url)));
const now = '2026-09-14T12:00:00.000Z';
const sample = (overrides = {}) => ({ source: 'idealista', source_listing_id: '1', city: 'Milano', neighborhood: 'Isola', rooms: 2,
  size_mq: 46, price_eur: 276000, condition: 'renovated', renovation_verified: true, observed_at: '2026-09-13T12:00:00Z', ...overrides });
const observations = (count = 8) => Array.from({ length: count }, (_, i) => sample({ source_listing_id: String(i), price_eur: 276000 + i*460 }));

test('historical full engine scores retain the baseline labels and reasons', () => {
  const listing = { price: 450000, size: 150, bathrooms: 2, rooms: 4, hasPlan: true, status: 'renew' };
  for (const [id, score] of [['neutral_fractionability',76], ['legacy_low_price_m2',100]]) {
    const s = resolveSearchStrategy(id), d = runDoorEngine(listing, profile, { scoringMode: s.scoringMode, includeEconomicSignals: s.includeEconomicDoorSignals });
    assert.equal(d.doorScore, score);
    assert.equal(d.scoringMode, s.scoringMode);
    assert.ok(d.doorScoreReasons.includes('bathroom_bonus_2_bathrooms'));
    assert.equal('surfaceSplitPossible' in d, false);
  }
  const v2 = runDoorEngine(listing, profile, { scoringMode: 'physical_evidence_v2', includeEconomicSignals: false });
  assert.equal(v2.technicalFeasibility, 'not_verified');
  assert.equal(v2.legalFeasibility, 'not_verified');
  assert.equal(v2.surfaceSplitPossible, true);
});

test('exact break-even and mixed trilocale costs use the shared underwriting', () => {
  for (const units of [Array.from({length:3}, () => ({unit_type:'bilocale',estimated_size_mq:46})),
    [{unit_type:'bilocale',estimated_size_mq:45},{unit_type:'trilocale',estimated_size_mq:60}]]) {
    const u = calculateUnderwriting({ purchasePriceEur: 450000, finalUnits: units.length, finalUnitPlan: units });
    const area = units.reduce((s,r) => s+r.estimated_size_mq,0);
    const exit = u.costs.projectCostEur / .97 / area;
    const reference = {median_eur_mq:exit,p25_eur_mq:exit,p75_eur_mq:exit};
    const a = assessUnitEconomics({purchasePriceEur:450000,units,references:units.map(() => reference)});
    assert.equal(Math.abs(a.underwriting.scenarios.base.profitLossEur),0);
    assert.equal(a.verdict,'covers_modelled_costs');
    assert.ok(Math.abs(a.break_even_eur_mq-exit)<1e-8);
    assert.equal(a.underwriting.costs.transformationCostEur,units.length===2?55000:75000);
  }
});

test('identical price/area with distinct source IDs remains distinct even in the same neighborhood', () => {
  const b = buildAskingBenchmark([sample(),sample({source_listing_id:'2'}),sample({source_listing_id:'3',neighborhood:'Paolo Sarpi'})], { minimumSample:2, now });
  assert.equal(b.observations.length,3);
  assert.equal(b.segments.find(s=>s.neighborhood==='isola').count,2);
  assert.equal(b.segments.find(s=>s.neighborhood==='paolo sarpi').count,1);
});
test('distinct rooms are not guessed from surface, conditions stay separate and contradictions are excluded', () => {
  const b = buildAskingBenchmark([sample({condition:'good'}),sample({source_listing_id:'2',rooms:3}),
    sample({source_listing_id:'3',condition:'to_renovate',queried_condition:'good'}),sample({source_listing_id:'4',rooms:null}),
    sample({source_listing_id:'5',renovation_verified:false})],{minimumSample:2,now});
  assert.equal(b.observations.length,2);
  assert.equal(b.segments.find(s=>s.unit_type==='bilocale').condition,'good');
  assert.equal(b.rejected.condition_conflict,1);
  assert.equal(b.rejected.unverified_condition,1);
});
test('configurable sample size governs segments and lookup, including stricter thresholds', () => {
  for (const [minimumSample, usable] of [[2,true],[8,true],[100,false]]) {
    const b = buildAskingBenchmark(observations(),{minimumSample,now});
    assert.equal(b.segments[0].usable,usable);
    assert.equal(Boolean(lookupAskingPrice(b,{city:'Milano',neighborhood:'Isola',unitType:'bilocale',sizeMq:46,now})),usable);
  }
});
test('history dedup is latest-per-source and confirmed cross-portal offers keep both prices', () => {
  const b = buildAskingBenchmark([sample({price_eur:200000}),sample({observed_at:now}),
    sample({source:'immobiliare',price_eur:280000,canonical_property_id:'abc',identity_confirmed:true}),
    sample({observed_at:now,canonical_property_id:'abc',identity_confirmed:true})],{minimumSample:2,now});
  assert.equal(b.observations.length,2);
  assert.equal(b.observations[0].price_eur,276000);
  assert.equal(b.observations[1].price_eur,280000);
  assert.equal(b.segments[0].count,1);
});
test('stale and ambiguous observations fail closed and input ordering cannot change medians', () => {
  const rows = [...observations(), sample({source_listing_id:'stale',observed_at:'2020-01-01'}),sample({source_listing_id:'conflict',price_eur:1}),sample({source_listing_id:'conflict',price_eur:2})];
  const a = buildAskingBenchmark(rows,{now}), b = buildAskingBenchmark([...rows].reverse(),{now});
  assert.deepEqual(a.segments,b.segments);
  assert.equal(a.rejected.stale_or_invalid_observation,1);
  assert.equal(a.rejected.same_time_conflict,1);
  assert.equal(lookupAskingPrice(a,{city:'Milano',neighborhood:'Isola',unitType:'bilocale',sizeMq:46,now:'2027-01-01'}),null);
});
test('every planned final unit needs the correct room-type and size benchmark', () => {
  const b = buildAskingBenchmark(observations(),{now});
  const listing={city:'Milano',neighborhood:'Isola',price:450000,size:150};
  const door = runDoorEngine(listing,profile,{includeEconomicSignals:false,scoringMode:'physical_evidence_v2'});
  assert.equal(assessInvestment({listing,doorEngine:door,benchmark:b,now}).status,'assessed');
  const mismatch={...door,plannedUnitMix:[{unit_type:'trilocale',estimated_size_mq:60},{unit_type:'bilocale',estimated_size_mq:46}]};
  assert.equal(assessInvestment({listing,doorEngine:mismatch,benchmark:b,now}).status,'unassessable');
});
test('ranking uses the whole fixed pool and gates nonfractionable candidates before the limit', () => {
  const b = buildAskingBenchmark(observations(),{now});
  const rows = [900000,450000,60000].map((price_eur,i)=>({source_channel:'idealista',source_listing_id:String(i),price_eur,size_mq:i===2?40:150,city:'Milano',neighborhood:'Isola',source_key:String(i)}));
  const ranked = prepareInvestmentCandidates(rows,profile,b,now);
  assert.equal(ranked[0].price_eur,450000);
  assert.equal(ranked.at(-1).investment_assessment.status,'not_fractionable');
  assert.equal(ranked[0].investment_assessment.ranking_score,ranked[0].investment_assessment.underwriting.scenarios.base.roiPct);
});
test('600 and 50 budgets visit all 32 queries, including the broad fallback', () => {
  const queries=Array.from({length:32},(_,i)=>({source_channel:'immobiliare',actor:'immobiliare-structured',query_area:i===31?'Milano':String(i),payload:{maxItems:20}}));
  for (const budget of [50,600,1000]) {
    const planned=allocateQueryBudget(queries,budget,budget);
    assert.equal(planned.reduce((s,q)=>s+q.allocated_items,0),budget);
    assert.ok(planned.every(q=>q.allocated_items>0));
    assert.equal(planned.at(-1).query_area,'Milano');
  }
  assert.throws(()=>allocateQueryBudget(queries,20,20),/at least/);
});
test('executor bounds concurrency, waits for completion and preserves plan order', async () => {
  let active=0, max=0;
  const result=await executeQueryPlan([0,1,2,3],async q=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5-q));active--;return[q];},{concurrency:2,deadlineMs:1000});
  assert.equal(max,2);assert.equal(active,0);assert.deepEqual(result.map(r=>r.rawResults[0]),[0,1,2,3]);
});
test('deadline aborts in-flight work and records queries that could not start', async () => {
  const result=await executeQueryPlan([0,1,2,3],(_q,signal)=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),{concurrency:2,deadlineMs:10});
  assert.deepEqual(result.map(r=>r.status),['deadline','deadline','not_started_deadline','not_started_deadline']);
});

test('valuation persistence preserves the assessed ROI, source links and unknown exits', async () => {
  const rows = [900000,450000,300000].map((price_eur,i)=>({id:i+1,source_channel:'idealista',source_listing_id:String(i),
    price_eur,size_mq:150,city:'Milano',neighborhood:i===2?'Unknown':'Isola',source_url:`https://www.idealista.it/immobile/${i}/`,
    title:`Item ${i}`,has_plan:true,thumbnail_url:'https://example.org/photo.jpg'}));
  const writes=[];
  const result=await runValuationFromSupabase({runId:'fixture',limit:3,now,benchmark:buildAskingBenchmark(observations(),{now}),
    env:{SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},log:()=>{},
    fetchImpl:async(url,opts)=>{
      if(opts.method) { writes.push({url,method:opts.method,body:JSON.parse(opts.body||'null')}); return new Response(''); }
      const path=new URL(url).pathname;
      return Response.json(path.endsWith('/triage_runs')?[{id:'fixture-id',run_id:'fixture',search_strategy:'deal_quality_v2',scoring_mode:'physical_evidence_v2'}]
        :path.endsWith('/triage_source_listings')?rows:[]);
    }});
  assert.equal(result.valued_count,2);
  const saved=writes.find(w=>w.method==='POST').body;
  assert.equal(saved[0].source_listing_id,'1');
  for(const row of saved.slice(0,2)) {
    assert.equal(row.ranking_score,row.roi_base_pct);
    assert.deepEqual(row.raw_result.underwriting,row.raw_result.investment_assessment.underwriting);
    assert.equal(row.source_url,`https://www.idealista.it/immobile/${row.source_listing_id}/`);
    assert.equal(row.has_plan,true);
  }
  assert.equal(saved[2].roi_base_pct,null);
  assert.equal(saved[2].total_sale_value_base_eur,null);
  assert.equal(saved[2].raw_result.investment_assessment.status,'unassessable');
});

test('malformed price references fail closed instead of producing an invalid ROI', () => {
  const b=buildAskingBenchmark(observations(),{now});
  const query={city:'Milano',neighborhood:'Isola',unitType:'bilocale',sizeMq:46,now};
  assert.equal(lookupAskingPrice({...b,segments:null},query),null);
  b.segments[0].p25_eur_mq=999999;
  assert.equal(lookupAskingPrice(b,query),null);
});

test('real pipeline orchestration with mocked HTTP enforces timeout, abort and isolated runs', () => {
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/check-ranking-pipeline.mjs',import.meta.url))],{encoding:'utf8',timeout:10000});
  assert.match(output,/PIPELINE_MOCK_PASS/);
});

test('same-pool report is reproducible and distinguishes historical evidence from economic ROI', () => {
  const rows=[450000,900000].map((price_eur,i)=>({source_channel:'idealista',source_listing_id:String(i),price_eur,size_mq:150,city:'Milano',neighborhood:'Isola'}));
  const b=buildAskingBenchmark(observations(),{now});
  const a=compareRankingPool(rows,profile,b,now), c=compareRankingPool([...rows].reverse(),profile,b,now);
  assert.equal(a.pool_sha256,c.pool_sha256);
  assert.deepEqual(a.deal_quality_v2,c.deal_quality_v2);
  assert.equal(a.deal_quality_v2[0].source_key,'idealista:0');
  assert.equal(a.historical.neutral_fractionability.length,2);
});
