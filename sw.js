/* Mosquito Slayer service worker: offline-first.
   Bump V whenever any file changes so installed copies refresh. */
const V = 'ms-v16';
const CORE = [
  './', 'index.html', 'styles.css', 'game.js', 'manifest.webmanifest',
  'assets/mosquito.png',
  'assets/faces/main.png', 'assets/faces/bite.png', 'assets/faces/sticker.png',
  'assets/sounds/sounds-data.js',
  'assets/sounds/mosquito-loop.mp3', 'assets/sounds/fire.mp3',
  'assets/sounds/game-over.mp3', 'assets/sounds/high-score.mp3',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png'
];

// Install only succeeds if EVERYTHING is cached, so "installed" always means "works offline".
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Safari asks media files for byte ranges; answer them from the cached copy.
async function rangeResponse(req, res) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m || !res || res.status !== 200) return res;
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  let start = m[1] === '' ? Math.max(0, size - parseInt(m[2], 10)) : parseInt(m[1], 10);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1)
    }
  });
}

// Cache first (instant + offline), refresh quietly in the background when online.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(V);
    const isNav = req.mode === 'navigate';
    const hit = await cache.match(isNav ? 'index.html' : req, { ignoreSearch: true });

    const refresh = fetch(req).then(res => {
      if (res && res.ok && res.status === 200 && !req.headers.get('range')) {
        cache.put(isNav ? 'index.html' : req, res.clone());
      }
      return res;
    }).catch(() => null);

    if (hit) {
      e.waitUntil(refresh);
      return req.headers.get('range') ? rangeResponse(req, hit) : hit;
    }
    const res = await refresh;
    if (res) return res;
    return isNav ? cache.match('index.html') : new Response('', { status: 504, statusText: 'Offline' });
  })());
});
