/**
 * Scoring — turns detector signals into a 0-100 confidence estimate.
 *
 * 1. Each signal contributes `value × weight` points to its *family*
 *    (chatbot, phrasing, formula, structure, rhythm). Families are capped so a
 *    single kind of evidence (e.g. many stock phrases) cannot dominate.
 * 2. AI evidence is scaled by the sensitivity setting; human evidence
 *    (slang, anecdotes, concrete details, varied rhythm) is subtracted.
 * 3. The net evidence goes through a logistic curve → 0-100.
 * 4. Corroboration caps: with evidence from only one family the score can
 *    never exceed the "uncertain" range; two families cap below "highly
 *    likely". This is the main false-positive guard — good grammar, headings,
 *    or a stock phrase alone never get content blocked.
 *
 * The number is a heuristic confidence, not a probability of authorship.
 */

import { clamp } from '../shared/utils.js';

export const FAMILIES = Object.freeze(['chatbot', 'phrasing', 'formula', 'structure', 'rhythm']);

export const FAMILY_CAPS = Object.freeze({
  chatbot: 4.5,
  phrasing: 3.5,
  formula: 3.5,
  structure: 2.5,
  rhythm: 2.5,
});

/** A family "fires" (counts as corroborating evidence) at this many points. */
export const FAMILY_FIRE_POINTS = 0.7;

export const HUMAN_CAP = 5;

export const SENSITIVITY_FACTORS = Object.freeze({ 1: 0.7, 2: 0.85, 3: 1, 4: 1.15, 5: 1.3 });

export const LOGISTIC = Object.freeze({ center: 3.2, slope: 1.1 });

/** Max score by number of fired families: [0, 1, 2, 3+]. */
export const CORROBORATION_CAPS = Object.freeze({
  normal: [45, 50, 80, 100],
  aggressive: [55, 60, 88, 100],
});

export const SHORT_TEXT_CAPS = Object.freeze([
  { maxWords: 25, cap: 70 },
  { maxWords: 50, cap: 85 },
]);

export const REPETITION_CAP = 30;

/** Upper bound for any heuristic score. */
export const MAX_SCORE = 99;

export function sensitivityFactor(sensitivity = 3) {
  const s = clamp(Math.round(Number(sensitivity) || 3), 1, 5);
  return SENSITIVITY_FACTORS[s];
}

export function logistic(evidence) {
  return 100 / (1 + Math.exp(-LOGISTIC.slope * (evidence - LOGISTIC.center)));
}

/** Sum signal points per family (uncapped and capped). */
export function aggregateFamilies(signals) {
  const raw = {};
  for (const fam of FAMILIES) raw[fam] = 0;
  for (const s of signals) {
    if (!(s.family in raw)) continue;
    raw[s.family] += (s.value || 0) * (s.weight || 0);
  }
  const capped = {};
  for (const fam of FAMILIES) capped[fam] = Math.min(raw[fam], FAMILY_CAPS[fam]);
  return { raw, capped };
}

/**
 * @param {{signals: import('./types.js').Signal[], humanSignals: import('./types.js').Signal[],
 *          features: import('./text-features.js').TextFeatures, options: import('./types.js').DetectionOptions}} args
 */
export function combineEvidence({ signals, humanSignals, features, options = {} }) {
  const { capped } = aggregateFamilies(signals);
  const factor = sensitivityFactor(options.sensitivity);

  let aiPoints = 0;
  for (const fam of FAMILIES) aiPoints += capped[fam];

  let humanPoints = 0;
  for (const s of humanSignals) humanPoints += (s.value || 0) * (s.weight || 0);
  humanPoints = Math.min(humanPoints, HUMAN_CAP);

  const evidence = aiPoints * factor - humanPoints;
  let score = logistic(evidence);

  const firedFamilies = FAMILIES.filter((fam) => capped[fam] * factor >= FAMILY_FIRE_POINTS);
  const caps = [];

  const table = options.aggressive ? CORROBORATION_CAPS.aggressive : CORROBORATION_CAPS.normal;
  const corroborationCap = table[Math.min(firedFamilies.length, table.length - 1)];
  if (score > corroborationCap) caps.push(`corroboration:${firedFamilies.length}`);
  score = Math.min(score, corroborationCap);

  const words = features?.wordCount ?? Infinity;
  for (const { maxWords, cap } of SHORT_TEXT_CAPS) {
    if (words < maxWords) {
      if (score > cap) caps.push(`short-text:${cap}`);
      score = Math.min(score, cap);
      break;
    }
  }

  if (features && features.sentences.length >= 4 && features.uniqueSentenceRatio < 0.6) {
    if (score > REPETITION_CAP) caps.push('repetitive-text');
    score = Math.min(score, REPETITION_CAP);
  }

  // An explicit statement that the text is AI-generated overrides the caps.
  const disclosure = signals.find((s) => s.id === 'ai-disclosure' && s.value >= 1);
  if (disclosure) score = Math.max(score, 90);

  return {
    // Heuristics can't be certain, so never report 100%.
    score: Math.round(clamp(score, 0, MAX_SCORE)),
    aiPoints: round2(aiPoints * factor),
    humanPoints: round2(humanPoints),
    evidence: round2(evidence),
    families: Object.fromEntries(FAMILIES.map((f) => [f, round2(capped[f] * factor)])),
    firedFamilies,
    caps,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
