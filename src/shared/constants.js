/**
 * Shared constants used by the content script, popup, options page and
 * service worker. Keep this file free of browser-API calls so it can be
 * imported anywhere (including tests).
 */

export const EXTENSION_NAME = 'AI Content Blocker';

/** Message types exchanged between popup, content script and service worker. */
export const MESSAGE = Object.freeze({
  GET_STATUS: 'AICB_GET_STATUS',
  SCAN: 'AICB_SCAN',
  SHOW_ALL: 'AICB_SHOW_ALL',
  BLOCK_ALL: 'AICB_BLOCK_ALL',
  STATS: 'AICB_STATS',
  OPEN_OPTIONS: 'AICB_OPEN_OPTIONS',
});

/** Supported blocking behaviours. */
export const ACTIONS = Object.freeze(['placeholder', 'collapse', 'blur', 'hide']);

export const ACTION_LABELS = Object.freeze({
  placeholder: 'Replace with placeholder',
  collapse: 'Collapse',
  blur: 'Blur',
  hide: 'Hide completely',
});

/**
 * Default settings. Every key is stored as its own item in chrome.storage.sync
 * so that large lists (whitelist/blacklist) do not hit the per-item quota of
 * a single combined object.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  // General
  enabled: true,
  autoScan: true,
  scanDynamic: true,
  /** 1 (low) … 5 (high). Scales how strongly AI-style evidence counts. */
  sensitivity: 3,

  // Blocking behaviour
  action: 'placeholder',
  /** Show the top detection reasons inside placeholders. */
  showReasons: true,

  // Detection
  /** Minimum number of characters a block needs before it is analysed. */
  minTextLength: 120,
  /** Content scoring at or above this value (0-100) is blocked. */
  confidenceThreshold: 65,
  /** Lower bounds of the score bands used for labels. */
  bandUncertain: 31,
  bandLikely: 61,
  bandHigh: 81,
  enablePhraseDetection: true,
  enableStyleDetection: true,
  /** Block content that the site itself labels as AI-generated (e.g. Google "AI Overview"). */
  blockSiteLabeledAI: true,

  // Website controls
  whitelist: [],
  blacklist: [],

  // Performance
  maxElementsPerScan: 200,
  /**
   * Extra delay (ms) before the first scan and between background batches.
   * 0 = check content before it is painted (recommended).
   */
  scanDelay: 0,
  /**
   * Debounce (ms) for MutationObserver bursts. 0 = check new content
   * immediately, before it is painted (recommended). Higher values batch
   * work on very busy pages but new content may flash before being blocked.
   */
  mutationDebounce: 0,
});

/** Validation ranges for numeric settings: [min, max]. */
export const SETTING_RANGES = Object.freeze({
  sensitivity: [1, 5],
  minTextLength: [40, 2000],
  confidenceThreshold: [31, 99],
  bandUncertain: [1, 98],
  bandLikely: [2, 99],
  bandHigh: [3, 100],
  maxElementsPerScan: [10, 2000],
  scanDelay: [0, 5000],
  mutationDebounce: [0, 10000],
});

/** Version of the stored settings format; see migrateSettings() in storage.js. */
export const SETTINGS_VERSION = 2;

/** Settings that change detection results; changing them triggers a full re-scan. */
export const DETECTION_SETTING_KEYS = Object.freeze([
  'sensitivity',
  'minTextLength',
  'confidenceThreshold',
  'bandUncertain',
  'bandLikely',
  'bandHigh',
  'enablePhraseDetection',
  'enableStyleDetection',
  'blockSiteLabeledAI',
  'blacklist',
]);

/** Hard limits that protect page performance regardless of settings. */
export const HARD_LIMITS = Object.freeze({
  /** Longest text (characters) passed to the detector for a single block. */
  maxAnalyzedChars: 12000,
  /** Largest container (characters) accepted as a single analysable unit. */
  maxUnitChars: 30000,
  /** Maximum number of domains in a whitelist/blacklist. */
  maxListEntries: 500,
  /** Size of the detection result cache (entries). */
  resultCacheSize: 3000,
});

/* ------------------------------------------------------------------ */
/* Support / donations                                                 */
/* ------------------------------------------------------------------ */

/** PayPal account that receives voluntary support payments. */
export const PAYPAL_EMAIL = 'patelshamit1911@gmail.com';

/**
 * PayPal's official Donate flow (https://www.paypal.com/donate) accepts the
 * recipient account e-mail in the `business` parameter. The extension only
 * opens this page in a new tab; it never handles payment data itself.
 */
export const SUPPORT_URL =
  'https://www.paypal.com/donate/?' +
  new URLSearchParams({
    business: PAYPAL_EMAIL,
    item_name: 'Support AI Content Blocker',
    currency_code: 'USD',
  }).toString();
