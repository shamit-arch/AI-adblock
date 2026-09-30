/**
 * Extracts analysable text from a content unit while keeping enough
 * structure (paragraphs, list items, headings) for the style detector.
 *
 * Unlike `innerText` this never forces a layout, skips excluded subtrees
 * (code, buttons, navigation, our own UI), and reports link density so
 * link lists can be ignored.
 */

import { INLINE_TAGS, isExcludedElement, isOwnElement } from './dom-filters.js';

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const MAX_DEPTH = 80;

function blockTypeFor(tag, inherited) {
  if (tag === 'LI' || tag === 'DT' || tag === 'DD') return 'li';
  if (HEADING_TAGS.has(tag)) return 'h';
  if (tag === 'BLOCKQUOTE') return 'quote';
  return inherited || 'p';
}

/**
 * @param {Element} unit
 * @param {{maxChars?: number, excludeSelector?: string}} [options]
 * @returns {{text: string, blocks: {type: string, text: string}[], linkDensity: number, charCount: number}}
 */
export function extractText(unit, { maxChars = 12000, excludeSelector } = {}) {
  const blocks = [];
  let current = null;
  let total = 0;
  let linkChars = 0;
  let done = false;

  const startBlock = (type) => {
    current = { type, parts: [] };
    blocks.push(current);
  };
  const endBlock = () => {
    current = null;
  };

  const visit = (node, type, inLink, depth) => {
    if (done || depth > MAX_DEPTH) return;
    if (node.nodeType === 3) {
      const value = node.nodeValue;
      if (!value) return;
      if (!/\S/.test(value)) {
        if (current) current.parts.push(' ');
        return;
      }
      if (!current) startBlock(type);
      const remaining = maxChars - total;
      const piece = value.length > remaining ? value.slice(0, remaining) : value;
      current.parts.push(piece);
      const len = piece.trim().length;
      total += len;
      if (inLink) linkChars += len;
      if (total >= maxChars || piece !== value) done = true;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = /** @type {Element} */ (node);
    if (isOwnElement(el) || (el !== unit && isExcludedElement(el, excludeSelector))) return;

    const tag = el.tagName;
    if (tag === 'BR') {
      endBlock();
      return;
    }
    const inline = INLINE_TAGS.has(tag);
    const childType = inline ? type : blockTypeFor(tag, type === 'li' ? 'li' : type === 'quote' ? 'quote' : undefined);
    if (!inline) endBlock();
    const childInLink = inLink || tag === 'A';
    for (let child = el.firstChild; child; child = child.nextSibling) {
      visit(child, childType, childInLink, depth + 1);
      if (done) break;
    }
    if (!inline) endBlock();
  };

  visit(unit, blockTypeFor(unit.tagName), false, 0);

  const out = [];
  for (const b of blocks) {
    const text = b.parts.join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ type: b.type, text });
  }
  const text = out.map((b) => b.text).join('\n');
  return {
    text,
    blocks: out,
    linkDensity: total ? linkChars / total : 0,
    charCount: text.length,
  };
}
