/**
 * LocalProvider — the built-in, fully on-device provider.
 *
 * Runs the phrase, style and human-signal detectors and combines their
 * signals with scoring.js. No network access, no external models.
 */

import { AIProvider } from '../types.js';
import { PhraseDetector } from '../phrase-detector.js';
import { StyleDetector } from '../style-detector.js';
import { HumanSignalDetector } from '../human-detector.js';
import { computeFeatures } from '../text-features.js';
import { combineEvidence } from '../scoring.js';

export class LocalProvider extends AIProvider {
  constructor({ detectors } = {}) {
    super({ id: 'local', name: 'Local heuristic analysis', weight: 1, local: true });
    this.phrase = new PhraseDetector();
    this.style = new StyleDetector();
    this.human = new HumanSignalDetector();
    /** Extra detectors can be added without modifying this class. */
    this.extraDetectors = detectors || [];
  }

  /** Synchronous core, used by the engine to avoid needless promise churn. */
  analyzeSync(input, options = {}, precomputed) {
    const features = precomputed || computeFeatures(input);
    const signals = [];
    const humanSignals = [];
    const notes = [];

    const run = (detector) => {
      const out = detector.analyze(features, options);
      signals.push(...(out.signals || []));
      humanSignals.push(...(out.humanSignals || []));
      if (out.notes) notes.push(...out.notes);
    };

    if (options.enablePhraseDetection !== false) run(this.phrase);
    if (options.enableStyleDetection !== false) run(this.style);
    run(this.human);
    for (const d of this.extraDetectors) run(d);

    const combined = combineEvidence({ signals, humanSignals, features, options });
    return {
      providerId: this.id,
      score: combined.score,
      signals,
      humanSignals,
      families: combined.families,
      firedFamilies: combined.firedFamilies,
      notes: [...notes, ...combined.caps],
      debug: combined,
    };
  }

  async analyze(input, options, precomputed) {
    return this.analyzeSync(input, options, precomputed);
  }
}
