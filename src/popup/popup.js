/**
 * Popup: global on/off, per-page stats, page actions, per-site toggle and
 * sensitivity. Talks to the content script of the active tab via messages.
 */

import { MESSAGE, SUPPORT_URL } from '../shared/constants.js';
import { addSiteToList, loadSettings, removeSiteFromList, saveSettings } from '../shared/storage.js';
import { getSiteMode } from '../shared/site-rules.js';
import { debounce, normalizeHostname } from '../shared/utils.js';

const SENSITIVITY_LABELS = { 1: 'Very low', 2: 'Low', 3: 'Medium', 4: 'High', 5: 'Very high' };

const $ = (id) => document.getElementById(id);
const ui = {
  enabled: $('enabled'),
  status: $('status'),
  statusText: $('status-text'),
  hostname: $('hostname'),
  detected: $('stat-detected'),
  blocked: $('stat-blocked'),
  visible: $('stat-visible'),
  note: $('page-note'),
  scan: $('scan'),
  showAll: $('show-all'),
  blockAll: $('block-all'),
  siteToggle: $('site-toggle'),
  sensitivity: $('sensitivity'),
  sensitivityLabel: $('sensitivity-label'),
  openOptions: $('open-options'),
  openPrivacy: $('open-privacy'),
  support: $('support-link'),
};

const state = {
  tab: null,
  hostname: '',
  settings: null,
  status: null,
  injectable: false,
};

function sendToTab(message) {
  return new Promise((resolve) => {
    if (!state.tab) return resolve(null);
    try {
      chrome.tabs.sendMessage(state.tab.id, message, { frameId: 0 }, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function hostFromUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? normalizeHostname(u.hostname) : '';
  } catch {
    return '';
  }
}

function setNote(text, action) {
  ui.note.textContent = '';
  if (!text) {
    ui.note.hidden = true;
    return;
  }
  ui.note.hidden = false;
  ui.note.append(document.createTextNode(text));
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = action.label;
    b.addEventListener('click', action.onClick);
    ui.note.append(document.createElement('br'), b);
  }
}

function render() {
  const { settings, status, hostname } = state;
  if (!settings) return;

  ui.enabled.checked = settings.enabled;
  ui.sensitivity.value = String(settings.sensitivity);
  ui.sensitivityLabel.textContent = SENSITIVITY_LABELS[settings.sensitivity];
  ui.hostname.textContent = hostname || '—';
  ui.hostname.title = hostname;

  const mode = status?.mode || (hostname ? getSiteMode(settings, hostname) : 'restricted');
  let text;
  let dotState;
  switch (mode) {
    case 'off':
      text = 'Protection OFF';
      dotState = 'off';
      break;
    case 'whitelisted':
      text = 'Paused on this site (allowed)';
      dotState = 'paused';
      break;
    case 'aggressive':
      text = 'Protection ON · strict mode for this site';
      dotState = 'aggressive';
      break;
    case 'unsupported':
      text = 'Not available on this web app';
      dotState = 'off';
      break;
    case 'restricted':
      text = 'Not available on this page';
      dotState = 'off';
      break;
    default:
      text = 'Protection ON';
      dotState = 'on';
  }
  if (!settings.enabled) {
    text = 'Protection OFF';
    dotState = 'off';
  }
  ui.status.dataset.state = dotState;
  ui.statusText.textContent = text;

  const stats = status?.stats;
  ui.detected.textContent = stats ? String(stats.detected) : '–';
  ui.blocked.textContent = stats ? String(stats.blocked) : '–';
  ui.visible.textContent = stats ? String(stats.visible) : '–';

  const connected = !!status;
  const active = connected && status.active;
  ui.scan.disabled = !active;
  ui.showAll.disabled = !connected || !stats || stats.blocked === 0;
  ui.blockAll.disabled = !connected || !stats || stats.visible === 0;

  const whitelisted = hostname && settings.whitelist.some((d) => hostname === d || hostname.endsWith('.' + d));
  ui.siteToggle.textContent = whitelisted ? 'Enable on This Site' : 'Disable on This Site';
  ui.siteToggle.disabled = !hostname || mode === 'unsupported';

  if (!hostname) {
    setNote('Browser pages, the Chrome Web Store and local files can’t be scanned.');
  } else if (mode === 'unsupported') {
    setNote('This site is an editor or messaging app, so the extension leaves it untouched to avoid breaking it.');
  } else if (!connected && settings.enabled && !whitelisted) {
    setNote('The blocker isn’t running in this tab yet (it was probably open before the extension was installed).', {
      label: 'Activate on this page',
      onClick: activate,
    });
  } else if (connected && stats && stats.pending > 0) {
    setNote(`Scanning… ${stats.pending} block(s) queued.`);
  } else if (connected && !settings.autoScan && active) {
    setNote('Automatic scanning is off. Use “Scan Page” to check this page.');
  } else {
    setNote('');
  }
}

async function refreshStatus() {
  state.status = await sendToTab({ type: MESSAGE.GET_STATUS });
  render();
}

async function activate() {
  if (!state.tab) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId: state.tab.id }, files: ['styles/blocker.css'] });
    await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, files: ['content.js'] });
    setTimeout(refreshStatus, 400);
  } catch (e) {
    setNote(`Couldn’t start on this page: ${e.message || e}`);
  }
}

async function runAction(type) {
  state.status = (await sendToTab({ type })) || state.status;
  render();
  setTimeout(refreshStatus, 600);
}

async function init() {
  ui.support.href = SUPPORT_URL;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab || null;
  state.hostname = hostFromUrl(tab?.url || '');
  state.settings = await loadSettings();
  await refreshStatus();

  ui.enabled.addEventListener('change', async () => {
    state.settings = await saveSettings({ enabled: ui.enabled.checked });
    render();
    setTimeout(refreshStatus, 300);
  });

  const saveSensitivity = debounce(async (value) => {
    state.settings = await saveSettings({ sensitivity: value });
    setTimeout(refreshStatus, 500);
  }, 250);
  ui.sensitivity.addEventListener('input', () => {
    const value = Number(ui.sensitivity.value);
    ui.sensitivityLabel.textContent = SENSITIVITY_LABELS[value];
    saveSensitivity(value);
  });

  ui.scan.addEventListener('click', () => runAction(MESSAGE.SCAN));
  ui.showAll.addEventListener('click', () => runAction(MESSAGE.SHOW_ALL));
  ui.blockAll.addEventListener('click', () => runAction(MESSAGE.BLOCK_ALL));

  ui.siteToggle.addEventListener('click', async () => {
    const host = state.hostname;
    if (!host) return;
    const whitelisted = state.settings.whitelist.some((d) => host === d || host.endsWith('.' + d));
    state.settings = whitelisted
      ? await removeSiteFromList('whitelist', host, { includeParents: true })
      : await addSiteToList('whitelist', host);
    render();
    setTimeout(refreshStatus, 300);
  });

  ui.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  ui.openPrivacy.addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#privacy') }),
  );

  // Keep the counts live while the popup is open.
  setInterval(refreshStatus, 1000);
}

init();
