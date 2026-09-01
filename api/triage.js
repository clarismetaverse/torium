import runsHandler from './_triage-runs.js';
import propertiesHandler from './_triage-properties.js';
import sourceListingsHandler from './_triage-source-listings.js';

export default async function handler(request, response) {
  if (request.query.resource === 'runs') return runsHandler(request, response);
  if (request.query.resource === 'properties') return propertiesHandler(request, response);
  if (request.query.resource === 'source-listings') return sourceListingsHandler(request, response);
  return response.status(404).json({ error: 'Triage resource not found' });
}
