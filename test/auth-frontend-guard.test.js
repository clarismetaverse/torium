import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const publicDir = new URL('../public/', import.meta.url);

async function source(name) {
  return readFile(new URL(name, publicDir), 'utf8');
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    clone() { return jsonResponse(status, body); },
    json: async () => body,
  };
}

function fakeDocument(elements = {}) {
  const listeners = {};
  const documentElement = {
    classList: { names: new Set(), add(n) { this.names.add(n); }, remove(n) { this.names.delete(n); } },
    dataset: {},
  };
  return {
    documentElement,
    head: { append() {} },
    createElement: () => ({ set textContent(value) { this.value = value; } }),
    getElementById: (id) => elements[id] || null,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    dispatch: (type, event) => listeners[type] && listeners[type](event),
    listeners,
  };
}

function fakeLocation(pathname = '/villas', search = '', hash = '') {
  return {
    pathname,
    search,
    hash,
    replaced: [],
    replace(url) { this.replaced.push(url); },
  };
}

async function runInPage({ scripts, location, fetchImpl, elements }) {
  const document = fakeDocument(elements);
  const context = {
    document,
    location,
    URLSearchParams,
    Promise,
    JSON,
    console,
    Element: class Element {},
    encodeURIComponent,
    setTimeout,
  };
  context.window = context;
  context.globalThis = context;
  context.fetch = fetchImpl;
  vm.createContext(context);
  for (const script of scripts) vm.runInContext(await source(script), context);
  return { context, document, location };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- next validation -------------------------------------------------------

test('the return path allowlist accepts internal routes only', async () => {
  const context = vm.createContext({});
  vm.runInContext(await source('safe-next.js'), context);
  const safeNext = context.toriumSafeNextPath;

  assert.equal(safeNext('/villas'), '/villas');
  assert.equal(safeNext('/home?run=abc#top'), '/home?run=abc#top');
  assert.equal(safeNext(undefined), '/home');
  assert.equal(safeNext(''), '/home');

  for (const hostile of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',      // browsers normalise "\" to "/": becomes //evil.example
    '\\\\evil.example',
    '/\t/evil.example',
    '/\n//evil.example',
    'javascript:alert(1)',
    '/@evil.example',
    '/:evil',
    'evil.example',
    '/'.padEnd(600, 'a'),
  ]) {
    assert.equal(safeNext(hostile), '/home', 'must refuse ' + JSON.stringify(hostile));
  }
});

// --- protected page guard --------------------------------------------------

test('a protected page with no session is sent to login with its own return path', async () => {
  const location = fakeLocation('/villas', '?area=como', '#top');
  await runInPage({
    scripts: ['auth-client.js'],
    location,
    fetchImpl: async () => jsonResponse(401, { authenticated: false }),
  });
  await flush();

  assert.equal(location.replaced.length, 1);
  assert.equal(location.replaced[0], '/login?next=' + encodeURIComponent('/villas?area=como#top'));
});

test('a session probe answering 403 sends the member to login with the inactive reason', async () => {
  const location = fakeLocation('/home');
  await runInPage({
    scripts: ['auth-client.js'],
    location,
    fetchImpl: async () => jsonResponse(403, { code: 'membership_inactive' }),
  });
  await flush();

  assert.equal(location.replaced[0], '/login?next=' + encodeURIComponent('/home') + '&reason=membership_inactive');
});

test('a membership revoked mid-session leaves the protected page', async () => {
  const location = fakeLocation('/home');
  const responses = [
    jsonResponse(200, { authenticated: true, user: { id: 'u', role: 'investor' } }),
    jsonResponse(403, { code: 'membership_inactive' }),
  ];
  const { context } = await runInPage({
    scripts: ['auth-client.js'],
    location,
    fetchImpl: async () => responses.shift(),
  });
  await flush();
  assert.equal(location.replaced.length, 0, 'the active session stays on the page');

  await context.fetch('/api/output?file=supabase:run-1');
  await flush();
  assert.equal(location.replaced[0], '/login?next=' + encodeURIComponent('/home') + '&reason=membership_inactive');
});

test('the shared logout control revokes the session and returns to login', async () => {
  const location = fakeLocation('/home');
  const requests = [];
  const { document, context } = await runInPage({
    scripts: ['auth-client.js'],
    location,
    fetchImpl: async (url, init) => {
      requests.push({ url, method: init?.method || 'GET' });
      return jsonResponse(200, { authenticated: true, user: { id: 'u', role: 'admin' } });
    },
  });
  await flush();

  let defaultPrevented = false;
  // The guard only reacts to real elements, so the trigger must satisfy the
  // page's own `instanceof Element` check.
  const trigger = Object.create(context.Element.prototype);
  trigger.closest = (selector) => (selector.includes('logout') ? trigger : null);
  document.dispatch('click', {
    target: trigger,
    preventDefault() { defaultPrevented = true; },
  });
  await flush();

  assert.equal(defaultPrevented, true);
  assert.ok(requests.some((r) => r.url === '/api/auth-session' && r.method === 'DELETE'));
  assert.equal(location.replaced.at(-1), '/login');
});

// --- login page ------------------------------------------------------------

async function submitLogin({ nextParam, loginStatus = 200, loginBody = {} }) {
  const location = fakeLocation('/login', nextParam ? '?next=' + encodeURIComponent(nextParam) : '');
  const form = {
    email: { value: 'member@example.test' },
    password: { value: 'a-sufficiently-long-password' },
    handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
  };
  const status = { textContent: '' };
  const submit = { disabled: false };
  const calls = [];

  await runInPage({
    scripts: ['safe-next.js', 'login.js'],
    location,
    elements: { loginForm: form, status, submit },
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method || 'GET' });
      if (!init?.method) return jsonResponse(401, { authenticated: false });
      return jsonResponse(loginStatus, loginBody);
    },
  });
  await flush();
  await form.handlers.submit({ preventDefault() {} });
  await flush();
  return { location, status, calls };
}

test('a successful login returns to the requested internal route', async () => {
  const { location } = await submitLogin({ nextParam: '/villas?area=toscana' });
  assert.equal(location.replaced.at(-1), '/villas?area=toscana');
});

test('a successful login refuses to return to an external destination', async () => {
  for (const hostile of ['https://evil.example/steal', '//evil.example', '/\\evil.example']) {
    const { location } = await submitLogin({ nextParam: hostile });
    assert.equal(location.replaced.at(-1), '/home', 'must not follow ' + hostile);
  }
});

test('a rejected login shows the server message and re-enables the form', async () => {
  const { location, status } = await submitLogin({
    nextParam: '/home',
    loginStatus: 401,
    loginBody: { error: 'Email or password not valid' },
  });
  assert.equal(location.replaced.length, 0);
  assert.equal(status.textContent, 'Email or password not valid');
});

test('the login page explains an inactive membership without leaking anything else', async () => {
  const location = fakeLocation('/login', '?reason=membership_inactive');
  const form = { email: { value: '' }, password: { value: '' }, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
  const status = { textContent: '' };
  await runInPage({
    scripts: ['safe-next.js', 'login.js'],
    location,
    elements: { loginForm: form, status, submit: { disabled: false } },
    fetchImpl: async () => jsonResponse(401, {}),
  });
  await flush();
  assert.match(status.textContent, /non è ancora attivo/);
});

// --- page wiring -----------------------------------------------------------

test('every protected page loads the guard and offers a logout control', async () => {
  for (const name of ['home.html', 'index.html', 'villas.html', 'renewals.html', 'account.html']) {
    const html = await source(name);
    assert.match(html, /src="\/auth-client\.js"/, name + ' must load the guard');
    assert.match(html, /data-torium-logout|id="logout"/, name + ' must offer a logout control');
  }
});

test('the login page loads the return-path allowlist before the login script', async () => {
  const html = await source('login.html');
  assert.ok(
    html.indexOf('/safe-next.js') < html.indexOf('/login.js'),
    'safe-next.js must be defined before login.js runs',
  );
  assert.doesNotMatch(html, /src="\/auth-client\.js"/);
});
