import 'dotenv/config';
import { MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS } from '../lib/milan-idealista-locations.js';

const selected = String(process.env.TORIUM_IDEALISTA_LOCATION_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const locations = selected.length
  ? MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS.filter((location) => selected.includes(location.id))
  : MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS;

for (const location of locations) {
  console.log(`${location.name}: ${location.id}`);
}
