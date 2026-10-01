// NutriNacho Service Worker v1.0
const CACHE_NAME = 'nutrinacho-v2';
const API_CACHE = 'nutrinacho-api-v1';

// App shell resources to cache on install
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/chart.js@4',
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

// Install: cache app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Caching app shell');
            return cache.addAll(SHELL_ASSETS).catch(err => {
                // If some CDN resources fail, don't block install
                console.warn('[SW] Some shell assets failed to cache:', err);
                // Cache what we can individually
                return Promise.allSettled(
                    SHELL_ASSETS.map(url => cache.add(url).catch(() => console.warn('[SW] Failed:', url)))
                );
            });
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME && k !== API_CACHE)
                    .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch: different strategies for different requests
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Strategy for Supabase API calls: Network-first, cache fallback
    if (url.hostname.includes('supabase.co')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Clone and cache successful API responses
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(API_CACHE).then(cache => {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Offline: serve from API cache
                    return caches.match(event.request).then(cached => {
                        if (cached) return cached;
                        // Return empty JSON array as last resort (supabase-js expects raw PostgREST body)
                        return new Response(JSON.stringify([]), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    });
                })
        );
        return;
    }

    // Strategy for Gemini API calls: Network-only (don't cache AI responses)
    if (url.hostname.includes('generativelanguage.googleapis.com')) {
        return; // Let browser handle normally
    }

    // Strategy for navigations & index.html: Network-first, cache fallback
    // This ensures users always get the latest HTML after a new SW activates.
    if (event.request.mode === 'navigate' || url.pathname === '/index.html' || url.pathname.endsWith('/index.html') || url.pathname === '/') {
        event.respondWith(
            fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    return caches.match('/index.html');
                });
            })
        );
        return;
    }

    // Strategy for static assets & CDN: Cache-first, network fallback
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                // Cache new resources (fonts, etc.)
                if (response.ok && (url.origin === self.location.origin || url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('cdn.tailwindcss.com'))) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                return new Response('Offline', { status: 503, statusText: 'Offline' });
            });
        })
    );
});
