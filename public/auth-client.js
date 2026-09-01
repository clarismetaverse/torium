(() => {
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
