// Service worker for staff alerts. Receives Web Push messages from the server so staff are notified
// even when the admin page is closed. Registered by admin.js with scope /admin/.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload */ }
  event.waitUntil((async () => {
    // If the admin page is on screen it already shows the alert itself (and refreshes the schedule), so stay quiet.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((c) => c.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Escape room alert', {
      body: data.body || '',
      tag: `ootb-${data.at || Date.now()}`, // same tag as the in-page notification, so the two collapse into one
      data: { url: '/admin/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((c) => new URL(c.url).pathname.startsWith('/admin'));
    if (open) await open.focus();
    else await self.clients.openWindow(event.notification.data?.url || '/admin/');
  })());
});
