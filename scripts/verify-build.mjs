/**
 * Sanity-checks dist/ after a build: manifest validity (MV3), every file the
 * manifest and HTML pages reference exists, no remote code, no leftover ES
 * module syntax in classic scripts, and only the expected permissions.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found — run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const exists = (p) => existsSync(join(dist, p));
const need = (p, what) => {
  if (!p) fail(`${what}: path missing`);
  else if (!exists(p)) fail(`${what}: ${p} does not exist`);
};

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
for (const key of ['name', 'version', 'description']) if (!manifest[key]) fail(`manifest.${key} missing`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`invalid version "${manifest.version}"`);
if (manifest.description.length > 132) fail('description longer than 132 characters');

for (const [size, p] of Object.entries(manifest.icons || {})) need(p, `icons.${size}`);
for (const [size, p] of Object.entries(manifest.action?.default_icon || {})) need(p, `action.default_icon.${size}`);
need(manifest.action?.default_popup, 'action.default_popup');
need(manifest.options_page, 'options_page');
need(manifest.background?.service_worker, 'background.service_worker');
if (manifest.background?.scripts) fail('MV3 uses background.service_worker, not background.scripts');
if (manifest.browser_action || manifest.page_action) fail('MV3 uses "action", not browser_action/page_action');

for (const [i, cs] of (manifest.content_scripts || []).entries()) {
  (cs.js || []).forEach((p) => need(p, `content_scripts[${i}].js`));
  (cs.css || []).forEach((p) => need(p, `content_scripts[${i}].css`));
  if (!cs.matches?.length) fail(`content_scripts[${i}].matches empty`);
}

// Service worker icon paths referenced from code.
for (const p of ['icons/icon-off-16.png', 'icons/icon-off-32.png', 'icons/icon-off-48.png', 'icons/icon-off-128.png']) {
  need(p, 'service worker "off" icon');
}

const ALLOWED_PERMISSIONS = new Set(['storage', 'activeTab', 'scripting']);
for (const p of manifest.permissions || []) if (!ALLOWED_PERMISSIONS.has(p)) fail(`unexpected permission "${p}"`);
if (manifest.host_permissions?.length) warnings.push(`host_permissions requested: ${manifest.host_permissions.join(', ')}`);

// HTML pages: referenced scripts/styles must exist and be local; no inline scripts (MV3 CSP).
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(dist);
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  const rel = relative(dist, file);
  for (const m of html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref)) fail(`${rel}: remote resource ${ref} (not allowed in MV3)`);
    else if (!existsSync(join(dirname(file), ref))) fail(`${rel}: referenced file ${ref} missing`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) fail(`${rel}: inline <script> is blocked by the MV3 CSP`);
}

for (const file of files.filter((f) => f.endsWith('.js'))) {
  const js = readFileSync(file, 'utf8');
  const rel = relative(dist, file);
  if (/^\s*(import|export)\s[^(]/m.test(js)) fail(`${rel}: contains ES module syntax but is loaded as a classic script`);
  if (/\beval\s*\(|new Function\s*\(/.test(js)) fail(`${rel}: uses eval/new Function (blocked by MV3 CSP)`);
  if (/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket\(/.test(js)) fail(`${rel}: contains network calls — the local build must not send data`);
}

const size = files.reduce((n, f) => n + statSync(f).size, 0);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  console.error(`\nBuild verification FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`Build verification passed: ${files.length} files, ${(size / 1024).toFixed(1)} KB, permissions [${manifest.permissions.join(', ')}].`);
