/**
 * Element classification used by discovery and text extraction:
 * which elements are never analysed (navigation, forms, code, banners…),
 * which are inline, which count as prose.
 */

export const HOST_TAG = 'AICB-NOTICE';
export const WRAPPER_ATTR = 'data-aicb-wrapper';
export const STATE_ATTR = 'data-aicb-state';
/** Set briefly on new content that is waiting for analysis (hidden, layout kept). */
export const PENDING_ATTR = 'data-aicb-pending';

/** Subtrees that are never analysed. */
export const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED',
  'VIDEO', 'AUDIO', 'MAP', 'MATH', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TEXTAREA', 'INPUT',
  'SELECT', 'OPTION', 'OPTGROUP', 'BUTTON', 'LABEL', 'FIELDSET', 'LEGEND', 'DATALIST', 'OUTPUT',
  'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'MENU', 'HEAD', 'TITLE', 'META', 'LINK', 'DIALOG', 'ADDRESS',
  HOST_TAG,
]);

export const EXCLUDED_ROLES = new Set([
  'navigation', 'banner', 'contentinfo', 'menu', 'menubar', 'menuitem', 'toolbar', 'tablist',
  'tab', 'search', 'button', 'alertdialog', 'complementary', 'tooltip', 'listbox', 'combobox',
  'textbox', 'searchbox', 'slider', 'switch', 'checkbox', 'radio', 'option', 'tree', 'treegrid',
  'status', 'log', 'marquee', 'timer',
]);

/** Class/id tokens that mark site chrome rather than content. */
const CHROME_TOKEN_RE =
  /(?:^|\s)(?:nav|navbar|navigation|menu|breadcrumbs?|pagination|pager|footer|header|masthead|sidebar|toolbar|share|sharing|social|related|newsletter|subscribe|signup|advert|advertisement|ads?|ad-slot|sponsored|promo|banner|skip-link|sr-only|visually-hidden|screen-reader-text)(?:[\s_-]|$)/i;

const CONSENT_RE =
  /(?:cookie|consent|gdpr|onetrust|cookiebot|didomi|truste|qc-cmp|cmp-|usercentrics|osano|termly|iubenda|cc-window|cc-banner|privacy-banner)/i;

export const INLINE_TAGS = new Set([
  'A', 'ABBR', 'ACRONYM', 'B', 'BDI', 'BDO', 'BIG', 'CITE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT',
  'I', 'INS', 'MARK', 'NOBR', 'Q', 'S', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME',
  'TT', 'U', 'WBR', 'IMG', 'RUBY', 'RT', 'RP',
]);

/** Children that are compatible with running prose. */
export const PROSE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'DL', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'HR',
  'BR', 'TABLE', 'PICTURE', 'IMG', 'CODE',
]);

/** Prose elements that carry paragraphs of text. */
export const STRONG_PROSE_TAGS = new Set(['P', 'UL', 'OL', 'DL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** Elements ignored when judging a container's children. */
export const NEUTRAL_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', HOST_TAG]);

export const TABLE_PART_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP', 'COL']);

export function isOwnElement(el) {
  return el.tagName === HOST_TAG || (el.hasAttribute && el.hasAttribute(WRAPPER_ATTR));
}

function classAndId(el) {
  const cls = el.getAttribute('class');
  const id = el.id;
  return cls && id ? `${cls} ${id}` : cls || id || '';
}

/**
 * Is this element (not its ancestors) something we must never analyse?
 * @param {Element} el
 * @param {string} [extraSelector] adapter-specific exclusions
 */
export function isExcludedElement(el, extraSelector) {
  const tag = el.tagName;
  if (EXCLUDED_TAGS.has(tag)) return true;
  if (el.hasAttribute(WRAPPER_ATTR)) return true;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.getAttribute('inert') !== null) return true;
  const role = el.getAttribute('role');
  if (role && EXCLUDED_ROLES.has(role)) return true;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
  const tokens = classAndId(el);
  if (tokens && (CHROME_TOKEN_RE.test(tokens) || CONSENT_RE.test(tokens))) return true;
  if (extraSelector) {
    try {
      if (el.matches(extraSelector)) return true;
    } catch {
      /* invalid adapter selector: ignore */
    }
  }
  return false;
}

/**
 * Memoised "is this element or any ancestor excluded" check. Create one per
 * scan pass; results are valid only while the DOM does not change.
 */
export function createExclusionChecker(extraSelector, stopAt) {
  const cache = new Map();
  const check = (el) => {
    if (!el || el === stopAt || el.nodeType !== 1) return false;
    if (cache.has(el)) return cache.get(el);
    const result = isExcludedElement(el, extraSelector) || check(el.parentElement);
    cache.set(el, result);
    return result;
  };
  return check;
}

/** Length of the text directly inside `el` (not in child elements). */
export function directTextLength(el) {
  let n = 0;
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) n += node.nodeValue.trim().length;
  }
  return n;
}

/** Nearest ancestor-or-self that is not an inline element. */
export function nearestBlock(el) {
  let cur = el;
  while (cur && INLINE_TAGS.has(cur.tagName) && cur.parentElement) cur = cur.parentElement;
  return cur;
}
