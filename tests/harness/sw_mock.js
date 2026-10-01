/**
 * Service Worker, CacheStorage, and PWA Lifecycle Mock
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MockCache {
    constructor(name) {
        this.name = name;
        this.entries = new Map();
    }

    async add(request) {
        const url = typeof request === 'string' ? request : request.url;
        this.entries.set(url, { url, status: 200, ok: true, text: async () => 'mock-content' });
    }

    async addAll(requests) {
        for (const req of requests) {
            await this.add(req);
        }
    }

    async put(request, response) {
        const url = typeof request === 'string' ? request : request.url;
        this.entries.set(url, response);
    }

    async match(request) {
        const url = typeof request === 'string' ? request : request.url;
        // Direct match
        if (this.entries.has(url)) return this.entries.get(url);
        // Prefix / substring match for REST queries
        for (const [key, val] of this.entries.entries()) {
            if (url.includes(key) || key.includes(url)) return val;
        }
        return null;
    }

    async keys() {
        return Array.from(this.entries.keys());
    }
}

class MockCacheStorage {
    constructor() {
        this.caches = new Map();
    }

    async open(name) {
        if (!this.caches.has(name)) {
            this.caches.set(name, new MockCache(name));
        }
        return this.caches.get(name);
    }

    async match(request) {
        for (const cache of this.caches.values()) {
            const match = await cache.match(request);
            if (match) return match;
        }
        return null;
    }

    async has(name) {
        return this.caches.has(name);
    }

    async delete(name) {
        return this.caches.delete(name);
    }

    async keys() {
        return Array.from(this.caches.keys());
    }
}

function createServiceWorkerMock() {
    const cacheStorage = new MockCacheStorage();
    const registrations = [];

    const serviceWorker = {
        async register(scriptURL, options = {}) {
            const reg = {
                scriptURL,
                scope: options.scope || '/',
                active: { state: 'activated' },
                installing: null,
                waiting: null
            };
            registrations.push(reg);
            return reg;
        },
        get ready() {
            return Promise.resolve(registrations[0] || null);
        },
        addEventListener: () => {},
        removeEventListener: () => {}
    };

    /**
     * Executes sw.js in an isolated ServiceWorkerGlobalScope
     */
    function loadServiceWorkerFile(swPath) {
        const resolvedPath = swPath || path.resolve(__dirname, '../../dashboard/sw.js');
        if (!fs.existsSync(resolvedPath)) {
            return { exists: false, error: 'File not found' };
        }

        const swCode = fs.readFileSync(resolvedPath, 'utf8');
        const listeners = {
            install: [],
            activate: [],
            fetch: []
        };

        const swScope = {
            caches: cacheStorage,
            addEventListener: (event, fn) => {
                if (listeners[event]) listeners[event].push(fn);
            },
            skipWaiting: async () => {},
            clients: {
                claim: async () => {}
            },
            fetch: async (req) => {
                return { status: 200, ok: true, clone: () => ({ status: 200 }) };
            },
            console: {
                log: () => {},
                warn: () => {},
                error: () => {}
            },
            URL: URL,
            Response: typeof Response !== 'undefined' ? Response : class MockResponse {
                constructor(body, init = {}) {
                    this._body = body;
                    this.status = init.status || 200;
                    this.statusText = init.statusText || 'OK';
                    this.ok = this.status >= 200 && this.status < 300;
                    this.headers = new Map(Object.entries((init.headers || {})));
                    this.type = 'basic';
                }
                clone() { return new MockResponse(this._body, { status: this.status, statusText: this.statusText, headers: Object.fromEntries(this.headers) }); }
                async text() { return typeof this._body === 'string' ? this._body : JSON.stringify(this._body); }
                async json() { return typeof this._body === 'string' ? JSON.parse(this._body) : this._body; }
            },
            Request: typeof Request !== 'undefined' ? Request : class MockRequest {
                constructor(url, init = {}) {
                    this.url = url;
                    this.method = init.method || 'GET';
                    this.mode = init.mode || 'cors';
                }
            },
            Headers: typeof Headers !== 'undefined' ? Headers : Map,
            JSON: JSON,
            Promise: Promise
        };

        swScope.self = swScope;
        vm.createContext(swScope);
        vm.runInContext(swCode, swScope);

        return {
            exists: true,
            listeners,
            caches: cacheStorage,
            async triggerInstall() {
                const waitPromises = [];
                const event = {
                    waitUntil: (p) => waitPromises.push(p)
                };
                for (const fn of listeners.install) {
                    fn(event);
                }
                await Promise.all(waitPromises);
            },
            async triggerFetch(request) {
                let responsePromise = null;
                const event = {
                    request: typeof request === 'string' ? { url: request, method: 'GET' } : request,
                    respondWith: (p) => {
                        responsePromise = p;
                    }
                };
                for (const fn of listeners.fetch) {
                    fn(event);
                    if (responsePromise) break;
                }
                return responsePromise ? await responsePromise : null;
            }
        };
    }

    return {
        serviceWorker,
        cacheStorage,
        registrations,
        loadServiceWorkerFile
    };
}

module.exports = {
    MockCache,
    MockCacheStorage,
    createServiceWorkerMock
};
