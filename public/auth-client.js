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

  const redirectToLogin = (reason) => {
    const next = location.pathname + location.search + location.hash;
    const query = '?next=' + encodeURIComponent(next) + (reason ? '&reason=' + encodeURIComponent(reason) : '');
    location.replace('/login' + query);
  };

  const originalFetch = window.fetch.bind(window);

  // 401 means the session is gone; 403 with membership_inactive means the
  // membership was suspended or revoked mid-session. Both must leave the
  // protected page rather than keep rendering stale product data.
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url;
    if (!String(url || '').startsWith('/api/')) return response;
    if (response.status === 401) redirectToLogin();
    if (response.status === 403) {
      const probe = response.clone();
      probe.json().then((body) => {
        if (body && body.code === 'membership_inactive') redirectToLogin('membership_inactive');
      }).catch(() => {});
    }
    return response;
  };

  window.toriumLogout = async () => {
    try {
      await originalFetch('/api/auth-session', { method: 'DELETE', credentials: 'same-origin' });
    } finally {
      location.replace('/login');
    }
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target instanceof Element
      ? event.target.closest('[data-torium-logout], #logout')
      : null;
    if (!trigger) return;
    event.preventDefault();
    window.toriumLogout();
  });

  window.toriumSessionReady = originalFetch('/api/auth-session', {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      redirectToLogin(response.status === 403 ? 'membership_inactive' : undefined);
      return null;
    }
    const session = await response.json();
    document.documentElement.classList.remove('auth-pending');
    window.toriumUser = session.user;
    document.documentElement.dataset.toriumRole = session.user?.role || '';
    return session.user;
  }).catch(() => redirectToLogin());
})();
