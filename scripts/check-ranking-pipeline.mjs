// Isolated mocked transport: never contacts Apify or Supabase.
import assert from 'node:assert/strict';
process.env.APIFY_TOKEN = 'fixture-only';
process.env.TORIUM_APIFY_POLL_INTERVAL_SECONDS = '.001';
process.env.TORIUM_DRY_RUN = 'false';
delete process.env.TORIUM_IDEALISTA_RUN_ID;
delete process.env.TORIUM_IDEALISTA_DATASET_ID;
const { runMassiveTriage } = await import('../pipelines/triage-multisource-massive.js');
let ids=0, stalled=false;
const calls=[];
globalThis.fetch=async (url,opts={})=>{
  const u=new URL(url); calls.push({path:u.pathname,method:opts.method,timeout:u.searchParams.get('timeout'),payload:opts.body&&JSON.parse(opts.body)});
  assert.equal(u.hostname,'api.apify.com');
  if(u.pathname.endsWith('/abort')) return Response.json({data:{status:'ABORTED'}});
  if(u.pathname.includes('/acts/')) return Response.json({data:{id:`actor${++ids}`}});
  if(u.pathname.includes('/actor-runs/')) return Response.json({data:{status:stalled?'RUNNING':'SUCCEEDED',defaultDatasetId:'fixture'}});
  if(u.pathname.includes('/datasets/')) return Response.json([]);
  throw Error('Unexpected endpoint');
};
const options={sources:'idealista',requestedAreas:['Milano'],maxItemsPerQuery:2,maxItemsPerSource:2,maxTotalRawListings:2,
  queryBudgetMode:'balanced_v2',queryDeadlineMs:1000,persist:false,searchStrategy:'neutral_fractionability'};
const output=await runMassiveTriage(options);
assert.equal(output.collection_status,'complete');
assert.equal(output.query_payloads.length,1);
assert.equal(calls.find(c=>c.payload).payload.maxItems,2);
assert.ok(Number(calls.find(c=>c.payload).timeout)>0);
stalled=true;
const pending=runMassiveTriage({...options,queryDeadlineMs:30});
await assert.rejects(runMassiveTriage(options),/already active/);
await assert.rejects(pending,/All source queries failed/);
assert.equal(calls.filter(c=>c.path.endsWith('/abort')).length,1);
stalled=false;
assert.equal((await runMassiveTriage(options)).collection_status,'complete');
console.log('PIPELINE_MOCK_PASS');
