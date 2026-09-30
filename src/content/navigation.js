/**
 * Detects SPA navigations (URL changes without a page load).
 *
 * Content scripts run in an isolated world and cannot patch the page's
 * history.pushState, so we combine:
 *   - the Navigation API (`navigatesuccess`) where available
 *   - popstate / hashchange events
 *   - a cheap 1 s poll of location.href as a fallback
 * Only path/query changes count; pure #hash changes (in-page anchors) do not.
 */

function pageKey(loc) {
  return `${loc.origin}${loc.pathname}${loc.search}`;
}

/**
 * @param {(url: string, previous: string) => void} callback
 * @returns {() => void} stop watching
 */
export function watchUrlChanges(callback, { win = globalThis, interval = 1000 } = {}) {
  let last = pageKey(win.location);
  const check = () => {
    const now = pageKey(win.location);
    if (now !== last) {
      const previous = last;
      last = now;
      callback(win.location.href, previous);
    }
  };

  win.addEventListener('popstate', check);
  win.addEventListener('hashchange', check);
  const nav = win.navigation;
  if (nav && typeof nav.addEventListener === 'function') nav.addEventListener('navigatesuccess', check);
  const timer = win.setInterval(check, interval);

  return () => {
    win.removeEventListener('popstate', check);
    win.removeEventListener('hashchange', check);
    if (nav && typeof nav.removeEventListener === 'function') nav.removeEventListener('navigatesuccess', check);
    win.clearInterval(timer);
  };
}
