import {
  authenticatedSession,
  clearAuthCookies,
  isSameOrigin,
  passwordSession,
  revokeSession,
  setAuthCookies,
} from './_auth.js';

function safeUser(user) {
  return user ? { id: user.id, email: user.email } : null;
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    const session = await authenticatedSession(request, response);
    if (!session) return response.status(401).json({ authenticated: false });
    return response.status(200).json({ authenticated: true, user: safeUser(session.user) });
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
    try {
      const session = await passwordSession(email, password);
      setAuthCookies(response, session);
      return response.status(200).json({ authenticated: true, user: safeUser(session.user) });
    } catch (error) {
      return response.status(error.statusCode === 400 ? 401 : 500).json({
        error: error.statusCode === 400 ? 'Email or password not valid' : error.message,
      });
    }
  }

  if (request.method === 'DELETE') {
    const session = await authenticatedSession(request, response);
    await revokeSession(session?.accessToken).catch(() => {});
    clearAuthCookies(response);
    return response.status(200).json({ authenticated: false });
  }

  response.setHeader('Allow', 'GET, POST, DELETE');
  return response.status(405).json({ error: 'Method not allowed' });
}
