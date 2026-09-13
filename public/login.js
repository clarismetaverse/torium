(() => {
  const params = new URLSearchParams(location.search);
  const next = toriumSafeNextPath(params.get('next'));
  const form = document.getElementById('loginForm');
  const reason = params.get('reason');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');

  if (reason === 'membership_inactive') {
    status.textContent = 'Il tuo accesso TORIUM non è ancora attivo. Contatta un operatore.';
  }

  fetch('/api/auth-session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => {
      if (response.ok) location.replace(next);
    })
    .catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = '';
    try {
      const response = await fetch('/api/auth-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value, password: form.password.value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Accesso non riuscito');
      location.replace(next);
    } catch (error) {
      status.textContent = error.message;
      submit.disabled = false;
    }
  });
})();
