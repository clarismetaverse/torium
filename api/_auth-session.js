import {
  authenticatedSession,
  clearAuthCookies,
  isSameOrigin,
  membershipForUser,
  noStore,
  passwordSession,
  pseudonymize,
  recordAuthEvent,
  revokeSession,
  setAuthCookies,
} from './_auth.js';
import { enforceRateLimit } from './_rate-limit.js';

function safeUser(user, membership) {
  return user ? {
    id: user.id,
    email: user.email,
    role: membership?.role || null,
  } : null;
}

export default async function handler(request, response) {
  noStore(response);

  if (request.method === 'GET') {
    const session = await authenticatedSession(request, response);
    if (!session) return response.status(401).json({ authenticated: false });
    const membership = await membershipForUser(session.user.id);
    if (!membership) {
      await revokeSession(session.accessToken).catch(() => {});
      clearAuthCookies(response);
      return response.status(403).json({
        authenticated: false,
        error: 'TORIUM membership is not active',
        code: 'membership_inactive',
      });
    }
    return response.status(200).json({
      authenticated: true,
      user: safeUser(session.user, membership),
    });
  }

  if (!isSameOrigin(request)) {
    return response.status(403).json({ error: 'Invalid request origin' });
  }

  if (request.method === 'POST') {
    const email = String(request.body?.email || '').trim().toLowerCase();
    const password = String(request.body?.password || '');
    if (!email || !password) {
      return response.status(400).json({ error: 'Email and password are required' });
    }
    if (email.length > 254 || password.length > 256) {
      return response.status(400).json({ error: 'Email or password not valid' });
    }
    if (!await enforceRateLimit(request, response, 'login', email)) return;
    try {
      const session = await passwordSession(email, password);
      const membership = await membershipForUser(session.user?.id);
      if (!membership) {
        await revokeSession(session.access_token).catch(() => {});
        await recordAuthEvent(session.user?.id || null, 'login_denied_membership');
        // The caller has already proven this credential, so naming the state
        // leaks nothing they do not know and avoids a dead-end login loop.
        return response.status(403).json({
          error: 'Accesso TORIUM non ancora attivo. Attendi la conferma di un operatore.',
          code: 'membership_inactive',
        });
      }
      setAuthCookies(response, session);
      await recordAuthEvent(session.user.id, 'login_succeeded', { role: membership.role });
      return response.status(200).json({
        authenticated: true,
        user: safeUser(session.user, membership),
      });
    } catch (error) {
      const invalidCredentials = [400, 401].includes(error.statusCode);
      if (invalidCredentials) {
        await recordAuthEvent(null, 'login_failed', { subject: pseudonymize(email) });
      }
      return response.status(invalidCredentials ? 401 : 503).json({
        error: invalidCredentials ? 'Email or password not valid' : 'Authentication service unavailable',
      });
    }
  }

  if (request.method === 'DELETE') {
    const session = await authenticatedSession(request, response);
    await revokeSession(session?.accessToken, 'global').catch(() => {});
    await recordAuthEvent(session?.user?.id, 'logout').catch(() => {});
    clearAuthCookies(response);
    return response.status(200).json({ authenticated: false });
  }

  response.setHeader('Allow', 'GET, POST, DELETE');
  return response.status(405).json({ error: 'Method not allowed' });
}
