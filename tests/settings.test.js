import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addSiteToList,
  ensureDefaults,
  loadSettings,
  normalizeSettings,
  onSettingsChanged,
  removeSiteFromList,
  resetSettings,
  saveSettings,
} from '../src/shared/storage.js';
import { DEFAULT_SETTINGS, SUPPORT_URL, PAYPAL_EMAIL } from '../src/shared/constants.js';
import { getSiteMode, isWhitelisted } from '../src/shared/site-rules.js';
import { hostnameMatches, normalizeDomain, debounce } from '../src/shared/utils.js';
import { getAdapter, isUnsupportedHost } from '../src/content/adapters/index.js';
import { installChromeMock } from './helpers/chrome-mock.js';

describe('settings normalisation', () => {
  it('fills defaults', () => {
    expect(normalizeSettings({})).toEqual({ ...DEFAULT_SETTINGS, whitelist: [], blacklist: [] });
  });

  it('clamps numbers and rejects bad types', () => {
    const s = normalizeSettings({ sensitivity: 42, confidenceThreshold: -5, maxElementsPerScan: 'lots', enabled: 'yes' });
    expect(s.sensitivity).toBe(5);
    expect(s.confidenceThreshold).toBe(31);
    expect(s.maxElementsPerScan).toBe(DEFAULT_SETTINGS.maxElementsPerScan);
    expect(s.enabled).toBe(true);
  });

  it('accepts numeric strings from form inputs', () => {
    expect(normalizeSettings({ minTextLength: '300' }).minTextLength).toBe(300);
  });

  it('rejects unknown actions and non-ascending bands', () => {
    const s = normalizeSettings({ action: 'explode', bandUncertain: 70, bandLikely: 50, bandHigh: 90 });
    expect(s.action).toBe('placeholder');
    expect([s.bandUncertain, s.bandLikely, s.bandHigh]).toEqual([31, 61, 81]);
  });

  it('normalises, de-duplicates and validates domain lists; whitelist wins', () => {
    const s = normalizeSettings({
      whitelist: ['https://www.YouTube.com/watch?v=1', 'reddit.com', 'reddit.com', 'not a domain', '*.example.co.uk'],
      blacklist: ['reddit.com', 'spam.example'],
    });
    expect(s.whitelist).toEqual(['youtube.com', 'reddit.com', 'example.co.uk']);
    expect(s.blacklist).toEqual(['spam.example']);
  });

  it('drops unknown keys', () => {
    expect(normalizeSettings({ evil: 1 })).not.toHaveProperty('evil');
  });
});

describe('domain matching and site modes', () => {
  it('matches subdomains but not look-alikes', () => {
    expect(hostnameMatches('old.reddit.com', 'reddit.com')).toBe(true);
    expect(hostnameMatches('www.reddit.com', 'reddit.com')).toBe(true);
    expect(hostnameMatches('notreddit.com', 'reddit.com')).toBe(false);
    expect(hostnameMatches('reddit.com.evil.io', 'reddit.com')).toBe(false);
  });

  it('normalizeDomain handles URLs, ports and wildcards', () => {
    expect(normalizeDomain('HTTPS://user@Sub.Example.com:8080/path')).toBe('sub.example.com');
    expect(normalizeDomain('localhost')).toBe('localhost');
    expect(normalizeDomain('192.168.0.1')).toBe('192.168.0.1');
    expect(normalizeDomain('no spaces allowed.com')).toBe('');
  });

  it('computes the site mode', () => {
    const s = normalizeSettings({ whitelist: ['youtube.com'], blacklist: ['spam.example'] });
    expect(getSiteMode(s, 'www.youtube.com')).toBe('whitelisted');
    expect(getSiteMode(s, 'blog.spam.example')).toBe('aggressive');
    expect(getSiteMode(s, 'news.example')).toBe('normal');
    expect(getSiteMode({ ...s, enabled: false }, 'news.example')).toBe('off');
    expect(isWhitelisted(s, 'm.youtube.com')).toBe(true);
  });
});

describe('persistence (chrome.storage)', () => {
  let chrome;
  beforeEach(() => {
    chrome = installChromeMock();
  });
  afterEach(() => {
    delete globalThis.chrome;
  });

  it('loads defaults when nothing is stored', async () => {
    expect((await loadSettings()).action).toBe('placeholder');
  });

  it('persists partial updates and only writes the given keys', async () => {
    await saveSettings({ sensitivity: 4, action: 'blur' });
    expect(chrome.__data).toEqual({ sensitivity: 4, action: 'blur' });
    const s = await loadSettings();
    expect(s.sensitivity).toBe(4);
    expect(s.action).toBe('blur');
  });

  it('validates values before writing', async () => {
    await saveSettings({ sensitivity: 99 });
    expect(chrome.__data.sensitivity).toBe(5);
  });

  it('ensureDefaults keeps user values and does not store defaults', async () => {
    chrome.__data.sensitivity = 2;
    const s = await ensureDefaults();
    expect(s.sensitivity).toBe(2);
    expect(s.action).toBe('placeholder');
    expect(chrome.__data).toEqual({ sensitivity: 2, settingsVersion: 2 });
  });

  it('migrates v1 stored defaults (slow scan timings) to the new instant defaults', async () => {
    Object.assign(chrome.__data, { scanDelay: 250, mutationDebounce: 500, sensitivity: 4, action: 'placeholder' });
    await ensureDefaults();
    const s = await loadSettings();
    expect(s.scanDelay).toBe(0);
    expect(s.mutationDebounce).toBe(0);
    expect(s.sensitivity).toBe(4); // user choices survive
    expect(chrome.__data.settingsVersion).toBe(2);
  });

  it('keeps timings the user customised', async () => {
    Object.assign(chrome.__data, { scanDelay: 1000, mutationDebounce: 300 });
    await ensureDefaults();
    const s = await loadSettings();
    expect([s.scanDelay, s.mutationDebounce]).toEqual([1000, 300]);
  });

  it('runs the migration only once', async () => {
    await ensureDefaults();
    await saveSettings({ mutationDebounce: 500 }); // chosen by the user after migrating
    await ensureDefaults();
    expect((await loadSettings()).mutationDebounce).toBe(500);
  });

  it('adds and removes sites from lists', async () => {
    await addSiteToList('blacklist', 'https://www.example.com/page');
    expect((await loadSettings()).blacklist).toEqual(['example.com']);
    await addSiteToList('whitelist', 'example.com');
    const s = await loadSettings();
    expect(s.whitelist).toEqual(['example.com']);
    expect(s.blacklist).toEqual([]);
    await removeSiteFromList('whitelist', 'news.example.com', { includeParents: true });
    expect((await loadSettings()).whitelist).toEqual([]);
  });

  it('notifies listeners with full settings and changed keys', async () => {
    const calls = [];
    const off = onSettingsChanged((s, keys) => calls.push([s.enabled, keys]));
    await saveSettings({ enabled: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([[false, ['enabled']]]);
    off();
  });

  it('resets to defaults', async () => {
    await saveSettings({ sensitivity: 1, whitelist: ['a.com'] });
    await resetSettings();
    const s = await loadSettings();
    expect(s.sensitivity).toBe(3);
    expect(s.whitelist).toEqual([]);
  });
});

describe('adapters and support link', () => {
  it('picks site adapters and merges generic rules', () => {
    expect(getAdapter('old.reddit.com').id).toBe('reddit');
    expect(getAdapter('www.youtube.com').id).toBe('youtube');
    expect(getAdapter('www.google.co.uk').id).toBe('google');
    expect(getAdapter('x.com').id).toBe('twitter');
    expect(getAdapter('www.theguardian.com').id).toBe('news');
    expect(getAdapter('some-blog.example').id).toBe('generic');
    expect(getAdapter('www.theguardian.com').unitSelector).toContain('.entry-content');
  });

  it('never runs inside editors and messaging apps', () => {
    expect(isUnsupportedHost('docs.google.com')).toBe(true);
    expect(isUnsupportedHost('mail.google.com')).toBe(true);
    expect(getAdapter('docs.google.com').unsupported).toBe(true);
    expect(isUnsupportedHost('www.google.com')).toBe(false);
  });

  it('support link is an official PayPal URL for the configured account', () => {
    const url = new URL(SUPPORT_URL);
    expect(url.origin).toBe('https://www.paypal.com');
    expect(url.pathname).toBe('/donate/');
    expect(url.searchParams.get('business')).toBe(PAYPAL_EMAIL);
  });
});

describe('utilities', () => {
  it('debounce with maxWait flushes during a continuous stream', async () => {
    let calls = 0;
    const d = debounce(() => calls++, 40, { maxWait: 100 });
    const start = Date.now();
    while (Date.now() - start < 250) {
      d();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(calls).toBeGreaterThanOrEqual(2);
    d.cancel();
  });
});
