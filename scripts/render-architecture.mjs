/**
 * Renders docs/architecture.svg + docs/architecture.png from the spec below.
 *
 *   node scripts/render-architecture.mjs
 *
 * Generated rather than hand-drawn so it can be corrected when the stack moves: edit LAYERS,
 * re-run, commit both files. Hand-placed coordinates rot the first time a box is renamed.
 *
 * 16:9 at 1920x1080 so it drops straight onto a slide. The stack runs down the left, the pricing
 * model sits in a rail on the right, and the layer everything imports closes that rail.
 *
 * This is shown to people outside the project, so no internal section numbers and no document
 * references. Every label has to make sense cold. Card copy is one or two plain sentences saying
 * what the thing does: keyword fragments look dense but say less, and read as filler at this size.
 *
 * It also has to look like the product. The rules, taken from packages/*\/src/styles.css:
 *
 *   - the wordmark is LOWERCASE "hora", always, with two dots: ink first, then coral
 *   - eyebrows are uppercase Archivo, wide tracking, muted, trailed by a hairline rule
 *   - one level of glass. Cards float on the canvas; they never sit inside another card
 *
 * Two renderer constraints shape the code:
 *
 *   1. resvg does not apply variable-font weight axes, so `font-weight` is silently ignored and
 *      everything lands on the default instance. Weight is faked by stroking glyphs in their own
 *      fill colour, kept light because Archivo's default instance already reads fairly solid.
 *   2. There is no backdrop-filter in SVG, so the glass is rebuilt rather than reproduced: warm
 *      canvas, blurred colour orbs beneath, translucent white cards with a soft warm shadow.
 */
import { Resvg } from '@resvg/resvg-js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, '.fonts');
const OUT_DIR = join(ROOT, 'docs');

// ---- design tokens, lifted verbatim from the stylesheet ------------------------------------
const T = {
  canvas: '#f7f6f3',
  peach: '#ffb38a',
  coral: '#ff7a59',
  coralDeep: '#f2542d',
  amber: '#ffc861',
  yellow: '#ffe8a3',
  ink: '#16130f',
  ink70: 'rgba(22,19,15,0.7)',
  ink45: 'rgba(22,19,15,0.45)',
  ink25: 'rgba(22,19,15,0.25)',
  hairline: 'rgba(22,19,15,0.12)',
  glass: 'rgba(255,255,255,0.58)',
  glassBorder: 'rgba(255,255,255,0.8)',
  display: 'Archivo',
  ui: 'Inter',
};

const W = 1920;
const H = 1080; // 16:9
const RAIL_X = 104; // lane for the "never touch the chain" annotation
const STACK_L = 150;
const STACK_R = 1420;
const SIDE_L = 1462;
const SIDE_R = W - 76;
const STACK_W = STACK_R - STACK_L;

// ---- helpers -------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Faux weight, light on purpose: above ~0.4 at body sizes this turns into a blob. */
const bold = (size) => (size >= 36 ? 0.8 : size >= 22 ? 0.4 : size >= 15 ? 0.2 : 0.16);

function text(x, y, s, o = {}) {
  const {
    size = 14,
    fill = T.ink,
    family = T.ui,
    anchor = 'start',
    weight = false,
    tracking = 0,
    upper = false,
    transform = '',
  } = o;
  const body = upper ? String(s).toUpperCase() : s;
  const stroke = weight ? ` stroke="${fill}" stroke-width="${bold(size)}"` : '';
  const ls = tracking ? ` letter-spacing="${tracking}"` : '';
  const tr = transform ? ` transform="${transform}"` : '';
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${stroke}${ls}${tr}>${esc(body)}</text>`;
}

/** Greedy wrap on a character budget derived from the box width. */
function wrap(s, width, size) {
  const budget = Math.floor(width / (size * 0.505));
  const out = [];
  let cur = '';
  for (const wd of s.split(' ')) {
    if ((cur + ' ' + wd).trim().length > budget && cur) {
      out.push(cur);
      cur = wd;
    } else cur = (cur + ' ' + wd).trim();
  }
  if (cur) out.push(cur);
  return out;
}

const widthOf = (s, size, tracking) => s.length * (size * 0.62 + tracking);

// ---- TeX -> SVG paths, at build time -------------------------------------------------------
// The formulas are real LaTeX. MathJax typesets them to geometry here, so the SVG that ships
// contains no math font and no markup a renderer has to understand — just <path>.
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texDoc = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  // fontCache 'none' inlines each glyph as its own path. The default ('local') emits <use>
  // refs into a per-document glyph table, and those ids collide the moment two equations share
  // one SVG — which is exactly this file.
  OutputJax: new SVG({ fontCache: 'none' }),
});

const EM = 1000; // MathJax lays out on a 1000-unit em, so scale = px size / 1000

/**
 * Typesets `latex` and returns the markup plus its metrics. `at(x, y)` places it with y on the
 * BASELINE, matching text(). Metrics are returned because the right rail flows on real heights:
 * a cases block is three lines tall and a one-liner is not, and guessing that is how the old
 * fixed-pitch layout ended up with dead space under some cards and none under others.
 */
function tex(latex, size, fill) {
  const html = adaptor.outerHTML(adaptor.firstChild(texDoc.convert(latex, { display: true })));
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(html);
  if (!m) throw new Error(`MathJax emitted no viewBox for: ${latex}`);
  const [minX, minY, vw, vh] = m.slice(1).map(Number);
  const s = size / EM;
  // MathJax paints in currentColor, which resvg will not resolve without a CSS color property.
  const inner = html
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(/currentColor/g, fill);
  return {
    width: vw * s,
    ascent: -minY * s, // minY is negative: the height above the baseline
    descent: (vh + minY) * s, // whatever hangs below it
    height: vh * s,
    at: (x, y) => `<g transform="translate(${x - minX * s} ${y}) scale(${s})">${inner}</g>`,
  };
}

/** The system's section marker: uppercase display type, muted, trailed by a hairline. */
function eyebrowRule(x, y, label, rightX, accent) {
  const size = 11.5;
  const tracking = 2;
  const tx = x + (accent ? 19 : 0);
  const end = tx + widthOf(label.toUpperCase(), size, tracking) + 14;
  return [
    accent ? `<circle cx="${x + 5}" cy="${y - 4}" r="4.5" fill="${accent}"/>` : '',
    text(tx, y, label, { size, family: T.display, fill: T.ink45, upper: true, tracking, weight: true }),
    end < rightX
      ? `<line x1="${end}" y1="${y - 4}" x2="${rightX}" y2="${y - 4}" stroke="${T.hairline}" stroke-width="1"/>`
      : '',
  ].join('');
}

const card = (x, y, w, h, o = {}) => {
  const { fill = T.glass, stroke = T.glassBorder, r = 16, dashed = false } = o;
  const d = dashed ? ' stroke-dasharray="5 4"' : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${d} filter="url(#soft)"/>`;
};

// ---- the stack -----------------------------------------------------------------------------
const LAYERS = [
  {
    eyebrow: 'Clients · React',
    note: 'The three trading screens speak to one REST API over HTTPS. None of them hold keys or reach the chain.',
    accent: T.amber,
    boxes: [
      {
        title: 'Website',
        sub: 'Diner · desktop',
        body: 'The diner experience on a laptop. Shows the live curve for one night and handles buying a table, selling it back, and holdings.',
      },
      {
        title: 'Mobile app',
        sub: 'Diner · phone · PWA',
        body: 'The same diner flows rebuilt for a phone, as bottom sheets and a scrolling night rail. Installable, with its own manifest.',
      },
      {
        title: 'Operator Console',
        sub: 'Restaurant · business app',
        body: 'Where a venue opens a pool per party size, watches fill and reserve, checks diners in at the door, and sweeps after service.',
      },
      {
        title: 'Interactive time decay',
        sub: 'Model explorer',
        body: 'An offline explorer for the pricing model. Scrubbing the time until service redraws the curve using the shared functions.',
      },
    ],
  },
  {
    eyebrow: 'app-services · Node + TypeScript',
    note: 'Owns the API, identity and money. Reaches the chain only through chain-services.',
    accent: T.peach,
    boxes: [
      {
        title: 'REST API',
        sub: 'The one surface',
        body: 'The only endpoint a client calls. Serves pool listings and quotes, and accepts buy, sell, check-in and sweep requests.',
      },
      {
        title: 'Orchestrator',
        sub: 'Buy and sell paths',
        body: 'Runs a trade end to end: locks a quote, settles payment, then commits on-chain. Rejects and refunds if the price moved first.',
      },
      {
        title: 'Identity',
        sub: 'Swappable seam',
        external: true,
        body: 'Every call resolves to an app user id. A header stub today, a JWT provider later, when an issuer role will gate the venue routes.',
      },
      {
        title: 'Payments',
        sub: 'Swappable seam · external',
        external: true,
        body: 'Collects payment against a locked quote and pays sell-backs out by transfer. A stub implementation runs the demo without keys.',
      },
    ],
  },
  {
    eyebrow: 'chain-services · TypeScript',
    note: 'The only module allowed to reach the chain. The mock shipped first, so no other stream waited on the program.',
    accent: T.coral,
    boxes: [
      {
        title: 'Chain adapter',
        sub: 'One interface',
        body: 'A single interface covering create_pool, quote, buy, sell, redeem, check_in and sweep. The mock satisfies it today; the Solana client swaps in behind it.',
      },
      {
        title: 'Mock adapter',
        sub: 'In-memory',
        body: 'An in-memory chain enforcing the same pricing and trading rules as the program, so the whole demo runs without a validator.',
      },
      {
        title: 'Solana client',
        sub: 'Planned swap · web3.js',
        external: true,
        body: 'Signs program instructions and subscribes to program events. Not yet wired: the interface and the program are both in place, the client is not.',
      },
      {
        title: 'Indexer → Postgres',
        sub: 'Optional read cache',
        body: 'Subscribes to the adapter event stream and projects it into Postgres. Off unless a database URL is set, and no demo path depends on it.',
      },
    ],
  },
  {
    eyebrow: 'contract · Solana + Anchor (Rust)',
    note: 'The single source of truth for funds. Everything above it is derived state.',
    accent: T.coralDeep,
    boxes: [
      {
        title: 'Pool account',
        sub: 'State',
        body: 'Per-pool state: the curve parameters, tables sold and available, the venue cut, and the service and decay timings.',
      },
      {
        title: 'Reserve',
        sub: 'Program-owned custody',
        body: 'Holds the USDC for one pool. Its balance is the area under the curve up to the tables sold, and the venue sweeps it after service.',
      },
      {
        title: 'Instructions',
        sub: 'On-chain',
        body: 'Five: opening a pool, buying, selling back, check-in, and the sweep. A buy mints one fungible token; check-in burns it at the door.',
      },
      {
        title: 'Time decay',
        sub: 'On-chain',
        body: 'The program derives θ from block time on each trade, so decay can never be supplied by a caller. Trading stops at service time.',
      },
    ],
  },
];

/** The pricing model, in the right rail. `tex` is LaTeX, typeset by tex() above. */
const MECHANICS = [
  {
    title: 'Bonding curve',
    tex: String.raw`p(n) = p_0 + k\,n`,
    body: 'Each table sold raises the price of the next. The curve is always the counterparty, so a table can always be sold back.',
  },
  {
    title: 'Time decay',
    tex: String.raw`\theta(\tau) = \begin{cases}
      1 & \tau \geq T_c \\
      \tau / T_c & 0 \leq \tau < T_c \\
      0 & \tau \leq 0
    \end{cases}`,
    body: 'τ is the time left before service. The premium fades linearly across the final Tc, and the meal credit p₀ never decays.',
  },
  {
    title: 'Execution price',
    tex: String.raw`\begin{aligned}
      \text{buy} &= p_0 + \lceil k\,n\,\theta \rceil \\
      \text{sell} &= p_0 + \lfloor k(n-1)\,\theta \rfloor \\
      \text{payout} &= \text{sell} \cdot (1 - \varphi)
    \end{aligned}`,
    body: 'φ is the venue cut, kept on every resale. It is the spread between what a buyer pays and what a seller receives.',
  },
  {
    title: 'Solvency',
    tex: String.raw`\text{Reserve} = \sum_{i=0}^{n-1} p(i) = n\,p_0 + k\,\frac{n(n-1)}{2}`,
    body: 'Every buy adds p(n) and every sell-back removes p(n−1), so the reserve always covers a sell-back. Decay only leaves surplus.',
  },
];

// ---- layout --------------------------------------------------------------------------------
const TOP = 178;
const PITCH = 212;
const CARD_OFFSET = 30;
const CARD_H = 132;
const GAP = 14;
const ebY = (i) => TOP + i * PITCH;
const cardsY = (i) => ebY(i) + CARD_OFFSET;
const cardsBottom = (i) => cardsY(i) + CARD_H;

function row(layer, i) {
  const out = [];
  const y = ebY(i);
  out.push(eyebrowRule(STACK_L, y, layer.eyebrow, STACK_R, layer.accent));
  out.push(text(STACK_L + 19, y + 20, layer.note, { size: 12, fill: T.ink45 }));

  const n = layer.boxes.length;
  const bw = (STACK_W - GAP * (n - 1)) / n;
  const by = cardsY(i);

  layer.boxes.forEach((b, j) => {
    const bx = STACK_L + j * (bw + GAP);
    out.push(card(bx, by, bw, CARD_H, b.external ? { stroke: 'rgba(242,84,45,0.34)', dashed: true } : {}));
    out.push(text(bx + 18, by + 30, b.title, { size: 15.5, family: T.display, weight: true }));
    out.push(
      text(bx + 18, by + 49, b.sub, {
        size: 9.5,
        family: T.display,
        fill: b.external ? 'rgba(242,84,45,0.78)' : T.ink45,
        upper: true,
        tracking: 1.4,
      }),
    );
    wrap(b.body, bw - 36, 11.5)
      .slice(0, 5)
      .forEach((ln, li) => out.push(text(bx + 18, by + 72 + li * 15, ln, { size: 11.5, fill: T.ink70 })));
  });
  return out.join('');
}

// ---- assemble ------------------------------------------------------------------------------
const parts = [];

parts.push(`<rect width="${W}" height="${H}" fill="${T.canvas}"/>`);
parts.push(`<g filter="url(#orb)" opacity="0.5">
  <ellipse cx="${W * 0.12}" cy="50" rx="330" ry="200" fill="${T.yellow}"/>
  <ellipse cx="${W * 0.94}" cy="210" rx="290" ry="230" fill="${T.peach}"/>
  <ellipse cx="${W * 0.44}" cy="${H + 50}" rx="470" ry="200" fill="${T.amber}" opacity="0.6"/>
  <ellipse cx="${W * 0.01}" cy="${H * 0.76}" rx="250" ry="220" fill="${T.coral}" opacity="0.32"/>
</g>`);

// masthead: the mark exactly as the apps draw it, then a plain display headline
const markSize = 20;
parts.push(
  `<circle cx="${STACK_L + 6}" cy="60" r="5.5" fill="${T.ink}"/>`,
  `<circle cx="${STACK_L + 25}" cy="60" r="5.5" fill="${T.coral}"/>`,
  text(STACK_L + 42, 66, 'hora', {
    size: markSize,
    family: T.display,
    weight: true,
    tracking: markSize * 0.14,
  }),
  text(STACK_L, 126, 'System Architecture', { size: 42, family: T.display, weight: true, tracking: -0.9 }),
);

LAYERS.forEach((l, i) => parts.push(row(l, i)));

// connectors between the four layers
const midX = STACK_L + STACK_W / 2;
const labels = ['HTTPS · one REST API', 'in-process calls, never the chain directly', 'RPC out, program events back'];
labels.forEach((label, i) => {
  const y1 = cardsBottom(i) + 7;
  const y2 = ebY(i + 1) - 12;
  parts.push(
    `<line x1="${midX}" y1="${y1}" x2="${midX}" y2="${y2 - 9}" stroke="rgba(22,19,15,0.3)" stroke-width="1.5" marker-start="url(#dotHead)" marker-end="url(#arrowHead)"/>`,
    text(midX + 13, (y1 + y2) / 2 + 4, label, { size: 11, fill: T.ink45 }),
  );
});

// the boundary rule, drawn as the thing it forbids, in its own lane down the left
const top = cardsY(0) + CARD_H / 2;
const bot = cardsY(3) + CARD_H / 2;
const cy = (top + bot) / 2;
// The label is rotated (the lane is narrow and the label is not) and sits in its own column to
// the LEFT of the line, so the line can run unbroken and the badge stays legible. Putting it on
// the line meant the two collided no matter how large a gap was cut for it.
const LABEL_X = 62;
parts.push(
  `<path d="M ${STACK_L - 12} ${top} H ${RAIL_X} V ${bot} H ${STACK_L - 12}" fill="none" stroke="rgba(242,84,45,0.4)" stroke-width="1.6" stroke-dasharray="6 5"/>`,
  `<circle cx="${RAIL_X}" cy="${cy}" r="18" fill="rgba(255,255,255,0.97)" stroke="${T.coralDeep}" stroke-width="1.6"/>`,
  `<path d="M ${RAIL_X - 6} ${cy - 6} l 12 12 M ${RAIL_X + 6} ${cy - 6} l -12 12" stroke="${T.coralDeep}" stroke-width="2.1" stroke-linecap="round"/>`,
  text(LABEL_X, cy, 'Clients never touch the chain', {
    size: 11,
    family: T.display,
    fill: T.coralDeep,
    anchor: 'middle',
    upper: true,
    tracking: 1.5,
    weight: true,
    transform: `rotate(-90 ${LABEL_X} ${cy})`,
  }),
);

// ---- right rail: the pricing model ---------------------------------------------------------
const SIDE_W = SIDE_R - SIDE_L;
parts.push(
  eyebrowRule(SIDE_L, ebY(0), 'The pricing model', SIDE_R, T.ink25),
  text(SIDE_L + 19, ebY(0) + 20, 'One pool is one venue, one service window, one party size.', {
    size: 12,
    fill: T.ink45,
  }),
);

// Each card is measured, not pitched: title, then the typeset formula at its true height, then
// the body. The rail flows from the running total so a three-line cases block pushes the rest
// down instead of overflowing its card.
const MECH_TOP = cardsY(0);
const MECH_GAP = 16;
const PAD_X = 18;
let railY = MECH_TOP;

MECHANICS.forEach((m) => {
  // 16.5 rather than the 12.5 the old plain-text lines used: MathJax's em box is taller than the
  // glyphs inside it, so matched nominal sizes render visibly smaller than surrounding UI text.
  const eq = tex(m.tex, 16.5, T.coralDeep);
  const lines = wrap(m.body, SIDE_W - PAD_X * 2, 11).slice(0, 3);
  const titleH = 30;
  const eqH = eq.ascent + eq.descent + 26;
  const bodyH = lines.length * 14 + 18;
  const h = titleH + eqH + bodyH;

  parts.push(card(SIDE_L, railY, SIDE_W, h));
  parts.push(text(SIDE_L + PAD_X, railY + titleH, m.title, { size: 15, family: T.display, weight: true }));
  parts.push(eq.at(SIDE_L + PAD_X, railY + titleH + 13 + eq.ascent));
  const bodyTop = railY + titleH + eqH;
  lines.forEach((ln, li) => parts.push(text(SIDE_L + PAD_X, bodyTop + 6 + li * 14, ln, { size: 11, fill: T.ink70 })));

  railY += h + MECH_GAP;
});

// the layer every other layer imports, closing the rail
const sY = railY + 4;
parts.push(
  eyebrowRule(SIDE_L, sY, 'Shared contracts', SIDE_R, T.ink25),
  card(SIDE_L, sY + 16, SIDE_W, 76),
  text(SIDE_L + 18, sY + 43, 'shared-types', { size: 15, family: T.display, weight: true }),
);
wrap(
  'Frozen interfaces and the pricing functions, imported by every layer. The chain and the model run the same code.',
  SIDE_W - 36,
  11,
)
  .slice(0, 3)
  .forEach((ln, li) => parts.push(text(SIDE_L + 18, sY + 61 + li * 14, ln, { size: 11, fill: T.ink70 })));

parts.push(
  text(STACK_L, H - 34, 'The bonding curve is the smart contract. Postgres is a read cache and is never authoritative over money.', {
    size: 12,
    fill: T.ink45,
  }),
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <filter id="orb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="85"/></filter>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#502d19" flood-opacity="0.11"/>
  </filter>
  <marker id="arrowHead" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
    <path d="M 1 1 L 10 6 L 1 11 z" fill="rgba(22,19,15,0.38)"/>
  </marker>
  <marker id="dotHead" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="4.5" markerHeight="4.5">
    <circle cx="4" cy="4" r="3" fill="rgba(22,19,15,0.38)"/>
  </marker>
</defs>
${parts.join('\n')}
</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'architecture.svg'), svg, 'utf8');

let fontFiles = [];
try {
  fontFiles = readdirSync(FONT_DIR)
    .filter((f) => f.endsWith('.ttf'))
    .map((f) => join(FONT_DIR, f));
} catch {
  /* handled below */
}
// Falling back to a system font silently would produce a diagram that looks fine to whoever ran
// it and wrong to everyone else, so this is a hard stop with the fix attached.
if (fontFiles.length === 0) {
  console.error(
    [
      `No .ttf files in ${FONT_DIR}.`,
      '',
      'The brand faces are not vendored (OFL, ~1.5MB). Fetch them once:',
      '',
      '  mkdir -p .fonts',
      '  BASE=https://github.com/google/fonts/raw/main/ofl',
      '  curl -sL -o .fonts/Archivo.ttf "$BASE/archivo/Archivo%5Bwdth,wght%5D.ttf"',
      '  curl -sL -o .fonts/Inter.ttf "$BASE/inter/Inter%5Bopsz,wght%5D.ttf"',
    ].join('\n'),
  );
  process.exit(1);
}

const png = new Resvg(svg, {
  // 2x -> 3840x2160, so it survives a projector at full-bleed
  fitTo: { mode: 'width', value: W * 2 },
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  background: T.canvas,
})
  .render()
  .asPng();

writeFileSync(join(OUT_DIR, 'architecture.png'), png);
console.log(`docs/architecture.svg  ${(svg.length / 1024).toFixed(1)} kB`);
console.log(`docs/architecture.png  ${(png.length / 1024).toFixed(1)} kB  ${W * 2}x${H * 2} (16:9)`);
