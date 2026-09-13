import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/push-client.js', import.meta.url), 'utf8');

function load() {
  const sandbox = { atob: (value) => Buffer.from(value, 'base64').toString('binary'), Uint8Array };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

function browser({ userAgent = ANDROID, standalone, maxTouchPoints = 0, permission = 'default', push = true } = {}) {
  const navigatorRef = { userAgent, maxTouchPoints, serviceWorker: {} };
  if (standalone !== undefined) navigatorRef.standalone = standalone;
  const windowRef = {
    Notification: { permission },
    matchMedia: () => ({ matches: standalone === true }),
  };
  if (push) windowRef.PushManager = function PushManager() {};
  return { window: windowRef, navigator: navigatorRef };
}

test('iOS in a browser tab is told to install, not asked for permission', () => {
  const { toriumPushCapability } = load();
  const result = toriumPushCapability(browser({ userAgent: IPHONE, standalone: false }));
  assert.equal(result.state, 'needs-install');
  assert.equal(result.label, 'iPhone');
});

test('iOS on the Home Screen can subscribe like any other browser', () => {
  const { toriumPushCapability } = load();
  assert.equal(toriumPushCapability(browser({ userAgent: IPHONE, standalone: true })).state, 'available');
});

test('an iPad reporting itself as a Mac is still recognised as iOS', () => {
  const { toriumPushCapability } = load();
  const result = toriumPushCapability(browser({ userAgent: MAC, maxTouchPoints: 5, standalone: false }));
  assert.equal(result.state, 'needs-install');
});

test('a desktop Mac is not mistaken for an iPad', () => {
  const { toriumPushCapability } = load();
  assert.equal(toriumPushCapability(browser({ userAgent: MAC, maxTouchPoints: 0 })).state, 'available');
});

test('a browser without the Push API is reported as unsupported', () => {
  const { toriumPushCapability } = load();
  assert.equal(toriumPushCapability(browser({ push: false })).state, 'unsupported');
});

test('permission the user already refused is a separate state from off', () => {
  const { toriumPushCapability } = load();
  assert.equal(toriumPushCapability(browser({ permission: 'denied' })).state, 'blocked');
});

test('the VAPID key is decoded to the byte array the Push API expects', () => {
  const { toriumPushBase64ToBytes } = load();
  // Base64url of 0x00 0x01 0xfe 0xff, which needs both substitutions and padding.
  const bytes = toriumPushBase64ToBytes('AAH-_w');
  assert.deepEqual([...bytes], [0, 1, 254, 255]);
});

function subscribeHarness({ permission = 'granted', vapidKey = 'BKxQ', saveStatus = 201 } = {}) {
  const calls = [];
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribed: false,
    async unsubscribe() { this.unsubscribed = true; return true; },
  };
  const pushManager = {
    subscribeOptions: null,
    async subscribe(options) { this.subscribeOptions = options; return subscription; },
    async getSubscription() { return subscription; },
  };
  const context = browser({ permission: 'default' });
  context.window.Notification.requestPermission = async () => permission;
  context.navigator.serviceWorker = {
    async register() { return { pushManager }; },
    async getRegistration() { return { pushManager }; },
    ready: Promise.resolve({ pushManager }),
  };
  context.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (!options.method || options.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ vapid_public_key: vapidKey, subscriptions: [] }) };
    }
    return { ok: saveStatus < 300, status: saveStatus, json: async () => ({}) };
  };
  return { context, calls, subscription, pushManager };
}

test('enabling registers the worker, subscribes and saves the subscription', async () => {
  const { toriumPush } = load();
  const harness = subscribeHarness();
  const result = await toriumPush(harness.context).enable();

  assert.equal(result.state, 'on');
  assert.equal(harness.pushManager.subscribeOptions.userVisibleOnly, true);
  const saved = harness.calls.find((call) => call.method === 'POST');
  assert.ok(saved, 'the subscription is sent to TORIUM');
  const body = JSON.parse(saved.body);
  assert.equal(body.endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
  assert.equal(body.device_label, 'Android');
});

test('a refused permission prompt does not leave a half-registered device', async () => {
  const { toriumPush } = load();
  const harness = subscribeHarness({ permission: 'denied' });
  const result = await toriumPush(harness.context).enable();
  assert.equal(result.state, 'blocked');
  assert.equal(harness.calls.filter((call) => call.method === 'POST').length, 0);
});

test('a subscription TORIUM could not store is undone in the browser too', async () => {
  const { toriumPush } = load();
  const harness = subscribeHarness({ saveStatus: 500 });
  const result = await toriumPush(harness.context).enable();
  assert.equal(result.state, 'error');
  assert.equal(harness.subscription.unsubscribed, true,
    'the device must not stay subscribed to a server that does not know it');
});

test('disabling revokes the subscription on both sides', async () => {
  const { toriumPush } = load();
  const harness = subscribeHarness();
  const result = await toriumPush(harness.context).disable();
  assert.equal(result.state, 'off');
  const deleted = harness.calls.find((call) => call.method === 'DELETE');
  assert.equal(JSON.parse(deleted.body).endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
  assert.equal(harness.subscription.unsubscribed, true);
});
