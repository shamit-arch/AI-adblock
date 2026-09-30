/**
 * StyleDetector — structural and rhythmic patterns typical of LLM output.
 *
 * None of these signals is meaningful alone (good writers use headings,
 * transitions and even em dashes). They only matter in combination, which
 * scoring.js enforces through its family-corroboration rule.
 */

import { Detector } from './types.js';
import {
  CONCLUSION_PATTERNS,
  FORMULAIC_HEADINGS,
  GENERIC_INTRO_PATTERNS,
  HEDGE_PATTERNS,
  TRANSITIONS,
} from './lexicon.js';
import { unit } from '../shared/utils.js';

const SUMMARY_MARKERS_RE = /\b(?:in conclusion|in summary|to sum up|to summarize|key takeaways?|tl;?dr|in short,|overall,)/gi;
const LABEL_COLON_RE = /^(?:\*\*)?[A-Z][^:.!?*\n]{1,50}(?::\*\*|\*\*:|:)\s+\S/;
const TRIAD_RE = /\b[\w-]+(?: [\w-]+){0,2}, [\w-]+(?: [\w-]+){0,2},? and [\w-]+/g;
const OPENER_IGNORE = new Set(['i', 'the', 'a']);

function transitionWeight(sentence) {
  const s = sentence.toLowerCase().replace(/^[^a-z]+/, '');
  for (const [t, w] of TRANSITIONS) {
    if (s.startsWith(t) && /^[\s,']/.test(s.slice(t.length, t.length + 1) || ' ')) return w;
  }
  return 0;
}

function countMatches(text, patterns) {
  let n = 0;
  for (const re of patterns) {
    re.lastIndex = 0;
    n += (text.match(re) || []).length;
  }
  return n;
}

export class StyleDetector extends Detector {
  constructor() {
    super('style', 'Style & structure analysis');
  }

  analyze(f) {
    const signals = [];
    const push = (id, family, label, value, weight, evidence) =>
      signals.push({ id, family, label, value: unit(value), weight, evidence });

    const per100 = (count) => (count * 100) / Math.max(80, f.wordCount);

    /* ---------------- formula ---------------- */

    const firstProse = (f.proseBlocks[0]?.text || f.firstSentence).trim();
    const intro = GENERIC_INTRO_PATTERNS.find((re) => re.test(f.firstSentence) || re.test(firstProse));
    push('generic-intro', 'formula', 'Generic, content-free introduction', intro ? 1 : 0, 1.2);

    const ending = `${f.lastParagraph}\n${f.lastSentences}`;
    const conclusionHits = CONCLUSION_PATTERNS.filter((re) => re.test(ending)).length;
    push(
      'formulaic-conclusion',
      'formula',
      'Formulaic wrap-up / conclusion',
      conclusionHits ? 0.7 + 0.3 * (conclusionHits - 1) : 0,
      1.2,
    );

    if (f.sentences.length >= 4) {
      let tw = 0;
      const ev = [];
      for (const s of f.sentences) {
        const w = transitionWeight(s);
        if (w) {
          tw += w;
          if (ev.length < 5) ev.push(s.split(/[\s,]/)[0]);
        }
      }
      const ratio = tw / f.sentences.length;
      push('formulaic-transitions', 'formula', 'Formulaic transitions ("Moreover", "Additionally")', (ratio - 0.08) / 0.22, 1.6, ev);
    }

    const hedges = countMatches(f.text, HEDGE_PATTERNS);
    push('hedging', 'formula', 'Stock hedging and caveats', (per100(hedges) - 0.3) / 1.2, 1.0);

    SUMMARY_MARKERS_RE.lastIndex = 0;
    const summaries = (f.text.match(SUMMARY_MARKERS_RE) || []).length;
    push('repeated-summaries', 'formula', 'Repeated summary sections', summaries >= 2 ? 1 : 0, 0.8);

    if (f.headings.length >= 2) {
      const formulaic = f.headings.filter((h) => FORMULAIC_HEADINGS.some((re) => re.test(h.text.trim()))).length;
      push('formulaic-headings', 'formula', 'Template-like headings ("Key Takeaways", "Conclusion")', formulaic / 2, 0.8);
    }

    if (f.wordCount >= 60) {
      push('generic-filler', 'formula', 'Generic filler with few concrete details', (1.5 - f.specificityDensity) / 1.5, 1.0);
    }

    /* ---------------- structure ---------------- */

    const labelled = [...f.listItems, ...f.proseBlocks].filter((b) => LABEL_COLON_RE.test(b.text)).length;
    push('label-colon-lists', 'structure', 'List items in "Label: explanation" format', (labelled - 1) / 3, 1.4);

    const headingsPer100 = (f.headings.length * 100) / Math.max(1, f.wordCount);
    if (f.headings.length >= 3) {
      push('heading-overuse', 'structure', 'Heavy use of headings', (headingsPer100 - 1.5) / 3, 0.6);
    }

    const blockCount = f.blocks.length || 1;
    if (f.listItems.length >= 5) {
      push('bullet-overuse', 'structure', 'Bullet-point heavy', (f.listItems.length / blockCount - 0.4) / 0.4, 0.5);
    }

    push('markdown-artifacts', 'chatbot', 'Leftover Markdown formatting (**bold**, ###)', f.markdownArtifacts / 3, 1.5);

    /* ---------------- rhythm ---------------- */

    const n = f.sentenceLengths.length;
    if (n >= 5) {
      const reliability = unit((n - 3) / 5);
      push(
        'low-burstiness',
        'rhythm',
        'Unusually uniform sentence lengths',
        ((0.5 - f.sentenceLengthCV) / 0.25) * reliability,
        1.5,
      );
    }

    if (f.paragraphLengths.length >= 4) {
      push('paragraph-uniformity', 'rhythm', 'Unnaturally consistent paragraph sizes', (0.35 - f.paragraphCV) / 0.25, 0.8);
    }

    if (f.sentences.length >= 6) {
      const counts = new Map();
      let considered = 0;
      for (const s of f.sentences) {
        const first = s.toLowerCase().match(/[a-z']+/)?.[0];
        if (!first || OPENER_IGNORE.has(first)) continue;
        considered++;
        counts.set(first, (counts.get(first) || 0) + 1);
      }
      const max = Math.max(0, ...counts.values());
      const share = considered ? max / f.sentences.length : 0;
      push('repetitive-openers', 'rhythm', 'Repetitive sentence openings', max >= 3 ? (share - 0.25) / 0.3 : 0, 0.7);
    }

    if (f.sentences.length >= 4) {
      TRIAD_RE.lastIndex = 0;
      const triads = (f.text.match(TRIAD_RE) || []).length;
      push('triadic-lists', 'rhythm', 'Frequent "X, Y, and Z" triplets', (triads / f.sentences.length - 0.12) / 0.3, 0.5);
    }

    const emDashes = (f.rawText.match(/—/g) || []).length;
    push('em-dash', 'rhythm', 'Heavy em-dash use', (per100(emDashes) - 0.4) / 1.2, 0.4);

    return { signals, humanSignals: [] };
  }
}
