import 'dotenv/config';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ENDPOINT = 'https://api.apify.com/v2/acts/shahidirfan~immobiliare-it-scraper/run-sync-get-dataset-items';

export async function runImmobiliareUrlScraper(input) {
  if (!APIFY_TOKEN) {
    throw new Error('Missing APIFY_TOKEN. Create a .env file from .env.example and add your Apify token.');
  }

  if (!input?.startUrl) {
    throw new Error('Missing startUrl for Immobiliare URL scraper.');
  }

  const url = `${ACTOR_ENDPOINT}?${new URLSearchParams({ token: APIFY_TOKEN })}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrl: input.startUrl,
      results_wanted: input.results_wanted ?? 20,
      max_pages: input.max_pages ?? 1,
      proxyConfiguration: input.proxyConfiguration ?? { useApifyProxy: false },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apify Immobiliare URL request failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return response.json();
}

async function main() {
  const startUrl = process.argv[2] || process.env.TORIUM_IMMOBILIARE_START_URL;
  const resultsWanted = Number(process.env.TORIUM_RESULTS_WANTED || 20);
  const maxPages = Number(process.env.TORIUM_MAX_PAGES || 1);

  if (!startUrl) {
    console.error('Missing startUrl. Pass it as first argument or set TORIUM_IMMOBILIARE_START_URL.');
    process.exit(1);
  }

  const results = await runImmobiliareUrlScraper({
    startUrl,
    results_wanted: resultsWanted,
    max_pages: maxPages,
  });

  console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1]?.endsWith('scrapers/immobiliare-url/client.js')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
