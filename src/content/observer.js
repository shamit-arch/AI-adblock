/**
 * DomObserver — turns DOM mutations into scan requests.
 *
 * Default (debounceMs = 0): roots are handed to the scanner synchronously
 * inside the MutationObserver callback. MutationObserver callbacks run as
 * microtasks, before the browser's next paint, so new content can be checked
 * and blocked before it is ever shown.
 *
 * With debounceMs > 0 mutations are batched (useful on extremely busy pages),
 * at the cost of new content possibly appearing briefly before being blocked.
 *
 * While `paused`, mutations are only collected (used at document_start until
 * settings have loaded).
 */

import { HOST_TAG, WRAPPER_ATTR } from './dom-filters.js';
import { debounce } from '../shared/utils.js';

const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'TITLE', 'BASE', HOST_TAG]);
/** Above this many pending roots, rescan the whole body instead. */
const FULL_RESCAN_THRESHOLD = 1500;

function isOurs(node) {
  return node.nodeType === 1 && (node.tagName === HOST_TAG || node.hasAttribute(WRAPPER_ATTR));
}

export class DomObserver {
  /**
   * @param {{target: Node, onNodes: (roots: Element[], info: {removed: boolean}) => void,
   *          debounceMs?: number, paused?: boolean, win?: Window}} config
   */
  constructor({ target, onNodes, debounceMs = 0, paused = false, win = globalThis }) {
    this.target = target;
    this.onNodes = onNodes;
    this.win = win;
    this.paused = paused;
    this.pending = new Set();
    this.removed = false;
    this.observer = null;
    this.setDebounce(debounceMs);
  }

  setDebounce(ms) {
    if (this.flushDebounced) this.flushDebounced.cancel();
    this.debounceMs = ms;
    this.flushDebounced = ms > 0 ? debounce(() => this.flush(), ms, { maxWait: Math.max(ms * 4, 1000) }) : null;
  }

  start() {
    this.paused = false;
    if (!this.observer && this.target) {
      const MO = this.win.MutationObserver;
      if (!MO) return;
      this.observer = new MO((mutations) => this.collect(mutations));
      this.observer.observe(this.target, { childList: true, subtree: true });
    }
    if (this.pending.size || this.removed) this.scheduleFlush();
  }

  /** Observe but only buffer until start() is called. */
  startPaused() {
    this.start();
    this.paused = true;
  }

  stop() {
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    this.flushDebounced?.cancel();
    this.pending.clear();
    this.removed = false;
  }

  /** Forget buffered mutations (e.g. when a full scan covers them anyway). */
  discardPending() {
    this.flushDebounced?.cancel();
    this.pending.clear();
    this.removed = false;
  }

  get running() {
    return !!this.observer && !this.paused;
  }

  collect(mutations) {
    let relevant = false;
    for (const m of mutations) {
      if (!this.removed && m.removedNodes.length) {
        for (const n of m.removedNodes) {
          if (!isOurs(n)) {
            this.removed = true;
            relevant = true;
            break;
          }
        }
      }
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          if (IGNORED_TAGS.has(node.tagName) || isOurs(node)) continue;
          this.pending.add(node);
          relevant = true;
        } else if (node.nodeType === 3 && node.parentElement && node.nodeValue.trim()) {
          if (isOurs(node.parentElement) || IGNORED_TAGS.has(node.parentElement.tagName)) continue;
          this.pending.add(node.parentElement);
          relevant = true;
        }
      }
    }
    if (relevant && !this.paused) this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushDebounced) this.flushDebounced();
    else this.flush(); // synchronous: still inside the MutationObserver microtask, before paint
  }

  /** Reduce pending nodes to connected, non-nested roots. */
  takeRoots() {
    const nodes = [];
    for (const n of this.pending) if (n.isConnected) nodes.push(n);
    this.pending.clear();
    if (nodes.length > FULL_RESCAN_THRESHOLD) return [this.target];
    const set = new Set(nodes);
    return nodes.filter((n) => {
      for (let p = n.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  flush() {
    const removed = this.removed;
    this.removed = false;
    const roots = this.takeRoots();
    if (roots.length || removed) this.onNodes(roots, { removed });
  }
}
