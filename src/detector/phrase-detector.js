/**
 * PhraseDetector — known AI phrasing.
 *
 * Emits three signals:
 *   chatbot-artifacts  assistant boilerplate ("As an AI language model", "Certainly! Here are…")
 *   ai-phrasing        stock phrases LLMs overuse ("delve into", "plays a crucial role", …)
 *   ai-vocabulary      density of words LLMs overuse ("tapestry", "seamless", "moreover", …)
 * plus an `ai-disclosure` signal when the text says it was AI-generated.
 *
 * False-positive guards:
 *   - matches inside quotation marks count for 30%
 *   - if the text is *about* AI (mentions chatbots, LLMs, ChatGPT…), chatbot
 *     boilerplate counts for half, because articles quote such phrases
 *   - phrase/vocabulary counts are normalised by length with a floor, so a
 *     single stock phrase in a short comment is not decisive
 */

import { Detector } from './types.js';
import {
  AI_META_RE,
  AI_PHRASE_PATTERNS,
  AI_VOCABULARY,
  CHATBOT_PATTERNS,
  DISCLOSURE_PATTERNS,
} from './lexicon.js';
import { isInQuotes } from './text-features.js';
import { unit } from '../shared/utils.js';

const QUOTED_FACTOR = 0.3;
const META_DISCUSSION_FACTOR = 0.5;
const MAX_EVIDENCE = 6;

function collectMatches(text, re) {
  re.lastIndex = 0;
  return [...text.matchAll(re)];
}

export class PhraseDetector extends Detector {
  constructor() {
    super('phrase', 'Known AI phrasing');
  }

  analyze(f) {
    const text = f.text;
    const signals = [];

    /* ---- chatbot boilerplate ---- */
    let chatbotWeight = 0;
    const chatbotEvidence = [];
    const chatbotSpans = [];
    for (const { re, weight } of CHATBOT_PATTERNS) {
      for (const m of collectMatches(text, re)) {
        const quoted = isInQuotes(f, m.index);
        chatbotWeight += weight * (quoted ? QUOTED_FACTOR : 1);
        chatbotSpans.push([m.index, m.index + m[0].length]);
        if (chatbotEvidence.length < MAX_EVIDENCE) chatbotEvidence.push(m[0].trim() + (quoted ? ' (quoted)' : ''));
      }
    }

    // Is the text discussing AI? Ignore mentions that are part of boilerplate itself.
    let masked = text;
    for (const [s, e] of chatbotSpans) masked = masked.slice(0, s) + ' '.repeat(e - s) + masked.slice(e);
    const metaMentions = collectMatches(masked, AI_META_RE).length;
    const metaDiscussion = metaMentions >= 1;
    if (metaDiscussion) chatbotWeight *= META_DISCUSSION_FACTOR;

    signals.push({
      id: 'chatbot-artifacts',
      family: 'chatbot',
      label: 'Chatbot boilerplate phrases',
      value: unit(chatbotWeight / 1.5),
      weight: 4,
      evidence: chatbotEvidence,
    });

    /* ---- explicit self-disclosure ---- */
    const disclosure = [];
    for (const re of DISCLOSURE_PATTERNS) {
      for (const m of collectMatches(text, re)) {
        if (!isInQuotes(f, m.index)) disclosure.push(m[0]);
      }
    }
    signals.push({
      id: 'ai-disclosure',
      family: 'chatbot',
      label: 'Text states it was AI-generated',
      value: disclosure.length ? 1 : 0,
      weight: 4.5,
      evidence: disclosure.slice(0, MAX_EVIDENCE),
    });

    /* ---- stock AI phrasing ---- */
    let phraseCount = 0;
    const phraseEvidence = [];
    for (const re of AI_PHRASE_PATTERNS) {
      for (const m of collectMatches(text, re)) {
        phraseCount += isInQuotes(f, m.index) ? QUOTED_FACTOR : 1;
        if (phraseEvidence.length < MAX_EVIDENCE) phraseEvidence.push(m[0]);
      }
    }
    // ~1 stock phrase per 250 words is unremarkable; 3+ in a short text is not.
    const phraseNorm = phraseCount / (1 + f.wordCount / 250);
    signals.push({
      id: 'ai-phrasing',
      family: 'phrasing',
      label: 'Stock AI phrasing',
      value: unit((phraseNorm - 0.5) / 2),
      weight: 3,
      evidence: phraseEvidence,
    });

    /* ---- vocabulary density ---- */
    let vocabHits = 0;
    const distinct = new Set();
    for (const w of f.words) {
      if (AI_VOCABULARY.has(w)) {
        vocabHits++;
        distinct.add(w);
      }
    }
    // Denominator floor of 80 words keeps short texts from spiking.
    const density = (vocabHits * 100) / Math.max(80, f.wordCount);
    const vocabValue = distinct.size >= 2 ? unit((density - 0.8) / 2.4) : 0;
    signals.push({
      id: 'ai-vocabulary',
      family: 'phrasing',
      label: 'Overused "AI vocabulary"',
      value: vocabValue,
      weight: 2,
      evidence: [...distinct].slice(0, MAX_EVIDENCE),
    });

    return { signals, humanSignals: [], notes: metaDiscussion ? ['meta-ai-discussion'] : [] };
  }
}
