// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverUnits } from '../src/content/discovery.js';
import { extractText } from '../src/content/extractor.js';
import { Scanner } from '../src/content/scanner.js';
import { Blocker } from '../src/content/blocker.js';
import { DomObserver } from '../src/content/observer.js';
import { getAdapter } from '../src/content/adapters/index.js';
import { STATE_ATTR, PENDING_ATTR } from '../src/content/dom-filters.js';
import { DetectionEngine } from '../src/detector/detector.js';
import { normalizeSettings } from '../src/shared/storage.js';
import { getDetectionOptions } from '../src/shared/site-rules.js';
import { AI, HUMAN } from './fixtures/samples.js';
import { buildTestPage, waitFor, sleep } from './helpers/dom.js';

const generic = getAdapter('example.com');

function makeScanner(settingsOverrides = {}, adapter = generic, scannerOptions = {}) {
  const settings = normalizeSettings({ scanDelay: 0, mutationDebounce: 50, ...settingsOverrides });
  const engine = new DetectionEngine();
  const spy = vi.spyOn(engine, 'analyzeSync');
  const blocker = new Blocker({ doc: document, getSettings: () => settings });
  const ctx = { settings, detection: getDetectionOptions(settings, 'normal'), active: true };
  const scanner = new Scanner({ engine, blocker, adapter, doc: document, win: window, getContext: () => ctx, ...scannerOptions });
  return { scanner, blocker, engine, spy, ctx };
}

const unitIn = (id) => document.querySelector(`#${id} p`);

const idleDone = (scanner) => waitFor(() => !scanner.running && !scanner.discoveryScheduled && scanner.queue.length === 0 && !scanner.cycleTimer);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('candidate discovery', () => {
  it('finds content units and skips site chrome, forms, code and banners', () => {
    document.body.innerHTML = buildTestPage();
    const ids = discoverUnits(document.body, { adapter: generic }).map((u) => u.id || u.className);
    expect(ids).toEqual(expect.arrayContaining(['ai-article', 'human-comment', 'ai-comment', 'human-comment-2']));
    expect(ids).not.toContain('cookie-banner');
    expect(ids).not.toContain('footer-text');
    expect(ids).not.toContain('ta');
    expect(ids).not.toContain('code-block');
    // the comment list is not merged into one unit
    expect(ids).not.toContain('comments');
  });

  it('groups an article’s paragraphs into a single unit', () => {
    document.body.innerHTML = `<main><div id="body"><h2>Title</h2><p>${'Sentence one is here. '.repeat(5)}</p><ul><li>point one here</li><li>point two here</li></ul><p>${'Another paragraph follows. '.repeat(5)}</p></div></main>`;
    const units = discoverUnits(document.body, { adapter: generic });
    expect(units.map((u) => u.id)).toEqual(['body']);
  });

  it('merges single-paragraph wrapper blocks (BBC-style) into the article', () => {
    const block = (t) => `<div class="text-block"><p>${t}</p></div>`;
    document.body.innerHTML = `<article id="art"><div class="headline"><h1>Headline</h1></div>${block(HUMAN.newsReport)}${block(HUMAN.encyclopedic)}${block(HUMAN.formalEssay)}</article>`;
    expect(discoverUnits(document.body, { adapter: generic }).map((u) => u.id)).toEqual(['art']);
  });

  it('keeps multi-paragraph feed items as separate units', () => {
    const post = (id) => `<div class="post" id="${id}"><p>${HUMAN.opinionComment}</p><p>${HUMAN.recipeNotes}</p></div>`;
    document.body.innerHTML = `<div class="feed">${post('p1')}${post('p2')}${post('p3')}</div>`;
    expect(discoverUnits(document.body, { adapter: generic }).map((u) => u.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('never merges several <article>s into one unit (regression: whole <main> was blocked)', () => {
    document.body.innerHTML = `<main id="main"><p class="label">Expected: blocked</p><article id="a1"><h1>Guide</h1><div><p>${AI.seoIntro}</p></div></article><p class="label">Expected: visible</p><article id="a2"><h2>News</h2><p>${HUMAN.newsReport}</p></article></main>`;
    const ids = discoverUnits(document.body, { adapter: generic }).map((u) => u.id);
    expect(ids).not.toContain('main');
    expect(ids).toEqual(expect.arrayContaining(['a1', 'a2']));
  });

  it('uses adapter selectors (e.g. Reddit comment bodies)', () => {
    document.body.innerHTML = `
      <shreddit-comment><div slot="commentMeta">user · 5h</div><div slot="comment" id="rc1"><p>${AI.chatbotComment}</p></div>
        <shreddit-comment><div slot="comment" id="rc2"><p>${HUMAN.casualComment}</p></div></shreddit-comment>
      </shreddit-comment>
      <div id="sidebar-text"><p>${AI.seoIntro}</p></div>`;
    const ids = discoverUnits(document.body, { adapter: getAdapter('www.reddit.com') }).map((u) => u.id);
    expect(ids).toEqual(['rc1', 'rc2']); // generic discovery is disabled on Reddit
  });

  it('only scans inside the given root for mutations but climbs to the enclosing unit', () => {
    document.body.innerHTML = `<div id="body"><p>${AI.seoIntro}</p><p id="new">${AI.productReview}</p></div><div id="other"><p>${HUMAN.personalBlog}</p></div>`;
    const units = discoverUnits(document.getElementById('new'), { adapter: generic });
    expect(units.map((u) => u.id)).toEqual(['body']);
  });
});

describe('text extraction', () => {
  it('keeps structure, skips code/buttons and reports link density', () => {
    document.body.innerHTML = `<div id="u"><h2>Heading</h2><p>Para <a href="#">with link</a>.</p><ul><li>One</li><li>Two</li></ul><pre>code()</pre><button>Reply</button></div>`;
    const out = extractText(document.getElementById('u'));
    expect(out.blocks.map((b) => b.type)).toEqual(['h', 'p', 'li', 'li']);
    expect(out.text).not.toMatch(/code\(\)|Reply/);
    expect(out.linkDensity).toBeGreaterThan(0);
    expect(out.linkDensity).toBeLessThan(1);
  });

  it('respects the character limit', () => {
    document.body.innerHTML = `<div id="u"><p>${'word '.repeat(5000)}</p></div>`;
    expect(extractText(document.getElementById('u'), { maxChars: 500 }).charCount).toBeLessThan(700);
  });
});

describe('scanning and blocking', () => {
  it('blocks AI units, leaves human and excluded content alone', async () => {
    document.body.innerHTML = buildTestPage();
    const { scanner } = makeScanner();
    scanner.scanAll();
    await waitFor(() => document.getElementById('ai-article').hasAttribute(STATE_ATTR));
    await idleDone(scanner);
    expect(document.getElementById('ai-comment').getAttribute(STATE_ATTR)).toBe('placeholder');
    for (const id of ['human-comment', 'human-comment-2', 'cookie-banner', 'footer-text', 'ta', 'code-block']) {
      expect(document.getElementById(id).hasAttribute(STATE_ATTR)).toBe(false);
    }
    expect(document.getElementById('ta').value).toBe(AI.seoIntro); // form fields untouched
  });

  it('does not analyse the same content twice', async () => {
    document.body.innerHTML = buildTestPage();
    const { scanner, spy } = makeScanner();
    scanner.scanAll();
    await waitFor(() => spy.mock.calls.length > 0);
    await idleDone(scanner);
    const calls = spy.mock.calls.length;
    scanner.scanAll();
    await sleep(50);
    await idleDone(scanner);
    expect(spy.mock.calls.length).toBe(calls);
  });

  it('re-analyses a unit when its text changes', async () => {
    document.body.innerHTML = `<div id="u"><p>${HUMAN.personalBlog}</p></div>`;
    const { scanner, spy } = makeScanner();
    scanner.scanAll();
    await waitFor(() => spy.mock.calls.length === 1);
    await idleDone(scanner);
    document.querySelector('#u p').textContent = AI.seoIntro;
    scanner.scanRoots([document.getElementById('u')]);
    await waitFor(() => unitIn('u').hasAttribute(STATE_ATTR));
  });

  it('ignores text shorter than the minimum length', async () => {
    document.body.innerHTML = `<div id="u"><p>Certainly! Here are some ways to delve into it.</p></div>`;
    const { scanner, spy } = makeScanner({ minTextLength: 120 });
    scanner.scanAll();
    await sleep(30);
    await idleDone(scanner);
    expect(spy).not.toHaveBeenCalled();
    expect(document.querySelector(`[${STATE_ATTR}]`)).toBeNull();
  });

  it('respects maxElementsPerScan per cycle and still finishes the queue', async () => {
    const items = Array.from({ length: 12 }, (_, i) => `<div class="item i${i}" id="i${i}"><span class="meta">user</span><div class="comment-body"><p>${i % 2 ? AI.forumReply : HUMAN.forumAnswer}</p></div></div>`).join('');
    document.body.innerHTML = `<div class="list">${items}</div>`;
    const { scanner } = makeScanner({ maxElementsPerScan: 10 });
    scanner.scanAll();
    await waitFor(() => scanner.stats.cycles >= 1 && scanner.stats.analyzed > 0);
    await idleDone(scanner);
    expect(scanner.stats.cycles).toBeGreaterThanOrEqual(2);
    expect(scanner.stats.analyzed).toBe(12);
    expect(document.querySelectorAll(`[${STATE_ATTR}]`).length).toBe(6);
  });

  it('unblocks content that no longer meets a raised threshold', async () => {
    document.body.innerHTML = `<div id="u"><p>${AI.subtleCorporate}</p></div>`;
    const { scanner, ctx, blocker } = makeScanner();
    scanner.scanAll();
    await waitFor(() => blocker.has(unitIn('u')));
    await idleDone(scanner);
    ctx.detection = { ...ctx.detection, threshold: 101 };
    scanner.scanAll({ force: true });
    await waitFor(() => !blocker.has(unitIn('u')));
  });

  it('handles site-labelled AI content via the adapter', async () => {
    document.body.innerHTML = `<div id="wrap"><div id="ov"><h2>AI Overview</h2><div>${AI.seoIntro}</div></div></div><div id="rso"><div class="MjjYud"><div class="VwiC3b">${HUMAN.newsReport}</div></div></div>`;
    const { scanner, blocker } = makeScanner({}, getAdapter('www.google.com'));
    scanner.scanAll();
    await waitFor(() => blocker.has(document.getElementById('ov')));
    expect(blocker.get(document.getElementById('ov')).result.siteLabeled).toBe(true);
  });

  it('stays within budget on a page with thousands of nodes', async () => {
    const para = (t) => `<div class="c"><span>user</span><div class="comment-body"><p>${t}</p></div><button>Reply</button><a href="#">Share</a></div>`;
    const rows = Array.from({ length: 400 }, (_, i) => para(i % 4 === 0 ? AI.chatbotComment : HUMAN.opinionComment)).join('');
    document.body.innerHTML = `<nav>${'<a href="#">link</a>'.repeat(300)}</nav><div class="feed">${rows}</div>`;
    expect(document.getElementsByTagName('*').length).toBeGreaterThan(2000);
    const t0 = Date.now();
    const units = discoverUnits(document.body, { adapter: generic });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(units.length).toBe(400);
  });
});

describe('blocking before paint', () => {
  it('scanNow blocks synchronously, in the same task', () => {
    document.body.innerHTML = buildTestPage();
    const { scanner } = makeScanner({}, generic, { budgetMs: 1000 });
    scanner.scanNow([document.body]);
    // No await: a browser could not have painted in between.
    expect(document.getElementById('ai-article').getAttribute(STATE_ATTR)).toBe('placeholder');
    expect(document.getElementById('ai-comment').getAttribute(STATE_ATTR)).toBe('placeholder');
    expect(document.getElementById('human-comment').hasAttribute(STATE_ATTR)).toBe(false);
  });

  it('blocks inserted content inside the MutationObserver microtask (before any paint)', async () => {
    document.body.innerHTML = '<div id="feed"></div>';
    const { scanner, blocker } = makeScanner({ mutationDebounce: 0 });
    const observer = new DomObserver({ target: document, debounceMs: 0, win: window, onNodes: (roots) => scanner.scanNow(roots) });
    observer.start();
    const item = document.createElement('div');
    item.className = 'comment';
    item.innerHTML = `<div class="author">x</div><div class="comment-body" id="late"><p>${AI.listicle}</p></div>`;
    document.getElementById('feed').append(item);
    let macrotaskRan = false;
    setTimeout(() => (macrotaskRan = true), 0);
    await Promise.resolve(); // only microtasks have run: the MutationObserver callback
    expect(macrotaskRan).toBe(false);
    expect(blocker.has(document.getElementById('late'))).toBe(true);
    observer.stop();
  });

  it('keeps over-budget new units invisible until analysed, then reveals or blocks them', async () => {
    document.body.innerHTML = buildTestPage();
    const { scanner } = makeScanner({}, generic, { budgetMs: -1 }); // nothing fits the sync budget
    scanner.scanNow([document.body]);
    expect(document.getElementById('human-comment').hasAttribute(PENDING_ATTR)).toBe(true);
    expect(document.getElementById('ai-comment').hasAttribute(PENDING_ATTR)).toBe(true);
    await waitFor(() => document.querySelectorAll(`[${PENDING_ATTR}]`).length === 0 && scanner.urgent.length === 0);
    expect(document.getElementById('ai-comment').getAttribute(STATE_ATTR)).toBe('placeholder');
    expect(document.getElementById('human-comment').hasAttribute(STATE_ATTR)).toBe(false);
  });

  it('never hides content that was already judged visible', () => {
    document.body.innerHTML = `<div class="c"><div class="comment-body" id="h"><p>${HUMAN.opinionComment}</p></div></div>`;
    const { scanner } = makeScanner({}, generic, { budgetMs: 1000 });
    scanner.scanNow([document.body]);
    scanner.budgetMs = -1;
    document.querySelector('#h p').append(' More text appended later by the site.');
    scanner.scanNow([document.getElementById('h')]);
    expect(document.getElementById('h').hasAttribute(PENDING_ATTR)).toBe(false);
  });

  it('a watchdog un-hides pending content if analysis never finishes', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<div class="c"><div class="comment-body" id="u"><p>${AI.seoIntro}</p></div></div>`;
      const { scanner } = makeScanner({}, generic, { budgetMs: -1 });
      scanner.postTask = () => {}; // simulate the follow-up task never running
      scanner.scanNow([document.body]);
      expect(document.getElementById('u').hasAttribute(PENDING_ATTR)).toBe(true);
      vi.advanceTimersByTime(2100);
      expect(document.getElementById('u').hasAttribute(PENDING_ATTR)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() clears pending state', () => {
    document.body.innerHTML = buildTestPage();
    const { scanner } = makeScanner({}, generic, { budgetMs: -1 });
    scanner.scanNow([document.body]);
    scanner.stop();
    expect(document.querySelectorAll(`[${PENDING_ATTR}]`).length).toBe(0);
  });
});

describe('units chosen on an incomplete DOM', () => {
  it('unblocks a group that stops being a paragraph group as the page grows, and re-checks its parts', () => {
    // Mid-parse: <main> only holds two AI paragraphs, so it looks like one text.
    const [first, second] = [AI.seoIntro, AI.forumReply];
    document.body.innerHTML = `<main id="main"><p>${first}</p><p>${second}</p></main>`;
    const { scanner, blocker } = makeScanner({}, generic, { budgetMs: 1000 });
    scanner.scanNow([document.body]);
    const main = document.getElementById('main');
    expect(blocker.has(main)).toBe(true);

    // The rest of the page arrives: comments, a widget and a form.
    main.insertAdjacentHTML(
      'beforeend',
      `<section id="comments"><div class="comment"><div class="meta">dave</div><div class="comment-body" id="human"><p>${HUMAN.forumAnswer}</p></div></div></section><div class="widget"><div><span>Trending</span></div></div><form><input></form>`,
    );
    scanner.scanNow([document.getElementById('comments')]);

    expect(blocker.has(main)).toBe(false);
    expect(main.hasAttribute(STATE_ATTR)).toBe(false);
    expect(document.getElementById('human').hasAttribute(STATE_ATTR)).toBe(false);
    // The AI paragraphs are re-checked on their own (same task, before paint).
    expect(document.querySelectorAll(`#main > p[${STATE_ATTR}]`).length).toBeGreaterThan(0);
  });

  it('validateBlockedGroups() fixes stale groups after parsing ends', () => {
    document.body.innerHTML = `<div id="g"><p>${AI.seoIntro}</p><p>${AI.subtleCorporate}</p></div>`;
    const { scanner, blocker } = makeScanner({}, generic, { budgetMs: 1000 });
    scanner.scanNow([document.body]);
    const g = document.getElementById('g');
    expect(blocker.has(g)).toBe(true);
    g.insertAdjacentHTML('beforeend', '<div class="x"><div><span>a</span></div></div><div class="y"><div><span>b</span></div></div><div class="z"><div><span>c</span></div></div>');
    expect(scanner.validateBlockedGroups()).toBe(1);
    expect(blocker.has(g)).toBe(false);
    expect(document.querySelectorAll(`#g > p[${STATE_ATTR}]`).length).toBeGreaterThan(0);
  });

  it('leaves valid groups and single-block units alone', () => {
    document.body.innerHTML = buildTestPage();
    const { scanner } = makeScanner({}, generic, { budgetMs: 1000 });
    scanner.scanNow([document.body]);
    expect(scanner.validateBlockedGroups()).toBe(0);
    expect(document.getElementById('ai-article').getAttribute(STATE_ATTR)).toBe('placeholder');
  });
});

describe('dynamic content', () => {
  it('detects content inserted after load via MutationObserver (debounced)', async () => {
    document.body.innerHTML = `<div id="feed"></div>`;
    const { scanner, blocker } = makeScanner();
    const onNodes = vi.fn((roots) => scanner.scanRoots(roots));
    const observer = new DomObserver({ target: document.body, onNodes, debounceMs: 50, win: window });
    observer.start();

    const feed = document.getElementById('feed');
    for (let i = 0; i < 5; i++) {
      const div = document.createElement('div');
      div.className = 'comment';
      div.id = `n${i}`;
      div.innerHTML = `<div class="author">someone</div><div class="comment-body"><p>${i === 2 ? AI.listicle : HUMAN.productReview}</p></div>`;
      feed.appendChild(div);
    }
    await waitFor(() => blocker.has(document.querySelector('#n2 .comment-body')));
    expect(onNodes).toHaveBeenCalledTimes(1); // five insertions → one debounced flush
    expect(blocker.stats().detected).toBe(1);
    observer.stop();
  });

  it('ignores its own notice insertions', async () => {
    document.body.innerHTML = `<div id="u"><p>${AI.seoIntro}</p></div>`;
    const { scanner, blocker } = makeScanner();
    const onNodes = vi.fn();
    const observer = new DomObserver({ target: document.body, onNodes, debounceMs: 30, win: window });
    observer.start();
    scanner.scanAll();
    await waitFor(() => blocker.has(unitIn('u')));
    await sleep(80);
    expect(onNodes).not.toHaveBeenCalled();
    observer.stop();
  });
});
