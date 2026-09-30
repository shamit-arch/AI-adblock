import { describe, expect, it } from 'vitest';
import {
  combineEvidence,
  CORROBORATION_CAPS,
  logistic,
  REPETITION_CAP,
  sensitivityFactor,
  aggregateFamilies,
  FAMILY_CAPS,
} from '../src/detector/scoring.js';
import { labelForScore, createDetectionResult, DEFAULT_BANDS } from '../src/detector/types.js';
import { getDetectionOptions } from '../src/shared/site-rules.js';
import { normalizeSettings } from '../src/shared/storage.js';

const sig = (family, points, id = `${family}-${points}`) => ({ id, family, label: id, value: 1, weight: points });
const features = (overrides = {}) => ({ wordCount: 200, sentences: new Array(10).fill('x'), uniqueSentenceRatio: 1, ...overrides });

describe('labels and thresholds', () => {
  it('maps scores to the default bands (0-30, 31-60, 61-80, 81-100)', () => {
    expect(labelForScore(0)).toBe('unlikely');
    expect(labelForScore(30)).toBe('unlikely');
    expect(labelForScore(31)).toBe('uncertain');
    expect(labelForScore(60)).toBe('uncertain');
    expect(labelForScore(61)).toBe('likely');
    expect(labelForScore(80)).toBe('likely');
    expect(labelForScore(81)).toBe('high');
    expect(labelForScore(100)).toBe('high');
  });

  it('supports custom bands', () => {
    const bands = { uncertain: 20, likely: 50, high: 70 };
    expect(labelForScore(25, bands)).toBe('uncertain');
    expect(labelForScore(55, bands)).toBe('likely');
    expect(labelForScore(75, bands)).toBe('high');
  });

  it('builds results with probabilistic wording', () => {
    const r = createDetectionResult({ score: 87.4, bands: DEFAULT_BANDS });
    expect(r.score).toBe(87);
    expect(r.labelText).toBe('Highly likely AI-generated');
    expect(Object.isFrozen(r)).toBe(true);
    expect(createDetectionResult({ score: 45 }).labelText).toBe('Possibly AI-generated');
  });

  it('skipped results always score 0', () => {
    const r = createDetectionResult({ score: 99, skipped: 'code' });
    expect(r.score).toBe(0);
    expect(r.label).toBe('unlikely');
  });

  it('blacklisted sites use a lower threshold and max sensitivity', () => {
    const s = normalizeSettings({ confidenceThreshold: 70, sensitivity: 2 });
    const normal = getDetectionOptions(s, 'normal');
    const aggressive = getDetectionOptions(s, 'aggressive');
    expect(normal.threshold).toBe(70);
    expect(aggressive.threshold).toBe(55);
    expect(aggressive.sensitivity).toBe(5);
    expect(aggressive.aggressive).toBe(true);
  });
});

describe('evidence combination', () => {
  it('logistic curve is monotonic and centred', () => {
    expect(logistic(3.2)).toBeCloseTo(50, 5);
    let prev = -1;
    for (let e = -5; e <= 12; e += 0.5) {
      const v = logistic(e);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('sensitivity factors increase monotonically and clamp', () => {
    expect(sensitivityFactor(1)).toBeLessThan(sensitivityFactor(3));
    expect(sensitivityFactor(3)).toBe(1);
    expect(sensitivityFactor(5)).toBeGreaterThan(sensitivityFactor(4));
    expect(sensitivityFactor(99)).toBe(sensitivityFactor(5));
    expect(sensitivityFactor('x')).toBe(1);
  });

  it('caps each family so one kind of evidence cannot dominate', () => {
    const { capped } = aggregateFamilies([sig('phrasing', 50)]);
    expect(capped.phrasing).toBe(FAMILY_CAPS.phrasing);
  });

  it('a single family of evidence stays in the uncertain range', () => {
    const r = combineEvidence({ signals: [sig('phrasing', 10)], humanSignals: [], features: features() });
    expect(r.firedFamilies).toEqual(['phrasing']);
    expect(r.score).toBeLessThanOrEqual(CORROBORATION_CAPS.normal[1]);
  });

  it('two families are capped below "highly likely"', () => {
    const r = combineEvidence({ signals: [sig('phrasing', 10), sig('formula', 10)], humanSignals: [], features: features() });
    expect(r.score).toBe(CORROBORATION_CAPS.normal[2]);
  });

  it('three or more families can reach high confidence', () => {
    const r = combineEvidence({
      signals: [sig('phrasing', 3), sig('formula', 3), sig('rhythm', 2)],
      humanSignals: [],
      features: features(),
    });
    expect(r.score).toBeGreaterThan(90);
  });

  it('human evidence lowers the score', () => {
    const signals = [sig('phrasing', 2), sig('formula', 2), sig('rhythm', 1)];
    const base = combineEvidence({ signals, humanSignals: [], features: features() }).score;
    const withHuman = combineEvidence({ signals, humanSignals: [sig('human', 3)], features: features() }).score;
    expect(withHuman).toBeLessThan(base);
  });

  it('short texts are capped', () => {
    const signals = [sig('phrasing', 3), sig('formula', 3), sig('chatbot', 4)];
    expect(combineEvidence({ signals, humanSignals: [], features: features({ wordCount: 20 }) }).score).toBeLessThanOrEqual(70);
    expect(combineEvidence({ signals, humanSignals: [], features: features({ wordCount: 40 }) }).score).toBeLessThanOrEqual(85);
  });

  it('repetitive text is capped at the repetition cap', () => {
    const signals = [sig('phrasing', 3), sig('formula', 3), sig('rhythm', 3)];
    const r = combineEvidence({ signals, humanSignals: [], features: features({ uniqueSentenceRatio: 0.2 }) });
    expect(r.score).toBeLessThanOrEqual(REPETITION_CAP);
    expect(r.caps).toContain('repetitive-text');
  });

  it('aggressive mode relaxes corroboration caps', () => {
    const signals = [sig('phrasing', 10)];
    const normal = combineEvidence({ signals, humanSignals: [], features: features() }).score;
    const aggressive = combineEvidence({ signals, humanSignals: [], features: features(), options: { aggressive: true } }).score;
    expect(aggressive).toBeGreaterThan(normal);
  });

  it('an explicit AI disclosure overrides caps', () => {
    const r = combineEvidence({
      signals: [{ id: 'ai-disclosure', family: 'chatbot', value: 1, weight: 4.5 }],
      humanSignals: [],
      features: features(),
    });
    expect(r.score).toBeGreaterThanOrEqual(90);
  });
});
