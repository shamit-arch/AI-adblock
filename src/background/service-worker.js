/**
 * Service worker: initialises default settings, keeps the toolbar badge in
 * sync with each tab's blocked count, and swaps the icon when the extension
 * is switched off. It never sees page content — only counts.
 */

import { MESSAGE } from '../shared/constants.js';
import { ensureDefaults, loadSettings, migrateSettings } from '../shared/storage.js';

const ICONS_ON = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const ICONS_OFF = { 16: 'icons/icon-off-16.png', 32: 'icons/icon-off-32.png', 48: 'icons/icon-off-48.png', 128: 'icons/icon-off-128.png' };

async function updateIcon(enabled) {
  try {
    await chrome.action.setIcon({ path: enabled ? ICONS_ON : ICONS_OFF });
    await chrome.action.setTitle({ title: enabled ? 'AI Content Blocker' : 'AI Content Blocker (off)' });
  } catch (e) {
    console.warn('[AI Content Blocker] could not update icon', e);
  }
}

// Idempotent: also covers reloads where onInstalled might not fire.
migrateSettings().catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await ensureDefaults();
  await chrome.action.setBadgeBackgroundColor({ color: '#5b4bdb' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await updateIcon(settings.enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await loadSettings();
  await updateIcon(settings.enabled);
});

chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes) updateIcon(changes.enabled.newValue !== false);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return false;

  if (msg.type === MESSAGE.STATS && sender.tab && sender.frameId === 0) {
    const blocked = Number(msg.stats?.blocked) || 0;
    const text = msg.active && blocked > 0 ? (blocked > 999 ? '999+' : String(blocked)) : '';
    chrome.action.setBadgeText({ tabId: sender.tab.id, text }).catch(() => {});
    return false;
  }

  if (msg.type === MESSAGE.OPEN_OPTIONS) {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
