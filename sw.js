// WorkTalk service worker: network first, cache fallback.
// Updates arrive immediately when online; the app still opens offline.

const CACHE = 'worktalk-v1';

const CORE = [
  '.',
  'index.html',
  'app.js',
  'decks.json',
  'words.json',
  'exercises.json',
  'words-marketing.json',
  'exercises-marketing.json',
  'manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Keep a fresh copy for offline use (incl. the Tailwind CDN and fonts)
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
