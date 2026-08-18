# @ttr/design

The hora design system. Five clients — the launcher, the diner site, the operator console, the
mobile app and the pricing lab — render from this package and nothing else.

```ts
// main.tsx, in every client
import '@ttr/design/base.css'; // tokens + reset + wash + glass + type ramp
import './styles.css'; // this app's own furniture
```

## What lives here

| | |
|---|---|
| `src/tokens.css` | Every colour, radius, shadow and face. The only file allowed to name a colour. |
| `src/base.css` | The reset, the ambient wash, the `.glass` primitive, the wordmark, the type ramp. Wrapped in `@layer base`. |
| `src/chart.ts` | Chart paint. Recharts takes SVG paint props, which the cascade cannot reach, so these have to be literals — and therefore have to be here. |
| `src/ease.ts` | `EASE` and `DUR`, matching `--ease` in the CSS. |

## Two rules

**1. No colour literals outside this package.** `npm run lint:tokens` fails the build on a hex,
`rgb()` or `hsl()` anywhere in the five clients. White and black at alpha are exempt — they are the
ends of the alpha scale, not brand.

If you need a palette colour at some other alpha, do not restate it. The channels are published:

```css
background: rgb(var(--accent-deep-rgb) / 0.08);
box-shadow: 0 3px 10px rgb(var(--shadow-rgb) / 0.07);
```

This is not tidiness. The previous palette drifted because five stylesheets each held their own copy
of the token block, so the fastest correct-looking move was always to paste a value — and by the
time the palette changed there were a dozen literals in places the tokens could not reach. The guard
exists so that the cheap path and the correct path are the same path.

**2. `base.css` is a cascade layer, so an app always wins.** A design-system rule must never beat an
app rule on source order — that is an accident of bundling, not a decision. The layer makes the
answer unconditional.

This one is load-bearing. Extracting `.muted` into a file that loads *first* silently reversed every
tie of the shape `.muted` vs `.lede`, and the diner's `<p class="muted lede">` had been relying on
the old order: its short-viewport tier sets `.lede { font-size: 13px }`, which had never once
applied. If you add a rule here, assume some app somewhere combines its class with another.

## Per-surface variation

Differences between surfaces are expressed as variables, not as diverging copies.

```html
<div class="orbs orbs--poster orbs--drift">  <!-- landing: the wash is the composition -->
<div class="orbs orbs--drift">               <!-- console: quieter, still alive -->
<div class="orbs">                           <!-- diner: quietest, no drift -->
```

The wash is louder on landing surfaces and quieter on app surfaces, because an app is rows of
parallel cards edge to edge — at poster strength the top-right orb sits on the last card of every
row, and four cards meaning the same kind of thing arrive in two different colours. Volume is
`--orb-1-opacity` / `--orb-2-opacity` / `--orb-1-inset-x` / `--orb-1-inset-y`, declared on `:root` so
a surface that builds its own orb container (the mobile app projects one inside the phone and
another behind it) inherits sane defaults and overrides the same way.

## What deliberately did NOT move here

`motion.ts` looks duplicated across the clients and is not. The mobile app's is a seven-line stub
because a phone gets almost no entrance animation; the launcher branches on reduced motion per
variant while the diner relies on a global `<MotionConfig reducedMotion="user">`. Collapsing those
would produce a shared abstraction no surface wants and nobody owns. Only the curve is shared, in
`ease.ts`, because a CSS hover and a Framer entrance landing on the same element must decelerate
identically or the element reads as two objects.

`app-services` is also out of scope. It server-renders a standalone dark status page at
`/unifold/status` — a debugging artifact with its own palette that is never seen beside the apps.
The token guard does not police it, on purpose.
