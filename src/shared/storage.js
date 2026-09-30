/**
 * Settings persistence.
 *
 * Settings live in chrome.storage.sync (falls back to chrome.storage.local if
 * sync is unavailable). Each setting is stored under its own key so large
 * domain lists do not exceed the 8 KB per-item sync quota of a combined object.
 *
 * Nothing but the user's own settings is ever stored: no page content, no
 * browsing history, no identifiers.
 */

import { ACTIONS, DEFAULT_SETTINGS, HARD_LIMITS, SETTING_RANGES, SETTINGS_VERSION } from './constants.js';
import { clamp, normalizeDomain } from './utils.js';

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

function toBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function toInt(key, value, fallback) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  const [min, max] = SETTING_RANGES[key];
  return Math.round(clamp(n, min, max));
}

export function normalizeDomainList(list) {
  const source = Array.isArray(list)
    ? list
    : typeof list === 'string'
      ? list.split(/[\s,]+/)
      : [];
  const out = [];
  const seen = new Set();
  for (const entry of source) {
    const d = normalizeDomain(entry);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
      if (out.length >= HARD_LIMITS.maxListEntries) break;
    }
  }
  return out;
}

/**
 * Merge `raw` over the defaults and validate every field. Unknown keys are
 * dropped; invalid values fall back to defaults; numbers are clamped.
 */
export function normalizeSettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const s = {};

  for (const key of SETTING_KEYS) {
    const def = d[key];
    const value = src[key];
    if (typeof def === 'boolean') s[key] = toBool(value, def);
    else if (typeof def === 'number') s[key] = toInt(key, value, def);
    else if (Array.isArray(def)) s[key] = value === undefined ? [] : normalizeDomainList(value);
    else s[key] = value ?? def;
  }

  if (!ACTIONS.includes(s.action)) s.action = d.action;

  // Score bands must be strictly ascending.
  if (!(s.bandUncertain < s.bandLikely && s.bandLikely < s.bandHigh)) {
    s.bandUncertain = d.bandUncertain;
    s.bandLikely = d.bandLikely;
    s.bandHigh = d.bandHigh;
  }

  // A site can't be both allowed and aggressively scanned: whitelist wins.
  if (s.whitelist.length && s.blacklist.length) {
    const allowed = new Set(s.whitelist);
    s.blacklist = s.blacklist.filter((x) => !allowed.has(x));
  }

  return s;
}

/* ------------------------------------------------------------------ */
/* chrome.storage access                                               */
/* ------------------------------------------------------------------ */

function chromeStorage() {
  const c = globalThis.chrome;
  if (!c || !c.storage) return null;
  return c.storage.sync || c.storage.local || null;
}

function call(area, method, arg) {
  return new Promise((resolve, reject) => {
    try {
      const maybe = area[method](arg, (result) => {
        const err = globalThis.chrome?.runtime?.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
      // Promise-returning implementations (MV3) resolve through the callback too;
      // guard against implementations that only return a promise.
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

export async function loadSettings() {
  const area = chromeStorage();
  if (!area) return normalizeSettings({});
  try {
    const stored = await call(area, 'get', SETTING_KEYS);
    return normalizeSettings(stored || {});
  } catch (e) {
    console.warn('[AI Content Blocker] Could not read settings, using defaults:', e);
    return normalizeSettings({});
  }
}

/**
 * Persist a partial settings update. The merged result is validated first and
 * only the keys provided in `partial` are written.
 * @returns {Promise<object>} the full, normalised settings after the update.
 */
export async function saveSettings(partial) {
  const area = chromeStorage();
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...partial });
  if (!area) return next;
  const toWrite = {};
  for (const key of Object.keys(partial || {})) {
    if (key in next) toWrite[key] = next[key];
  }
  // Writing a list may also have pruned the other list (whitelist wins).
  if ('whitelist' in toWrite) toWrite.blacklist = next.blacklist;
  await call(area, 'set', toWrite);
  return next;
}

/** Restore defaults by removing every stored setting. */
export async function resetSettings() {
  const area = chromeStorage();
  const defaults = normalizeSettings({});
  if (area) {
    // Write the defaults (so open tabs get a change event), then drop them so
    // future default improvements still apply.
    await call(area, 'set', defaults);
    await call(area, 'remove', SETTING_KEYS);
  }
  return defaults;
}

/**
 * Values that were written to storage as *defaults* by older versions.
 * Keys still holding these are removed so the current defaults apply;
 * values the user chose themselves are kept.
 */
const LEGACY_DEFAULTS = {
  // v1 wrote every default on install; v2 checks content before first paint.
  2: { scanDelay: 250, mutationDebounce: 500 },
};

/** Upgrade stored settings to the current format (run on install/update). */
export async function migrateSettings() {
  const area = chromeStorage();
  if (!area) return;
  const stored = (await call(area, 'get', [...SETTING_KEYS, 'settingsVersion'])) || {};
  const version = Number(stored.settingsVersion) || 1;
  if (version >= SETTINGS_VERSION) return;
  const remove = [];
  for (let v = version + 1; v <= SETTINGS_VERSION; v++) {
    for (const [key, legacy] of Object.entries(LEGACY_DEFAULTS[v] || {})) {
      if (stored[key] === legacy) remove.push(key);
    }
  }
  if (remove.length) await call(area, 'remove', remove);
  await call(area, 'set', { settingsVersion: SETTINGS_VERSION });
}

/**
 * Prepare storage on install/update. Defaults are *not* written to storage,
 * so improved defaults in future versions apply automatically; only values
 * the user changes are stored.
 */
export async function ensureDefaults() {
  await migrateSettings();
  return loadSettings();
}

/**
 * Subscribe to settings changes made anywhere (popup, options, other tabs).
 * The callback receives the full normalised settings and the changed keys.
 * @returns {() => void} unsubscribe
 */
export function onSettingsChanged(callback) {
  const c = globalThis.chrome;
  if (!c?.storage?.onChanged) return () => {};
  const listener = async (changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    const keys = Object.keys(changes).filter((k) => SETTING_KEYS.includes(k));
    if (!keys.length) return;
    callback(await loadSettings(), keys);
  };
  c.storage.onChanged.addListener(listener);
  return () => c.storage.onChanged.removeListener(listener);
}

/** Add a domain to the whitelist or blacklist (removing it from the other). */
export async function addSiteToList(listName, domain) {
  const d = normalizeDomain(domain);
  if (!d || (listName !== 'whitelist' && listName !== 'blacklist')) return loadSettings();
  const current = await loadSettings();
  const other = listName === 'whitelist' ? 'blacklist' : 'whitelist';
  const list = current[listName].includes(d) ? current[listName] : [...current[listName], d];
  return saveSettings({
    [listName]: list,
    [other]: current[other].filter((x) => x !== d),
  });
}

/** Remove a domain (and any parent-domain entry that matches it) from a list. */
export async function removeSiteFromList(listName, domain, { includeParents = false } = {}) {
  const d = normalizeDomain(domain);
  const current = await loadSettings();
  const list = current[listName] || [];
  const next = list.filter((entry) => {
    if (entry === d) return false;
    if (includeParents && d.endsWith('.' + entry)) return false;
    return true;
  });
  return saveSettings({ [listName]: next });
}

export { SETTING_KEYS };
