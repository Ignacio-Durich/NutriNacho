/**
 * Headless DOM Environment & Sandboxed Execution Harness for NutriNacho
 * Zero-dependency DOM emulator with node:vm execution.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createSupabaseMock } = require('./supabase_mock');
const { createChartMock } = require('./chart_mock');
const { createServiceWorkerMock } = require('./sw_mock');

class DOMElement {
    constructor(tagName = 'div', attributes = {}) {
        this.tagName = tagName.toUpperCase();
        this.id = attributes.id || '';
        this.attributes = { ...attributes };
        this._classList = new Set(
            (attributes.class || '').split(/\s+/).filter(Boolean)
        );
        this.style = {};
        this.children = [];
        this.parentNode = null;
        this._textContent = '';
        this._innerHTML = '';
        this.value = attributes.value || '';
        this.disabled = false;
        this.onclick = null;
        this.eventListeners = {};
    }

    get className() {
        return Array.from(this._classList).join(' ');
    }

    set className(val) {
        this._classList = new Set((val || '').split(/\s+/).filter(Boolean));
    }

    get classList() {
        const self = this;
        return {
            add(...tokens) {
                tokens.forEach(t => t && self._classList.add(t));
            },
            remove(...tokens) {
                tokens.forEach(t => self._classList.delete(t));
            },
            contains(token) {
                return self._classList.has(token);
            },
            toggle(token, force) {
                if (force !== undefined) {
                    if (force) self._classList.add(token);
                    else self._classList.delete(token);
                    return force;
                }
                if (self._classList.has(token)) {
                    self._classList.delete(token);
                    return false;
                }
                self._classList.add(token);
                return true;
            }
        };
    }

    get textContent() {
        if (this.children.length === 0) return this._textContent;
        return this.children.map(c => c.textContent).join('');
    }

    set textContent(val) {
        this._textContent = String(val ?? '');
        this._innerHTML = String(val ?? '');
        this.children = [];
    }

    get innerHTML() {
        return this._innerHTML || this._textContent;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this._textContent = html.replace(/<[^>]*>/g, '');
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    setAttribute(name, val) {
        this.attributes[name] = String(val);
        if (name === 'id') this.id = String(val);
        if (name === 'class') this.className = String(val);
    }

    removeAttribute(name) {
        delete this.attributes[name];
        if (name === 'id') this.id = '';
        if (name === 'class') this.className = '';
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    addEventListener(event, fn) {
        if (!this.eventListeners[event]) this.eventListeners[event] = [];
        this.eventListeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.eventListeners[event]) return;
        this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== fn);
    }

    dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        const listeners = this.eventListeners[type] || [];
        listeners.forEach(fn => fn.call(this, event));
        if (type === 'click' && typeof this.onclick === 'function') {
            this.onclick.call(this, event);
        }
    }

    click() {
        this.dispatchEvent({ type: 'click', target: this });
    }

    querySelectorAll(selector) {
        const collectDescendants = (node) => {
            const list = [];
            for (const child of node.children) {
                list.push(child);
                list.push(...collectDescendants(child));
            }
            return list;
        };
        const descendants = collectDescendants(this);
        const subDoc = new DOMDocument();
        subDoc.allElements = descendants;
        for (const el of descendants) {
            if (el.id) subDoc.elementsById.set(el.id, el);
        }
        return subDoc.querySelectorAll(selector);
    }

    querySelector(selector) {
        const all = this.querySelectorAll(selector);
        return all.length > 0 ? all[0] : null;
    }

    getContext(type) {
        return {
            canvas: this,
            fillRect: () => {},
            clearRect: () => {},
            getImageData: () => {},
            putImageData: () => {},
            createImageData: () => {},
            setTransform: () => {},
            drawImage: () => {},
            save: () => {},
            fillText: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            closePath: () => {},
            stroke: () => {},
            translate: () => {},
            scale: () => {},
            rotate: () => {},
            arc: () => {},
            fill: () => {},
            measureText: (text) => ({ width: text.length * 6 })
        };
    }
}

class DOMDocument {
    constructor() {
        this.elementsById = new Map();
        this.allElements = [];
        this.documentElement = new DOMElement('html');
        this.body = new DOMElement('body');
        this.documentElement.appendChild(this.body);
        this.eventListeners = {};
    }

    registerElement(el) {
        this.allElements.push(el);
        if (el.id) {
            this.elementsById.set(el.id, el);
        }
        el.children.forEach(c => this.registerElement(c));
    }

    getElementById(id) {
        return this.elementsById.get(id) || null;
    }

    createElement(tag) {
        const el = new DOMElement(tag);
        this.allElements.push(el);
        return el;
    }

    querySelectorAll(selector) {
        if (!selector) return [];

        // Support comma-separated selectors (e.g. '[id^="pop-"], [class*="pop-delta"]')
        if (selector.includes(',')) {
            const subSelectors = selector.split(',').map(s => s.trim()).filter(Boolean);
            const resultSet = new Set();
            for (const sub of subSelectors) {
                const elements = this.querySelectorAll(sub);
                for (const el of elements) {
                    resultSet.add(el);
                }
            }
            return Array.from(resultSet);
        }

        const trimmed = selector.trim();
        if (!trimmed) return [];

        // Match .className
        if (trimmed.startsWith('.')) {
            const cls = trimmed.slice(1);
            const results = [];
            for (const el of this.allElements) {
                if (el.classList.contains(cls)) results.push(el);
            }
            return results;
        }

        // Match #id
        if (trimmed.startsWith('#') && !trimmed.includes(' ')) {
            const el = this.getElementById(trimmed.slice(1));
            return el ? [el] : [];
        }

        // Match attribute selectors: [attr], [attr=val], [attr^=val], [attr*=val], [attr$=val]
        const attrMatch = trimmed.match(/^\[([a-zA-Z0-9\-_:]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/);
        if (attrMatch) {
            const attrName = attrMatch[1];
            const op = attrMatch[2] || '';
            const targetVal = attrMatch[3] !== undefined ? attrMatch[3] :
                              attrMatch[4] !== undefined ? attrMatch[4] :
                              attrMatch[5] !== undefined ? attrMatch[5] : null;

            const results = [];
            for (const el of this.allElements) {
                let val;
                if (attrName === 'class') {
                    val = el.className;
                } else if (attrName === 'id') {
                    val = el.id || (el.getAttribute ? el.getAttribute('id') : el.attributes?.id);
                } else {
                    val = el.getAttribute ? el.getAttribute(attrName) : (el.attributes ? el.attributes[attrName] : null);
                }

                if (val === undefined || val === null) continue;
                val = String(val);

                if (!op) {
                    results.push(el);
                } else if (op === '=') {
                    if (val === targetVal) results.push(el);
                } else if (op === '^=') {
                    if (val.startsWith(targetVal)) results.push(el);
                } else if (op === '*=') {
                    if (val.includes(targetVal)) results.push(el);
                } else if (op === '$=') {
                    if (val.endsWith(targetVal)) results.push(el);
                }
            }
            return results;
        }

        // Match descendant selector if present (e.g. '#meals-body tr' or '#best-day-card .day-date')
        if (trimmed.includes(' ')) {
            const parts = trimmed.split(/\s+/).filter(Boolean);
            if (parts.length > 1) {
                const parents = this.querySelectorAll(parts[0]);
                const results = [];
                for (const parent of parents) {
                    const collectDescendants = (node) => {
                        const list = [];
                        for (const child of node.children) {
                            list.push(child);
                            list.push(...collectDescendants(child));
                        }
                        return list;
                    };
                    const descendants = collectDescendants(parent);
                    const subDoc = new DOMDocument();
                    subDoc.allElements = descendants;
                    for (const d of descendants) {
                        if (d.id) subDoc.elementsById.set(d.id, d);
                    }
                    results.push(...subDoc.querySelectorAll(parts.slice(1).join(' ')));
                }
                return results;
            }
        }

        // Match tag
        const tag = trimmed.toUpperCase();
        const results = [];
        for (const el of this.allElements) {
            if (el.tagName === tag) results.push(el);
        }
        return results;
    }

    querySelector(selector) {
        const all = this.querySelectorAll(selector);
        return all.length > 0 ? all[0] : null;
    }

    addEventListener(event, fn) {
        if (!this.eventListeners[event]) this.eventListeners[event] = [];
        this.eventListeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.eventListeners[event]) return;
        this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== fn);
    }

    dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        (this.eventListeners[type] || []).forEach(fn => fn(event));
    }
}

/**
 * Lightweight HTML parser to populate the DOMDocument
 */
function parseHTMLIntoDocument(html) {
    const doc = new DOMDocument();
    
    // Tag regex capturing tags with attributes
    const tagRegex = /<([a-zA-Z0-9\-]+)([^>]*)>/g;
    let match;
    
    // Extract elements and register IDs / classes
    while ((match = tagRegex.exec(html)) !== null) {
        const tagName = match[1].toLowerCase();
        if (tagName === 'script' || tagName === 'style' || tagName === 'meta' || tagName === 'link') continue;
        
        const attrStr = match[2];
        const attributes = {};
        
        const attrRegex = /([a-zA-Z0-9\-:@]+)(?:=(?:'([^']*)'|"([^"]*)"|([^>\s]+)))?/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
            const key = attrMatch[1];
            const val = attrMatch[2] !== undefined ? attrMatch[2] :
                        attrMatch[3] !== undefined ? attrMatch[3] :
                        attrMatch[4] !== undefined ? attrMatch[4] : '';
            attributes[key] = val;
        }

        const el = new DOMElement(tagName, attributes);
        doc.registerElement(el);
    }

    return doc;
}

/**
 * Creates and initializes the test environment for dashboard/index.html
 */
function createNutriNachoEnvironment(options = {}) {
    const htmlPath = options.htmlPath || path.resolve(__dirname, '../../dashboard/index.html');
    const rawHTML = fs.readFileSync(htmlPath, 'utf8');

    // Parse DOM
    const document = parseHTMLIntoDocument(rawHTML);

    // Mocks
    const supabaseMock = createSupabaseMock(options.supabase || {});
    const chartMock = createChartMock();
    const swMock = createServiceWorkerMock();

    // In-memory Storage
    const storageStore = new Map();
    const localStorageMock = {
        getItem: (k) => storageStore.get(k) || null,
        setItem: (k, v) => storageStore.set(k, String(v)),
        removeItem: (k) => storageStore.delete(k),
        clear: () => storageStore.clear()
    };

    // Navigator Mock
    let isOnline = options.online !== undefined ? options.online : true;
    const navigatorMock = {
        get onLine() { return isOnline; },
        set onLine(val) { isOnline = Boolean(val); },
        serviceWorker: swMock.serviceWorker
    };

    // Object URL & Blob Mock
    const createdBlobs = [];
    const urlMock = {
        createObjectURL: (blob) => {
            const id = `blob:nutrinacho-${Math.random().toString(36).substring(2)}`;
            createdBlobs.push({ id, blob });
            return id;
        },
        revokeObjectURL: (id) => {
            const idx = createdBlobs.findIndex(b => b.id === id);
            if (idx !== -1) createdBlobs.splice(idx, 1);
        }
    };

    // Window object
    const windowListeners = {};
    const windowMock = {
        document,
        navigator: navigatorMock,
        localStorage: localStorageMock,
        location: { href: 'http://localhost:8080/', reload: () => {} },
        addEventListener: (event, fn) => {
            if (!windowListeners[event]) windowListeners[event] = [];
            windowListeners[event].push(fn);
        },
        removeEventListener: (event, fn) => {
            if (!windowListeners[event]) return;
            windowListeners[event] = windowListeners[event].filter(cb => cb !== fn);
        },
        dispatchEvent: (event) => {
            const type = typeof event === 'string' ? event : event.type;
            (windowListeners[type] || []).forEach(fn => fn(event));
        },
        URL: urlMock,
        Blob: typeof Blob !== 'undefined' ? Blob : class MockBlob {
            constructor(parts, opts = {}) {
                this.parts = parts;
                this.type = opts.type || '';
                this.size = parts.reduce((acc, p) => acc + (typeof p === 'string' ? p.length : (p.byteLength || 0)), 0);
            }
            async text() {
                return this.parts.join('');
            }
        }
    };

    // Extract embedded <script> tags from index.html
    const scriptMatches = rawHTML.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) || [];
    let scriptCode = '';
    scriptMatches.forEach(tag => {
        const code = tag.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
        scriptCode += '\n' + code;
    });

    const activeTimers = [];

    // Provide default globals to sandbox
    const sandbox = {
        window: windowMock,
        document,
        navigator: navigatorMock,
        localStorage: localStorageMock,
        supabase: supabaseMock.clientFactory,
        Chart: chartMock.Chart,
        URL: urlMock,
        Blob: windowMock.Blob,
        console: options.silent ? {
            log: () => {},
            warn: () => {},
            error: () => {},
            info: () => {}
        } : console,
        setTimeout: (fn, ms) => {
            const t = setTimeout(fn, ms);
            if (t.unref) t.unref();
            activeTimers.push(t);
            return t;
        },
        clearTimeout,
        setInterval: (fn, ms) => {
            // Unref interval timer by default so it never hangs test runner process
            const t = setInterval(fn, ms);
            if (t.unref) t.unref();
            activeTimers.push(t);
            return t;
        },
        clearInterval: (id) => {
            clearInterval(id);
            const idx = activeTimers.indexOf(id);
            if (idx !== -1) activeTimers.splice(idx, 1);
        },
        Date,
        Math,
        JSON,
        String,
        Number,
        Array,
        Object,
        Promise,
        Boolean,
        RegExp,
        Error,
        TypeError,
        parseInt,
        parseFloat,
        isNaN,
        isFinite
    };

    vm.createContext(sandbox);

    return {
        sandbox,
        document,
        window: windowMock,
        windowListeners,
        rawHTML,
        scriptCode,
        supabaseMock,
        chartMock,
        swMock,
        createdBlobs,
        activeTimers,
        setOnline(status) {
            isOnline = Boolean(status);
            windowMock.dispatchEvent({ type: status ? 'online' : 'offline' });
        },
        runScript() {
            vm.runInContext(scriptCode, sandbox);
            return sandbox;
        },
        getGlobal(name) {
            try {
                return vm.runInContext(name, sandbox);
            } catch (e) {
                return undefined;
            }
        },
        eval(expr) {
            return vm.runInContext(expr, sandbox);
        },
        cleanup() {
            activeTimers.forEach(t => {
                try { clearInterval(t); clearTimeout(t); } catch (e) {}
            });
            activeTimers.length = 0;
        }
    };
}

module.exports = {
    DOMElement,
    DOMDocument,
    parseHTMLIntoDocument,
    createNutriNachoEnvironment
};
