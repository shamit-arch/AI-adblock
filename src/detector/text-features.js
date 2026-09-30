/**
 * Text feature extraction shared by all detectors.
 *
 * Features are computed once per text and reused by every detector, so the
 * expensive parts (tokenising, sentence splitting) run a single time.
 */

import { ABBREVIATIONS, ENGLISH_STOPWORDS } from './lexicon.js';

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const WORD_RE = /[a-z0-9]+(?:['-][a-z0-9]+)*/g;
const BULLET_RE = /^\s*(?:[-*•‣◦▪●–]|\d{1,2}[.)]|[a-z][.)])\s+/i;
const MD_HEADING_RE = /^\s*#{1,6}\s+\S/;

/** Normalise typographic quotes/dashes/spaces so patterns can stay ASCII. */
export function normalizeTypography(text) {
  return text
    .replace(/[‘’‛ʼ′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, '...')
    .replace(/[    ]/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

export function stripUrlsAndEmails(text) {
  return text.replace(URL_RE, ' ').replace(EMAIL_RE, ' ');
}

export function tokenize(text) {
  return text.toLowerCase().match(WORD_RE) || [];
}

function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Coefficient of variation (sd / mean). 0 when undefined. */
export function coefficientOfVariation(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  if (!m) return 0;
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / values.length) / m;
}

/**
 * Split prose into sentences, keeping common abbreviations and initials intact.
 */
export function splitSentences(text) {
  const out = [];
  for (const line of text.split(/\n+/)) {
    const pieces = line.split(/(?<=[.!?])["')\]]*\s+/);
    let buffer = '';
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      buffer = buffer ? `${buffer} ${piece}` : piece;
      const lastWord = buffer.trim().split(/\s+/).pop() || '';
      const endsWithPeriod = lastWord.endsWith('.');
      const bare = lastWord.toLowerCase().replace(/^[("'[]+/, '').replace(/[.]+$/, '');
      const isAbbrev =
        endsWithPeriod &&
        (ABBREVIATIONS.has(bare) || /^[a-z]$/i.test(bare) || /^(?:[a-z]\.){1,3}[a-z]?$/i.test(bare));
      if (isAbbrev && i < pieces.length - 1) continue;
      const s = buffer.trim();
      if (s) out.push(s);
      buffer = '';
    }
    if (buffer.trim()) out.push(buffer.trim());
  }
  return out;
}

/** Infer block structure from plain text (used when no DOM structure is given). */
export function parseBlocks(text) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (MD_HEADING_RE.test(line)) {
      blocks.push({ type: 'h', text: line.replace(/^\s*#{1,6}\s+/, '') });
      continue;
    }
    if (BULLET_RE.test(line)) {
      blocks.push({ type: 'li', text: line.replace(BULLET_RE, '') });
      continue;
    }
    const words = line.split(/\s+/).length;
    const next = lines[i + 1];
    if (next && words <= 8 && !/[.!?,;:]$/.test(line) && /^[A-Z0-9"']/.test(line) && next.split(/\s+/).length > words) {
      blocks.push({ type: 'h', text: line });
      continue;
    }
    blocks.push({ type: 'p', text: line });
  }
  return blocks;
}

function normalizeBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    let text = normalizeTypography(stripUrlsAndEmails(String(b.text || ''))).trim();
    if (!text) continue;
    let type = b.type === 'li' || b.type === 'h' || b.type === 'quote' ? b.type : 'p';
    if (type === 'p' && BULLET_RE.test(text) && text.length < 600) {
      type = 'li';
      text = text.replace(BULLET_RE, '');
    }
    if (MD_HEADING_RE.test(text)) {
      type = 'h';
      text = text.replace(/^\s*#{1,6}\s+/, '');
    }
    out.push({ type, text });
  }
  return out;
}

function countMarkdownArtifacts(raw) {
  let n = 0;
  n += (raw.match(/\*\*[^*\n]{2,80}\*\*/g) || []).length;
  n += (raw.match(/^\s*#{1,6}\s+\S/gm) || []).length;
  n += (raw.match(/```/g) || []).length;
  n += (raw.match(/(?:^|\s)__[^_\n]{2,60}__(?=\s|[.,:]|$)/g) || []).length;
  return n;
}

/** [start, end) ranges of text inside double quotes, used to discount quoted phrases. */
function findQuotedRanges(text) {
  const ranges = [];
  const re = /"([^"\n]{2,600})"|(?:^|[\s(])'([^'\n]{8,400})'(?=[\s.,;:!?)]|$)/g;
  let m;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

export function looksLikeCode(text) {
  const lines = text.split(/\n/).filter((l) => l.trim());
  if (!lines.length) return false;
  const symbols = (text.match(/[{}();=<>[\]$|&\\]/g) || []).length;
  const ratio = symbols / Math.max(1, text.length);
  const codeLine =
    /(?:[;{}]\s*$|^\s*(?:function|const|let|var|def|class|import|export|return|public|private|#include|package|using|SELECT|FROM)\b|=>|\)\s*\{|^\s*\/\/|^\s*<\/?[a-z][\w-]*[\s>])/;
  const codeLines = lines.filter((l) => codeLine.test(l)).length;
  return ratio > 0.07 || (lines.length >= 3 && codeLines / lines.length > 0.35);
}

/**
 * @typedef {ReturnType<typeof computeFeatures>} TextFeatures
 * @param {import('./types.js').DetectionInput | string} input
 */
export function computeFeatures(input) {
  const src = typeof input === 'string' ? { text: input } : input || { text: '' };
  const rawText = String(src.text || '');
  const text = normalizeTypography(stripUrlsAndEmails(rawText)).replace(/\n\s*\n+/g, '\n').trim();
  const blocks = src.blocks && src.blocks.length ? normalizeBlocks(src.blocks) : parseBlocks(text);

  const words = tokenize(text);
  const wordCount = words.length;

  const proseBlocks = blocks.filter((b) => b.type === 'p' || b.type === 'quote');
  const proseText = proseBlocks.map((b) => b.text).join('\n');
  const allSentences = splitSentences(blocks.filter((b) => b.type !== 'h').map((b) => b.text).join('\n'));
  const proseSentences = splitSentences(proseText).filter((s) => s.split(/\s+/).length >= 3);
  const sentenceLengths = proseSentences.map((s) => s.split(/\s+/).length);

  const paragraphLengths = proseBlocks
    .map((b) => b.text.split(/\s+/).length)
    .filter((n) => n >= 12);

  const normalizedSentences = allSentences.map((s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()).filter(Boolean);
  const uniqueSentenceRatio = normalizedSentences.length
    ? new Set(normalizedSentences).size / normalizedSentences.length
    : 1;

  let stopwords = 0;
  for (const w of words) if (ENGLISH_STOPWORDS.has(w)) stopwords++;

  // Concrete specifics: numbers and mid-sentence proper nouns per 100 words.
  let specifics = 0;
  for (const sentence of allSentences) {
    const tokens = sentence.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].replace(/^[("'[]+|[)"'\].,;:!?]+$/g, '');
      if (!t) continue;
      if (/\d/.test(t)) specifics++;
      else if (i > 0 && /^[A-Z][a-z]/.test(t) && !/^I(?:'[a-z]+)?$/.test(t) && !/[:.]$/.test(tokens[i - 1])) specifics++;
    }
  }

  const headings = blocks.filter((b) => b.type === 'h');
  const listItems = blocks.filter((b) => b.type === 'li');
  const lastProse = proseBlocks.length ? proseBlocks[proseBlocks.length - 1].text : '';

  return {
    rawText,
    text,
    lower: text.toLowerCase(),
    blocks,
    words,
    wordCount,
    charCount: text.length,
    sentences: allSentences,
    proseSentences,
    sentenceLengths,
    meanSentenceLength: mean(sentenceLengths),
    sentenceLengthCV: coefficientOfVariation(sentenceLengths),
    paragraphLengths,
    paragraphCV: coefficientOfVariation(paragraphLengths),
    headings,
    listItems,
    proseBlocks,
    firstSentence: (allSentences[0] || '').trim(),
    lastParagraph: lastProse,
    lastSentences: allSentences.slice(-3).join(' '),
    uniqueSentenceRatio,
    stopwordRatio: wordCount ? stopwords / wordCount : 0,
    specificityDensity: (specifics * 100) / Math.max(60, wordCount),
    markdownArtifacts: countMarkdownArtifacts(rawText),
    quotedRanges: findQuotedRanges(text),
    codeLike: looksLikeCode(rawText),
    linkDensity: src.meta && Number.isFinite(src.meta.linkDensity) ? src.meta.linkDensity : 0,
  };
}

/** True if `index` falls inside a quoted span. */
export function isInQuotes(features, index) {
  for (const [start, end] of features.quotedRanges) {
    if (index >= start && index < end) return true;
  }
  return false;
}
