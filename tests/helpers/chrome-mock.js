/**
 * Minimal in-memory chrome.* mock covering what the extension uses.
 */
export function createChromeMock(initial = {}) {
  const data = { ...initial };
  const storageListeners = new Set();
  const messageListeners = new Set();
  const sent = [];

  const storageArea = {
    get(keys, cb) {
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
      if (cb) {
        queueMicrotask(() => cb(out));
        return undefined;
      }
      return Promise.resolve(out);
    },
    set(items, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      queueMicrotask(() => {
        for (const l of storageListeners) l(changes, 'sync');
        cb && cb();
      });
      return cb ? undefined : Promise.resolve();
    },
    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const k of list) {
        if (k in data) {
          changes[k] = { oldValue: data[k], newValue: undefined };
          delete data[k];
        }
      }
      queueMicrotask(() => {
        if (Object.keys(changes).length) for (const l of storageListeners) l(changes, 'sync');
        cb && cb();
      });
      return cb ? undefined : Promise.resolve();
    },
  };

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      onMessage: {
        addListener: (fn) => messageListeners.add(fn),
        removeListener: (fn) => messageListeners.delete(fn),
      },
      sendMessage(msg) {
        sent.push(msg);
        return Promise.resolve();
      },
    },
    storage: {
      sync: storageArea,
      onChanged: {
        addListener: (fn) => storageListeners.add(fn),
        removeListener: (fn) => storageListeners.delete(fn),
      },
    },
  };

  /** Deliver a message as if the popup sent it; resolves with the response. */
  chrome.__dispatch = (msg) =>
    new Promise((resolve) => {
      let responded = false;
      for (const l of messageListeners) {
        l(msg, { id: 'test-extension-id' }, (r) => {
          responded = true;
          resolve(r);
        });
      }
      if (!responded) resolve(undefined);
    });
  chrome.__data = data;
  chrome.__sent = sent;
  return chrome;
}

export function installChromeMock(initial) {
  const mock = createChromeMock(initial);
  globalThis.chrome = mock;
  return mock;
}
