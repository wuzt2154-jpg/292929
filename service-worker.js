/* SAME PLACE - GitHub Pages Web Push Service Worker
 * Place in the SAME directory as index.html.
 * Handles system notifications only; it does not cache pages or intercept requests.
 */
'use strict';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// The site sends this message at login/logout. We do not persist user IDs in
// worker storage, because they become stale when a user switches accounts.
self.addEventListener('message', event => {
  if (event.data?.kind === 'SP_IDENTITY') {
    // Identity is checked by the authenticated server when sending a push.
    return;
  }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readPayload(event) {
  if (!event.data) return {};
  try {
    const value = event.data.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {}; // Invalid push data: still show a generic notification.
  }
}

function getRecord(payload) {
  if (payload.record && typeof payload.record === 'object') return payload.record;
  if (payload.data?.record && typeof payload.data.record === 'object') return payload.data.record;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function destination(record) {
  const url = new URL(self.registration.scope);
  if (UUID.test(String(record.space_id || '')) && UUID.test(String(record.sender_id || ''))) {
    url.searchParams.set('space_id', record.space_id);
    url.searchParams.set('dm', record.sender_id);
  }
  return url.href;
}

async function wasHandledInForeground(record) {
  if (!record.id || !record.receiver_id) return false;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = windows.filter(client =>
    client.visibilityState === 'visible' && client.url.startsWith(self.registration.scope)
  );
  for (const client of visible) {
    const handled = await new Promise(resolve => {
      const channel = new MessageChannel();
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        channel.port1.close();
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), 1200);
      channel.port1.onmessage = e => finish(e.data?.handled === true);
      try {
        client.postMessage({ kind: 'SP_PUSH_FOREGROUND', record }, [channel.port2]);
      } catch (_) {
        finish(false);
      }
    });
    if (handled) return true;
  }
  return false;
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const payload = readPayload(event);
    const record = getRecord(payload);
    if (await wasHandledInForeground(record)) return;

    const title = '同场 SAME PLACE';
    const body = '你收到一条新私聊消息';
    await self.registration.showNotification(title, {
      body,
      tag: record.id ? 'sp-dm-' + String(record.id) : 'sp-new-message',
      renotify: false,
      data: { url: destination(record) }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const target = new URL(event.notification.data?.url || scope, scope);
    if (target.origin !== self.location.origin || !target.href.startsWith(scope)) {
      return self.clients.openWindow(scope);
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(scope)) {
        if ('navigate' in client) {
          try {
            const moved = await client.navigate(target.href);
            if (moved && 'focus' in moved) return moved.focus();
          } catch (_) { /* Fall back to opening a window. */ }
        }
        break;
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
