/**
 * Small, dependency-free helpers shared across the extension.
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Clamp to [0, 1]. */
export function unit(value) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

/**
 * Debounce with an optional `maxWait` so that a continuous stream of calls
 * (e.g. an infinite-scroll feed mutating constantly) still flushes regularly.
 */
export function debounce(fn, wait, { maxWait = 0 } = {}) {
  let timer = null;
  let firstCallAt = 0;
  let lastArgs = null;

  const invoke = () => {
    timer = null;
    firstCallAt = 0;
    const args = lastArgs;
    lastArgs = null;
    fn(...args);
  };

  const debounced = (...args) => {
    lastArgs = args;
    const now = Date.now();
    if (!firstCallAt) firstCallAt = now;
    if (timer) clearTimeout(timer);
    const elapsed = now - firstCallAt;
    const delay = maxWait > 0 ? Math.max(0, Math.min(wait, maxWait - elapsed)) : wait;
    timer = setTimeout(invoke, delay);
  };

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    firstCallAt = 0;
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
  };

  return debounced;
}

/** Leading + trailing throttle. */
export function throttle(fn, interval) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;

  const throttled = (...args) => {
    const now = Date.now();
    const remaining = interval - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      pendingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          const a = pendingArgs;
          pendingArgs = null;
          fn(...a);
        }, remaining);
      }
    }
  };

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  return throttled;
}

/**
 * Resolve on the next idle period. Falls back to setTimeout where
 * requestIdleCallback is unavailable (jsdom, older browsers).
 * The resolved value always exposes `timeRemaining()` and `didTimeout`.
 */
export function nextIdle(timeout = 1000) {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(resolve, { timeout });
    } else {
      const start = Date.now();
      setTimeout(() => {
        resolve({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 12 - (Date.now() - start)),
        });
      }, 1);
    }
  });
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fast non-cryptographic 32-bit FNV-1a hash, returned as base-36 string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + str.length.toString(36);
}

export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalise a user-entered domain (or URL) to a bare lowercase hostname.
 * Returns '' when the value is not a plausible hostname.
 *   "https://www.Reddit.com/r/foo" -> "reddit.com"
 *   "*.example.co.uk"               -> "example.co.uk"
 */
export function normalizeDomain(input) {
  if (typeof input !== 'string') return '';
  let value = input.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  value = value.replace(/^[^@/]*@/, ''); // credentials
  value = value.split(/[/?#]/)[0]; // path/query/fragment
  value = value.replace(/:\d+$/, ''); // port
  value = value.replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
  if (value === 'localhost') return value;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value; // IPv4
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)) {
    return '';
  }
  return value;
}

/** Hostname of the current page with a leading "www." removed. */
export function normalizeHostname(hostname) {
  return String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

/** True if `hostname` equals `domain` or is a subdomain of it. */
export function hostnameMatches(hostname, domain) {
  const host = normalizeHostname(hostname);
  const d = normalizeDomain(domain);
  if (!host || !d) return false;
  return host === d || host.endsWith('.' + d);
}

/** Tiny bounded LRU cache built on Map insertion order. */
export class LRUCache {
  constructor(limit = 1000) {
    this.limit = limit;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      this.map.delete(this.map.keys().next().value);
    }
    return this;
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
