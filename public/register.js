(() => {
  const form = document.getElementById('registerForm');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');

  fetch('/api/auth-session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => {
      if (response.ok) {
        location.replace('/home');
      }
    })
    .catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'Invio in corso...';
    try {
      const response = await fetch('/api/auth-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', email: form.email.value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Richiesta non riuscita');
      }
      status.textContent = body.message;
      form.reset();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
})();
