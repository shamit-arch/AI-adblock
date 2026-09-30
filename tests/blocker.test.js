// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Blocker } from '../src/content/blocker.js';
import { STATE_ATTR } from '../src/content/dom-filters.js';
import { normalizeSettings } from '../src/shared/storage.js';

const RESULT = Object.freeze({ score: 87, label: 'high', labelText: 'Highly likely AI-generated', reasons: ['Stock AI phrasing'], textHash: 'h1' });

function setup(action = 'placeholder', extra = {}) {
  document.body.innerHTML = `
    <div id="wrap">
      <div id="target" class="article" title="orig"><p>AI text here</p><a href="#x" id="link">link</a></div>
      <ul id="list"><li id="item">List item text</li></ul>
      <table><tr><td id="cell">Cell text</td></tr></table>
    </div>`;
  const original = document.body.innerHTML;
  let settings = normalizeSettings({ action });
  let changes = 0;
  let allowed = 0;
  const blocker = new Blocker({
    doc: document,
    getSettings: () => settings,
    onChange: () => changes++,
    onAllowSite: () => allowed++,
    ...extra,
  });
  return {
    blocker,
    original,
    target: document.getElementById('target'),
    setAction: (a) => (settings = { ...settings, action: a }),
    counts: () => ({ changes, allowed }),
  };
}

const notice = () => document.querySelector('aicb-notice');

describe('blocking actions', () => {
  it('placeholder hides the element and inserts a Shadow-DOM notice before it', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, RESULT);
    expect(target.getAttribute(STATE_ATTR)).toBe('placeholder');
    const host = notice();
    expect(host).not.toBeNull();
    expect(host.nextElementSibling).toBe(target);
    expect(host.shadowRoot).toBeNull(); // closed shadow root: page scripts can't reach in
    const record = blocker.get(target);
    expect(record.shadow.textContent).toContain('Highly likely AI-generated content blocked');
    expect(record.shadow.textContent).toContain('Confidence: 87%');
    expect(record.shadow.querySelector('[data-action="show"]').textContent).toBe('Show content');
    expect(record.shadow.querySelector('[data-action="allow"]').textContent).toBe('Always allow site');
  });

  it('"Show content" reveals the original and offers "Hide again"', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, RESULT);
    blocker.get(target).shadow.querySelector('[data-action="show"]').click();
    expect(target.getAttribute(STATE_ATTR)).toBe('revealed');
    const shadow = blocker.get(target).shadow;
    expect(shadow.textContent).toContain('shown');
    shadow.querySelector('[data-action="hide"]').click();
    expect(target.getAttribute(STATE_ATTR)).toBe('placeholder');
  });

  it('"Always allow site" calls the allow callback', () => {
    const { blocker, target, counts } = setup('placeholder');
    blocker.block(target, RESULT);
    blocker.get(target).shadow.querySelector('[data-action="allow"]').click();
    expect(counts().allowed).toBe(1);
  });

  it('collapse clips the element and shows an Expand bar', () => {
    const { blocker, target } = setup('collapse');
    blocker.block(target, RESULT);
    expect(target.getAttribute(STATE_ATTR)).toBe('collapsed');
    expect(blocker.get(target).shadow.querySelector('[data-action="show"]').textContent).toBe('Expand');
  });

  it('blur blurs in place and reveals on click without following links', () => {
    const { blocker, target } = setup('blur');
    blocker.block(target, RESULT);
    expect(target.getAttribute(STATE_ATTR)).toBe('blurred');
    expect(notice()).toBeNull();
    expect(target.getAttribute('title')).toMatch(/Click to reveal/);
    let pageHandlerRan = false;
    document.body.addEventListener('click', () => (pageHandlerRan = true));
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('link').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(pageHandlerRan).toBe(false);
    expect(target.getAttribute(STATE_ATTR)).toBe('revealed');
    expect(target.getAttribute('title')).toBe('orig');
  });

  it('hide removes the element from view with no notice', () => {
    const { blocker, target } = setup('hide');
    blocker.block(target, RESULT);
    expect(target.getAttribute(STATE_ATTR)).toBe('hidden');
    expect(notice()).toBeNull();
  });

  it('list items get an <li> wrapper so the list stays valid', () => {
    const { blocker } = setup('placeholder');
    const item = document.getElementById('item');
    blocker.block(item, RESULT);
    const wrapper = item.previousElementSibling;
    expect(wrapper.tagName).toBe('LI');
    expect(wrapper.firstElementChild.tagName).toBe('AICB-NOTICE');
  });

  it('table cells fall back to blur instead of inserting siblings', () => {
    const { blocker } = setup('placeholder');
    const cell = document.getElementById('cell');
    blocker.block(cell, RESULT);
    expect(cell.getAttribute(STATE_ATTR)).toBe('blurred');
    expect(cell.previousElementSibling).toBeNull();
  });

  it('notice clicks do not reach page handlers', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, RESULT);
    let pageClicks = 0;
    document.getElementById('wrap').addEventListener('click', () => pageClicks++);
    blocker.get(target).shadow.querySelector('[data-action="show"]').click();
    expect(pageClicks).toBe(0);
  });
});

describe('restoration', () => {
  for (const action of ['placeholder', 'collapse', 'blur', 'hide']) {
    it(`unblock restores the DOM exactly (${action})`, () => {
      const { blocker, target, original } = setup(action);
      blocker.block(target, RESULT);
      blocker.block(document.getElementById('item'), RESULT);
      blocker.restoreAll();
      expect(document.body.innerHTML).toBe(original);
      expect(blocker.records.size).toBe(0);
    });
  }

  it('showAll / blockAll toggle every record and update stats', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, RESULT);
    blocker.block(document.getElementById('item'), RESULT);
    expect(blocker.stats()).toEqual({ detected: 2, blocked: 2, visible: 0 });
    expect(blocker.showAll()).toBe(2);
    expect(blocker.stats()).toEqual({ detected: 2, blocked: 0, visible: 2 });
    expect(blocker.blockAll()).toBe(2);
    expect(blocker.stats()).toEqual({ detected: 2, blocked: 2, visible: 0 });
  });

  it('refreshAll applies a changed action to blocked elements', () => {
    const { blocker, target, setAction } = setup('placeholder');
    blocker.block(target, RESULT);
    setAction('blur');
    blocker.refreshAll();
    expect(target.getAttribute(STATE_ATTR)).toBe('blurred');
    expect(notice()).toBeNull();
  });

  it('cleanup drops records for removed elements and their notices', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, RESULT);
    target.remove();
    expect(blocker.cleanup()).toBe(1);
    expect(notice()).toBeNull();
    expect(blocker.records.size).toBe(0);
  });

  it('cleanup re-inserts a notice the page removed', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, RESULT);
    notice().remove();
    blocker.cleanup();
    expect(target.previousElementSibling.tagName).toBe('AICB-NOTICE');
  });

  it('can block directly in the revealed state (remembered reveal)', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, RESULT, { revealed: true });
    expect(target.getAttribute(STATE_ATTR)).toBe('revealed');
    expect(blocker.stats().visible).toBe(1);
  });

  it('site-labeled results describe the label instead of a confidence', () => {
    const { blocker, target } = setup('placeholder');
    blocker.block(target, { ...RESULT, siteLabeled: true, labelText: 'AI-generated' }, { source: 'site-label' });
    expect(blocker.get(target).shadow.textContent).toContain('Labeled as AI-generated by this site');
  });
});

beforeEach(() => {
  document.body.innerHTML = '';
});
