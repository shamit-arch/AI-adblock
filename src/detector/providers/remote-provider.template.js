/**
 * TEMPLATE — not imported anywhere and not included in the build.
 *
 * Shows how an external AI-detection API could be plugged in later.
 * Enabling something like this changes the privacy model (page text leaves
 * the browser), so it must be:
 *   - strictly opt-in, with a clear explanation in the options page
 *   - limited to the API's origin via "host_permissions" in the manifest
 *   - registered with `engine.registerProvider(new RemoteProvider({...}))`
 *     (the engine then averages its score with the local provider by weight)
 *
 * The build verifier (scripts/verify-build.mjs) fails if network calls appear
 * in dist/, so adopting this also means updating that check deliberately.
 */

import { AIProvider } from '../types.js';

export class RemoteProvider extends AIProvider {
  /**
   * @param {{endpoint: string, apiKey: string, weight?: number, timeoutMs?: number}} config
   */
  constructor({ endpoint, apiKey, weight = 2, timeoutMs = 4000 }) {
    super({ id: 'remote', name: 'Remote AI detector', weight, local: false });
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async isAvailable() {
    return Boolean(this.endpoint && this.apiKey && globalThis.navigator?.onLine !== false);
  }

  /** @returns {Promise<import('../types.js').ProviderResult>} */
  async analyze(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ text: input.text }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Map the API's response (e.g. probability 0..1) onto the 0-100 scale.
      const score = Math.round(Math.max(0, Math.min(1, Number(data.probability))) * 100);
      return {
        providerId: this.id,
        score,
        signals: [{ id: 'remote-model', family: 'model', label: 'External detector', value: score / 100, weight: 1 }],
        humanSignals: [],
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
