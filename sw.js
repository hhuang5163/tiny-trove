// Tiny Trove service worker: makes the app open with no internet.
// Bump VERSION whenever you change app files so phones pick up the new copy.
const VERSION = 'tiny-trove-v7';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'sketches.js', 'data/smiski.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'tiny-trove-photos' && k !== 'tiny-trove-fonts').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: keep a copy so the handwriting font works offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('tiny-trove-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Photos from the photos/ folder: use the network when online, fall back to a saved copy.
  if (url.pathname.includes('/photos/')) {
    e.respondWith(caches.open('tiny-trove-photos').then(async c => {
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch (err) {
        return (await c.match(req)) || new Response('', { status: 404 });
      }
    }));
    return;
  }

  // App files: saved copy first, refreshed in the background.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || c.match('index.html');
  }));
});
