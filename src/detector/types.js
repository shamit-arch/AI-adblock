/**
 * Core types and interfaces of the detection system.
 *
 * The engine is organised in three layers:
 *
 *   Detector    – one analysis technique (phrases, style, …). Pure, synchronous,
 *                 works on pre-computed TextFeatures and returns Signals.
 *   AIProvider  – produces a score for a text. The built-in LocalProvider
 *                 combines several Detectors; future providers could call a
 *                 remote API or run an on-device model.
 *   DetectionEngine (detector.js) – caching, eligibility checks, and
 *                 combination of one or more providers into a DetectionResult.
 */

/**
 * @typedef {'p'|'li'|'h'|'quote'} BlockType
 *
 * @typedef {Object} TextBlock
 * @property {BlockType} type
 * @property {string} text
 *
 * @typedef {Object} DetectionInput
 * @property {string} text               Plain text to analyse.
 * @property {TextBlock[]} [blocks]      Optional structure (from the DOM extractor).
 * @property {{linkDensity?: number}} [meta]
 *
 * @typedef {Object} Signal
 * @property {string} id
 * @property {string} family   'chatbot' | 'phrasing' | 'formula' | 'structure' | 'rhythm' | 'human'
 * @property {string} label    Short human-readable reason.
 * @property {number} value    Strength in [0, 1].
 * @property {number} weight   Points contributed at full strength.
 * @property {string[]} [evidence]
 *
 * @typedef {Object} DetectionOptions
 * @property {number} [sensitivity]  1 (low) … 5 (high)
 * @property {boolean} [aggressive]  blacklisted site
 * @property {boolean} [enablePhraseDetection]
 * @property {boolean} [enableStyleDetection]
 * @property {{uncertain:number, likely:number, high:number}} [bands]
 *
 * @typedef {Object} ProviderResult
 * @property {string} providerId
 * @property {number} score           0-100
 * @property {Signal[]} signals
 * @property {Signal[]} humanSignals
 * @property {Object<string, number>} [families]
 * @property {string[]} [firedFamilies]
 * @property {string[]} [notes]
 */

export const DEFAULT_BANDS = Object.freeze({ uncertain: 31, likely: 61, high: 81 });

export const LABELS = Object.freeze({
  unlikely: 'Unlikely AI-generated',
  uncertain: 'Possibly AI-generated',
  likely: 'Likely AI-generated',
  high: 'Highly likely AI-generated',
});

/** Map a 0-100 score to a label key using configurable band lower bounds. */
export function labelForScore(score, bands = DEFAULT_BANDS) {
  if (score >= bands.high) return 'high';
  if (score >= bands.likely) return 'likely';
  if (score >= bands.uncertain) return 'uncertain';
  return 'unlikely';
}

/**
 * Base class for a single analysis technique.
 * Subclasses override `analyze(features, options)`.
 */
export class Detector {
  /** @param {string} id @param {string} name */
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }

  /**
   * @param {import('./text-features.js').TextFeatures} _features
   * @param {DetectionOptions} _options
   * @returns {{signals: Signal[], humanSignals: Signal[]}}
   */
  analyze(_features, _options) {
    throw new Error(`Detector "${this.id}" does not implement analyze()`);
  }
}

/**
 * Interface for anything that can score text. Implementations may be local
 * (synchronous work wrapped in a promise) or remote (network calls). Remote
 * providers MUST only run after explicit user opt-in; see README.
 */
export class AIProvider {
  /**
   * @param {{id: string, name: string, weight?: number, local?: boolean}} config
   */
  constructor({ id, name, weight = 1, local = true }) {
    this.id = id;
    this.name = name;
    /** Relative weight when several providers are combined. */
    this.weight = weight;
    /** True if the provider never sends content off the device. */
    this.local = local;
  }

  /** @returns {Promise<boolean>} */
  async isAvailable() {
    return true;
  }

  /**
   * @param {DetectionInput} _input
   * @param {DetectionOptions} _options
   * @param {import('./text-features.js').TextFeatures} [_features] pre-computed features (optional)
   * @returns {Promise<ProviderResult>}
   */
  async analyze(_input, _options, _features) {
    throw new Error(`Provider "${this.id}" does not implement analyze()`);
  }
}

/**
 * Build the immutable result object returned by the engine.
 * @returns {Readonly<DetectionResult>}
 *
 * @typedef {Object} DetectionResult
 * @property {number} score        0-100 (probabilistic estimate, never proof)
 * @property {string} label        'unlikely' | 'uncertain' | 'likely' | 'high'
 * @property {string} labelText    e.g. "Likely AI-generated"
 * @property {string|null} skipped reason the text was not analysed, if any
 * @property {Signal[]} signals    AI-leaning signals, strongest first
 * @property {Signal[]} humanSignals human-leaning signals, strongest first
 * @property {string[]} reasons    up to three short reasons for display
 * @property {Object<string, number>} families evidence points per family
 * @property {string[]} firedFamilies families with meaningful evidence
 * @property {number} wordCount
 * @property {{id: string, score: number}[]} providers
 * @property {string} textHash
 */
export function createDetectionResult({
  score = 0,
  bands = DEFAULT_BANDS,
  skipped = null,
  signals = [],
  humanSignals = [],
  families = {},
  firedFamilies = [],
  wordCount = 0,
  providers = [],
  textHash = '',
  notes = [],
} = {}) {
  const s = Math.round(Math.min(100, Math.max(0, score)));
  const label = skipped ? 'unlikely' : labelForScore(s, bands);
  const byContribution = (a, b) => b.value * b.weight - a.value * a.weight;
  const sortedSignals = [...signals].filter((x) => x.value > 0).sort(byContribution);
  const sortedHuman = [...humanSignals].filter((x) => x.value > 0).sort(byContribution);
  return Object.freeze({
    score: skipped ? 0 : s,
    label,
    labelText: LABELS[label],
    skipped,
    signals: sortedSignals,
    humanSignals: sortedHuman,
    reasons: sortedSignals.slice(0, 3).map((x) => x.label),
    families,
    firedFamilies,
    wordCount,
    providers,
    textHash,
    notes,
  });
}
