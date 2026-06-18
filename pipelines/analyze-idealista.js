import 'dotenv/config';
import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';

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
    maxItems: 5,
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
    maxItems: 5,
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
    maxItems: 5,
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
    maxItems: 5,
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
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function analyzeWithOpenAI(text) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, input: text }),
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.output_text || data;
}

async function main() {
  const searchName = process.argv[2] || 'residentialRenovationMilan';
  const listingIndex = Number(process.argv[3] || 0);
  const searchInput = searches[searchName];
  if (!searchInput) throw new Error(`Unknown search: ${searchName}`);

  const prompt = await fs.readFile('prompts/property-analysis.md', 'utf8');
  const listings = await runIdealistaScraper(searchInput);
  const listing = listings[listingIndex];
  if (!listing) throw new Error('No listing found at this index.');

  const analysisInput = `${prompt}\n\nPROPERTY_LISTING_JSON:\n${JSON.stringify(listing, null, 2)}`;
  const openaiAnalysis = await analyzeWithOpenAI(analysisInput);

  console.log(JSON.stringify({
    searchName,
    listingIndex,
    listing,
    analysis: openaiAnalysis,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
