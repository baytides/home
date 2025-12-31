const CACHE_VERSION = 'v2';
const STATIC_CACHE = `baytides-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `baytides-dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = `baytides-images-${CACHE_VERSION}`;

// Static assets to precache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/about.html',
  '/projects.html',
  '/volunteer.html',
  '/donate.html',
  '/contact.html',
  '/privacy.html',
  '/terms.html',
  '/404.html',
  '/assets/css/style.css',
  '/assets/js/main.js',
  '/assets/images/logo.webp',
  '/assets/images/favicon.png',
  '/partials/header.html',
  '/partials/footer.html',
];

// Images to precache
const IMAGE_ASSETS = ['/assets/images/hero-bg.webp', '/assets/images/egret.webp'];

// Max items in dynamic cache
const MAX_DYNAMIC_ITEMS = 50;

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
      caches.open(IMAGE_CACHE).then((cache) => cache.addAll(IMAGE_ASSETS)),
    ]).then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.filter((key) => !validCaches.includes(key)).map((key) => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Trim cache to max size
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}

// Cache strategies
const strategies = {
  // Cache first, fallback to network (for static assets)
  cacheFirst: async (request, cacheName) => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return null;
    }
  },

  // Network first, fallback to cache (for HTML pages)
  networkFirst: async (request, cacheName) => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      return cached || null;
    }
  },

  // Stale while revalidate (for dynamic content)
  staleWhileRevalidate: async (request, cacheName) => {
    const cached = await caches.match(request);
    const fetchPromise = fetch(request)
      .then((response) => {
        if (response.ok) {
          caches.open(cacheName).then((cache) => {
            cache.put(request, response.clone());
            trimCache(cacheName, MAX_DYNAMIC_ITEMS);
          });
        }
        return response;
      })
      .catch(() => null);

    return cached || fetchPromise;
  },
};

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip external requests
  if (url.origin !== location.origin) return;

  // Skip form handler and API calls
  if (url.pathname.includes('/api/') || url.hostname === 'forms.baytides.org') return;

  // Determine caching strategy based on request type
  let responsePromise;

  if (
    request.destination === 'image' ||
    url.pathname.match(/\.(webp|jpg|jpeg|png|gif|svg|ico)$/i)
  ) {
    // Images: Cache first
    responsePromise = strategies.cacheFirst(request, IMAGE_CACHE);
  } else if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    url.pathname.match(/\.(css|js)$/i)
  ) {
    // CSS/JS: Stale while revalidate
    responsePromise = strategies.staleWhileRevalidate(request, STATIC_CACHE);
  } else if (
    request.mode === 'navigate' ||
    url.pathname.match(/\.html$/i) ||
    url.pathname === '/'
  ) {
    // HTML pages: Network first
    responsePromise = strategies.networkFirst(request, DYNAMIC_CACHE);
  } else {
    // Everything else: Stale while revalidate
    responsePromise = strategies.staleWhileRevalidate(request, DYNAMIC_CACHE);
  }

  event.respondWith(
    responsePromise.then((response) => {
      if (response) return response;

      // Fallback for navigation requests
      if (request.mode === 'navigate') {
        return caches.match('/404.html') || caches.match('/');
      }

      return new Response('Offline', { status: 503 });
    })
  );
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
