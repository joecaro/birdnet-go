/* global self */
// Minimal service worker for PWA install support.
// This enables the browser's "Add to Home Screen" / "Install App" prompt.
// No offline caching — BirdNET-Go runs on a local network.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const fallbackUrl = '/ui/dashboard';
  const targetUrl =
    event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : fallbackUrl;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const url = new URL(targetUrl, self.location.origin);
      const sameOriginClient = windowClients.find(client => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (sameOriginClient) {
        return sameOriginClient.focus().then(client => {
          if ('navigate' in client) {
            return client.navigate(url.href);
          }
          return client;
        });
      }

      return self.clients.openWindow(url.href);
    })
  );
});
