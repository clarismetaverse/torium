import { MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS } from '../lib/milan-idealista-locations.js';

for (const location of MILAN_IDEALISTA_PRIORITY_NEIGHBORHOODS) {
  console.log(`${location.name}: ${location.id}`);
}
