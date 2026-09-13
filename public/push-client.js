// Turning notifications on for this browser.
//
// Three things have to line up before a push can arrive, and they fail in
// different ways: the browser must support the Push API, the user must grant
// permission, and on iOS the site must have been added to the Home Screen
// first - Safari exposes no push at all to a PWA opened in a tab. Each of
// those is a different sentence to show the investor, so they are separate
// states here rather than one "notifications unavailable".
(function attachToriumPush(global) {
  var ENDPOINT = '/api/push-subscription';

  function base64UrlToBytes(value) {
    var padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    var binary = global.atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Coarse on purpose: enough for the investor to tell a phone from a laptop in
  // the account page, never a fingerprint.
  function deviceLabel(navigatorRef) {
    var agent = String(navigatorRef && navigatorRef.userAgent || '');
    if (/iphone/i.test(agent)) return 'iPhone';
    if (/ipad/i.test(agent)) return 'iPad';
    if (/android/i.test(agent)) return 'Android';
    if (/macintosh/i.test(agent)) return 'Mac';
    if (/windows/i.test(agent)) return 'Windows';
    return 'Questo dispositivo';
  }

  function isAppleMobile(navigatorRef) {
    var agent = String(navigatorRef && navigatorRef.userAgent || '');
    // iPadOS reports itself as a Mac, and is told apart by having touch points.
    var iPadOnDesktopAgent = /macintosh/i.test(agent) && (navigatorRef.maxTouchPoints || 0) > 1;
    return /iphone|ipad|ipod/i.test(agent) || iPadOnDesktopAgent;
  }

  function isInstalled(windowRef, navigatorRef) {
    if (navigatorRef && typeof navigatorRef.standalone === 'boolean') return navigatorRef.standalone;
    if (windowRef && typeof windowRef.matchMedia === 'function') {
      try {
        return windowRef.matchMedia('(display-mode: standalone)').matches === true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  /**
   * What this browser can do right now, before anything is asked of the user.
   *
   * 'needs-install' is the one that matters on iOS: permission cannot even be
   * requested until the site is on the Home Screen, so prompting there would
   * silently do nothing.
   */
  function capability(context) {
    var navigatorRef = context.navigator;
    var windowRef = context.window;
    var hasServiceWorker = !!(navigatorRef && navigatorRef.serviceWorker);
    var hasPush = !!(windowRef && windowRef.PushManager);
    var hasNotification = !!(windowRef && windowRef.Notification);

    if (isAppleMobile(navigatorRef) && !isInstalled(windowRef, navigatorRef)) {
      return { state: 'needs-install', label: deviceLabel(navigatorRef) };
    }
    if (!hasServiceWorker || !hasPush || !hasNotification) {
      return { state: 'unsupported', label: deviceLabel(navigatorRef) };
    }
    if (windowRef.Notification.permission === 'denied') {
      return { state: 'blocked', label: deviceLabel(navigatorRef) };
    }
    return { state: 'available', label: deviceLabel(navigatorRef) };
  }

  function toriumPush(context) {
    var scope = context || { window: global, navigator: global.navigator, fetch: global.fetch };
    var windowRef = scope.window;
    var navigatorRef = scope.navigator;
    var fetchRef = scope.fetch;

    async function registration() {
      return navigatorRef.serviceWorker.register('/sw.js', { scope: '/' });
    }

    async function currentSubscription() {
      var ready = await navigatorRef.serviceWorker.getRegistration('/');
      if (!ready || !ready.pushManager) return null;
      return ready.pushManager.getSubscription();
    }

    return {
      capability: function () {
        return capability({ window: windowRef, navigator: navigatorRef });
      },

      /** Whether this specific browser is currently subscribed. */
      status: async function () {
        var support = capability({ window: windowRef, navigator: navigatorRef });
        if (support.state !== 'available') return { state: support.state, label: support.label };
        var subscription = await currentSubscription().catch(function () { return null; });
        return { state: subscription ? 'on' : 'off', label: support.label };
      },

      /**
       * Must be called from a click. Browsers ignore a permission prompt that
       * is not tied to a user gesture, and Safari holds it against the site.
       */
      enable: async function () {
        var support = capability({ window: windowRef, navigator: navigatorRef });
        if (support.state !== 'available') return { state: support.state, label: support.label };

        var permission = await windowRef.Notification.requestPermission();
        if (permission !== 'granted') return { state: permission === 'denied' ? 'blocked' : 'off' };

        var keyResponse = await fetchRef(ENDPOINT, { credentials: 'same-origin' });
        if (!keyResponse.ok) return { state: 'error', reason: 'key_unavailable' };
        var body = await keyResponse.json();
        if (!body.vapid_public_key) return { state: 'error', reason: 'not_configured' };

        var ready = await registration();
        await navigatorRef.serviceWorker.ready;
        var subscription = await ready.pushManager.subscribe({
          // Required by every browser: a push must result in something the
          // user can see. TORIUM has no use for silent pushes anyway.
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(body.vapid_public_key),
        });

        var payload = subscription.toJSON();
        payload.device_label = deviceLabel(navigatorRef);
        var saved = await fetchRef(ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!saved.ok) {
          // Never leave a subscription the server does not know about: the
          // device would stay registered with the push service and never
          // receive anything.
          await subscription.unsubscribe().catch(function () {});
          return { state: 'error', reason: 'not_registered' };
        }
        return { state: 'on', label: support.label };
      },

      disable: async function () {
        var subscription = await currentSubscription().catch(function () { return null; });
        if (!subscription) return { state: 'off' };
        await fetchRef(ENDPOINT, {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(function () {});
        await subscription.unsubscribe().catch(function () {});
        return { state: 'off' };
      },
    };
  }

  global.toriumPushCapability = capability;
  global.toriumPushDeviceLabel = deviceLabel;
  global.toriumPushBase64ToBytes = base64UrlToBytes;
  global.toriumPush = toriumPush;
})(typeof globalThis !== 'undefined' ? globalThis : this);
