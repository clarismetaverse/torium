import 'dotenv/config';

const ACTOR_ENDPOINT = 'https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items';

const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';

export async function runIdealistaScraper(input) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error('Missing APIFY_TOKEN. Create a .env file from .env.example and add your Apify token.');
  }
  const url = `${ACTOR_ENDPOINT}?token=${token}`;

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

export const searches = {
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

  // --- exit market ---------------------------------------------------------
  //
  // Everything above collects what TORIUM buys: large apartments to divide.
  // These collect what it sells: small units, split by condition, so the exit
  // price can be measured per zone instead of borrowed from a citywide average
  // that mixes a 40 sqm renovated flat with a 200 sqm one to gut.

  exitSmallRenovatedMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    maxSize: '60',
    condition: ['good', 'newDevelopment'],
    propertyStatus: ['free'],
    sortBy: 'mostRecent',
    maxItems: 300,
    fetchDetails: false,
    fetchStats: false,
  },

  exitSmallToRenovateMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    maxSize: '60',
    condition: ['renew'],
    propertyStatus: ['free'],
    sortBy: 'mostRecent',
    maxItems: 300,
    fetchDetails: false,
    fetchStats: false,
  },

  exitMidRenovatedMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    minSize: '60',
    maxSize: '80',
    condition: ['good', 'newDevelopment'],
    propertyStatus: ['free'],
    sortBy: 'mostRecent',
    maxItems: 300,
    fetchDetails: false,
    fetchStats: false,
  },

  // The denominator of the size premium: large units in the same condition we
  // sell in. Without it the premium would compare a renovated bilocale against
  // an unrenovated large flat and count the renovation twice.
  exitLargeRenovatedMilan: {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: DEFAULT_CITY,
    minSize: '120',
    condition: ['good', 'newDevelopment'],
    propertyStatus: ['free'],
    sortBy: 'mostRecent',
    maxItems: 300,
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

// Importing this module must not start a scrape: other scripts reuse the
// searches and the runner, and a stray actor call costs real credits.
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
