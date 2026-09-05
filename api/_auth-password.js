import {
  authenticatedSession,
  clearAuthCookies,
  isSameOrigin,
  membershipForUser,
  requestInvite,
  recordAuthEvent,
  requestOrigin,
  requestPasswordRecovery,
  revokeSession,
  setAuthCookies,
  updatePassword,
  userForAccessToken,
} from './_auth.js';

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

export function validatePassword(value) {
  const password = String(value || '');
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error('La password deve contenere da 12 a 128 caratteri');
  }
  return password;
}

function genericRecoveryResponse(response) {
  return response.status(200).json({
    ok: true,
    message: 'Se l’indirizzo è associato a un account attivo, riceverai le istruzioni via email.',
  });
}

function genericInviteResponse(response) {
  return response.status(200).json({
    ok: true,
    message: 'Se possibile, riceverai un invito via email.',
  });
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');

  if (!['POST', 'PUT'].includes(request.method)) {
    response.setHeader('Allow', 'POST, PUT');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!isSameOrigin(request)) {
    return response.status(403).json({ error: 'Invalid request origin' });
  }

  if (request.method === 'POST' && request.body?.action === 'request') {
    const email = validEmail(request.body?.email);
    if (!email) return genericRecoveryResponse(response);
    try {
      const origin = requestOrigin(request);
      await requestPasswordRecovery(email, origin ? origin + '/set-password' : undefined);
    } catch (error) {
      if (error.statusCode === 429) {
        return response.status(429).json({ error: 'Troppe richieste. Riprova tra qualche minuto.' });
      }
      console.error('Password recovery request failed', error);
    }
    return genericRecoveryResponse(response);
  }

  if (request.method === 'POST' && request.body?.action === 'invite') {
    const email = validEmail(request.body?.email);
    if (!email) return genericInviteResponse(response);
    try {
      const redirectTo = requestOrigin(request);
      await requestInvite(email, redirectTo ? redirectTo + '/set-password' : undefined, 'investor');
    } catch (error) {
      if (error.statusCode === 429) {
        return response.status(429).json({ error: 'Troppe richieste. Riprova tra qualche minuto.' });
      }
      console.error('Invite request failed', error);
    }
    return genericInviteResponse(response);
  }

  if (request.method === 'POST' && request.body?.action === 'adopt') {
    const type = String(request.body?.type || '');
    const accessToken = String(request.body?.access_token || '');
    const refreshToken = String(request.body?.refresh_token || '');
    if (!['invite', 'recovery'].includes(type) || accessToken.length < 40 || refreshToken.length < 20) {
      return response.status(400).json({ error: 'Link non valido o incompleto' });
    }
    const user = await userForAccessToken(accessToken);
    const membership = await membershipForUser(user?.id);
    if (!user || !membership) {
      return response.status(403).json({ error: 'Invito o account TORIUM non attivo' });
    }
    setAuthCookies(response, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(request.body?.expires_in) || 3600,
    });
    await recordAuthEvent(user.id, type === 'invite' ? 'invite_accepted' : 'recovery_link_opened');
    return response.status(200).json({ ok: true, mode: type });
  }

  if (request.method === 'PUT') {
    const session = await authenticatedSession(request, response);
    if (!session?.user?.id || !await membershipForUser(session.user.id)) {
      clearAuthCookies(response);
      return response.status(401).json({ error: 'Sessione di recupero non valida o scaduta' });
    }
    let password;
    try {
      password = validatePassword(request.body?.password);
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }
    try {
      await updatePassword(
        session.accessToken,
        password,
        String(request.body?.current_password || '') || undefined,
      );
      await recordAuthEvent(session.user.id, 'password_changed');
      await revokeSession(session.accessToken, 'global').catch(() => {});
      clearAuthCookies(response);
      return response.status(200).json({ ok: true, reauthenticate: true });
    } catch (error) {
      const status = [400, 401, 422].includes(error.statusCode) ? 400 : 503;
      return response.status(status).json({
        error: status === 400 ? error.message : 'Servizio di autenticazione temporaneamente non disponibile',
      });
    }
  }

  return response.status(400).json({ error: 'Azione password non valida' });
}
