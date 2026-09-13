import {
  authenticatedSession,
  clearAuthCookies,
  isSameOrigin,
  noStore,
  pseudonymize,
  requestInvite,
  recordAuthEvent,
  requestOrigin,
  requestPasswordRecovery,
  revokeSession,
  setAuthCookies,
  updatePassword,
  userForAccessToken,
} from './_auth.js';
import { enforceRateLimit } from './_rate-limit.js';

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
    message: 'Richiesta registrata. Se idonea, riceverai un invito via email.',
  });
}

export default async function handler(request, response) {
  noStore(response);

  if (!['POST', 'PUT'].includes(request.method)) {
    response.setHeader('Allow', 'POST, PUT');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!isSameOrigin(request)) {
    return response.status(403).json({ error: 'Invalid request origin' });
  }

  if (request.method === 'POST' && request.body?.action === 'request') {
    const email = validEmail(request.body?.email);
    // Rate limited on the source address alone so an unparsable address cannot
    // be used to probe whether validation ran.
    if (!await enforceRateLimit(request, response, 'recovery')) return;
    if (!email) return genericRecoveryResponse(response);
    try {
      const origin = requestOrigin(request);
      await requestPasswordRecovery(email, origin ? origin + '/set-password' : undefined);
      await recordAuthEvent(null, 'recovery_requested', { subject: pseudonymize(email) });
    } catch (error) {
      // Never surface upstream status: a 429 or 4xx here would tell the caller
      // whether the address exists. The generic response is always returned.
      console.error('Password recovery request failed', error.statusCode || error.message);
    }
    return genericRecoveryResponse(response);
  }

  if (request.method === 'POST' && request.body?.action === 'invite') {
    const email = validEmail(request.body?.email);
    if (!await enforceRateLimit(request, response, 'invite')) return;
    if (!email) return genericInviteResponse(response);
    try {
      const redirectTo = requestOrigin(request);
      // Sends the Supabase invitation only. Membership is NOT activated here:
      // the invited account reaches the "authenticated without active
      // membership" state until an operator grants access.
      await requestInvite(email, redirectTo ? redirectTo + '/set-password' : undefined);
      await recordAuthEvent(null, 'invite_requested', { subject: pseudonymize(email) });
    } catch (error) {
      console.error('Invite request failed', error.statusCode || error.message);
    }
    return genericInviteResponse(response);
  }

  if (request.method === 'POST' && request.body?.action === 'adopt') {
    const type = String(request.body?.type || '');
    const accessToken = String(request.body?.access_token || '');
    const refreshToken = String(request.body?.refresh_token || '');
    // Shape check only: Supabase is the authority on whether the token is
    // valid. A Supabase refresh token is a short opaque string - 12 characters
    // in current GoTrue - so a length floor borrowed from JWTs rejected every
    // legitimate recovery and invite link with a 400.
    const accessTokenLooksLikeJwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(accessToken);
    if (!['invite', 'recovery'].includes(type)
      || !accessTokenLooksLikeJwt
      || refreshToken.length < 8
      || refreshToken.length > 512) {
      return response.status(400).json({ error: 'Link non valido o incompleto' });
    }
    if (!await enforceRateLimit(request, response, 'session_adopt')) return;
    const user = await userForAccessToken(accessToken);
    if (!user?.id) {
      return response.status(403).json({ error: 'Link non valido o scaduto' });
    }
    // Password lifecycle is Supabase identity, not TORIUM authorization. An
    // invited account must be able to set its password before an operator
    // activates membership; product access stays denied until then.
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
    if (!session?.user?.id) {
      clearAuthCookies(response);
      return response.status(401).json({ error: 'Sessione di recupero non valida o scaduta' });
    }
    if (!await enforceRateLimit(request, response, 'password_update', session.user.id)) return;
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
