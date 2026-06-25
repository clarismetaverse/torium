import 'dotenv/config';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ENDPOINT = 'https://api.apify.com/v2/acts/igolaizola~immobiliare-it-scraper/run-sync-get-dataset-items';

function withoutEmptyValues(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    })
  );
}

export async function runImmobiliareScraper(input) {
  if (!APIFY_TOKEN) {
    throw new Error('Missing APIFY_TOKEN. Create a .env file from .env.example and add your Apify token.');
  }

  const url = `${ACTOR_ENDPOINT}?${new URLSearchParams({ token: APIFY_TOKEN })}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withoutEmptyValues(input)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apify Immobiliare request failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return response.json();
}

export const immobiliareSearches = {
  milanoFractioningRenovation: {
    maxItems: Number(process.env.TORIUM_IMMOBILIARE_MAX_ITEMS || 100),
    province: 'MI',
    municipality: process.env.TORIUM_CITY || 'Milano',
    operation: 'buy',
    sortType: 'lessExpensiveM2',
    minSize: Number(process.env.TORIUM_MIN_SIZE || 120),
    propertyType: 'apartment',
    propertyCondition: 'toBeRenovated',
    excludeAuctions: true,
  },
  milanoFractioningDiscounted: {
    maxItems: Number(process.env.TORIUM_IMMOBILIARE_MAX_ITEMS || 100),
    province: 'MI',
    municipality: process.env.TORIUM_CITY || 'Milano',
    operation: 'buy',
    sortType: 'discounted',
    minSize: Number(process.env.TORIUM_MIN_SIZE || 120),
    propertyType: 'apartment',
    excludeAuctions: true,
  },
};

async function main() {
  const searchName = process.argv[2] || 'milanoFractioningRenovation';
  const area = process.argv[3] || process.env.TORIUM_AREA || '';
  const input = immobiliareSearches[searchName];

  if (!input) {
    console.error(`Unknown Immobiliare search: ${searchName}`);
    console.error(`Available searches: ${Object.keys(immobiliareSearches).join(', ')}`);
    process.exit(1);
  }

  const results = await runImmobiliareScraper({ ...input, area });
  console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1]?.endsWith('scrapers/immobiliare/client.js')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
