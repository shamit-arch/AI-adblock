/**
 * HumanSignalDetector — evidence that text was written by a person.
 *
 * Always active (independent of the phrase/style toggles) because it only
 * ever *lowers* scores, which is the safe direction for false positives.
 */

import { Detector } from './types.js';
import {
  EMOTICON_RE,
  INFORMAL_TOKENS,
  MILD_INFORMAL_TOKENS,
  MISSING_APOSTROPHE,
  NARRATIVE_PATTERNS,
  PROFANITY,
} from './lexicon.js';
import { unit } from '../shared/utils.js';

const COMMON_ACRONYMS = /^(?:USA|NASA|HTML|HTTP|HTTPS|JSON|API|CEO|FAQ|DIY|USB|CPU|GPU|RAM|SSD|LLC|INC|TV|PC|OK|UK|US|EU|UN|AI|FBI|CIA|NFL|NBA|BBC|CNN|PDF|URL|CSS|SQL|NYC|LOL|TBH)$/;

export class HumanSignalDetector extends Detector {
  constructor() {
    super('human', 'Human writing signals');
  }

  analyze(f) {
    const humanSignals = [];
    const push = (id, label, value, weight, evidence) =>
      humanSignals.push({ id, family: 'human', label, value: unit(value), weight, evidence });

    /* informal vocabulary */
    const informal = new Set();
    const mild = new Set();
    let profanity = 0;
    let missingApostrophes = 0;
    for (const w of f.words) {
      if (INFORMAL_TOKENS.has(w)) informal.add(w);
      else if (MILD_INFORMAL_TOKENS.has(w)) mild.add(w);
      if (PROFANITY.has(w)) profanity++;
      if (MISSING_APOSTROPHE.has(w)) missingApostrophes++;
    }
    EMOTICON_RE.lastIndex = 0;
    const emoticons = (f.rawText.match(EMOTICON_RE) || []).length;
    push(
      'informal-language',
      'Informal / slang vocabulary',
      (informal.size + 0.5 * mild.size + emoticons) / 2,
      2.5,
      [...informal, ...mild].slice(0, 6),
    );

    /* casual typography */
    let casual = 0;
    casual += Math.min(3, f.sentences.filter((s) => /^[a-z]/.test(s)).length);
    casual += Math.min(3, (f.text.match(/(?:^|\s)i(?=[\s,.'!?])/g) || []).length);
    casual += Math.min(3, missingApostrophes);
    casual += Math.min(2, (f.text.match(/[!?]{2,}/g) || []).length);
    casual += Math.min(2, (f.text.match(/\.{3,}/g) || []).length);
    const shouting = (f.text.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !COMMON_ACRONYMS.test(w)).length;
    casual += Math.min(2, shouting);
    push('casual-typography', 'Casual typing (lowercase, missing apostrophes, "!!")', casual / 3, 1.5);

    /* personal narrative */
    let narrative = 0;
    for (const re of NARRATIVE_PATTERNS) {
      re.lastIndex = 0;
      narrative += (f.text.match(re) || []).length;
    }
    push('personal-narrative', 'Personal, specific anecdotes', narrative / 2, 1.2);

    /* concrete specifics */
    push('concrete-specifics', 'Concrete names, numbers and dates', (f.specificityDensity - 3) / 6, 1.2);

    /* bursty sentence rhythm */
    if (f.sentenceLengths.length >= 5) {
      push('high-burstiness', 'Varied, natural sentence rhythm', (f.sentenceLengthCV - 0.6) / 0.3, 0.8);
    }

    /* fragments: "No idea." "Why the grill?" */
    const fragments = f.sentences.filter((s) => {
      const words = s.split(/\s+/).length;
      return words <= 3 && /[.?!]$/.test(s) && !/recommended|thank|welcome/i.test(s);
    }).length;
    push('fragments', 'Short conversational fragments', fragments / 3, 0.6);

    push('profanity', 'Profanity', profanity, 1.0);

    return { signals: [], humanSignals };
  }
}
