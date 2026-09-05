import sessionHandler from './_auth-session.js';
import preferencesHandler from './_investor-preferences.js';
import passwordHandler from './_auth-password.js';

export default async function handler(request, response) {
  if (request.query.resource === 'session') return sessionHandler(request, response);
  if (request.query.resource === 'preferences') return preferencesHandler(request, response);
  if (request.query.resource === 'password') return passwordHandler(request, response);
  return response.status(404).json({ error: 'Account resource not found' });
}
