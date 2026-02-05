const CACHE_VERSION = 'v6';
const STATIC_CACHE = `baytides-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `baytides-dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = `baytides-images-${CACHE_VERSION}`;

// Static assets to precache
const STATIC_ASSETS = [
  '/',
  '/about',
  '/projects',
  '/volunteer',
  '/events',
  '/donate',
  '/contact',
  '/privacy',
  '/terms',
  '/accessibility',
  '/aegis',
  '/offline',
  '/assets/images/logo.webp',
  '/assets/images/favicon.png',
  '/assets/images/pwa/icon-192x192.png',
  '/assets/images/pwa/icon-512x512.png',
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

    // Start the fetch in the background
    const fetchPromise = fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const responseToCache = response.clone();
          const cache = await caches.open(cacheName);
          await cache.put(request, responseToCache);
          trimCache(cacheName, MAX_DYNAMIC_ITEMS);
        }
        return response;
      })
      .catch(() => null);

    // If we have a cached response, return it immediately
    // The fetch continues in the background to update the cache
    if (cached) {
      return cached;
    }

    // No cache, wait for the network
    return fetchPromise;
  },
};

// ============================================================================
// Offline Form Queue System
// ============================================================================

// Store form submission in IndexedDB for later sync
async function queueFormSubmission(request) {
  const formData = await request.clone().formData();
  const data = {};
  formData.forEach((value, key) => {
    data[key] = value;
  });

  const queuedForm = {
    id: Date.now().toString(),
    url: request.url,
    method: request.method,
    data: data,
    timestamp: new Date().toISOString(),
    headers: Object.fromEntries(request.headers.entries()),
  };

  // Store in IndexedDB
  return new Promise((resolve, reject) => {
    const dbRequest = self.indexedDB.open('BayTidesOffline', 1);

    dbRequest.onerror = () => reject(dbRequest.error);

    dbRequest.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('formQueue')) {
        db.createObjectStore('formQueue', { keyPath: 'id' });
      }
    };

    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction('formQueue', 'readwrite');
      const store = tx.objectStore('formQueue');
      store.add(queuedForm);
      tx.oncomplete = () => {
        resolve(queuedForm);
        // Notify clients about the queued form
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: 'FORM_QUEUED',
              form: queuedForm,
            });
          });
        });
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

// Get all queued form submissions
async function getQueuedForms() {
  return new Promise((resolve, reject) => {
    const dbRequest = self.indexedDB.open('BayTidesOffline', 1);

    dbRequest.onerror = () => reject(dbRequest.error);

    dbRequest.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('formQueue')) {
        db.createObjectStore('formQueue', { keyPath: 'id' });
      }
    };

    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction('formQueue', 'readonly');
      const store = tx.objectStore('formQueue');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

// Remove a queued form after successful submission
async function removeQueuedForm(id) {
  return new Promise((resolve, reject) => {
    const dbRequest = self.indexedDB.open('BayTidesOffline', 1);

    dbRequest.onerror = () => reject(dbRequest.error);

    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction('formQueue', 'readwrite');
      const store = tx.objectStore('formQueue');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

// Process queued forms when online
async function processQueuedForms() {
  const queuedForms = await getQueuedForms();

  for (const form of queuedForms) {
    try {
      const formData = new self.FormData();
      Object.entries(form.data).forEach(([key, value]) => {
        formData.append(key, value);
      });

      const response = await fetch(form.url, {
        method: form.method,
        body: formData,
      });

      if (response.ok) {
        await removeQueuedForm(form.id);
        // Notify clients about successful sync
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: 'FORM_SYNCED',
              form: form,
            });
          });
        });
      }
    } catch (syncError) {
      console.error('Failed to sync form:', form.id, syncError);
    }
  }
}

// Background Sync for form submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'form-sync') {
    event.waitUntil(processQueuedForms());
  }
});

// Periodic sync for browsers that support it
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'form-sync') {
    event.waitUntil(processQueuedForms());
  }
});

// ============================================================================
// Fetch Handler
// ============================================================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle form submissions (POST requests to form endpoints)
  if (request.method === 'POST' && isFormEndpoint(url)) {
    event.respondWith(handleFormSubmission(request));
    return;
  }

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip external requests
  if (url.origin !== location.origin) return;

  // Skip API calls (but not form endpoints which are handled above)
  if (url.pathname.includes('/api/')) return;

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

      // Fallback for navigation requests - show offline page
      if (request.mode === 'navigate') {
        return caches.match('/offline') || caches.match('/');
      }

      return new Response('Offline', { status: 503 });
    })
  );
});

// Check if URL is a form submission endpoint
function isFormEndpoint(url) {
  const formEndpoints = [
    '/api/volunteer',
    '/api/contact',
    '/api/donate',
    '/api/newsletter',
    'forms.baytides.org',
  ];
  return formEndpoints.some(
    (endpoint) => url.pathname.includes(endpoint) || url.hostname.includes(endpoint)
  );
}

// Handle form submissions with offline support
async function handleFormSubmission(request) {
  try {
    // Try to submit the form online first
    const response = await fetch(request.clone());
    return response;
  } catch {
    // Network error - queue the form for later
    try {
      const queuedForm = await queueFormSubmission(request);

      // Register for background sync if available
      if ('sync' in self.registration) {
        await self.registration.sync.register('form-sync');
      }

      // Return a custom response indicating the form was queued
      return new Response(
        JSON.stringify({
          success: true,
          queued: true,
          message:
            "You appear to be offline. Your submission has been saved and will be sent automatically when you're back online.",
          id: queuedForm.id,
        }),
        {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } catch {
      // Failed to queue - return error
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Unable to submit form while offline. Please try again when connected.',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  }
}

// ============================================================================
// Message Handler
// ============================================================================

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  if (event.data === 'getQueuedForms') {
    getQueuedForms().then((forms) => {
      event.source.postMessage({
        type: 'QUEUED_FORMS',
        forms: forms,
      });
    });
  }

  if (event.data === 'processQueue') {
    processQueuedForms();
  }
});

// Listen for online event to process queue
self.addEventListener('online', () => {
  processQueuedForms();
});
