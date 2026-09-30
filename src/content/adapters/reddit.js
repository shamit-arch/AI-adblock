/**
 * Reddit — new ("shreddit") and old layouts.
 * Only post bodies and comment bodies are analysed; titles, author lines,
 * vote bars and sidebars are left alone. Generic discovery is disabled
 * because Reddit's feed structure would otherwise produce odd units.
 */

export default {
  id: 'reddit',
  name: 'Reddit',
  matches: (host) => /(^|\.)reddit\.com$/.test(host),
  useGeneric: false,
  unitSelectors: [
    'shreddit-comment [slot="comment"]',
    'shreddit-post [slot="text-body"]',
    'shreddit-profile-comment [slot="comment"]',
    '[data-testid="comment"]',
    '[data-click-id="text"]',
    '[data-test-id="post-content"] .RichTextJSON-root',
    '.usertext-body .md', // old.reddit.com
  ],
  excludeSelectors: [
    '[slot="title"]',
    '[slot="credit-bar"]',
    '[slot="commentMeta"]',
    'shreddit-comment-action-row',
    'faceplate-tracker[noun="comments"]',
    '.tagline',
    '.flat-list',
  ],
};
