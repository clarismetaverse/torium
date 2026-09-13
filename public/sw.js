// TORIUM service worker.
//
// It exists for one reason: a push message has to be handled when no TORIUM tab
// is open, and only a service worker can do that. There is deliberately no
// caching here. TORIUM shows live listing data behind an authenticated session,
// and a cache that outlives a logout, or that serves yesterday's valuations
// from disk, would be worse than a slow page.

self.addEventListener('install', () => {
  // Take over immediately: a notification that arrives during an update should
  // still be handled.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function notificationFrom(event) {
  const fallback = {
    title: 'TORIUM',
    body: 'Ci sono novità sui tuoi criteri.',
    tag: 'torium-alerts',
    url: '/account#alertsCard',
  };
  if (!event.data) return fallback;
  try {
    const payload = event.data.json();
    return {
      title: payload.title || fallback.title,
      body: payload.body || fallback.body,
      tag: payload.tag || fallback.tag,
      url: payload.url || fallback.url,
    };
  } catch {
    return fallback;
  }
}

self.addEventListener('push', (event) => {
  const notification = notificationFrom(event);
  event.waitUntil(self.registration.showNotification(notification.title, {
    body: notification.body,
    tag: notification.tag,
    // A later notification replaces the earlier one silently rather than
    // buzzing twice for the same run.
    renotify: false,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: notification.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/account', self.location.origin);
  // Never follow a URL from the payload to another origin, whatever it says.
  if (target.origin !== self.location.origin) target.href = self.location.origin + '/account';

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      if ('navigate' in client) await client.navigate(target.href).catch(() => {});
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

// A browser may rotate a subscription on its own. Without this the device goes
// quiet and nobody finds out until someone asks why they stopped receiving
// anything.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
    if (!applicationServerKey) return;
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    await fetch('/api/push-subscription', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    }).catch(() => {});
  })());
});
