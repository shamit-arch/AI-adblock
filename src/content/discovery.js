/**
 * Candidate discovery: finds the content *units* worth analysing.
 *
 * A unit is the smallest container that holds one coherent piece of writing:
 * an article body, a comment body, a post, a review, a search snippet.
 *
 *   1. Adapter units — site-specific selectors (Reddit comment bodies, tweets…)
 *      and well-known platform selectors (WordPress, Discourse, XenForo…).
 *   2. Generic units — every text-bearing block is mapped to its nearest block
 *      ancestor, then climbed to the enclosing "paragraph group" (a container
 *      whose children are mostly prose). Lists of items (feeds, comment
 *      threads) stop the climb so each item stays its own unit.
 *
 * Excluded subtrees (nav, header, footer, forms, code, banners…) are skipped
 * by the tree walker itself, so they are never even visited.
 */

import {
  createExclusionChecker,
  directTextLength,
  INLINE_TAGS,
  isExcludedElement,
  isOwnElement,
  nearestBlock,
  NEUTRAL_TAGS,
  PROSE_TAGS,
  STRONG_PROSE_TAGS,
} from './dom-filters.js';
import { HARD_LIMITS } from '../shared/constants.js';

const STOP_TAGS = new Set(['BODY', 'HTML']);

/**
 * Elements chosen as units by *climbing* to a paragraph group. Their
 * validity depends on their children, which can change while a page is still
 * loading, so they are re-validated later (see Scanner.revalidate).
 */
export const GROUP_UNITS = new WeakSet();
const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'SPAN']);
const MIN_BLOCK_CHARS = 20;
const MAX_CLIMB = 6;

function safeQueryAll(root, selector) {
  if (!selector || !root.querySelectorAll) return [];
  try {
    return root.querySelectorAll(selector);
  } catch {
    return [];
  }
}

function safeClosest(el, selector) {
  if (!selector || !el || !el.closest) return null;
  try {
    return el.closest(selector);
  } catch {
    return null;
  }
}

/** A DIV/SECTION whose children are paragraphs (or that holds a paragraph of bare text). */
function isProseContainer(el) {
  if (!CONTAINER_TAGS.has(el.tagName)) return false;
  if (directTextLength(el) >= 40) return true;
  const kids = el.children;
  if (!kids.length || kids.length > 12) return false;
  let strong = 0;
  for (const k of kids) {
    if (NEUTRAL_TAGS.has(k.tagName)) continue;
    if (STRONG_PROSE_TAGS.has(k.tagName)) strong++;
    else if (!PROSE_TAGS.has(k.tagName) && !INLINE_TAGS.has(k.tagName)) return false;
  }
  return strong > 0;
}

/** Container whose children are mostly running prose. */
export function isParagraphGroup(el) {
  const kids = el.children;
  const n = kids.length;
  if (!n || n > 400) return false;
  let considered = 0;
  let prose = 0;
  let strong = 0;
  for (let i = 0; i < n && i < 80; i++) {
    const k = kids[i];
    const tag = k.tagName;
    if (NEUTRAL_TAGS.has(tag) || isOwnElement(k)) continue;
    considered++;
    if (STRONG_PROSE_TAGS.has(tag)) {
      prose++;
      strong++;
    } else if (PROSE_TAGS.has(tag) || INLINE_TAGS.has(tag)) {
      prose++;
    } else if (tag !== 'ARTICLE' && isProseContainer(k)) {
      // An <article> is self-contained: several of them form a list, not a text.
      prose++;
      strong++;
    }
  }
  if (directTextLength(el) >= 40) strong++;
  return strong > 0 && considered > 0 && prose / considered >= 0.6;
}

function onlyChild(parent, child) {
  if (directTextLength(parent) > 0) return false;
  for (const k of parent.children) {
    if (k !== child && !NEUTRAL_TAGS.has(k.tagName) && !isOwnElement(k)) return false;
  }
  return true;
}

function strongProseChildren(el) {
  let n = 0;
  for (const k of el.children) if (STRONG_PROSE_TAGS.has(k.tagName) || isProseContainer(k)) n++;
  return n;
}

/** Does `el` look like one item among repeated sibling items (feed, thread)? */
function isRepeatedItem(el) {
  const parent = el.parentElement;
  if (!parent) return false;
  const signature = `${el.tagName}.${el.getAttribute('class') || ''}`;
  let similar = 0;
  let checked = 0;
  for (const sib of parent.children) {
    if (sib === el) continue;
    if (++checked > 50) break;
    if (`${sib.tagName}.${sib.getAttribute('class') || ''}` === signature && strongProseChildren(sib) >= 2) {
      if (++similar >= 2) return true;
    }
  }
  return false;
}

/**
 * Climb from a text block to the paragraph group that contains it.
 * @param {Element} block
 * @param {{excluded: (el: Element) => boolean, textLength: (el: Element) => number, maxUnitChars: number}} ctx
 */
export function resolveGenericUnit(block, ctx) {
  let unit = block;
  // `cursor` may run ahead of `unit` through single-child wrappers: they add
  // no content, so we pass through them but only commit to a real group.
  let cursor = block;
  for (let step = 0; step < MAX_CLIMB + 2; step++) {
    const parent = cursor.parentElement;
    if (!parent || STOP_TAGS.has(parent.tagName)) break;
    if (ctx.excluded(parent)) break;
    if (onlyChild(parent, cursor)) {
      cursor = parent;
      continue;
    }
    if (!isParagraphGroup(parent)) break;
    if (ctx.textLength(parent) > ctx.maxUnitChars) break;
    // A multi-paragraph block with look-alike siblings is an item in a list
    // (a post in a feed, a comment in a thread): keep it separate.
    if (cursor !== block && strongProseChildren(cursor) >= 2 && isRepeatedItem(cursor)) break;
    unit = cursor = parent;
  }
  if (unit !== block) GROUP_UNITS.add(unit);
  return unit;
}

/** A group unit stays valid only while it still looks like a paragraph group. */
export function isStillValidUnit(el) {
  return !GROUP_UNITS.has(el) || isParagraphGroup(el);
}

/**
 * Find analysable units inside `root`.
 * @param {Element} root
 * @param {{adapter: object, maxUnitChars?: number}} options
 * @returns {Element[]} units in document order, outermost only
 */
export function discoverUnits(root, { adapter, maxUnitChars = HARD_LIMITS.maxUnitChars }) {
  const doc = root.ownerDocument || root;
  const body = doc.body;
  if (!root || !body) return [];
  const scope = root.nodeType === 9 ? body : root;
  const excluded = createExclusionChecker(adapter.excludeSelector, null);
  if (scope !== body && excluded(scope)) return [];

  const lengths = new Map();
  const textLength = (el) => {
    let n = lengths.get(el);
    if (n === undefined) {
      n = el.textContent.length;
      lengths.set(el, n);
    }
    return n;
  };

  const adapterUnits = new Set();
  const unitSel = adapter.unitSelector;
  if (unitSel) {
    for (const el of safeQueryAll(scope, unitSel)) {
      if (!excluded(el)) adapterUnits.add(el);
    }
    const enclosing = safeClosest(scope, unitSel);
    if (enclosing && !excluded(enclosing)) adapterUnits.add(enclosing);
  }

  const genericUnits = new Set();
  if (adapter.useGeneric !== false) {
    const blockText = new Map();
    const blockOf = new Map();
    const walker = doc.createTreeWalker(scope, 1 | 4 /* SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode(node) {
        if (node.nodeType === 3) return node.nodeValue.trim() ? 1 : 3; // ACCEPT : SKIP
        if (isOwnElement(node) || isExcludedElement(node, adapter.excludeSelector)) return 2; // REJECT
        if (unitSel && adapterUnits.has(node)) return 2;
        return 3; // SKIP (descend)
      },
    });
    // The walker does not re-check ancestors of `scope`; that was done above.
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      let block = blockOf.get(parent);
      if (block === undefined) {
        block = nearestBlock(parent);
        blockOf.set(parent, block);
      }
      if (!block || STOP_TAGS.has(block.tagName)) continue;
      blockText.set(block, (blockText.get(block) || 0) + node.nodeValue.trim().length);
    }

    const ctx = { excluded, textLength, maxUnitChars };
    for (const [block, chars] of blockText) {
      if (chars < MIN_BLOCK_CHARS) continue;
      if (scope !== body && !scope.contains(block) && excluded(block)) continue;
      if (unitSel && safeClosest(block, unitSel)) continue; // belongs to an adapter unit
      const unit = resolveGenericUnit(block, ctx);
      if (unit && !STOP_TAGS.has(unit.tagName)) genericUnits.add(unit);
    }
  }

  // Adapter units win over generic ones that contain or sit inside them.
  if (adapterUnits.size && genericUnits.size) {
    for (const a of adapterUnits) {
      for (let p = a.parentElement; p; p = p.parentElement) {
        if (genericUnits.has(p)) genericUnits.delete(p);
      }
    }
  }

  const all = new Set([...adapterUnits, ...genericUnits]);
  const result = [];
  for (const u of all) {
    let nested = false;
    for (let p = u.parentElement; p; p = p.parentElement) {
      if (all.has(p)) {
        nested = true;
        break;
      }
    }
    if (!nested) result.push(u);
  }

  result.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    return pos & 4 /* FOLLOWING */ ? -1 : pos & 2 /* PRECEDING */ ? 1 : 0;
  });
  return result;
}
