// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentController } from '../src/content/controller.js';
import { STATE_ATTR } from '../src/content/dom-filters.js';
import { MESSAGE } from '../src/shared/constants.js';
import { saveSettings, loadSettings } from '../src/shared/storage.js';
import { installChromeMock } from './helpers/chrome-mock.js';
import { buildTestPage, waitFor, sleep } from './helpers/dom.js';
import { AI, HUMAN } from './fixtures/samples.js';

let chrome;
let controller;

async function start(initial = {}, hostname = 'blog.example') {
  chrome = installChromeMock({ ...initial });
  document.body.innerHTML = buildTestPage();
  controller = new ContentController({ doc: document, win: window, chromeApi: chrome, hostname, urlPollInterval: 50 });
  await controller.init();
  return controller;
}

const aiBody = () => document.getElementById('ai-article');
const aiComment = () => document.getElementById('ai-comment');
const blockedCount = () => document.querySelectorAll(`[${STATE_ATTR}]:not([${STATE_ATTR}="revealed"])`).length;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  delete globalThis.chrome;
});

describe('content controller', () => {
  it('starts blocking as soon as settings load (no scan delay, no idle wait)', async () => {
    await start();
    // Synchronous work started inside init(); whatever didn't fit the time
    // budget is queued for the very next task, not for idle time.
    const { stats, urgent, queue } = controller.scanner;
    expect(stats.analyzed + urgent.length).toBeGreaterThanOrEqual(2);
    expect(queue.length).toBe(0);
    await waitFor(() => aiBody().getAttribute(STATE_ATTR) === 'placeholder' && aiComment().getAttribute(STATE_ATTR) === 'placeholder', { timeout: 1000 });
  });

  it('blocks dynamically inserted content before the next task (before paint)', async () => {
    await start();
    const item = document.createElement('div');
    item.className = 'comment';
    item.innerHTML = `<div class="meta">late_user</div><div class="comment-body" id="late"><p>${AI.forumReply}</p></div>`;
    document.querySelector('.comments').append(item);
    await Promise.resolve();
    expect(document.getElementById('late').getAttribute(STATE_ATTR)).toBe('placeholder');
  });

  it('scans on load and reports stats to the popup and badge', async () => {
    await start();
    await waitFor(() => aiBody().hasAttribute(STATE_ATTR) && aiComment().hasAttribute(STATE_ATTR));
    const status = await chrome.__dispatch({ type: MESSAGE.GET_STATUS });
    expect(status).toMatchObject({ ok: true, hostname: 'blog.example', mode: 'normal', active: true });
    expect(status.stats).toMatchObject({ detected: 2, blocked: 2, visible: 0 });
    await waitFor(() => chrome.__sent.some((m) => m.type === MESSAGE.STATS && m.stats.blocked === 2));
  });

  it('Show All / Block All from the popup', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    let status = await chrome.__dispatch({ type: MESSAGE.SHOW_ALL });
    expect(status.stats).toMatchObject({ blocked: 0, visible: 2 });
    expect(blockedCount()).toBe(0);
    status = await chrome.__dispatch({ type: MESSAGE.BLOCK_ALL });
    expect(status.stats).toMatchObject({ blocked: 2, visible: 0 });
  });

  it('disabling the extension restores the page; re-enabling rescans', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    await saveSettings({ enabled: false });
    await waitFor(() => document.querySelectorAll(`[${STATE_ATTR}]`).length === 0);
    expect(document.querySelector('aicb-notice')).toBeNull();
    expect((await chrome.__dispatch({ type: MESSAGE.GET_STATUS })).mode).toBe('off');

    await saveSettings({ enabled: true });
    await waitFor(() => blockedCount() === 2);
  });

  it('whitelisting the site stops scanning and restores content', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    await saveSettings({ whitelist: ['example'] }); // invalid → ignored
    await sleep(30);
    expect(blockedCount()).toBe(2);
    await saveSettings({ whitelist: ['blog.example'] });
    await waitFor(() => document.querySelectorAll(`[${STATE_ATTR}]`).length === 0);
    expect((await chrome.__dispatch({ type: MESSAGE.GET_STATUS })).mode).toBe('whitelisted');

    // New content is not scanned while whitelisted.
    const div = document.createElement('div');
    div.innerHTML = `<div class="comment-body" id="late"><p>${AI.listicle}</p></div>`;
    document.body.append(div);
    await sleep(150);
    expect(document.getElementById('late').hasAttribute(STATE_ATTR)).toBe(false);
  });

  it('does nothing on a whitelisted site from the start', async () => {
    await start({ whitelist: ['blog.example'] });
    await sleep(100);
    expect(document.querySelectorAll(`[${STATE_ATTR}]`).length).toBe(0);
  });

  it('"Always allow site" in a placeholder whitelists the site', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    controller.blocker.get(aiBody()).shadow.querySelector('[data-action="allow"]').click();
    await waitFor(() => document.querySelectorAll(`[${STATE_ATTR}]`).length === 0);
    expect((await loadSettings()).whitelist).toEqual(['blog.example']);
  });

  it('detects dynamically loaded content', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    const item = document.createElement('div');
    item.className = 'comment';
    item.innerHTML = `<div class="meta">late_user</div><div class="comment-body" id="late"><p>${AI.forumReply}</p></div>`;
    document.querySelector('.comments').append(item);
    await waitFor(() => document.getElementById('late').getAttribute(STATE_ATTR) === 'placeholder');
  });

  it('does not scan dynamic content when that setting is off', async () => {
    await start({ scanDynamic: false });
    await waitFor(() => blockedCount() === 2);
    const item = document.createElement('div');
    item.innerHTML = `<div class="comment-body" id="late"><p>${AI.forumReply}</p></div>`;
    document.body.append(item);
    await sleep(200);
    expect(document.getElementById('late').hasAttribute(STATE_ATTR)).toBe(false);
  });

  it('manual scan works when automatic scanning is off', async () => {
    await start({ autoScan: false });
    await sleep(100);
    expect(blockedCount()).toBe(0);
    await chrome.__dispatch({ type: MESSAGE.SCAN });
    await waitFor(() => blockedCount() === 2);
  });

  it('changing the blocking action re-applies it to blocked content', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    await saveSettings({ action: 'blur' });
    await waitFor(() => aiBody().getAttribute(STATE_ATTR) === 'blurred');
    expect(document.querySelector('aicb-notice')).toBeNull();
  });

  it('raising the threshold unblocks content below it', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    await saveSettings({ confidenceThreshold: 99, sensitivity: 1 });
    await waitFor(() => blockedCount() < 2);
  });

  it('rescans after SPA navigation', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    const spy = [];
    const orig = controller.scanner.scanAll.bind(controller.scanner);
    controller.scanner.scanAll = (o) => {
      spy.push(o);
      return orig(o);
    };
    history.pushState({}, '', '/another-page');
    await waitFor(() => spy.length > 0);
  });

  it('remembers revealed content when the site re-renders it', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    controller.blocker.reveal(aiComment());
    const html = aiComment().parentElement.innerHTML.replace(/<aicb-notice[\s\S]*?<\/aicb-notice>/, '');
    const parent = aiComment().parentElement;
    aiComment().remove();
    parent.querySelector('aicb-notice')?.remove();
    const clone = document.createElement('div');
    clone.innerHTML = html;
    const fresh = clone.querySelector('.comment-body');
    fresh.removeAttribute(STATE_ATTR);
    fresh.removeAttribute('data-aicb-id');
    fresh.id = 'fresh';
    parent.append(fresh);
    await waitFor(() => document.getElementById('fresh').getAttribute(STATE_ATTR) === 'revealed');
  });

  it('never touches human content', async () => {
    await start();
    await waitFor(() => blockedCount() === 2);
    expect(document.getElementById('human-comment').hasAttribute(STATE_ATTR)).toBe(false);
    expect(document.getElementById('human-comment-2').hasAttribute(STATE_ATTR)).toBe(false);
    expect(document.getElementById('human-comment').textContent).toContain(HUMAN.casualComment.slice(0, 40));
  });

  it('stays inactive on unsupported web apps', async () => {
    await start({}, 'docs.google.com');
    await sleep(100);
    expect(controller.mode).toBe('unsupported');
    expect(blockedCount()).toBe(0);
  });
});
