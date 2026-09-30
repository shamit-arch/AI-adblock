/**
 * Content-script entry point (bundled to dist/content.js), injected at
 * document_start so content can be checked before it is first painted.
 *
 * Guards against double injection (manifest injection + the popup's
 * "Activate on this page" fallback) and against orphaned instances left
 * behind when the extension is reloaded.
 */

import { ContentController } from './controller.js';

(function bootstrap() {
  const g = globalThis;
  const doc = g.document;
  // Runs at document_start, when <html> may not exist yet: decide by content type.
  if (!doc || (doc.contentType && !/html/i.test(doc.contentType))) return;
  if (doc.documentElement && doc.documentElement.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;

  const existing = g.__aicbController;
  if (existing) {
    if (existing.isAlive()) return;
    existing.destroy();
  }

  const controller = new ContentController();
  g.__aicbController = controller;
  controller.init().catch((e) => console.warn('[AI Content Blocker] failed to start:', e));
})();
