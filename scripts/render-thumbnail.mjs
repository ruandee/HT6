/**
 * Renders docs/thumbnail.png — the Devpost gallery image.
 *
 *   node scripts/render-thumbnail.mjs
 *
 * 1200x675 (16:9) at 2x, so it stays sharp when Devpost serves it as the small project card and
 * again as the full-width header on the project page.
 *
 * The wordmark and nothing else: the .brand lockup — dots beside the name — over a one-line
 * descriptor. Devpost renders the gallery card at roughly a third of its natural width, and at
 * that size a thumbnail gets to say exactly one thing, so it says the name and the category.
 *
 * Rendered through headless Chromium rather than resvg, unlike scripts/render-architecture.mjs,
 * because the orbs are real CSS gradients under a real blur here instead of a hand-rebuilt
 * approximation.
 *
 * The rules it has to obey, taken from packages/launcher/src/styles.css:
 *
 *   - the wordmark is LOWERCASE "hora", always, with two dots above it: ink first, then coral
 *   - eyebrows are uppercase Archivo, wide tracking, muted
 *   - the canvas is warm off-white, never pure white, with the orbs hazy behind it
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, '.fonts');
const OUT_DIR = join(ROOT, 'docs');

const W = 1200;
const H = 675;
const SCALE = 2;

// ---- fonts -----------------------------------------------------------------------------------
// Embedded as data URIs rather than linked from Google Fonts: this has to render identically on a
// machine with no network, and a silent fallback to a system face would produce a thumbnail that
// looks fine to whoever ran it and wrong to everyone else.
function face(file, family) {
  let buf;
  try {
    buf = readFileSync(join(FONT_DIR, file));
  } catch {
    console.error(
      [
        `Missing ${join(FONT_DIR, file)}.`,
        '',
        'The brand faces are not vendored (OFL, ~1.5MB). Fetch them once:',
        '',
        '  mkdir -p .fonts',
        '  BASE=https://github.com/google/fonts/raw/main/ofl',
        '  curl -sL -o .fonts/Archivo.ttf "$BASE/archivo/Archivo%5Bwdth,wght%5D.ttf"',
      ].join('\n'),
    );
    process.exit(1);
  }
  return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${buf.toString('base64')}) format('truetype');font-display:block}`;
}

// Archivo is a variable font, so one file covers every weight the page asks for. Inter and Reenie
// Beanie are not loaded: nothing on this composition is set in body or handwritten type.
const FONTS = face('Archivo.ttf', 'Archivo');

const html = `<style>
${FONTS}
:root{
  --canvas:#f7f6f3;
  --peach:#ffb38a; --coral:#ff7a59; --amber:#ffc861; --yellow:#ffe8a3;
  --ink:#16130f; --ink-45:rgba(22,19,15,.45);
  --font-display:'Archivo',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;background:var(--canvas);color:var(--ink);
  -webkit-font-smoothing:antialiased;overflow:hidden}

/* hazy orbs. Without them this is a beige rectangle — they are the canvas, not decoration. */
.orbs{position:absolute;inset:0;overflow:hidden}
.orb{position:absolute;border-radius:50%;filter:blur(90px)}
.orb--1{width:600px;height:600px;right:-140px;top:-220px;opacity:.85;
  background:radial-gradient(circle at 35% 35%,var(--coral) 0%,var(--peach) 42%,var(--yellow) 68%,transparent 76%)}
.orb--2{width:500px;height:500px;left:-160px;bottom:-230px;opacity:.6;
  background:radial-gradient(circle at 50% 50%,var(--amber) 0%,var(--peach) 45%,transparent 72%)}

.shell{position:relative;height:100%;display:flex;flex-direction:column;
  align-items:center;justify-content:center}

/* The dots sit beside the name rather than above it, as in the .brand lockup from the stylesheet
   — the arrangement the three apps use in their headers — but stacked rather than side by side. */
.lockup{display:flex;align-items:center;gap:30px}

/* Stacked into a column beside the name the pair reads as a colon, so it is sized and placed like
   one: the column stands about the height of the x-height and centres on it. The margin does that
   centring — flex alone uses the line box, which the ascender of "h" makes taller on top than the
   letterforms actually are, so the dots would ride high. */
.dots{display:flex;flex-direction:column;gap:.07em;align-self:center;margin-top:.07em;
  font-size:230px}
.dots i{width:.21em;height:.21em;border-radius:50%;background:var(--ink);display:block}
.dots i:last-child{background:var(--coral)}

.wordmark{font-family:var(--font-display);font-weight:700;text-transform:lowercase;
  font-size:230px;line-height:.82;letter-spacing:-.045em;
  /* -.045em of tracking is removed from the right of the final "a" as well, so the word hangs
     left of centre unless it is given that space back */
  text-indent:.045em}

.tagline{font-family:var(--font-display);font-size:21px;font-weight:600;letter-spacing:.3em;
  text-transform:uppercase;color:var(--ink-45);
  /* the tracking is trailing whitespace on the last letter; nudge it back to optical centre */
  text-indent:.3em;margin-top:40px}
</style>

<div class="orbs"><div class="orb orb--1"></div><div class="orb orb--2"></div></div>

<div class="shell">
  <div class="lockup">
    <div class="dots"><i></i><i></i></div>
    <h1 class="wordmark">hora</h1>
  </div>
  <div class="tagline">Tokenized reservations</div>
</div>`;

// ---- render ----------------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
await page.setContent(html, { waitUntil: 'load' });
// setContent resolves before the embedded face is parsed, and a screenshot taken in that window
// lands on the fallback face with the layout already shifted around it.
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();

writeFileSync(join(OUT_DIR, 'thumbnail.png'), png);
console.log(
  `docs/thumbnail.png  ${(png.length / 1024).toFixed(1)} kB  ${W * SCALE}x${H * SCALE} (16:9)`,
);
