/**
 * Renders packages/launcher/src/writeupMath.generated.ts from the formulas below.
 *
 *   node scripts/render-writeup-math.mjs
 *
 * The write-up page (`/writeup`) is real prose with real equations in it. Rather than ship a math
 * font and a runtime typesetter to the browser, the formulas are typeset here, once, exactly the
 * way the architecture diagram does it (scripts/render-architecture.mjs): real LaTeX -> MathJax ->
 * SVG geometry. The launcher then imports flat SVG strings and injects them, so the page carries no
 * KaTeX/MathJax bundle and no math webfont.
 *
 * The one difference from the diagram: that script paints for resvg, which cannot resolve
 * `currentColor`, so it bakes a fill in. Here the target is a browser, where `currentColor` is the
 * better answer — the equation inherits the surrounding text colour, so the same SVG reads as ink
 * in a paragraph and as the coral accent in a display block, decided entirely by CSS.
 *
 * Generated, not hand-pasted: edit FORMULAS, re-run, commit the output. The alternative — SVG blobs
 * living inline in the component — rots the first time a coefficient changes.
 */
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages', 'launcher', 'src', 'writeupMath.generated.ts');

/**
 * Every distinct expression in DEVPOST.md, keyed. `display: true` is a centred block; the rest are
 * set inline and size themselves off the paragraph's font (MathJax emits width/height in `ex`).
 */
const FORMULAS = {
  // ---- display blocks ----
  price: {
    display: true,
    tex: String.raw`\text{price} = \underbrace{p_0}_{\text{prepaid meal credit}} + \underbrace{k \cdot n \cdot \theta(t)}_{\text{scarcity premium}}`,
  },
  reserve: {
    display: true,
    tex: String.raw`\text{Reserve} = \sum_{i=0}^{n-1} p(i) = n\,p_0 + k\,\frac{n(n-1)}{2}`,
  },
  thetaCases: {
    display: true,
    tex: String.raw`\theta(\tau) = \begin{cases} 1 & \tau \geq T_c \\ \tau / T_c & 0 \leq \tau < T_c \\ 0 & \tau \leq 0 \end{cases} \qquad \tau = t_{\text{service}} - t_{\text{now}}`,
  },

  // ---- inline ----
  N: { tex: String.raw`N` },
  k: { tex: String.raw`k` },
  s: { tex: String.raw`s` },
  sEq: { tex: String.raw`s = 5\%` },
  theta: { tex: String.raw`\theta` },
  nToN1: { tex: String.raw`n \to n+1` },
  pnDef: { tex: String.raw`p(n) = p_0 + kn` },
  pn: { tex: String.raw`p(n)` },
  pn1: { tex: String.raw`p(n-1)` },
  pn1Payout: { tex: String.raw`p(n-1)(1-s)` },
};

// ---- TeX -> SVG, same setup as the architecture diagram --------------------------------------
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texDoc = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  // fontCache 'none' inlines every glyph as its own <path>. The default ('local') emits a per-
  // document <defs> of glyphs referenced by id, and those ids collide the instant two of these
  // SVGs land on the same page — which is the whole write-up.
  OutputJax: new SVG({ fontCache: 'none' }),
});

/** One expression to an SVG string, colour left as `currentColor` for the page to set. */
function svgFor(tex, display) {
  const node = texDoc.convert(tex, { display });
  const svg = adaptor.outerHTML(adaptor.firstChild(node));
  if (!/^<svg/.test(svg)) throw new Error(`MathJax emitted no <svg> for: ${tex}`);
  return svg;
}

const out = {};
for (const [key, { tex, display }] of Object.entries(FORMULAS)) {
  out[key] = svgFor(tex, Boolean(display));
}

const banner = `// AUTO-GENERATED — do not edit. Regenerate with:  node scripts/render-writeup-math.mjs
//
// Real LaTeX from DEVPOST.md, typeset by MathJax to SVG <path> geometry at build time — the same
// rule the architecture diagram follows. No math font and no typesetter ship to the browser; each
// SVG inherits its colour from \`currentColor\`, so the page's CSS decides it.`;

const body = Object.entries(out)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join('\n');

const file = `${banner}\nexport const MATH = {\n${body}\n} as const;\n\nexport type MathKey = keyof typeof MATH;\n`;

writeFileSync(OUT, file, 'utf8');
console.log(`wrote ${OUT}`);
console.log(`  ${Object.keys(out).length} formulas, ${(file.length / 1024).toFixed(1)} kB`);
