/**
 * Shadow-DOM notice rendered in place of (or above) blocked content.
 *
 * Built with createElement/textContent only (no innerHTML) so it works on
 * pages with Trusted Types, and styled inside a shadow root so site CSS
 * cannot leak in and ours cannot leak out.
 */

import { HOST_TAG, WRAPPER_ATTR } from './dom-filters.js';

const STYLE = `
:host { all: initial; display: block; box-sizing: border-box; contain: content; }
:host([data-inline]) { display: inline-block; vertical-align: middle; }
* { box-sizing: border-box; }
.card, .bar {
  --bg: #f7f7fb; --fg: #1d1d27; --muted: #5d5f73; --border: #d9dae6; --accent: #5b4bdb;
  --accent-fg: #ffffff; --btn-bg: #ffffff; --btn-hover: #eeeefa; --badge-bg: #ebe8ff;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--fg); background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  text-align: left; letter-spacing: normal; text-transform: none; word-spacing: normal;
}
:host([data-theme="dark"]) .card, :host([data-theme="dark"]) .bar {
  --bg: #20212b; --fg: #ececf3; --muted: #a4a6ba; --border: #3a3b4a; --accent: #8e82ff;
  --accent-fg: #14141c; --btn-bg: #2b2c38; --btn-hover: #363746; --badge-bg: #332f5e;
}
.card { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 10px 12px; margin: 6px 0; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 5px 10px; margin: 4px 0; font-size: 12px; }
.info { display: flex; align-items: center; gap: 10px; flex: 1 1 220px; min-width: 0; }
.badge {
  flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border-radius: 8px; background: var(--badge-bg); color: var(--accent); font-weight: 700; font-size: 11px;
}
.bar .badge { width: 20px; height: 20px; border-radius: 6px; font-size: 9px; }
.text { min-width: 0; }
.title { font-weight: 600; }
.meta { color: var(--muted); font-size: 12px; margin-top: 1px; }
.bar .meta { margin: 0; flex: 1 1 auto; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
button {
  font: inherit; font-size: 12px; line-height: 1.2; cursor: pointer; border-radius: 7px; padding: 5px 10px;
  border: 1px solid var(--border); background: var(--btn-bg); color: var(--fg); margin: 0;
}
button:hover { background: var(--btn-hover); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
button.primary:hover { filter: brightness(1.08); }
.bar button { padding: 3px 8px; font-size: 11px; }
`;

let sharedSheet = null;

function applyStyles(shadow, doc) {
  try {
    const win = doc.defaultView;
    if ('adoptedStyleSheets' in shadow && win && typeof win.CSSStyleSheet === 'function') {
      if (!sharedSheet) {
        sharedSheet = new win.CSSStyleSheet();
        sharedSheet.replaceSync(STYLE);
      }
      shadow.adoptedStyleSheets = [sharedSheet];
      return;
    }
  } catch {
    sharedSheet = null;
  }
  const style = doc.createElement('style');
  style.textContent = STYLE;
  shadow.appendChild(style);
}

const STOPPED_EVENTS = [
  'click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
  'touchstart', 'touchend', 'keydown', 'keyup', 'keypress', 'contextmenu', 'submit',
];

/**
 * Create the host element (plus an <li> wrapper when inserted into a list).
 * @returns {{host: HTMLElement, outer: HTMLElement, shadow: ShadowRoot}}
 */
export function createNoticeHost(doc, { listItem = false, inline = false, dark = false } = {}) {
  const host = doc.createElement(HOST_TAG.toLowerCase());
  host.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (inline) host.setAttribute('data-inline', '');
  host.style.setProperty('display', inline ? 'inline-block' : 'block', 'important');
  host.style.setProperty('position', 'static', 'important');
  host.style.setProperty('visibility', 'visible', 'important');
  host.style.setProperty('opacity', '1', 'important');
  host.style.setProperty('filter', 'none', 'important');
  host.style.setProperty('max-width', '100%', 'important');
  host.style.setProperty('float', 'none', 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  applyStyles(shadow, doc);

  // Keep interactions with our UI from triggering site handlers
  // (e.g. a whole post card being a link).
  for (const type of STOPPED_EVENTS) {
    host.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'click' || type === 'auxclick' || type === 'submit') e.preventDefault();
    });
  }

  let outer = host;
  if (listItem) {
    outer = doc.createElement('li');
    outer.setAttribute(WRAPPER_ATTR, '');
    outer.style.setProperty('list-style', 'none', 'important');
    outer.style.setProperty('margin', '0', 'important');
    outer.style.setProperty('padding', '0', 'important');
    outer.appendChild(host);
  }
  return { host, outer, shadow };
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, label, action, handlers, primary = false) {
  const b = el(doc, 'button', primary ? 'primary' : '', label);
  b.type = 'button';
  b.dataset.action = action;
  b.addEventListener('click', () => handlers[action]?.());
  return b;
}

export function describeConfidence(result) {
  if (result.siteLabeled) return 'Labeled as AI-generated by this site';
  return `Confidence: ${result.score}%`;
}

/**
 * Render the notice for a record.
 * @param {ShadowRoot} shadow
 * @param {{view: 'placeholder'|'collapsed'|'revealed', result: object, showReasons: boolean,
 *          allowSite: boolean}} state
 * @param {{show?: Function, hide?: Function, allow?: Function}} handlers
 */
export function renderNotice(shadow, doc, { view, result, showReasons, allowSite = true }, handlers) {
  for (const child of [...shadow.childNodes]) {
    if (child.nodeName !== 'STYLE') child.remove();
  }

  const title = result.labelText || 'Possibly AI-generated';
  const reasons = showReasons && result.reasons?.length ? ` · ${result.reasons.slice(0, 2).join(', ')}` : '';

  if (view === 'placeholder') {
    const card = el(doc, 'div', 'card');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'AI Content Blocker notice');
    const info = el(doc, 'div', 'info');
    info.append(el(doc, 'span', 'badge', 'AI'));
    const text = el(doc, 'div', 'text');
    text.append(el(doc, 'div', 'title', `${title} content blocked`));
    text.append(el(doc, 'div', 'meta', describeConfidence(result) + reasons));
    info.append(text);
    const actions = el(doc, 'div', 'actions');
    actions.append(button(doc, 'Show content', 'show', handlers, true));
    if (allowSite) actions.append(button(doc, 'Always allow site', 'allow', handlers));
    card.append(info, actions);
    shadow.append(card);
    return;
  }

  const bar = el(doc, 'div', 'bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'AI Content Blocker notice');
  bar.append(el(doc, 'span', 'badge', 'AI'));
  const conf = result.siteLabeled ? 'labeled by site' : `${result.score}%`;
  if (view === 'collapsed') {
    bar.append(el(doc, 'span', 'meta', `${title} (${conf}) — collapsed${reasons}`));
    const actions = el(doc, 'div', 'actions');
    actions.append(button(doc, 'Expand', 'show', handlers, true));
    if (allowSite) actions.append(button(doc, 'Always allow site', 'allow', handlers));
    bar.append(actions);
  } else {
    bar.append(el(doc, 'span', 'meta', `${title} (${conf}) — shown`));
    const actions = el(doc, 'div', 'actions');
    actions.append(button(doc, 'Hide again', 'hide', handlers));
    bar.append(actions);
  }
  shadow.append(bar);
}

/** Best-effort detection of a dark page background behind `element`. */
export function isDarkBackground(element) {
  try {
    const win = element.ownerDocument.defaultView;
    for (let cur = element.parentElement; cur; cur = cur.parentElement) {
      const bg = win.getComputedStyle(cur).backgroundColor;
      const m = bg && bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (!m) continue;
      const alpha = m[4] === undefined ? 1 : Number(m[4]);
      if (alpha < 0.5) continue;
      const [r, g, b] = [m[1], m[2], m[3]].map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
    }
    return !!win.matchMedia?.('(prefers-color-scheme: dark)').matches &&
      win.getComputedStyle(element.ownerDocument.documentElement).colorScheme?.includes('dark');
  } catch {
    return false;
  }
}
