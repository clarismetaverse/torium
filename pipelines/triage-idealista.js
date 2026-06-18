import 'dotenv/config';
import fs from 'node:fs/promises';
import { runDoorEngine } from '../lib/door-engine.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';
const TRIAGE_MAX_ITEMS = Number(process.env.TORIUM_TRIAGE_MAX_ITEMS || 20);
const GPT_TRIAGE_LIMIT = Number(process.env.TORIUM_GPT_TRIAGE_LIMIT || 5);

if (!APIFY_TOKEN) throw new Error('Missing APIFY_TOKEN in .env');
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY in .env');

const searches = {
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
  groundFloorPremisesMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'premises',
    location: DEFAULT_CITY,
    minSize: '60',
    floor: ['groundFloor'],
    sortBy: 'highestPriceReduction',
    maxItems: TRIAGE_MAX_ITEMS,
    fetchDetails: false,
    fetchStats: false,
  },
  largeHomesFractioningMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    minSize: '120',
    sortBy: 'lowestPriceM2',
    maxItems: TRIAGE_MAX_ITEMS,
    fetchDetails: false,
    fetchStats: false,
  },
  buildingsMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'buildings',
    location: DEFAULT_CITY,
    minSize: '160',
    sortBy: 'lowestPriceM2',
    maxItems: TRIAGE_MAX_ITEMS,
    fetchDetails: false,
    fetchStats: false,
  },
};

async function runIdealistaScraper(input) {
  const response = await fetch(`https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Apify request failed: ${response.status}\n${await response.text()}`);
  }

  return response.json();
}

function tryParseJson(text) {
  if (typeof text !== 'string') return text;

  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      } catch {
        return { raw_text: text };
      }
    }
    return { raw_text: text };
  }
}

async function analyzeWithOpenAI(prompt, listing, doorEngine, investorProfile) {
  const input = `${prompt}\n\nINPUT_JSON:\n${JSON.stringify({ listing, doorEngine, investorProfile }, null, 2)}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}\n${await response.text()}`);
  }

  const data = await response.json();
  return tryParseJson(data.output_text || JSON.stringify(data));
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
  let score = 0;

  score += Math.min(40, doorEngine.doorScore * 0.4);

  if (spread.spread_base_eur) {
    if (spread.spread_base_eur > 300000) score += 35;
    else if (spread.spread_base_eur > 200000) score += 25;
    else if (spread.spread_base_eur > 100000) score += 15;
    else if (spread.spread_base_eur > 0) score += 5;
  }

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

  console.log(`Running Idealista triage search: ${searchName}`);
  const listings = await runIdealistaScraper(searchInput);

  const preScored = listings
    .map((listing, index) => ({
      index,
      listing,
      doorEngine: runDoorEngine(listing, investorProfile),
    }))
    .sort((a, b) => b.doorEngine.doorScore - a.doorEngine.doorScore);

  const selected = preScored.slice(0, GPT_TRIAGE_LIMIT);
  const results = [];

  for (const item of selected) {
    console.log(`Analyzing listing ${item.index} with GPT...`);
    const gptAnalysis = await analyzeWithOpenAI(prompt, item.listing, item.doorEngine, investorProfile);
    const spread = computeSpread(item.doorEngine, gptAnalysis);
    const rankingScore = computeRankingScore(item.doorEngine, spread, gptAnalysis);

    results.push({
      listing_index: item.index,
      ranking_score: rankingScore,
      door_engine: item.doorEngine,
      spread,
      gpt_analysis: gptAnalysis,
      listing: item.listing,
    });
  }

  results.sort((a, b) => b.ranking_score - a.ranking_score);

  const output = {
    search_name: searchName,
    city: DEFAULT_CITY,
    investor_profile: investorProfile.id,
    scraped_count: listings.length,
    gpt_analyzed_count: results.length,
    results,
  };

  await fs.mkdir('outputs/triage', { recursive: true });
  const filename = `outputs/triage/${Date.now()}-${searchName}.json`;
  await fs.writeFile(filename, JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output, null, 2));
  console.log(`Saved triage output to ${filename}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
