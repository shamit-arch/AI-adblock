import { describe, expect, it } from 'vitest';
import { DetectionEngine, checkEligibility, SKIP_REASONS } from '../src/detector/detector.js';
import { AIProvider } from '../src/detector/types.js';
import { computeFeatures, splitSentences, looksLikeCode } from '../src/detector/text-features.js';
import { PhraseDetector } from '../src/detector/phrase-detector.js';
import { StyleDetector } from '../src/detector/style-detector.js';
import { HUMAN, AI, BORDERLINE, EDGE } from './fixtures/samples.js';

const DEFAULT_THRESHOLD = 65;
const engine = new DetectionEngine();
const analyze = (text, opts = {}) => engine.analyzeSync(text, { sensitivity: 3, ...opts });

describe('clearly human text', () => {
  for (const [name, text] of Object.entries(HUMAN)) {
    it(`scores "${name}" as unlikely AI (< 31)`, () => {
      const r = analyze(text);
      expect(r.skipped).toBeNull();
      expect(r.score).toBeLessThan(31);
      expect(r.label).toBe('unlikely');
    });
  }
});

describe('clearly AI-like text', () => {
  for (const [name, text] of Object.entries(AI)) {
    it(`scores "${name}" above the default blocking threshold`, () => {
      const r = analyze(text);
      expect(r.skipped).toBeNull();
      expect(r.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
      expect(['likely', 'high']).toContain(r.label);
      expect(r.firedFamilies.length).toBeGreaterThanOrEqual(2);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  }
});

describe('borderline text stays visible', () => {
  for (const [name, text] of Object.entries(BORDERLINE)) {
    it(`does not block "${name}" at default settings`, () => {
      expect(analyze(text).score).toBeLessThan(DEFAULT_THRESHOLD);
    });
  }
});

describe('false-positive guards', () => {
  it('does not flag an article that quotes chatbot phrases', () => {
    const r = analyze(HUMAN.articleAboutChatbots);
    expect(r.score).toBeLessThan(31);
    const chatbot = r.signals.find((s) => s.id === 'chatbot-artifacts');
    expect(chatbot.evidence.some((e) => e.includes('(quoted)'))).toBe(true);
  });

  it('does not block a single stock phrase in ordinary text', () => {
    expect(analyze(BORDERLINE.singleStockPhrase).score).toBeLessThan(31);
  });

  it('does not block text just for good grammar, headings and bullets', () => {
    expect(analyze(BORDERLINE.structuredHuman).score).toBeLessThan(31);
    expect(analyze(HUMAN.documentation).score).toBeLessThan(31);
  });

  it('caps text with only one family of evidence below "likely"', () => {
    // Only AI vocabulary/phrasing, nothing structural or rhythmic.
    const r = analyze(
      'Honestly the tapestry thing made me laugh, my sister kept saying "delve" all weekend at the lake, it was a whole bit. We ate way too much corn and the dog got into the trash twice. 10/10 would go again next July.',
    );
    expect(r.score).toBeLessThan(50);
  });

  it('never rates repeated boilerplate as likely AI', () => {
    const r = analyze(EDGE.repeated);
    expect(r.score).toBeLessThanOrEqual(30);
  });

  it('treats a plain chatbot phrase alone as insufficient', () => {
    const r = analyze(
      'I hope this helps! We fixed the fence on Sunday and the neighbors brought over a pie, which was nice of them after the whole thing with the tree last year.',
    );
    expect(r.score).toBeLessThan(DEFAULT_THRESHOLD);
  });
});

describe('edge cases', () => {
  it('skips very short text', () => {
    expect(analyze(EDGE.veryShort).skipped).toBe(SKIP_REASONS.TOO_SHORT);
    expect(analyze('').skipped).toBe(SKIP_REASONS.EMPTY);
  });

  it('skips code', () => {
    expect(analyze(EDGE.code).skipped).toBe(SKIP_REASONS.CODE);
    expect(looksLikeCode(EDGE.code)).toBe(true);
    expect(looksLikeCode(HUMAN.personalBlog)).toBe(false);
  });

  it('skips navigation text', () => {
    expect(analyze(EDGE.navigation).skipped).not.toBeNull();
    expect(analyze(EDGE.navigationInline).skipped).toBe(SKIP_REASONS.NAVIGATION);
  });

  it('skips non-English text instead of guessing', () => {
    expect(analyze(EDGE.nonEnglish).skipped).toBe(SKIP_REASONS.LANGUAGE);
  });

  it('ignores URLs and e-mail addresses', () => {
    const f = computeFeatures(EDGE.urlsAndEmails);
    expect(f.text).not.toMatch(/https?:|@example/);
  });

  it('skips link lists', () => {
    const r = engine.analyzeSync({ text: AI.seoIntro, meta: { linkDensity: 0.9 } }, {});
    expect(r.skipped).toBe(SKIP_REASONS.LINKS);
  });

  it('treats an explicit AI disclosure as a strong label', () => {
    expect(analyze(EDGE.disclosure).score).toBeGreaterThanOrEqual(81);
  });

  it('eligibility check is exposed for reuse', () => {
    expect(checkEligibility(computeFeatures(HUMAN.personalBlog))).toBeNull();
  });
});

describe('scores and options', () => {
  it('returns an integer score within 0-99 (never 100% certain) and a label', () => {
    for (const text of [...Object.values(HUMAN), ...Object.values(AI)]) {
      const r = analyze(text);
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(99);
      expect(r.labelText).toMatch(/AI-generated/);
    }
  });

  it('never uses definitive language in labels', () => {
    const r = analyze(AI.listicle);
    expect(r.labelText).toMatch(/^(Likely|Highly likely|Possibly|Unlikely) AI-generated$/);
    expect(r.labelText).not.toMatch(/definitely|certainly|confirmed/i);
  });

  it('higher sensitivity never lowers a score', () => {
    for (const text of [...Object.values(BORDERLINE), ...Object.values(AI), AI.subtleCorporate]) {
      const low = analyze(text, { sensitivity: 1 }).score;
      const mid = analyze(text, { sensitivity: 3 }).score;
      const high = analyze(text, { sensitivity: 5 }).score;
      expect(low).toBeLessThanOrEqual(mid);
      expect(mid).toBeLessThanOrEqual(high);
    }
  });

  it('respects the phrase / style toggles', () => {
    const both = analyze(AI.seoIntro);
    const noPhrase = analyze(AI.seoIntro, { enablePhraseDetection: false });
    const noStyle = analyze(AI.seoIntro, { enableStyleDetection: false });
    expect(noPhrase.signals.some((s) => s.id === 'ai-phrasing')).toBe(false);
    expect(noStyle.signals.some((s) => s.id === 'formulaic-transitions')).toBe(false);
    expect(noPhrase.score).toBeLessThanOrEqual(both.score);
    expect(noStyle.score).toBeLessThanOrEqual(both.score);
  });

  it('uses configurable bands for labels', () => {
    const r = analyze(AI.listicle, { bands: { uncertain: 40, likely: 90, high: 101 } });
    expect(r.label).toBe('likely');
  });

  it('caches results by text and options', () => {
    const e = new DetectionEngine();
    const a = e.analyzeSync(AI.seoIntro, { sensitivity: 3 });
    expect(e.analyzeSync(AI.seoIntro, { sensitivity: 3 })).toBe(a);
    expect(e.analyzeSync(AI.seoIntro, { sensitivity: 4 })).not.toBe(a);
  });
});

describe('provider architecture', () => {
  class FixedProvider extends AIProvider {
    constructor(score, id = 'fixed') {
      super({ id, name: 'Fixed', weight: 1, local: true });
      this.score = score;
      this.calls = 0;
    }
    async analyze() {
      this.calls++;
      return { providerId: this.id, score: this.score, signals: [], humanSignals: [] };
    }
  }

  it('combines several providers by weighted average', async () => {
    const e = new DetectionEngine();
    e.registerProvider(new FixedProvider(0));
    const local = await new DetectionEngine().analyze(AI.seoIntro, {});
    const combined = await e.analyze(AI.seoIntro, {});
    expect(combined.providers.map((p) => p.id)).toEqual(['local', 'fixed']);
    expect(combined.score).toBe(Math.round(local.score / 2));
  });

  it('keeps working when an optional provider throws', async () => {
    class Broken extends AIProvider {
      constructor() {
        super({ id: 'broken', name: 'Broken', local: false });
      }
      async analyze() {
        throw new Error('network down');
      }
    }
    const e = new DetectionEngine();
    e.registerProvider(new Broken());
    const r = await e.analyze(AI.listicle, {});
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    expect(r.providers.map((p) => p.id)).toEqual(['local']);
  });

  it('does not call providers for ineligible text', async () => {
    const p = new FixedProvider(100, 'remote-like');
    const e = new DetectionEngine({ providers: [p] });
    await e.analyze(EDGE.code, {});
    expect(p.calls).toBe(0);
  });

  it('rejects objects that are not providers', () => {
    expect(() => new DetectionEngine().registerProvider({})).toThrow();
  });

  it('isSynchronous reflects async-only providers', () => {
    const e = new DetectionEngine();
    expect(e.isSynchronous).toBe(true);
    e.registerProvider(new FixedProvider(10));
    expect(e.isSynchronous).toBe(false);
  });
});

describe('individual detectors and features', () => {
  it('phrase detector finds chatbot boilerplate', () => {
    const out = new PhraseDetector().analyze(computeFeatures(AI.chatbotComment));
    const s = out.signals.find((x) => x.id === 'chatbot-artifacts');
    expect(s.value).toBeGreaterThan(0.5);
    expect(s.evidence.join(' ')).toMatch(/As an AI language model/);
  });

  it('style detector finds label-colon lists and formulaic transitions', () => {
    const out = new StyleDetector().analyze(computeFeatures(AI.listicle));
    expect(out.signals.find((s) => s.id === 'label-colon-lists').value).toBe(1);
    const t = new StyleDetector().analyze(computeFeatures(AI.seoIntro)).signals.find((s) => s.id === 'formulaic-transitions');
    expect(t.value).toBeGreaterThan(0.3);
  });

  it('splits sentences without breaking on abbreviations', () => {
    expect(splitSentences('Dr. Smith arrived at 5 p.m. on Monday. He left early.')).toHaveLength(2);
    expect(splitSentences('It was cold! Was it? Yes.')).toHaveLength(3);
  });

  it('accepts structured input from the DOM extractor', () => {
    const r = engine.analyzeSync(
      {
        text: AI.markdownAnswer,
        blocks: [
          { type: 'h', text: 'Understanding Machine Learning' },
          { type: 'p', text: 'Machine learning is a subset of artificial intelligence that enables systems to learn from data. It plays a crucial role in many modern applications.' },
          { type: 'li', text: 'Automation: Machine learning automates repetitive tasks, saving time and resources.' },
          { type: 'li', text: 'Accuracy: Models can identify patterns with remarkable precision.' },
          { type: 'li', text: 'Scalability: Solutions can easily scale to handle large volumes of data.' },
        ],
      },
      {},
    );
    expect(r.signals.some((s) => s.id === 'label-colon-lists')).toBe(true);
  });

  it('truncates very long input instead of stalling', () => {
    const huge = AI.seoIntro.repeat(200);
    const t = Date.now();
    const r = new DetectionEngine().analyzeSync(huge, {});
    expect(Date.now() - t).toBeLessThan(1500);
    expect(r.wordCount).toBeLessThan(2500);
  });
});
