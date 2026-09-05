(() => {
  const form = document.getElementById('recoveryForm');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'Invio in corso...';
    try {
      const response = await fetch('/api/auth-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', email: form.email.value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Richiesta non riuscita');
      status.textContent = body.message;
      form.reset();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
})();
