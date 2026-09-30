/**
 * Builds the unpacked extension into dist/.
 *
 *   npm run build        production build (minified) + verification
 *   npm run build:dev    unminified with inline source maps
 *   npm run watch        rebuild on change
 *
 * Content scripts can't use ES module imports, so every entry point is
 * bundled with esbuild into a self-contained IIFE.
 */
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const entryPoints = {
  content: 'src/content/content.js',
  'service-worker': 'src/background/service-worker.js',
  'popup/popup': 'src/popup/popup.js',
  'options/options': 'src/options/options.js',
};

const staticFiles = [
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/options/options.html', 'options/options.html'],
  ['src/options/options.css', 'options/options.css'],
  ['src/styles/blocker.css', 'styles/blocker.css'],
  ['icons', 'icons'],
];

function copyStatic() {
  for (const [from, to] of staticFiles) {
    const src = join(root, from);
    if (!existsSync(src)) throw new Error(`Missing static file: ${from}`);
    const dest = join(dist, to);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

const options = {
  absWorkingDir: root,
  entryPoints,
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['chrome111'],
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  charset: 'utf8',
};

if (!existsSync(join(root, 'icons', 'icon-128.png'))) {
  await import('./generate-icons.mjs');
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'copy-static', setup: (b) => b.onEnd(() => copyStatic()) }],
  });
  await ctx.watch();
  console.log('Watching for changes… (static files are re-copied on each rebuild)');
} else {
  await esbuild.build(options);
  console.log(`Built ${dev ? 'development' : 'production'} extension in ${dist}`);
}
