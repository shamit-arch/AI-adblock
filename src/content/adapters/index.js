/**
 * Adapter registry.
 *
 * An adapter describes how to find content on a particular site:
 *
 *   {
 *     id, name,
 *     matches(hostname) -> boolean,
 *     unitSelectors: string[],      // containers analysed as one unit each
 *     excludeSelectors: string[],   // never analysed (in addition to generic rules)
 *     useGeneric: boolean,          // also run generic paragraph discovery
 *     getBlockTarget?(unit) -> Element,  // element to block (defaults to the unit)
 *     findLabeledAI?(root) -> [{element, label}], // content the site labels as AI
 *   }
 *
 * To add a site: create adapters/<site>.js and add it to SITE_ADAPTERS.
 */

import generic from './generic.js';
import reddit from './reddit.js';
import youtube from './youtube.js';
import google from './google.js';
import twitter from './twitter.js';
import news from './news.js';

export const SITE_ADAPTERS = [reddit, youtube, google, twitter, news];

/**
 * Web applications where modifying the DOM could break editing, messaging or
 * other functionality. The content script stays inactive there.
 */
export const UNSUPPORTED_HOSTS = [
  'docs.google.com', 'mail.google.com', 'drive.google.com', 'calendar.google.com',
  'meet.google.com', 'keep.google.com', 'sheets.google.com', 'slides.google.com',
  'colab.research.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
  'teams.microsoft.com', 'teams.live.com', 'web.whatsapp.com', 'app.slack.com', 'discord.com',
  'figma.com', 'canva.com', 'notion.so', 'codepen.io', 'codesandbox.io', 'stackblitz.com',
  'vscode.dev', 'github.dev', 'replit.com', 'chatgpt.com', 'chat.openai.com', 'claude.ai',
  'gemini.google.com', 'copilot.microsoft.com', 'perplexity.ai', 'excalidraw.com', 'miro.com',
];

export function isUnsupportedHost(host) {
  return UNSUPPORTED_HOSTS.some((d) => host === d || host.endsWith('.' + d));
}

function joinSelectors(list) {
  return list.filter(Boolean).join(', ');
}

/**
 * Resolve the adapter for a hostname, merged with the generic defaults.
 * @returns {object} resolved adapter with `unitSelector` / `excludeSelector` strings
 */
export function getAdapter(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const unsupported = isUnsupportedHost(host);
  const site = SITE_ADAPTERS.find((a) => {
    try {
      return a.matches(host) || a.matches('www.' + host);
    } catch {
      return false;
    }
  });
  const base = site || generic;
  const useGeneric = base.useGeneric !== false;
  const unitSelectors = [...(base.unitSelectors || []), ...(site && useGeneric ? generic.unitSelectors : [])];
  const excludeSelectors = [...generic.excludeSelectors, ...(site ? site.excludeSelectors || [] : [])];
  return {
    id: base.id,
    name: base.name,
    unsupported,
    useGeneric,
    unitSelector: joinSelectors([...new Set(unitSelectors)]),
    excludeSelector: joinSelectors([...new Set(excludeSelectors)]),
    getBlockTarget: base.getBlockTarget ? base.getBlockTarget.bind(base) : null,
    findLabeledAI: base.findLabeledAI ? base.findLabeledAI.bind(base) : null,
  };
}
