/**
 * X / Twitter — tweet text only (not names, handles, or engagement bars).
 */

export default {
  id: 'twitter',
  name: 'X (Twitter)',
  matches: (host) => /(^|\.)(twitter|x)\.com$/.test(host),
  useGeneric: false,
  unitSelectors: ['[data-testid="tweetText"]', '[data-testid="noteText"]'],
  excludeSelectors: ['[data-testid="User-Name"]'],
};
