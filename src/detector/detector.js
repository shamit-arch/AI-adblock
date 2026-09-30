/**
 * DetectionEngine — the public entry point of the detection system.
 *
 *   const engine = new DetectionEngine();              // local provider only
 *   const result = await engine.analyze(text, options);
 *   result.score      // 0-100 heuristic confidence
 *   result.labelText  // "Likely AI-generated"
 *
 * Responsibilities:
 *   - eligibility checks (too short, code, navigation, non-English, link lists)
 *   - computing text features once and sharing them with providers
 *   - caching results by text hash + options
 *   - combining several providers (weighted average) when more are registered
 */

import { AIProvider, createDetectionResult, DEFAULT_BANDS } from './types.js';
import { computeFeatures } from './text-features.js';
import { LocalProvider } from './providers/local-provider.js';
import { HARD_LIMITS } from '../shared/constants.js';
import { hashString, LRUCache } from '../shared/utils.js';

export const SKIP_REASONS = Object.freeze({
  EMPTY: 'empty',
  TOO_SHORT: 'too-short',
  CODE: 'code',
  NAVIGATION: 'navigation',
  LANGUAGE: 'unsupported-language',
  LINKS: 'link-list',
});

/** Minimum words for any analysis at all (the DOM layer has its own char limit). */
export const MIN_WORDS = 12;

export function checkEligibility(features, { minWords = MIN_WORDS } = {}) {
  if (!features.text) return SKIP_REASONS.EMPTY;
  if (features.wordCount < minWords) return SKIP_REASONS.TOO_SHORT;
  if (features.codeLike) return SKIP_REASONS.CODE;
  if (features.linkDensity > 0.6) return SKIP_REASONS.LINKS;
  if (features.wordCount >= 20 && features.stopwordRatio < 0.12) return SKIP_REASONS.LANGUAGE;

  const punctuation = (features.text.match(/[.!?]/g) || []).length;
  const blocks = features.blocks.length || 1;
  if (blocks >= 4 && features.wordCount / blocks < 4 && punctuation < blocks * 0.3) return SKIP_REASONS.NAVIGATION;
  if (punctuation === 0 && features.wordCount < 80 && !/[,;:]/.test(features.text)) return SKIP_REASONS.NAVIGATION;
  return null;
}

/** Cap very long inputs so a single huge element cannot stall the page. */
function truncateInput(input, maxChars) {
  const src = typeof input === 'string' ? { text: input } : { ...input };
  const text = String(src.text || '');
  if (text.length <= maxChars) return src;
  src.text = text.slice(0, maxChars);
  if (Array.isArray(src.blocks)) {
    let budget = maxChars;
    const blocks = [];
    for (const b of src.blocks) {
      if (budget <= 0) break;
      blocks.push(b.text.length > budget ? { ...b, text: b.text.slice(0, budget) } : b);
      budget -= b.text.length + 1;
    }
    src.blocks = blocks;
  }
  return src;
}

function optionsKey(o) {
  const b = o.bands || DEFAULT_BANDS;
  return [
    o.sensitivity ?? 3,
    o.aggressive ? 1 : 0,
    o.enablePhraseDetection === false ? 0 : 1,
    o.enableStyleDetection === false ? 0 : 1,
    b.uncertain,
    b.likely,
    b.high,
  ].join(',');
}

export class DetectionEngine {
  /**
   * @param {{providers?: AIProvider[], cacheSize?: number, maxChars?: number}} [config]
   */
  constructor({ providers, cacheSize = HARD_LIMITS.resultCacheSize, maxChars = HARD_LIMITS.maxAnalyzedChars } = {}) {
    this.providers = providers && providers.length ? [...providers] : [new LocalProvider()];
    this.cache = new LRUCache(cacheSize);
    this.maxChars = maxChars;
  }

  /** Add (or replace, by id) a provider. */
  registerProvider(provider) {
    if (!provider || typeof provider.analyze !== 'function' || !provider.id) {
      throw new TypeError('Provider must have an id and an analyze() method (see AIProvider).');
    }
    this.providers = this.providers.filter((p) => p.id !== provider.id).concat(provider);
    this.cache.clear();
    return this;
  }

  unregisterProvider(id) {
    this.providers = this.providers.filter((p) => p.id !== id);
    this.cache.clear();
    return this;
  }

  getProviders() {
    return [...this.providers];
  }

  clearCache() {
    this.cache.clear();
  }

  /** Shared preparation: truncation, features, cache key, eligibility. */
  prepare(input, options = {}) {
    const src = truncateInput(input, this.maxChars);
    const textHash = hashString(String(src.text || ''));
    const structure = Array.isArray(src.blocks) ? hashString(src.blocks.map((b) => b.type).join(',')) : '';
    const key = `${textHash}|${structure}|${optionsKey(options)}|${src.meta?.linkDensity > 0.6 ? 'L' : ''}`;
    const cached = this.cache.get(key);
    if (cached) return { cached };
    const features = computeFeatures(src);
    const skipped = checkEligibility(features, { minWords: options.minWords });
    return { src, features, key, textHash, skipped };
  }

  finalize(prep, providerResults, options) {
    const bands = options.bands || DEFAULT_BANDS;
    let result;
    if (prep.skipped || !providerResults.length) {
      result = createDetectionResult({
        skipped: prep.skipped || 'no-provider',
        bands,
        wordCount: prep.features.wordCount,
        textHash: prep.textHash,
      });
    } else {
      let totalWeight = 0;
      let weighted = 0;
      for (const { provider, result: r } of providerResults) {
        totalWeight += provider.weight;
        weighted += r.score * provider.weight;
      }
      const primary = providerResults[0].result;
      result = createDetectionResult({
        score: weighted / totalWeight,
        bands,
        signals: providerResults.flatMap(({ result: r }) => r.signals || []),
        humanSignals: providerResults.flatMap(({ result: r }) => r.humanSignals || []),
        families: primary.families || {},
        firedFamilies: primary.firedFamilies || [],
        wordCount: prep.features.wordCount,
        providers: providerResults.map(({ provider, result: r }) => ({ id: provider.id, score: r.score })),
        textHash: prep.textHash,
        notes: providerResults.flatMap(({ result: r }) => r.notes || []),
      });
    }
    this.cache.set(prep.key, result);
    return result;
  }

  /**
   * Analyse text with every registered provider.
   * @param {import('./types.js').DetectionInput | string} input
   * @param {import('./types.js').DetectionOptions & {minWords?: number}} [options]
   * @returns {Promise<import('./types.js').DetectionResult>}
   */
  async analyze(input, options = {}) {
    const prep = this.prepare(input, options);
    if (prep.cached) return prep.cached;
    if (prep.skipped) return this.finalize(prep, [], options);

    const results = [];
    for (const provider of this.providers) {
      try {
        if (!(await provider.isAvailable())) continue;
        const r = await provider.analyze(prep.src, options, prep.features);
        if (r && Number.isFinite(r.score)) results.push({ provider, result: r });
      } catch (e) {
        // A failing optional provider must never break local detection.
        console.warn(`[AI Content Blocker] provider "${provider.id}" failed:`, e);
      }
    }
    return this.finalize(prep, results, options);
  }

  /**
   * Synchronous analysis using only providers that implement analyzeSync()
   * (the local provider). Used on the hot path of the content script.
   */
  analyzeSync(input, options = {}) {
    const prep = this.prepare(input, options);
    if (prep.cached) return prep.cached;
    if (prep.skipped) return this.finalize(prep, [], options);
    const results = [];
    for (const provider of this.providers) {
      if (typeof provider.analyzeSync !== 'function') continue;
      try {
        results.push({ provider, result: provider.analyzeSync(prep.src, options, prep.features) });
      } catch (e) {
        console.warn(`[AI Content Blocker] provider "${provider.id}" failed:`, e);
      }
    }
    return this.finalize(prep, results, options);
  }

  /** True when every provider can run synchronously (no async/remote providers). */
  get isSynchronous() {
    return this.providers.every((p) => typeof p.analyzeSync === 'function');
  }
}

export function createDetectionEngine(config) {
  return new DetectionEngine(config);
}

export { AIProvider, LocalProvider };
