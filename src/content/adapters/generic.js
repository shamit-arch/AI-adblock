/**
 * Generic adapter — used on every site, and merged into site adapters that
 * keep `useGeneric: true`.
 *
 * `unitSelectors` lists well-known content containers of common platforms
 * (WordPress, Discourse, XenForo, phpBB, Stack Exchange, Hacker News, review
 * widgets, schema.org markup). They are domain-independent, so they work on
 * self-hosted forums and blogs too. Everything else is found by the generic
 * paragraph-group discovery in discovery.js.
 */

export default {
  id: 'generic',
  name: 'Generic',
  matches: () => true,
  useGeneric: true,
  unitSelectors: [
    '[itemprop="articleBody"]',
    '[itemprop="reviewBody"]',
    '[itemprop="comment"] [itemprop="text"]',
    '.entry-content',
    '.comment-content',
    '.comment-body',
    '.comment-text',
    '.cooked', // Discourse
    '.bbWrapper', // XenForo
    '.postbody .content', // phpBB
    '.js-post-body', // Stack Exchange posts
    '.comment-copy', // Stack Exchange comments
    '.commtext', // Hacker News
    '[data-hook="review-body"]', // Amazon reviews
    '.review-text',
    '.review-body',
  ],
  excludeSelectors: [
    '[role="dialog"][aria-modal="true"] form',
    '.sr-only',
    '.visually-hidden',
    '[data-nosnippet] nav',
    '.byline',
    '.author-bio',
    '.wp-caption-text',
    '.comment-meta',
    '.comment-metadata',
  ],
};
