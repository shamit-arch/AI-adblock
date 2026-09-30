/**
 * Serves test-pages/ on http://localhost:5173 for manual testing.
 * (Content scripts only run on http/https pages, not file:// URLs.)
 *
 *   npm run demo            → http://localhost:5173/demo.html
 *   add ?slow to stream the HTML in chunks (simulates a slow network, so you
 *   can check that AI content is never painted before it is blocked)
 *   PORT=8080 npm run demo
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-pages');
const port = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path === '/' ? 'demo.html' : path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    if (new URL(req.url, 'http://x').searchParams.has('slow') && extname(file) === '.html') {
      // Stream in ~6 chunks, 300 ms apart, so the browser paints partial pages.
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      const size = Math.ceil(body.length / 6);
      for (let i = 0; i < body.length; i += size) {
        res.write(body.subarray(i, i + size));
        await new Promise((r) => setTimeout(r, 300));
      }
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': type }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Demo page: http://localhost:${port}/demo.html`));
