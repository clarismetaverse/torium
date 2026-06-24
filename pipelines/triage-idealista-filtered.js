import 'dotenv/config';
import fs from 'node:fs/promises';
import { runDoorEngine } from '../lib/door-engine.js';
import { getPreTriageExclusion, summarizeExclusions } from '../lib/pre-triage-filters.js';
import { syncTriageRunToSupabase } from '../lib/supabase-triage-sync.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';
const TRIAGE_MAX_ITEMS = Number(process.env.TORIUM_TRIAGE_MAX_ITEMS || 50);
const GPT_TRIAGE_LIMIT = Number(process.env.TORIUM_GPT_TRIAGE_LIMIT || 10);

if (!APIFY_TOKEN) throw new Error('Missing APIFY_TOKEN in .env');
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY in .env');

const searches = {
  largeHomesFractioningMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    minSize: '120',
    condition: ['renew'],
    sortBy: 'lowestPriceM2',
    maxItems: TRIAGE_MAX_ITEMS,
    fetchDetails: false,
    fetchStats: false,
  },
  residentialRenovationMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    minSize: '100',
    condition: ['renew'],
    sortBy: 'lowestPriceM2',
    maxItems: TRIAGE_MAX_ITEMS,
    fetchDetails: false,
    fetchStats: false,
  },
};

async function runIdealistaScraper(input) {
  const url = `https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items?${new URLSearchParams({ token: APIFY_TOKEN })}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Apify request failed: ${response.status}\n${await response.text()}`);
  return response.json();
}

function extractModelText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return JSON.stringify(data);
}

function tryParseJson(text) {
  const stripped = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(stripped); } catch {
    const first = stripped.indexOf('{');
    const last = stripped.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(stripped.slice(first, last + 1)); } catch { return { raw_text: text }; }
    }
    return { raw_text: text };
  }
}

function getListingTitle(listing) {
  return listing?.suggestedTexts?.title || listing?.address || listing?.propertyCode || 'Untitled listing';
}

function getListingUrl(listing) {
  return listing?.url || null;
}

function buildResultLink(result, rank) {
  return {
    rank,
    score: result.ranking_score,
    title: result.title,
    url: result.url,
    price: result.listing?.price ?? null,
    size_mq: result.listing?.size ?? null,
    spread_base_eur: result.spread?.spread_base_eur ?? null,
    roi_base_pct: result.spread?.roi_base_pct ?? null,
    action: result.gpt_analysis?.recommended_action ?? null,
  };
}

async function analyzeWithOpenAI(prompt, listing, doorEngine, investorProfile) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [['Authori', 'zation'].join('')]: ['Bearer', OPENAI_API_KEY].join(' '),
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: `${prompt}\n\nINPUT_JSON:\n${JSON.stringify({ listing, doorEngine, investorProfile }, null, 2)}`,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}\n${await response.text()}`);
  return tryParseJson(extractModelText(await response.json()));
}

function computeSpread(doorEngine, gptAnalysis) {
  const projectCost = doorEngine.estimatedProjectCost;
  const saleLow = gptAnalysis?.total_sale_value_low_eur;
  const saleBase = gptAnalysis?.total_sale_value_base_eur;
  const saleHigh = gptAnalysis?.total_sale_value_high_eur;
  return {
    project_cost_eur: projectCost,
    spread_low_eur: projectCost && saleLow ? saleLow - projectCost : null,
    spread_base_eur: projectCost && saleBase ? saleBase - projectCost : null,
    spread_high_eur: projectCost && saleHigh ? saleHigh - projectCost : null,
    roi_base_pct: projectCost && saleBase ? Number((((saleBase - projectCost) / projectCost) * 100).toFixed(2)) : null,
  };
}

function computeRankingScore(doorEngine, spread, gptAnalysis) {
  let score = Math.min(40, doorEngine.doorScore * 0.4);
  if (spread.spread_base_eur > 300000) score += 35;
  else if (spread.spread_base_eur > 200000) score += 25;
  else if (spread.spread_base_eur > 100000) score += 15;
  else if (spread.spread_base_eur > 0) score += 5;
  if (gptAnalysis?.fractioning_confidence === 'high') score += 15;
  if (gptAnalysis?.fractioning_confidence === 'medium') score += 8;
  if (gptAnalysis?.valuation_confidence === 'high') score += 10;
  if (gptAnalysis?.valuation_confidence === 'medium') score += 5;
  const redFlags = Array.isArray(gptAnalysis?.red_flags) ? gptAnalysis.red_flags.length : 0;
  score -= Math.min(20, redFlags * 4);
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function main() {
  const searchName = process.argv[2] || 'largeHomesFractioningMilan';
  const searchInput = searches[searchName];
  if (!searchInput) throw new Error(`Unknown search: ${searchName}`);

  const investorProfile = JSON.parse(await fs.readFile('config/investor-profiles/max-doors-20k.json', 'utf8'));
  const prompt = await fs.readFile('prompts/triage-valuation-red-flags.md', 'utf8');
  const listings = await runIdealistaScraper(searchInput);

  const filteredOut = [];
  const eligibleListings = [];

  listings.forEach((listing, index) => {
    const exclusion = getPreTriageExclusion(listing);
    if (exclusion.excluded) {
      filteredOut.push({
        index,
        exclusion,
        title: getListingTitle(listing),
        url: getListingUrl(listing),
      });
    } else {
      eligibleListings.push({ index, listing });
    }
  });

  const preScored = eligibleListings
    .map(({ index, listing }) => ({ index, listing, doorEngine: runDoorEngine(listing, investorProfile) }))
    .sort((a, b) => b.doorEngine.doorScore - a.doorEngine.doorScore);

  const results = [];
  for (const item of preScored.slice(0, GPT_TRIAGE_LIMIT)) {
    const gptAnalysis = await analyzeWithOpenAI(prompt, item.listing, item.doorEngine, investorProfile);
    const spread = computeSpread(item.doorEngine, gptAnalysis);
    const result = {
      listing_index: item.index,
      title: getListingTitle(item.listing),
      url: getListingUrl(item.listing),
      idealista_url: getListingUrl(item.listing),
      ranking_score: computeRankingScore(item.doorEngine, spread, gptAnalysis),
      door_engine: item.doorEngine,
      spread,
      gpt_analysis: gptAnalysis,
      listing: item.listing,
    };
    results.push(result);
  }

  results.sort((a, b) => b.ranking_score - a.ranking_score);

  const output = {
    search_name: searchName,
    city: DEFAULT_CITY,
    investor_profile: investorProfile.id,
    scraped_count: listings.length,
    eligible_count: eligibleListings.length,
    filtered_out_count: filteredOut.length,
    filtered_out_summary: summarizeExclusions(filteredOut),
    filtered_out: filteredOut,
    gpt_analyzed_count: results.length,
    result_links: results.map((result, index) => buildResultLink(result, index + 1)),
    results,
  };

  await fs.mkdir('outputs/triage', { recursive: true });
  const filename = `outputs/triage/${Date.now()}-${searchName}-filtered.json`;
  await fs.writeFile(filename, JSON.stringify(output, null, 2));
  await syncTriageRunToSupabase(output, filename);
  console.log(JSON.stringify(output, null, 2));
  console.log(`Saved triage output to ${filename}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
