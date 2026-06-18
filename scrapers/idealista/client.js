import 'dotenv/config';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ENDPOINT = 'https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items';

const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';

if (!APIFY_TOKEN) {
  throw new Error('Missing APIFY_TOKEN. Create a .env file from .env.example and add your Apify token.');
}

async function runIdealistaScraper(input) {
  const url = `${ACTOR_ENDPOINT}?token=${APIFY_TOKEN}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apify request failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return response.json();
}

const searches = {
  residentialRenovationMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    minSize: '100',
    condition: ['renew'],
    sortBy: 'lowestPriceM2',
    maxItems: 50,
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
    maxItems: 50,
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
    maxItems: 50,
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
    maxItems: 30,
    fetchDetails: false,
    fetchStats: false,
  },
};

async function main() {
  const searchName = process.argv[2] || 'residentialRenovationMilan';
  const input = searches[searchName];

  if (!input) {
    console.error(`Unknown search: ${searchName}`);
    console.error(`Available searches: ${Object.keys(searches).join(', ')}`);
    process.exit(1);
  }

  const results = await runIdealistaScraper(input);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
