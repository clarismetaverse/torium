(() => {
  const form = document.getElementById('passwordForm');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');

  function fail(message) {
    status.className = 'status error';
    status.textContent = message;
    form.hidden = true;
  }

  async function establishRecoverySession() {
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(location.search.replace(/^\?/, ''));
    const payload = {
      action: 'adopt',
      access_token: fragment.get('access_token') || query.get('access_token') || '',
      refresh_token: fragment.get('refresh_token') || query.get('refresh_token') || '',
      expires_in: fragment.get('expires_in') || query.get('expires_in') || '',
      type: fragment.get('type') || query.get('type') || '',
    };
    const fragmentError = fragment.get('error_description') || fragment.get('error')
      || query.get('error_description') || query.get('error');
    history.replaceState(null, '', location.pathname);
    if (fragmentError) throw new Error(fragmentError);

    if (payload.access_token && payload.refresh_token) {
      const response = await fetch('/api/auth-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Link non valido o scaduto');
      return body.mode;
    }

    const session = await fetch('/api/auth-session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!session.ok) throw new Error('Link non valido o scaduto. Richiedine uno nuovo.');
    return 'session';
  }

  establishRecoverySession().then((mode) => {
    status.className = 'status';
    status.textContent = mode === 'invite'
      ? 'Invito verificato. Imposta la password per attivare l’accesso.'
      : 'Identità verificata. Ora puoi scegliere la nuova password.';
    form.hidden = false;
  }).catch((error) => fail(error.message));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.password.value !== form.confirmPassword.value) {
      fail('Le due password non coincidono.');
      form.hidden = false;
      return;
    }
    submit.disabled = true;
    status.textContent = 'Aggiornamento e revoca delle vecchie sessioni...';
    try {
      const response = await fetch('/api/auth-password', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.password.value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Aggiornamento non riuscito');
      status.className = 'status';
      status.textContent = 'Password aggiornata. Torna al login con le nuove credenziali.';
      form.hidden = true;
    } catch (error) {
      fail(error.message);
      form.hidden = false;
      submit.disabled = false;
    }
  });
})();
