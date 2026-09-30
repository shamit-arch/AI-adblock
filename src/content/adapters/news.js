/**
 * News and publishing platforms — treat the article body as one unit so the
 * detector sees the whole piece (better statistics, one placeholder), and
 * exclude bylines, captions, related-story rails and newsletter boxes.
 * Generic discovery stays on for comment sections and live blogs.
 */

const NEWS_DOMAINS = [
  'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'bbc.co.uk', 'bbc.com', 'cnn.com',
  'reuters.com', 'apnews.com', 'npr.org', 'wsj.com', 'bloomberg.com', 'forbes.com',
  'businessinsider.com', 'huffpost.com', 'usatoday.com', 'foxnews.com', 'nbcnews.com',
  'cbsnews.com', 'abcnews.go.com', 'latimes.com', 'theatlantic.com', 'newyorker.com',
  'wired.com', 'theverge.com', 'techcrunch.com', 'arstechnica.com', 'engadget.com',
  'independent.co.uk', 'telegraph.co.uk', 'dailymail.co.uk', 'medium.com', 'substack.com',
  'buzzfeed.com', 'vice.com', 'vox.com', 'axios.com', 'politico.com', 'time.com',
  'economist.com', 'aljazeera.com', 'cnet.com', 'zdnet.com', 'mashable.com', 'msn.com',
  'news.yahoo.com', 'theconversation.com', 'hbr.org', 'fastcompany.com', 'inc.com',
  'entrepreneur.com', 'hindustantimes.com', 'indiatimes.com', 'ndtv.com', 'thehindu.com',
  'abc.net.au', 'smh.com.au', 'cbc.ca', 'theglobeandmail.com', 'lemonde.fr', 'spiegel.de',
];

export function isNewsHost(host) {
  return NEWS_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

export default {
  id: 'news',
  name: 'News & publishing',
  matches: isNewsHost,
  useGeneric: true,
  unitSelectors: [
    '[itemprop="articleBody"]',
    '[data-testid="article-body"]',
    '[data-gu-name="body"]', // The Guardian
    'section[name="articleBody"]', // NYT
    '.article-body',
    '.article__body',
    '.article-content',
    '.story-body',
    '.post-content',
    '.body.markup', // Substack
    'article .available-content',
    'main article',
  ],
  excludeSelectors: [
    'figcaption',
    '[data-component="byline-block"]',
    '[data-component="links-block"]',
    '[data-component="image-block"]',
    '[data-testid="byline"]',
    '.byline',
    '.caption',
    '.credit',
    '.related',
    '.related-stories',
    '.newsletter',
    '.subscription-widget',
    '.paywall',
    '.ad-container',
    '[data-ad]',
  ],
};
