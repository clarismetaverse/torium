(() => {
  const params = new URLSearchParams(location.search);
  const requested = params.get('next') || '/home';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/home';
  const form = document.getElementById('loginForm');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');

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
