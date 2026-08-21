// WorkTalk service worker: network first, cache fallback.
// Updates arrive immediately when online; the app still opens offline.

const CACHE = 'worktalk-v14';

const CORE = [
  '.',
  'index.html',
  'app.js',
  'decks.json',
  'mistakes.json',
  'dialogues.json',
  'grammar.json',
  'placement.html',
  'placement.js',
  'placement.json',
  'enrich.json',
  'words.json',
  'exercises.json',
  'words-marketing.json',
  'exercises-marketing.json',
  'words-finance.json',
  'exercises-finance.json',
  'words-sport.json',
  'exercises-sport.json',
  'words-business.json',
  'exercises-business.json',
  'words-legal.json',
  'exercises-legal.json',
  'words-healthcare.json',
  'exercises-healthcare.json',
  'words-technical.json',
  'exercises-technical.json',
  'words-hospitality.json',
  'exercises-hospitality.json',
  'readings-workplace.json',
  'readings-marketing.json',
  'readings-finance.json',
  'readings-sport.json',
  'readings-business.json',
  'readings-legal.json',
  'readings-healthcare.json',
  'readings-technical.json',
  'readings-hospitality.json',
  'words-hr.json', 'exercises-hr.json', 'readings-hr.json',
  'words-sales.json', 'exercises-sales.json', 'readings-sales.json',
  'words-accounting.json', 'exercises-accounting.json', 'readings-accounting.json',
  'words-administration.json', 'exercises-administration.json', 'readings-administration.json',
  'words-it.json', 'exercises-it.json', 'readings-it.json',
  'words-customerservice.json', 'exercises-customerservice.json', 'readings-customerservice.json',
  'words-nutrition.json', 'exercises-nutrition.json', 'readings-nutrition.json',
  'words-lifestyle.json', 'exercises-lifestyle.json', 'readings-lifestyle.json',
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
  // Push traffic must always go to the network, never to our cache
  if (/onesignal|\/push\//i.test(e.request.url)) return;
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
