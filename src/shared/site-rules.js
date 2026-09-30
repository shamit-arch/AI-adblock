/**
 * Per-site behaviour derived from settings.
 *
 *   'off'         – extension globally disabled
 *   'whitelisted' – user allowed this site; nothing is scanned
 *   'aggressive'  – user blacklisted this site; stricter detection
 *   'normal'      – default scanning
 */

import { hostnameMatches, normalizeHostname } from './utils.js';

export function findMatchingEntry(list, hostname) {
  return (list || []).find((entry) => hostnameMatches(hostname, entry)) || null;
}

export function isWhitelisted(settings, hostname) {
  return !!findMatchingEntry(settings.whitelist, hostname);
}

export function isBlacklisted(settings, hostname) {
  return !!findMatchingEntry(settings.blacklist, hostname);
}

export function getSiteMode(settings, hostname) {
  if (!settings.enabled) return 'off';
  if (isWhitelisted(settings, hostname)) return 'whitelisted';
  if (isBlacklisted(settings, hostname)) return 'aggressive';
  return 'normal';
}

export function isActiveMode(mode) {
  return mode === 'normal' || mode === 'aggressive';
}

/**
 * Effective detection options for a site. Blacklisted ("aggressive") sites
 * use maximum sensitivity and a lower blocking threshold.
 */
export function getDetectionOptions(settings, mode) {
  const aggressive = mode === 'aggressive';
  return {
    sensitivity: aggressive ? 5 : settings.sensitivity,
    aggressive,
    enablePhraseDetection: settings.enablePhraseDetection,
    enableStyleDetection: settings.enableStyleDetection,
    bands: {
      uncertain: settings.bandUncertain,
      likely: settings.bandLikely,
      high: settings.bandHigh,
    },
    threshold: aggressive
      ? Math.max(settings.bandUncertain + 5, settings.confidenceThreshold - 15)
      : settings.confidenceThreshold,
  };
}

/**
 * The hostname used for site rules. Inside frames we prefer the top-level
 * site so that "disable on this site" behaves as users expect.
 */
export function getTopHostname(loc = globalThis.location) {
  try {
    const origins = loc.ancestorOrigins;
    if (origins && origins.length) {
      return normalizeHostname(new URL(origins[origins.length - 1]).hostname);
    }
  } catch {
    /* ignore */
  }
  return normalizeHostname(loc?.hostname || '');
}
