/**
 * Builds all five clients into ONE static tree, for ONE Vercel project.
 *
 *   dist/                → launcher   (the landing page, /demo, /writeup)
 *   dist/diner/          → diner-frontend
 *   dist/mobile/         → mobile-diner
 *   dist/restaurant/     → restaurant-frontend
 *   dist/lab/            → decay-lab
 *
 * Why one project instead of five: the five were never independent. They share a design system,
 * a types package and a backend, so every cross-app link was a hardcoded vercel.app hostname and
 * every shared-code change needed five deploys that could each half-fail. One project means one
 * build, one domain, one set of environment variables, and cross-app links that are just paths.
 *
 * Ordering matters here: the launcher writes to dist/ itself, so it goes first and the sub-apps
 * land in their own subdirectories afterwards. Reverse that and the launcher's --emptyOutDir
 * deletes the apps that were just built.
 */
import { execSync } from 'node:child_process';
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

/**
 * Where each app is mounted. `base` is baked into every asset URL at build time, so it has to
 * match the path the app is actually served from — a mismatch here is a page that loads and then
 * 404s every script it asked for.
 */
const APPS = [
  { pkg: '@ttr/launcher', dir: 'launcher', out: DIST, base: '/' },
  { pkg: '@ttr/diner-frontend', dir: 'diner-frontend', out: `${DIST}/diner`, base: '/diner/' },
  { pkg: '@ttr/mobile-diner', dir: 'mobile-diner', out: `${DIST}/mobile`, base: '/mobile/' },
  {
    pkg: '@ttr/restaurant-frontend',
    dir: 'restaurant-frontend',
    out: `${DIST}/restaurant`,
    base: '/restaurant/',
  },
  { pkg: '@ttr/decay-lab', dir: 'decay-lab', out: `${DIST}/lab`, base: '/lab/' },
];

/**
 * Cross-app links, as paths rather than origins.
 *
 * Vite inlines VITE_* at build time, so these are compiled into the launcher's bundle. They are
 * set here rather than in the Vercel dashboard on purpose: they are a consequence of the layout
 * decided in APPS above, not a deployment preference, and splitting them across two places is how
 * they end up disagreeing. Anything that IS a deployment preference — VITE_API_URL, the Unifold
 * key — stays in the dashboard and passes through untouched.
 */
const LINKS = {
  VITE_DINER_URL: '/diner/',
  VITE_MOBILE_URL: '/mobile/',
  VITE_RESTAURANT_URL: '/restaurant/',
  VITE_LAB_URL: '/lab/',
};

/* execSync rather than execFileSync: on Windows every npm is a .cmd shim, and Node has refused
   to spawn one without a shell since the 2024 command-injection hardening. Going through a shell
   deliberately (and building the command as a string) avoids both the spawn failure and the
   DEP0190 warning you get from mixing `shell: true` with an argv array. The only interpolated
   value is a package name from the literal table above. */

console.log(`\n  building 5 clients into ${DIST}\n`);
rmSync(DIST, { recursive: true, force: true });

/* @ttr/shared-types has to be compiled before anything imports it.
 *
 * It is the one workspace package that cannot ship raw source the way @ttr/design does:
 * app-services and chain-services are Node processes that import it directly, so it needs real
 * emitted JS. Its `exports` therefore point at dist/ - which is gitignored, so a fresh clone
 * (every Vercel build is one) starts without it.
 *
 * The clients do not rebuild it for us. None of their tsconfigs declare `references`, so their
 * `tsc -b` has nothing to follow and simply fails to resolve the types. This used to be handled
 * by a `cd ../shared-types && npm run build` glued onto the front of three of the five per-app
 * vercel.json build commands - and was missing from the other two. Doing it once, here, is why
 * that class of "works locally, fails on a clean checkout" bug cannot come back. */
process.stdout.write(`  ${'shared-types'.padEnd(22)} → ${'(prereq)'.padEnd(14)} `);
try {
  execSync('npm run build --workspace @ttr/shared-types', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('ok');
} catch (err) {
  console.log('FAILED\n');
  process.stderr.write(String(err.stdout ?? '') + String(err.stderr ?? ''));
  process.stderr.write(`\n  ${err.message}\n\n`);
  process.exit(1);
}


for (const app of APPS) {
  process.stdout.write(`  ${app.dir.padEnd(22)} → ${app.base.padEnd(14)} `);
  const started = Date.now();
  try {
    execSync(`npm run build --workspace ${app.pkg}`, {
        cwd: ROOT,
        env: { ...process.env, ...LINKS, VITE_BASE: app.base, VITE_OUT_DIR: app.out },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.log('FAILED\n');
    // err.message as well as the captured streams: a spawn that never started has no stdout,
    // and printing nothing at all is how this failure stayed invisible the first time.
    process.stderr.write(String(err.stdout ?? '') + String(err.stderr ?? ''));
    process.stderr.write(`
  ${err.message}

`);
    process.exit(1);
  }
  console.log(`ok  ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// A silent partial build is worse than a loud failure: check every entry point actually landed.
const missing = APPS.filter((a) => !existsSync(`${a.out}/index.html`));
if (missing.length) {
  console.error(`\n  missing index.html: ${missing.map((m) => m.dir).join(', ')}\n`);
  process.exit(1);
}
console.log(`\n  done — dist/ contains ${readdirSync(DIST).join(', ')}\n`);
