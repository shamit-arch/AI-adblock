/**
 * Scanner — finds content units, analyses them, and hands results to the
 * Blocker.
 *
 * Two paths:
 *
 *   Urgent (scanNow)  — new content (page load, inserted comments, feeds).
 *     Units are analysed synchronously, within a time budget, in the same
 *     task/microtask that discovered them, i.e. before the browser paints.
 *     Units that don't fit the budget are marked `data-aicb-pending`
 *     (invisible, layout preserved) and finished in immediately following
 *     tasks, so AI text is not flashed on screen before being blocked.
 *
 *   Background (scanAll / scanRoots) — re-evaluating content that was already
 *     judged (settings changes, SPA navigation). Runs in idle time.
 *
 * Performance measures:
 *   - each unit is analysed once per text version (WeakMap signatures)
 *   - a cheap pre-check (textContent length) skips unchanged units
 *   - growing units that are already blocked are not re-analysed for small growth
 *   - per-batch time budget and `maxElementsPerScan` cap
 *   - a watchdog guarantees nothing stays hidden as "pending" for long
 */

import { discoverUnits, GROUP_UNITS, isStillValidUnit } from './discovery.js';
import { extractText } from './extractor.js';
import { PENDING_ATTR } from './dom-filters.js';
import { HARD_LIMITS } from '../shared/constants.js';
import { hashString, nextIdle } from '../shared/utils.js';

const now = () => (globalThis.performance ? performance.now() : Date.now());

/** Time budget (ms) for synchronous work in one batch (about one frame). */
export const URGENT_BUDGET_MS = 16;
/**
 * Budget for the one-time initial scan while the page is loading: nothing
 * has been painted yet, so it is better to finish now than to defer.
 */
export const INITIAL_BUDGET_MS = 50;
/** Maximum time an element may stay hidden while waiting for analysis. */
export const PENDING_TIMEOUT_MS = 2000;

export class Scanner {
  /**
   * @param {{engine: import('../detector/detector.js').DetectionEngine,
   *          blocker: import('./blocker.js').Blocker,
   *          adapter: object,
   *          getContext: () => {settings: object, detection: object, active: boolean},
   *          isRevealedHash?: (hash: string) => boolean,
   *          onCycleEnd?: () => void,
   *          budgetMs?: number,
   *          doc?: Document, win?: Window}} config
   */
  constructor({
    engine,
    blocker,
    adapter,
    getContext,
    isRevealedHash = () => false,
    onCycleEnd = () => {},
    budgetMs = URGENT_BUDGET_MS,
    doc = document,
    win = globalThis,
  }) {
    this.engine = engine;
    this.blocker = blocker;
    this.adapter = adapter;
    this.getContext = getContext;
    this.isRevealedHash = isRevealedHash;
    this.onCycleEnd = onCycleEnd;
    this.budgetMs = budgetMs;
    this.doc = doc;
    this.win = win;

    // background (idle) queue
    this.queue = [];
    this.queued = new WeakSet();
    this.running = false;
    this.cycleTimer = null;
    this.pendingRoots = [];
    this.discoveryScheduled = false;

    // urgent queue
    this.urgent = [];
    this.urgentSet = new Set();
    this.urgentScheduled = false;
    this.pendingEls = new Set();
    /** Units still being parsed that are held back until complete. */
    this.openUnits = new Set();
    this.watchdog = null;
    this.setupFastScheduler();

    this.quickSig = new WeakMap();
    this.fullSig = new WeakMap();
    this.analyzedLength = new WeakMap();
    this.generation = 0;
    this.stats = { analyzed: 0, skipped: 0, discovered: 0, cycles: 0, deferred: 0 };
  }

  /** setTimeout(0) is clamped and slow to chain; MessageChannel runs the next task ASAP. */
  setupFastScheduler() {
    const MC = this.win.MessageChannel || globalThis.MessageChannel;
    this.fastTasks = [];
    if (typeof MC === 'function') {
      const channel = new MC();
      channel.port1.onmessage = () => {
        const tasks = this.fastTasks.splice(0);
        for (const t of tasks) t();
      };
      channel.port1.unref?.(); // Node (tests): don't keep the process alive
      channel.port2.unref?.();
      this.postTask = (fn) => {
        this.fastTasks.push(fn);
        channel.port2.postMessage(0);
      };
    } else {
      this.postTask = (fn) => setTimeout(fn, 0);
    }
  }

  /** Forget everything analysed so far (next scan re-evaluates all units). */
  reset() {
    this.quickSig = new WeakMap();
    this.fullSig = new WeakMap();
    this.analyzedLength = new WeakMap();
    this.engine.clearCache?.();
  }

  /** Cancel queued work and un-hide anything pending. */
  stop() {
    this.generation++;
    this.queue = [];
    this.queued = new WeakSet();
    this.pendingRoots = [];
    this.discoveryScheduled = false;
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    this.cycleTimer = null;
    this.urgent = [];
    this.urgentSet.clear();
    this.clearAllPending();
  }

  get root() {
    return this.doc.body || this.doc.documentElement;
  }

  /* ------------------------------------------------------------------ */
  /* Discovery                                                          */
  /* ------------------------------------------------------------------ */

  /** Synchronously find units inside `roots` (also handles site-labelled AI). */
  discoverIn(roots) {
    const ctx = this.getContext();
    const body = this.doc.body;
    if (!ctx.active || !body) return [];
    let list = roots.filter((r) => r && (r.nodeType === 9 || r.isConnected));
    if (list.some((r) => r === body || r === this.doc.documentElement || r.nodeType === 9)) list = [body];

    const found = [];
    const seen = new Set();
    for (const root of list) {
      for (const unit of discoverUnits(root, { adapter: this.adapter, maxUnitChars: HARD_LIMITS.maxUnitChars })) {
        if (!seen.has(unit)) {
          seen.add(unit);
          found.push(unit);
        }
      }
    }

    if (ctx.settings.blockSiteLabeledAI && typeof this.adapter.findLabeledAI === 'function') {
      for (const root of list) {
        try {
          for (const item of this.adapter.findLabeledAI(root) || []) this.blockLabeled(item);
        } catch {
          /* adapter failure must not break scanning */
        }
      }
    }

    this.stats.discovered += found.length;
    return found;
  }

  blockLabeled({ element, label }) {
    if (!element || !element.isConnected || this.blocker.has(element)) return;
    const result = Object.freeze({
      score: 100,
      label: 'high',
      labelText: 'AI-generated',
      siteLabeled: true,
      reasons: [label || 'Marked as AI-generated by the site'],
      signals: [],
      humanSignals: [],
      textHash: '',
    });
    this.blocker.block(element, result, { source: 'site-label' });
  }

  targetOf(unit) {
    return (this.adapter.getBlockTarget && this.adapter.getBlockTarget(unit)) || unit;
  }

  /* ------------------------------------------------------------------ */
  /* Urgent path: before paint                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Discover and analyse units inside `roots` right now.
   * @param {Node[]} roots
   * @param {{hidePending?: boolean, budgetMs?: number}} [opts]
   *   hidePending: hide new units that don't fit the time budget until analysed
   */
  scanNow(roots, { hidePending = true, budgetMs = this.budgetMs } = {}) {
    const ctx = this.getContext();
    if (!ctx.active) return;
    const start = now();
    const units = this.discoverIn(this.revalidate(roots));
    const max = ctx.settings.maxElementsPerScan;
    const sync = this.engine.isSynchronous;
    let analyzed = 0;
    for (const unit of units) {
      if (sync && analyzed < max && now() - start < budgetMs) {
        if (this.processUnitSync(unit)) analyzed++;
      } else {
        this.enqueueUrgent(unit, hidePending);
      }
    }
    if (this.openUnits.size) this.releaseClosedUnits();
    if (units.length) this.onCycleEnd();
  }

  /* ------------------------------------------------------------------ */
  /* Re-validating grouped units as the DOM grows                       */
  /* ------------------------------------------------------------------ */

  /** Forget a blocked group that no longer looks like one text; its contents get re-checked. */
  invalidate(el) {
    this.blocker.unblock(el);
    this.quickSig.delete(el);
    this.fullSig.delete(el);
    this.analyzedLength.delete(el);
  }

  /**
   * New nodes inside a blocked *group* unit can show it was chosen on an
   * incomplete DOM (e.g. mid-way through parsing). If it's no longer a
   * paragraph group, unblock it and add it to the roots to re-discover.
   */
  revalidate(roots) {
    if (!this.blocker.records.size) return roots;
    const extra = [];
    for (const root of roots) {
      for (let el = root.nodeType === 1 ? root : null; el && el !== this.doc.body; el = el.parentElement) {
        const record = this.blocker.get(el);
        if (!record) continue;
        if (record.source === 'detector' && GROUP_UNITS.has(el) && !isStillValidUnit(el)) {
          this.invalidate(el);
          extra.push(el);
        }
        break;
      }
    }
    return extra.length ? roots.concat(extra) : roots;
  }

  /** Check every blocked group unit (used once parsing has finished). */
  validateBlockedGroups() {
    const invalid = [];
    for (const [el, record] of this.blocker.records) {
      if (record.source === 'detector' && GROUP_UNITS.has(el) && !isStillValidUnit(el)) invalid.push(el);
    }
    for (const el of invalid) this.invalidate(el);
    if (invalid.length) this.scanNow(invalid, { hidePending: false });
    return invalid.length;
  }

  /* ------------------------------------------------------------------ */
  /* Units still being parsed (slow / streamed page loads)              */
  /* ------------------------------------------------------------------ */

  /**
   * While the HTML parser is still inside a unit, only part of its text
   * exists. The browser may paint that fragment, and a fragment is often too
   * short to judge. Such units are held invisible until they are complete —
   * but only if the fragment is too short or already looks at least
   * "possibly AI"; clearly human text is shown immediately.
   */
  isStillParsing(unit) {
    if (this.doc.readyState !== 'loading') return false;
    let last = this.doc.documentElement;
    while (last && last.lastElementChild) last = last.lastElementChild;
    return !!last && unit.contains(last);
  }

  hold(unit) {
    this.openUnits.add(unit);
    this.markPending(unit);
  }

  /** Re-evaluate held units the parser has moved past (or all, once parsing ends). */
  releaseClosedUnits({ all = false } = {}) {
    for (const unit of [...this.openUnits]) {
      if (!all && this.isStillParsing(unit)) continue;
      this.openUnits.delete(unit);
      this.quickSig.delete(unit);
      this.fullSig.delete(unit);
      try {
        this.processUnitSync(unit);
      } finally {
        if (!this.openUnits.has(unit)) this.clearPending(unit);
      }
    }
  }

  enqueueUrgent(unit, hide) {
    if (this.urgentSet.has(unit)) return;
    this.urgentSet.add(unit);
    this.urgent.push(unit);
    this.stats.deferred++;
    // Only hide content the user hasn't seen judged yet; never re-hide known-visible content.
    if (hide && !this.quickSig.has(unit)) this.markPending(unit);
    this.scheduleUrgent();
  }

  scheduleUrgent() {
    if (this.urgentScheduled) return;
    this.urgentScheduled = true;
    const gen = this.generation;
    this.postTask(() => {
      this.urgentScheduled = false;
      if (gen === this.generation) this.drainUrgent();
    });
  }

  async drainUrgent() {
    const gen = this.generation;
    const start = now();
    const sync = this.engine.isSynchronous;
    const max = this.getContext().settings.maxElementsPerScan;
    let analyzed = 0;
    let first = true;
    // Always make progress: at least one unit per slice, even over budget.
    while (this.urgent.length && (first || (now() - start < this.budgetMs && analyzed < max))) {
      first = false;
      const unit = this.urgent.shift();
      this.urgentSet.delete(unit);
      try {
        const did = sync ? this.processUnitSync(unit) : await this.processUnit(unit);
        if (did) analyzed++;
      } catch (e) {
        console.debug('[AI Content Blocker] failed to process element', e);
      } finally {
        if (!this.openUnits.has(unit)) this.clearPending(unit);
      }
      if (gen !== this.generation) return;
    }
    if (this.urgent.length) this.scheduleUrgent();
    else this.onCycleEnd();
  }

  markPending(unit) {
    const target = this.targetOf(unit);
    if (this.blocker.has(target) || target.hasAttribute(PENDING_ATTR)) return;
    target.setAttribute(PENDING_ATTR, '');
    this.pendingEls.add(target);
    if (!this.watchdog) {
      this.watchdog = setTimeout(() => {
        this.watchdog = null;
        this.clearAllPending();
      }, PENDING_TIMEOUT_MS);
    }
  }

  clearPending(unit) {
    const target = this.targetOf(unit);
    if (this.pendingEls.delete(target)) target.removeAttribute(PENDING_ATTR);
    if (!this.pendingEls.size && this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  clearAllPending() {
    for (const el of this.pendingEls) el.removeAttribute(PENDING_ATTR);
    this.pendingEls.clear();
    this.openUnits.clear();
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /* ------------------------------------------------------------------ */
  /* Background path: idle time                                         */
  /* ------------------------------------------------------------------ */

  /** Re-evaluate everything on the page in idle time. */
  scanAll({ delay = 0, force = false } = {}) {
    if (force) this.reset();
    this.scanRoots([this.root], { delay });
  }

  scanRoots(roots, { delay = 0 } = {}) {
    for (const r of roots) if (r) this.pendingRoots.push(r);
    if (this.discoveryScheduled) return;
    this.discoveryScheduled = true;
    const gen = this.generation;
    const run = async () => {
      await nextIdle(1000);
      if (gen !== this.generation) return;
      this.discoveryScheduled = false;
      const roots = this.pendingRoots;
      this.pendingRoots = [];
      this.enqueue(this.prioritize(this.discoverIn(roots)));
    };
    if (delay > 0) setTimeout(run, delay);
    else run();
  }

  /** Units in or near the viewport first, then the rest in document order. */
  prioritize(units) {
    const h = this.win.innerHeight || 800;
    const near = [];
    const far = [];
    for (const u of units) {
      let top = 0;
      let bottom = 0;
      try {
        const r = u.getBoundingClientRect();
        top = r.top;
        bottom = r.bottom;
      } catch {
        /* detached */
      }
      if (bottom >= -h && top <= h * 2) near.push(u);
      else far.push(u);
    }
    return near.concat(far);
  }

  enqueue(units) {
    for (const u of units) {
      if (this.queued.has(u)) continue;
      this.queued.add(u);
      this.queue.push(u);
    }
    if (this.queue.length) this.scheduleCycle(0);
  }

  scheduleCycle(delay) {
    if (this.running || this.cycleTimer) return;
    const gen = this.generation;
    this.cycleTimer = setTimeout(() => {
      this.cycleTimer = null;
      if (gen === this.generation) this.runCycle();
    }, delay);
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    this.stats.cycles++;
    try {
      let budget = this.getContext().settings.maxElementsPerScan;
      while (this.queue.length && budget > 0) {
        const deadline = await nextIdle(1000);
        if (gen !== this.generation || !this.getContext().active) break;
        do {
          const unit = this.queue.shift();
          this.queued.delete(unit);
          budget--;
          try {
            if (this.engine.isSynchronous) this.processUnitSync(unit);
            else await this.processUnit(unit);
          } catch (e) {
            console.debug('[AI Content Blocker] failed to process element', e);
          }
        } while (this.queue.length && budget > 0 && deadline.timeRemaining() > 2);
      }
    } finally {
      this.running = false;
    }
    const current = gen === this.generation;
    if (current) this.onCycleEnd();
    if (this.queue.length && this.getContext().active) {
      this.scheduleCycle(current ? this.getContext().settings.scanDelay : 0);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Analysis                                                           */
  /* ------------------------------------------------------------------ */

  /** Shared checks + extraction. Returns null when nothing needs analysing. */
  prepare(unit) {
    if (!unit.isConnected) return null;
    const ctx = this.getContext();
    if (!ctx.active) return null;
    const { settings, detection } = ctx;
    const target = this.targetOf(unit);

    const optionsKey = `${detection.sensitivity}|${detection.threshold}|${detection.aggressive}|${settings.minTextLength}`;
    const length = unit.textContent.length;
    const quick = `${length}|${optionsKey}`;
    if (this.quickSig.get(unit) === quick) return null;
    const firstLook = !this.quickSig.has(unit);
    this.quickSig.set(unit, quick);

    // Content still streaming in (page parsing, live updates) that is already
    // blocked doesn't need re-checking on every small addition.
    const last = this.analyzedLength.get(unit);
    const existing = this.blocker.get(target);
    if (!firstLook && last && existing?.source === 'detector' && existing.state !== 'revealed' && length < last * 1.25) {
      return null;
    }

    const extracted = extractText(unit, {
      maxChars: HARD_LIMITS.maxAnalyzedChars,
      excludeSelector: this.adapter.excludeSelector,
    });

    if (extracted.charCount < settings.minTextLength) {
      this.stats.skipped++;
      if (existing?.source === 'detector') this.blocker.unblock(target);
      else if (!existing && this.isStillParsing(unit)) this.hold(unit);
      return null;
    }

    const sig = `${hashString(extracted.text)}|${optionsKey}`;
    if (this.fullSig.get(unit) === sig) return null;
    this.fullSig.set(unit, sig);
    this.analyzedLength.set(unit, length);

    return {
      target,
      detection,
      input: { text: extracted.text, blocks: extracted.blocks, meta: { linkDensity: extracted.linkDensity } },
    };
  }

  apply(unit, { target, detection }, result) {
    this.stats.analyzed++;
    if (!unit.isConnected || !this.getContext().active) return;
    const existing = this.blocker.get(target);
    if (!result.skipped && result.score >= detection.threshold) {
      this.openUnits.delete(unit);
      this.clearPending(unit);
      this.blocker.block(target, result, {
        source: 'detector',
        revealed: existing ? existing.state === 'revealed' : this.isRevealedHash(result.textHash),
      });
      return;
    }
    if (existing && existing.source === 'detector') this.blocker.unblock(target);
    const inconclusive = result.skipped || result.score >= detection.bands.uncertain;
    if (!existing && inconclusive && this.isStillParsing(unit)) {
      this.hold(unit);
    } else if (this.openUnits.delete(unit)) {
      this.clearPending(unit);
    }
  }

  /** @returns {boolean} true if the unit was analysed */
  processUnitSync(unit) {
    const prep = this.prepare(unit);
    if (!prep) return false;
    this.apply(unit, prep, this.engine.analyzeSync(prep.input, prep.detection));
    return true;
  }

  /** Async variant for engines with remote/async providers. */
  async processUnit(unit) {
    const prep = this.prepare(unit);
    if (!prep) return false;
    const result = this.engine.isSynchronous
      ? this.engine.analyzeSync(prep.input, prep.detection)
      : await this.engine.analyze(prep.input, prep.detection);
    this.apply(unit, prep, result);
    return true;
  }

  get pendingCount() {
    return this.queue.length + this.urgent.length;
  }
}
