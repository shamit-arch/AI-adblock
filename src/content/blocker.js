/**
 * Blocker — applies and reverts blocking actions on page elements.
 *
 * Original content is never removed or moved: blocked elements only receive a
 * `data-aicb-state` attribute (styled by blocker.css) and, for placeholder /
 * collapse modes, a sibling Shadow-DOM notice is inserted before them.
 * Restoring removes both, leaving the page exactly as it was.
 *
 *   placeholder  element hidden, notice card with [Show content] [Always allow site]
 *   collapse     element clipped to a few lines, slim notice bar with [Expand]
 *   blur         element blurred; click to reveal
 *   hide         element hidden (restore from the popup)
 */

import { STATE_ATTR, TABLE_PART_TAGS } from './dom-filters.js';
import { createNoticeHost, isDarkBackground, renderNotice } from './placeholder.js';

const STATE_FOR_ACTION = {
  placeholder: 'placeholder',
  collapse: 'collapsed',
  blur: 'blurred',
  hide: 'hidden',
};

let nextId = 1;

export class Blocker {
  /**
   * @param {{doc?: Document, getSettings: () => object, onChange?: () => void,
   *          onAllowSite?: () => void, onReveal?: (record) => void}} config
   */
  constructor({ doc = document, getSettings, onChange = () => {}, onAllowSite = null, onReveal = () => {}, onRehide = () => {} }) {
    this.doc = doc;
    this.getSettings = getSettings;
    this.onChange = onChange;
    this.onAllowSite = onAllowSite;
    this.onReveal = onReveal;
    this.onRehide = onRehide;
    /** @type {Map<Element, object>} */
    this.records = new Map();
  }

  has(element) {
    return this.records.has(element);
  }

  get(element) {
    return this.records.get(element);
  }

  /** Placeholder/collapse need a sibling notice; table parts can't host one safely. */
  effectiveAction(element, action) {
    if ((action === 'placeholder' || action === 'collapse') && (TABLE_PART_TAGS.has(element.tagName) || !element.parentElement)) {
      return 'blur';
    }
    return action;
  }

  /**
   * Block (or update) an element.
   * @param {Element} element
   * @param {object} result DetectionResult (or site-label result)
   * @param {{source?: string, revealed?: boolean}} [opts]
   */
  block(element, result, { source = 'detector', revealed = false } = {}) {
    const existing = this.records.get(element);
    if (existing) {
      existing.result = result;
      existing.source = source;
      if (existing.state === 'revealed') this.render(existing);
      else this.apply(existing);
      this.onChange();
      return existing;
    }
    const record = {
      id: nextId++,
      element,
      result,
      source,
      state: 'blocked',
      action: null,
      host: null,
      outer: null,
      shadow: null,
      savedTitle: undefined,
      clickHandler: null,
    };
    this.records.set(element, record);
    element.setAttribute('data-aicb-id', String(record.id));
    if (revealed) {
      record.action = this.effectiveAction(element, this.getSettings().action);
      this.setRevealed(record);
    } else {
      this.apply(record);
    }
    this.onChange();
    return record;
  }

  apply(record) {
    const { element } = record;
    const action = this.effectiveAction(element, this.getSettings().action);
    this.detachBlur(record);
    record.action = action;
    record.state = 'blocked';
    element.setAttribute(STATE_ATTR, STATE_FOR_ACTION[action]);
    if (action === 'placeholder' || action === 'collapse') {
      this.ensureHost(record);
      this.render(record);
    } else {
      this.removeHost(record);
      if (action === 'blur') this.attachBlur(record);
    }
  }

  setRevealed(record) {
    this.detachBlur(record);
    record.state = 'revealed';
    record.element.setAttribute(STATE_ATTR, 'revealed');
    if (record.action === 'placeholder' || record.action === 'collapse') {
      this.ensureHost(record);
      this.render(record);
    } else {
      this.removeHost(record);
    }
  }

  ensureHost(record) {
    if (record.host && record.outer.isConnected) return;
    const { element } = record;
    if (!element.parentElement) return;
    const parentTag = element.parentElement.tagName;
    let inline = false;
    try {
      inline = (this.doc.defaultView.getComputedStyle(element).display || '').startsWith('inline');
    } catch {
      /* ignore */
    }
    const { host, outer, shadow } = createNoticeHost(this.doc, {
      listItem: parentTag === 'UL' || parentTag === 'OL',
      inline,
      dark: isDarkBackground(element),
    });
    record.host = host;
    record.outer = outer;
    record.shadow = shadow;
    element.before(outer);
  }

  removeHost(record) {
    if (record.outer) record.outer.remove();
    record.host = record.outer = record.shadow = null;
  }

  render(record) {
    if (!record.shadow) return;
    const settings = this.getSettings();
    const view = record.state === 'revealed' ? 'revealed' : record.action === 'collapse' ? 'collapsed' : 'placeholder';
    renderNotice(
      record.shadow,
      this.doc,
      { view, result: record.result, showReasons: settings.showReasons, allowSite: !!this.onAllowSite },
      {
        show: () => this.reveal(record.element),
        hide: () => this.rehide(record.element),
        allow: () => this.onAllowSite && this.onAllowSite(),
      },
    );
  }

  attachBlur(record) {
    const { element } = record;
    record.savedTitle = element.getAttribute('title');
    element.setAttribute('title', `${record.result.labelText} (${record.result.siteLabeled ? 'site label' : record.result.score + '%'}). Click to reveal.`);
    record.clickHandler = (e) => {
      if (record.state !== 'blocked') return;
      e.preventDefault();
      e.stopPropagation();
      this.reveal(element);
    };
    element.addEventListener('click', record.clickHandler, true);
  }

  detachBlur(record) {
    if (!record.clickHandler) return;
    record.element.removeEventListener('click', record.clickHandler, true);
    record.clickHandler = null;
    if (record.savedTitle === null) record.element.removeAttribute('title');
    else if (record.savedTitle !== undefined) record.element.setAttribute('title', record.savedTitle);
    record.savedTitle = undefined;
  }

  /** Show the original content (keeps a small "Hide again" bar where applicable). */
  reveal(element) {
    const record = this.records.get(element);
    if (!record || record.state === 'revealed') return false;
    this.setRevealed(record);
    this.onReveal(record);
    this.onChange();
    return true;
  }

  /** Re-block a revealed element. */
  rehide(element) {
    const record = this.records.get(element);
    if (!record || record.state !== 'revealed') return false;
    this.apply(record);
    this.onRehide(record);
    this.onChange();
    return true;
  }

  /** Remove all traces of blocking from an element. */
  unblock(element, { silent = false } = {}) {
    const record = this.records.get(element);
    if (!record) return false;
    this.detachBlur(record);
    this.removeHost(record);
    element.removeAttribute(STATE_ATTR);
    element.removeAttribute('data-aicb-id');
    this.records.delete(element);
    if (!silent) this.onChange();
    return true;
  }

  showAll() {
    let n = 0;
    for (const record of this.records.values()) {
      if (record.state !== 'revealed') {
        this.setRevealed(record);
        this.onReveal(record);
        n++;
      }
    }
    if (n) this.onChange();
    return n;
  }

  blockAll() {
    let n = 0;
    for (const record of this.records.values()) {
      if (record.state === 'revealed') {
        this.apply(record);
        this.onRehide(record);
        n++;
      }
    }
    if (n) this.onChange();
    return n;
  }

  /** Restore every element (used when disabling or allow-listing the site). */
  restoreAll() {
    const n = this.records.size;
    for (const element of [...this.records.keys()]) this.unblock(element, { silent: true });
    if (n) this.onChange();
    return n;
  }

  /** Re-apply the current action to blocked elements after a settings change. */
  refreshAll() {
    for (const record of this.records.values()) {
      if (record.state === 'blocked') this.apply(record);
      else {
        record.action = this.effectiveAction(record.element, this.getSettings().action);
        this.setRevealed(record);
      }
    }
    this.onChange();
  }

  /**
   * Re-detect light/dark page backgrounds. Content can be blocked while the
   * page is still parsing, before its stylesheets have applied.
   */
  refreshThemes() {
    for (const record of this.records.values()) {
      if (record.host) record.host.setAttribute('data-theme', isDarkBackground(record.element) ? 'dark' : 'light');
    }
  }

  /** Drop records whose elements were removed by the page. */
  cleanup() {
    let removed = 0;
    for (const [element, record] of [...this.records]) {
      if (!element.isConnected) {
        this.detachBlur(record);
        this.removeHost(record);
        this.records.delete(element);
        removed++;
      } else if (record.outer && !record.outer.isConnected) {
        // The page re-rendered and dropped our notice; put it back.
        record.host = record.outer = record.shadow = null;
        if (record.state === 'revealed') this.setRevealed(record);
        else this.apply(record);
      }
    }
    if (removed) this.onChange();
    return removed;
  }

  stats() {
    let blocked = 0;
    let revealed = 0;
    for (const r of this.records.values()) {
      if (r.state === 'revealed') revealed++;
      else blocked++;
    }
    return { detected: this.records.size, blocked, visible: revealed };
  }
}
