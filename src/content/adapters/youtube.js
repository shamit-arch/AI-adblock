/**
 * YouTube — comments, community posts and the video description.
 * YouTube is a heavy SPA; generic discovery is disabled so only these
 * well-defined text elements are touched.
 */

export default {
  id: 'youtube',
  name: 'YouTube',
  matches: (host) => /(^|\.)youtube\.com$/.test(host) && !/^(studio|music|tv)\./.test(host),
  useGeneric: false,
  unitSelectors: [
    'ytd-comment-view-model #content-text',
    'ytd-comment-renderer #content-text',
    'ytd-backstage-post-renderer #content-text',
    'ytd-post-renderer #content-text',
    'ytd-watch-metadata #description-inline-expander',
  ],
  excludeSelectors: ['#author-text', '#header-author', '#vote-count-middle', 'ytd-menu-renderer'],
};
