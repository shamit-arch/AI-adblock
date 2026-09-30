/**
 * ContentController — wires settings, adapter, scanner, blocker and observer
 * together for one page, and answers messages from the popup.
 */

import { DetectionEngine } from '../detector/detector.js';
import { Blocker } from './blocker.js';
import { INITIAL_BUDGET_MS, Scanner } from './scanner.js';
import { DomObserver } from './observer.js';
import { getAdapter } from './adapters/index.js';
import { watchUrlChanges } from './navigation.js';
import { DETECTION_SETTING_KEYS, MESSAGE } from '../shared/constants.js';
import * as defaultStorage from '../shared/storage.js';
import { getDetectionOptions, getSiteMode, getTopHostname, isActiveMode } from '../shared/site-rules.js';
import { throttle } from '../shared/utils.js';

export class ContentController {
  /**
   * @param {{doc?: Document, win?: Window, chromeApi?: object, engine?: DetectionEngine,
   *          hostname?: string, storage?: object, urlPollInterval?: number}} [deps]
   */
  constructor({
    doc = globalThis.document,
    win = globalThis,
    chromeApi = globalThis.chrome,
    engine = new DetectionEngine(),
    hostname,
    storage = defaultStorage,
    urlPollInterval = 1000,
  } = {}) {
    this.doc = doc;
    this.win = win;
    this.chrome = chromeApi;
    this.engine = engine;
    this.storage = storage;
    this.urlPollInterval = urlPollInterval;
    this.hostname = hostname || getTopHostname(win.location);
    this.adapter = getAdapter(this.hostname);
    this.settings = null;
    this.active = false;
    this.revealedHashes = new Set();
    this.cleanups = [];
    this.reportStats = throttle(() => this.sendStats(), 400);
  }

  async init() {
    // Runs at document_start: start watching the DOM immediately so content
    // parsed while settings load is not missed. Mutations are only buffered
    // until we know whether to scan this site.
    this.observer = new DomObserver({
      target: this.doc,
      win: this.win,
      debounceMs: 0,
      onNodes: (roots, { removed }) => this.onMutations(roots, removed),
    });
    this.observer.startPaused();

    this.settings = await this.storage.loadSettings();
    this.observer.setDebounce(this.settings.mutationDebounce);

    this.blocker = new Blocker({
      doc: this.doc,
      getSettings: () => this.settings,
      onChange: () => this.reportStats(),
      onAllowSite: () => this.allowSite(),
      onReveal: (r) => r.result.textHash && this.revealedHashes.add(r.result.textHash),
      onRehide: (r) => this.revealedHashes.delete(r.result.textHash),
    });

    this.scanner = new Scanner({
      engine: this.engine,
      blocker: this.blocker,
      adapter: this.adapter,
      doc: this.doc,
      win: this.win,
      getContext: () => this.getContext(),
      isRevealedHash: (h) => this.revealedHashes.has(h),
      onCycleEnd: () => this.reportStats(),
    });

    this.cleanupRemoved = throttle(() => this.blocker.cleanup(), 250);

    this.cleanups.push(this.storage.onSettingsChanged((s, keys) => this.onSettingsChanged(s, keys)));

    this.messageListener = (msg, sender, sendResponse) => this.handleMessage(msg, sender, sendResponse);
    this.chrome?.runtime?.onMessage?.addListener(this.messageListener);
    this.cleanups.push(() => this.chrome?.runtime?.onMessage?.removeListener(this.messageListener));

    this.cleanups.push(watchUrlChanges(() => this.onUrlChange(), { win: this.win, interval: this.urlPollInterval }));

    // Units held back while the parser was still inside them are decided once parsing ends.
    if (this.doc.readyState === 'loading') {
      const onReady = () => {
        if (!this.active) return;
        this.scanner.releaseClosedUnits({ all: true });
        this.scanner.validateBlockedGroups();
      };
      this.doc.addEventListener('DOMContentLoaded', onReady, { once: true });
      this.cleanups.push(() => this.doc.removeEventListener('DOMContentLoaded', onReady));
    }

    // Placeholders created while the page's CSS was still loading may have picked the wrong theme.
    if (this.doc.readyState !== 'complete') {
      const onLoad = () => this.blocker.refreshThemes();
      this.win.addEventListener('load', onLoad, { once: true });
      this.cleanups.push(() => this.win.removeEventListener('load', onLoad));
    }

    this.applyState({ initial: true });
    this.sendStats();
    return this;
  }

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */

  get mode() {
    if (!this.settings) return 'off';
    if (this.adapter.unsupported) return 'unsupported';
    return getSiteMode(this.settings, this.hostname);
  }

  getContext() {
    const mode = this.mode;
    return {
      settings: this.settings,
      detection: getDetectionOptions(this.settings, mode),
      active: this.active,
      mode,
    };
  }

  applyState({ initial = false } = {}) {
    const shouldRun = isActiveMode(this.mode);
    if (shouldRun && !this.active) this.start({ initial });
    else if (!shouldRun && this.active) this.stop();
    else if (!shouldRun) this.observer.stop();
  }

  start({ initial = false } = {}) {
    this.active = true;
    if (!this.settings.autoScan) {
      this.observer.stop();
      this.reportStats();
      return;
    }

    // Everything parsed so far is covered by one full scan; buffered mutations are redundant.
    this.observer.discardPending();
    const loading = this.doc.readyState === 'loading';
    const scanNow = () =>
      this.active &&
      this.scanner.scanNow([this.scanner.root], { hidePending: initial && loading, budgetMs: initial ? INITIAL_BUDGET_MS : undefined });
    if (initial && this.settings.scanDelay > 0) setTimeout(scanNow, this.settings.scanDelay);
    else scanNow();

    this.syncObserver();
    this.reportStats();
  }

  /**
   * The observer always runs while the page is still loading (that is how
   * content is caught before first paint). Afterwards it only keeps running
   * if "Scan dynamically loaded content" is on.
   */
  syncObserver() {
    const s = this.settings;
    if (!this.active || !s.autoScan) {
      this.observer.stop();
      return;
    }
    if (s.scanDynamic || this.doc.readyState === 'loading') this.observer.start();
    else this.observer.stop();
    if (!s.scanDynamic && this.doc.readyState === 'loading' && !this.waitingForDomReady) {
      this.waitingForDomReady = true;
      this.doc.addEventListener(
        'DOMContentLoaded',
        () => {
          this.waitingForDomReady = false;
          this.syncObserver();
        },
        { once: true },
      );
    }
  }

  stop() {
    this.active = false;
    this.observer.stop();
    this.scanner.stop();
    this.scanner.reset();
    this.blocker.restoreAll();
    this.reportStats();
  }

  onMutations(roots, removed) {
    if (removed) this.cleanupRemoved();
    // New content: analyse now, before the browser paints it.
    if (this.active && roots.length) this.scanner.scanNow(roots, { hidePending: true });
  }

  onUrlChange() {
    this.blocker.cleanup();
    // New content arrives through the observer; this catches elements the SPA re-used.
    if (this.active && this.settings.autoScan) this.scanner.scanAll({ delay: 300 });
    this.reportStats();
  }

  onSettingsChanged(settings, keys) {
    const prevMode = this.mode;
    this.settings = settings;
    const wasActive = this.active;
    this.applyState();
    if (!this.active || !wasActive) return;

    const changed = (k) => keys.includes(k);
    if (changed('mutationDebounce')) this.observer.setDebounce(settings.mutationDebounce);
    if (changed('autoScan') || changed('scanDynamic')) this.syncObserver();

    const detectionChanged = keys.some((k) => DETECTION_SETTING_KEYS.includes(k)) || prevMode !== this.mode;
    if (detectionChanged) {
      // Content is already on screen and judged; re-evaluate it in idle time.
      this.scanner.stop();
      this.scanner.scanAll({ force: true });
    } else if (changed('autoScan') && settings.autoScan) {
      this.scanner.scanNow([this.scanner.root], { hidePending: false });
    }

    if (changed('action') || changed('showReasons')) this.blocker.refreshAll();
  }

  async allowSite() {
    try {
      await this.storage.addSiteToList('whitelist', this.hostname);
      // onSettingsChanged will restore the page; do it now in case storage events are slow.
      this.settings = { ...this.settings, whitelist: [...this.settings.whitelist, this.hostname] };
      this.applyState();
    } catch (e) {
      console.warn('[AI Content Blocker] could not update the allow-list:', e);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Messaging                                                          */
  /* ------------------------------------------------------------------ */

  getStatus() {
    const stats = this.blocker ? this.blocker.stats() : { detected: 0, blocked: 0, visible: 0 };
    return {
      ok: true,
      hostname: this.hostname,
      mode: this.mode,
      active: this.active,
      adapter: this.adapter.id,
      adapterName: this.adapter.name,
      stats: {
        ...stats,
        analyzed: this.scanner ? this.scanner.stats.analyzed : 0,
        pending: this.scanner ? this.scanner.pendingCount : 0,
      },
    };
  }

  handleMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return false;
    if (sender && this.chrome?.runtime?.id && sender.id && sender.id !== this.chrome.runtime.id) return false;
    switch (msg.type) {
      case MESSAGE.GET_STATUS:
        sendResponse(this.getStatus());
        return false;
      case MESSAGE.SCAN:
        if (this.active) {
          this.scanner.stop();
          this.scanner.reset();
          this.scanner.scanNow([this.scanner.root], { hidePending: false });
          if (this.settings.autoScan) this.syncObserver();
        }
        sendResponse(this.getStatus());
        return false;
      case MESSAGE.SHOW_ALL:
        this.blocker.showAll();
        sendResponse(this.getStatus());
        return false;
      case MESSAGE.BLOCK_ALL:
        this.blocker.blockAll();
        sendResponse(this.getStatus());
        return false;
      default:
        return false;
    }
  }

  sendStats() {
    const runtime = this.chrome?.runtime;
    try {
      if (!runtime?.id || !runtime.sendMessage) return;
      const stats = this.blocker ? this.blocker.stats() : { detected: 0, blocked: 0, visible: 0 };
      const p = runtime.sendMessage({ type: MESSAGE.STATS, stats, active: this.active });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* extension was reloaded; this orphaned script keeps working locally */
    }
  }

  /** True while the extension context that created this controller is valid. */
  isAlive() {
    try {
      return !!this.chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  /** Tear down completely and restore the page. */
  destroy() {
    if (this.active) this.stop();
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }
}
