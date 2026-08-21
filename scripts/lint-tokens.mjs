/**
 * Token guard.
 *
 * Fails the build if a colour literal appears anywhere outside packages/design.
 *
 * This exists because the design system did not rot through anyone's carelessness — it rotted
 * because nothing failed. Five stylesheets each held their own copy of the token block, and every
 * time somebody needed a tint in a hurry the fastest correct-looking move was to paste a value.
 * By the time the palette changed there were a dozen `rgba(242, 84, 45, …)` literals in places the
 * token block could not reach, and recolouring the product meant a hand audit of eight files.
 *
 * Hoisting the tokens into @ttr/design fixed the present. This fixes the future: the shortcut is
 * now the thing that breaks CI, so the cheap path and the correct path are the same path.
 *
 * Run: node scripts/lint-tokens.mjs   (also wired to `npm run lint:tokens`)
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * The surfaces governed by the design system — and only those.
 *
 * app-services is deliberately absent. It server-renders a standalone dark status page at
 * /unifold/status, which is a debugging artifact rather than a product surface: it has its own
 * palette, it is never seen next to the apps, and dragging it into this ramp would make it worse
 * at its one job. A guard that polices things nobody wants policed is a guard that gets disabled.
 */
const GOVERNED = [
  'launcher',
  'diner-frontend',
  'restaurant-frontend',
  'mobile-diner',
  'decay-lab',
];

const FILES = GOVERNED.flatMap((pkg) =>
  globSync(`packages/${pkg}/src/**/*.{css,ts,tsx}`, { cwd: ROOT }),
);

/**
 * What counts as a violation. Deliberately narrow — this should catch pasted brand colour and
 * nothing else, because a guard that cries wolf gets an `--ignore` flag bolted on within a week
 * and stops guarding anything.
 */
const PATTERNS = [
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'rgb()/rgba()', re: /\brgba?\(\s*\d/g },
  { name: 'hsl()/hsla()', re: /\bhsla?\(\s*\d/g },
];

/**
 * Allowed literals, and the reason each one is allowed.
 *
 * Pure white and pure black are not brand colours — they are the ends of the alpha scale, used
 * for glass highlights, text on a filled control, and scrims. Threading `--white` through those
 * would be ceremony, not clarity. Everything else has to come from a token.
 */
const ALLOW = [
  /^#fff(f)?$/i, // white, and #ffff
  /^#ffffff(ff)?$/i,
  /^#000(0)?$/i, // black — used by the mask trick in .glass::before
  /^#000000(ff)?$/i,
  /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/i, // white at alpha: glass, insets, scrims
  /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i, // black at alpha
];

const IGNORE_LINE = /token-lint-ignore/;

let violations = 0;
const byFile = new Map();

for (const rel of FILES) {
  const text = readFileSync(`${ROOT}/${rel}`, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    // a line-level escape hatch, because there will be a legitimate exception one day and the
    // alternative is somebody deleting this script
    if (IGNORE_LINE.test(line)) return;
    // Don't police prose: comments explaining what a colour *used to be* are the whole point.
    // Numeric character references (&#8594; and friends) are arrows and dashes in JSX, not
    // colours — strip them before the hex pattern mistakes `&#8594` for one.
    const code = line
      .replace(/\/\*.*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .replace(/&#x?[0-9a-fA-F]+;?/g, '');

    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code))) {
        const literal = name === 'hex colour' ? m[0] : code.slice(m.index).match(/^[a-z]+\([^)]*\)/i)?.[0] ?? m[0];
        if (ALLOW.some((a) => a.test(literal))) continue;
        violations++;
        if (!byFile.has(rel)) byFile.set(rel, []);
        byFile.get(rel).push({ line: i + 1, literal, text: line.trim() });
      }
    }
  });
}

/* ---- second check: every var(--x) must resolve ----

   The literal check above cannot see a token that has been RENAMED. When the palette moved from
   coral to sage, `--coral-deep` was renamed to `--accent-deep` across the stylesheets by search
   and replace - but eleven inline styles in TSX (`style={{ color: 'var(--coral-deep)' }}`) were
   missed, and CSS fails silently: an undefined custom property is not an error, the declaration
   is simply dropped and the element inherits. Every one of those accents rendered as plain body
   text for days without a single warning anywhere.

   So: collect every custom property anyone DEFINES, then check every one anyone USES exists. */
const DEFINED = new Set();
const defRe = /(--[a-zA-Z0-9_-]+)\s*:/g;
for (const rel of [...FILES, 'packages/design/src/tokens.css', 'packages/design/src/base.css']) {
  const text = readFileSync(`${ROOT}/${rel}`, 'utf8');
  let m;
  while ((m = defRe.exec(text))) DEFINED.add(m[1]);
}

const useRe = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
let unknown = 0;
for (const rel of FILES) {
  const lines = readFileSync(`${ROOT}/${rel}`, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    let m;
    useRe.lastIndex = 0;
    while ((m = useRe.exec(line))) {
      if (DEFINED.has(m[1])) continue;
      unknown++;
      console.error(`  ${rel.split(sep).join('/')}:${i + 1}  var(${m[1]}) is not defined anywhere`);
    }
  });
}
if (unknown) {
  console.error(
    `\ntoken guard: ${unknown} reference(s) to a custom property that does not exist.\n` +
      'CSS drops an undefined var() silently, so these render as inherited values rather than\n' +
      'failing - check for a rename.\n',
  );
  process.exit(1);
}

if (violations === 0) {
  console.log(
    `token guard: ${FILES.length} files clean — every colour comes from @ttr/design,` +
      ` and all ${DEFINED.size} custom properties resolve`,
  );
  process.exit(0);
}

console.error(`\ntoken guard: ${violations} colour literal(s) outside packages/design\n`);
for (const [file, hits] of byFile) {
  console.error(`  ${file.split(/[\\/]/).join('/')}`);
  for (const h of hits) {
    console.error(`    ${String(h.line).padStart(4)}  ${h.literal}`);
    console.error(`          ${h.text.slice(0, 96)}`);
  }
  console.error('');
}
console.error(
  'Add the value to packages/design/src/tokens.css and reference it with var(), or — if it\n' +
    'genuinely cannot be a custom property (SVG paint, for instance) — put it in\n' +
    'packages/design/src/chart.ts. Last resort: append `token-lint-ignore` to the line with a\n' +
    'comment saying why.\n',
);
process.exit(1);
