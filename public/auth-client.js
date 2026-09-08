(() => {
  // A Supabase recovery or invite link can land on a protected page instead of
  // /set-password: when the requested redirect_to is not in the project's
  // allowlist, GoTrue silently falls back to the Site URL, which lands on "/"
  // and is rewritten to /home. Without this the auth guard below would bounce
  // to /login and discard the one-time token in the fragment, making recovery
  // impossible to complete. Forward to the page that can consume it instead.
  const authLinkPayload = () => {
    for (const raw of [location.hash.replace(/^#/, ''), location.search.replace(/^\?/, '')]) {
      if (!raw) continue;
      const params = new URLSearchParams(raw);
      const type = params.get('type');
      const isCredentialLink = type === 'recovery' || type === 'invite'
        || (params.get('access_token') && params.get('refresh_token'));
      const isAuthLinkError = params.get('error_code') && params.get('error_description');
      if (isCredentialLink || isAuthLinkError) return raw;
    }
    return null;
  };

  if (location.pathname !== '/set-password') {
    const payload = authLinkPayload();
    if (payload) {
      location.replace('/set-password#' + payload);
      return;
    }
  }

  document.documentElement.classList.add('auth-pending');
  const style = document.createElement('style');
  style.textContent = 'html.auth-pending body{visibility:hidden}';
  document.head.append(style);

  const redirectToLogin = () => {
    const next = location.pathname + location.search + location.hash;
    location.replace('/login?next=' + encodeURIComponent(next));
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url;
    if (response.status === 401 && String(url || '').startsWith('/api/')) redirectToLogin();
    return response;
  };

  window.toriumSessionReady = originalFetch('/api/auth-session', {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      redirectToLogin();
      return null;
    }
    const session = await response.json();
    document.documentElement.classList.remove('auth-pending');
    window.toriumUser = session.user;
    return session.user;
  }).catch(redirectToLogin);
})();
