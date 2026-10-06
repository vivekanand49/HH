// Loaded into the service worker (see vite.config.js importScripts).
// Shows medicine reminders and opens the app when one is tapped.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Swasthya Setu', body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Swasthya Setu', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/favicon.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: true,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
