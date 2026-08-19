/**
 * Serves the merged dist/ the way Vercel will, so `npm run build:web` can be checked locally.
 *
 * The rewrite behaviour is the part worth reproducing: static file first, and only if nothing is
 * on disk does the request fall back to an index.html - the sub-app's own, if the first path
 * segment is a mount point, otherwise the launcher's. Get that wrong and every deep link either
 * 404s or quietly serves the wrong app, which a plain static server cannot show you.
 *
 *   npm run build:web && npm run preview:web
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
/** keep in step with the mount points in build-web.mjs and the rewrites in vercel.json */
const MOUNTS = ['diner', 'mobile', 'restaurant', 'lab'];
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('\n  dist/ is empty or missing - run `npm run build:web` first.\n');
  process.exit(1);
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  // normalize, then strip any '..' so a crafted path cannot escape dist/
  let file = join(DIST, normalize(url).split('..').join(''));

  if (!existsSync(file) || statSync(file).isDirectory()) {
    const seg = url.split('/')[1];
    file = MOUNTS.includes(seg) ? join(DIST, seg, 'index.html') : join(DIST, 'index.html');
  }
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`\n  dist/ on http://localhost:${PORT}\n`);
  for (const m of ['', ...MOUNTS]) console.log(`    http://localhost:${PORT}/${m}`);
  console.log('');
});
