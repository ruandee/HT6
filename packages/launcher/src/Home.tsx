/**
 * The landing page: what hora is, for someone who has never seen it.
 *
 * This is the only surface in the repo with a selling job. That's deliberate, and it's what frees
 * the three apps to stop pitching in their own headers — a diner who has opened the app is already
 * sold, and a slogan there just costs them a screenful of the thing they came for.
 *
 * ---- why it moves sideways ----
 *
 * It reads as a deck, not a document: six full-screen slides on a horizontal track, with a rail
 * naming them down the right-hand side. The sections were always discrete — one claim each, each
 * one previously fenced off with a hairline rule — so paging between them says what the rules were
 * trying to say, without drawing a single line.
 *
 * The track is native `overflow-x` with scroll snapping rather than a transform-driven carousel.
 * That buys trackpad swipes, touch, the scrollbar, Home/End and find-in-page for free, and it
 * degrades to an ordinary scroller if the JS below never runs. The only thing JavaScript adds is
 * translating a vertical wheel into horizontal travel, because a mouse with one wheel is otherwise
 * stranded on a horizontal page.
 *
 * Motion rules:
 *   - Slides reveal once, on approach, and never again.
 *   - Reduced motion keeps the fades but removes spatial transforms, and turns snapping off.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { group, reveal, inView, hoverLift, tapPress, EASE } from './motion';

/**
 * The decay demo pulls in recharts, which is heavier than the entire rest of this page. It also
 * lives four slides along, so loading it before the hero has painted trades the first impression
 * for a slide most visitors haven't reached yet. Split out, it arrives while they read — and
 * .decay__placeholder reserves its height so nothing jumps when it does.
 */
const DecayDemo = lazy(() => import('./DecayDemo'));

/* ---- the opening ----
   The two dots arrive alone and oversized in the middle of the screen — ink first, then accent —
   then retreat into their resting place at the top of the wordmark, and the rest of the hero
   rises behind them.

   The retreat distance is measured rather than written down. The wordmark is clamp()-sized, so
   where the dots come to rest moves with the viewport, and the only number that is right at every
   width is the one read off the layout. That read needs one frame with no transform applied, which
   is free here: both dots are still transparent at that point, so the frame is never seen. */

/** Resting diameter of a dot, matching `.wordmark__dots i`. The scale-up is derived from it. */
const DOT_REST = 15;
/** How big a dot gets mid-screen: a share of the viewport, fenced in on phones and ultrawides. */
const DOT_BIG = { share: 0.07, min: 40, max: 84 } as const;
/** How long the pair holds at full size before retreating. */
const HOLD_MS = 1250;

interface Lift {
  y: number;
  scale: number;
}

/**
 * The opening is a first impression, so it gets one showing per page load.
 *
 * `/demo` unmounts this component, and coming back remounts it — without this flag the intro would
 * replay every time someone returned from the role picker, which is the exact "re-animates on
 * every approach" failure the motion rules at the top of this file rule out for the slides.
 *
 * It lives outside the component, not in a ref, because it has to survive that unmount. It is set
 * when the intro finishes rather than when it starts, so StrictMode's double-invoked effects in
 * development still see `false` on the second pass and the intro is not swallowed in dev.
 */
let introPlayed = false;

/** The rail's labels, in track order. Index 0 is the hero, which the rail calls by its name. */
const SLIDES = [
  'hora',
  'The problem',
  'How it works',
  'See for yourself',
  'Under the hood',
  "Who it's for",
] as const;

interface Step {
  n: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Pick a night, get a price',
    body: 'Choose the date and party size; every party with n members shares the same price, and most of what you pay is a credit off your bill when you arrive. So you prepay for your food, and for preserving your optionality.',
  },
  {
    n: '02',
    title: 'The price follows the room',
    body: 'Each table sold nudges the price up for the next one, so booking early is cheaper and a nearly full Saturday costs what a nearly full Saturday is worth. As service gets close, the premium fades away again, back down to the dinner credit it started from.',
  },
  {
    n: '03',
    title: 'Plans changed? Sell it back',
    body: 'There is always someone to sell to, because the app itself is the buyer, as an automated market maker (AMM). Hand the table back any time before service and the money returns immediately, minus a small cut for the restaurant. No need to call in!',
  },
  {
    n: '04',
    title: 'A no-show finally pays',
    body: 'If nobody shows and nobody sold it back, the table was still paid for, and that money goes to the restaurant at the end of the night. No card holds or blacklists. The restaurant recoups on the empty seats.',
  },
];

interface Tech {
  label: string;
  body: string;
}

/**
 * The blockchain slide. Every card leads with what it means for the reader and mentions the
 * mechanism second — the point of being on-chain here is the guarantee it buys, and a landing page
 * that opens with "Solana program" has already lost the diner it was written for.
 */
const TECH: Tech[] = [
  {
    label: 'Built on Solana',
    body: 'Every table, price, and sale is a transaction on a public blockchain. The pool that buys your table back is a smart contract holding real money, so what it owes and what it holds are both things you can go and check.',
  },
  {
    label: 'Always able to pay you',
    body: 'The contract only ever takes in what it needs to buy every table back later. Whatever the price does, the money to refund you is already sitting there. That is arithmetic, not a promise anyone has to keep.',
  },
  {
    label: 'No wallet, no crypto',
    body: 'Sign in with an email like anything else. No seed phrase, no browser extension, no gas fees, no jargon. It settles in a dollar-backed stablecoin, and none of that ever reaches the screen.',
  },
  {
    label: 'One table each, per night',
    body: 'The contract itself refuses to sell you a second table for the same evening, whatever the party size. Nobody can quietly buy up a Friday and resell it, because the rule lives in the code rather than in the terms of service.',
  },
];

interface Side {
  who: string;
  lines: string[];
}

const SIDES: Side[] = [
  {
    who: 'For diners',
    lines: [
      'Book early and pay less for it; all while keeping your optionality.',
      'Change your mind, and get most of it back.',
      'Most of the price is prepaying for your dinner',
      'A table you cannot use costs you almost nothing.',
    ],
  },
  {
    who: 'For restaurants',
    lines: [
      'Every seat is paid for before service, not after.',
      'A no-show turns into revenue instead of an automatic loss',
      'Every resale pays the house a cut, so reservation scalpers are cut out of the equation.',
      'You see the room filling in real time, and what you are owed at the end.',
    ],
  },
];

/** A slide that rises into place the first time it's approached, releasing its children in turn. */
function Slide({
  children,
  stagger = 0.08,
  wide = false,
}: {
  children: React.ReactNode;
  stagger?: number;
  wide?: boolean;
}) {
  return (
    <motion.section
      className={`slide${wide ? ' slide--wide' : ''}`}
      variants={group(stagger)}
      initial="hidden"
      whileInView="show"
      viewport={inView}
    >
      <div className="slide__inner">{children}</div>
    </motion.section>
  );
}

export default function Home({
  onEnter,
  onWriteup,
}: {
  onEnter: (e: React.MouseEvent) => void;
  onWriteup: (e: React.MouseEvent) => void;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const disclose = useMemo(() => reveal(reduceMotion), [reduceMotion]);

  /** null until measured; once set, the dots jump to centre and the sequence starts. */
  const [lift, setLift] = useState<Lift | null>(null);
  /** true once the dots have been told to go home and the hero has been released. */
  const [settled, setSettled] = useState(false);
  const dotsRef = useRef<HTMLDivElement>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    // Reduced motion gets the finished page, not a shortened version of the intro: there is no
    // information in the opening that the settled hero doesn't already show. A second visit to
    // this route skips it for the same reason — it has already been made.
    if (reduceMotion || introPlayed) {
      setLift({ y: 0, scale: 1 });
      setSettled(true);
      return;
    }
    const el = dotsRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const big = Math.min(Math.max(window.innerWidth * DOT_BIG.share, DOT_BIG.min), DOT_BIG.max);
    setLift({
      y: window.innerHeight / 2 - (rect.top + rect.height / 2),
      scale: big / DOT_REST,
    });
  }, [reduceMotion]);

  useEffect(() => {
    if (!lift || settled) return;
    const t = setTimeout(() => {
      introPlayed = true;
      setSettled(true);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [lift, settled]);

  /** Move the track to a slide. Smooth unless the visitor asked for less motion. */
  const go = useCallback(
    (i: number) => {
      const track = trackRef.current;
      if (!track) return;
      track.scrollTo({
        left: i * track.clientWidth,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    },
    [reduceMotion],
  );

  /** Which slide is under the viewport, read off the track rather than tracked in state. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      setActive(Math.max(0, Math.min(SLIDES.length - 1, i)));
    };
    const onScroll = () => {
      // scroll fires far more often than the answer can change; coalesce to one read per frame
      if (!frame) frame = requestAnimationFrame(read);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /**
   * A vertical wheel pages the deck sideways.
   *
   * The one thing the native scroller cannot do on its own: a mouse has a vertical wheel and this
   * page has no vertical travel, so without this a plain mouse is stuck on the first slide. A
   * trackpad's horizontal gesture already arrives as `deltaX` and is left alone — intercepting it
   * would fight the very input that already works.
   *
   * It pages rather than accumulating, and that is not a preference. The track snaps `mandatory`,
   * so nudging `scrollLeft` by one wheel notch moves it a fraction of a slide and the snap drags
   * it straight back — the first version of this did exactly that and appeared to do nothing at
   * all. One gesture, one slide, with a short lock so a single flick of an inertial wheel doesn't
   * fire four times.
   *
   * Refs rather than the state values: this listener is attached once, and closing over `active`
   * would leave it permanently convinced the deck is still on slide zero.
   */
  const activeRef = useRef(0);
  activeRef.current = active;
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let locked = false;
    let accum = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const slide = (e.target as HTMLElement | null)?.closest?.('.slide');
      // let a genuinely tall slide use the wheel for its own overflow before we take it
      if (slide && slide.scrollHeight > slide.clientHeight + 8) {
        const atTop = slide.scrollTop <= 0;
        const atBottom = slide.scrollTop + slide.clientHeight >= slide.scrollHeight - 1;
        if (!(e.deltaY < 0 ? atTop : atBottom)) return;
      }
      e.preventDefault();
      if (locked) return;
      accum += e.deltaY;
      if (Math.abs(accum) < 40) return;
      const dir = accum > 0 ? 1 : -1;
      accum = 0;
      locked = true;
      window.setTimeout(() => {
        locked = false;
      }, 420);
      goRef.current(Math.max(0, Math.min(SLIDES.length - 1, activeRef.current + dir)));
    };
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => track.removeEventListener('wheel', onWheel);
  }, []);

  /** Arrow keys page the deck, which is also what makes the rail reachable without a mouse. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(Math.min(SLIDES.length - 1, active + 1));
      else if (e.key === 'ArrowLeft') go(Math.max(0, active - 1));
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(SLIDES.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, go]);

  return (
    <div className="home">
      {/* ============ the rail ============
          Just the names, down the right edge. The one that is current carries the logo's accent
          dot — the same mark as the wordmark's second dot, so position is indicated by the brand
          rather than by a scrollbar. The rest underline on hover, which is the only affordance
          they need to read as reachable. */}
      <nav className="rail" aria-label="Sections">
        {SLIDES.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`rail__item${i === active ? ' rail__item--on' : ''}`}
            aria-current={i === active || undefined}
            onClick={() => go(i)}
          >
            <i className="rail__dot" aria-hidden />
            <span className="rail__label">{label}</span>
          </button>
        ))}
      </nav>

      <div className="track" ref={trackRef}>
        {/* ============ hero ============ */}
        <section className="slide slide--hero">
          <div className="slide__inner">
            {/* `disclose` rather than the shorter `fadeUp`: after the dots have cleared the middle
                of the screen the hero is arriving from nothing, not adjusting in place, and 8px of
                travel reads as a flicker against a mark that just crossed half the viewport. */}
            <motion.div
              className="hero__inner"
              variants={group(0.09, 0.1)}
              initial="hidden"
              animate={settled ? 'show' : 'hidden'}
            >
              <motion.div className="hero__eyebrow" variants={disclose}>
                Tokenized reservations
              </motion.div>

              {/* The mark runs the opening, so it stays out of the variant tree above — an explicit
                  `animate` object stops it inheriting the hero's hidden/show state. */}
              <motion.div
                className="wordmark__dots"
                ref={dotsRef}
                initial={false}
                animate={{
                  y: settled ? 0 : (lift?.y ?? 0),
                  scale: settled ? 1 : (lift?.scale ?? 1),
                }}
                /* Going out to centre is a cut, not a move: it happens on the frame the measurement
                   lands, while both dots are still invisible. Only the way home is animated. */
                transition={settled ? { duration: 0.95, ease: EASE } : { duration: 0 }}
              >
                {[0, 0.3].map((delay, i) => (
                  <motion.i
                    key={i}
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.2 }}
                    animate={lift ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.2 }}
                    transition={{
                      delay: settled ? 0 : 0.15 + delay,
                      type: 'spring',
                      stiffness: 300,
                      damping: 20,
                      mass: 0.8,
                    }}
                  />
                ))}
              </motion.div>

              {/* the wordmark IS the hero. Everything else on this screen is a caption to it. */}
              <motion.h1 className="wordmark" variants={disclose}>
                hora
              </motion.h1>

              <motion.p className="hero__sub" variants={disclose}>
                A restaurant table you can buy, price, and <span className="script">sell back</span>
                <br />
                right up until the night it&apos;s for.
              </motion.p>

              <motion.div className="ctas" variants={disclose}>
                <motion.a
                  className="cta cta--ink"
                  href="/writeup"
                  onClick={onWriteup}
                  whileHover={reduceMotion ? undefined : hoverLift}
                  whileTap={reduceMotion ? undefined : tapPress}
                >
                  Read the Devpost
                  <span className="cta__arrow">&#8594;</span>
                </motion.a>
                <motion.a
                  className="cta cta--accent"
                  href="/demo"
                  onClick={onEnter}
                  whileHover={reduceMotion ? undefined : hoverLift}
                  whileTap={reduceMotion ? undefined : tapPress}
                >
                  See the demo
                  <span className="cta__arrow">&#8594;</span>
                </motion.a>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ============ the problem ============ */}
        <Slide>
          <motion.div className="eyebrow" variants={disclose}>
            The problem
          </motion.div>
          <motion.h2 className="sec__title" variants={disclose}>
            A booking is a promise
            <br />
            with <span className="script">nothing</span> behind it.
          </motion.h2>
          <motion.p className="sec__lede" variants={disclose}>
            The hardest table in town costs the same as an empty Tuesday: nothing. So the good one
            gets hoarded and quietly resold in a third-party auction, the easy one gets abandoned at
            7:58, and the restaurant pays for both.
          </motion.p>
        </Slide>

        {/* ============ how it works ============ */}
        <Slide stagger={0.1} wide>
          <motion.div className="eyebrow" variants={disclose}>
            How it works
          </motion.div>
          <motion.h2 className="sec__title" variants={disclose}>
            Give the table a <span className="script">price</span>.
          </motion.h2>

          <div className="steps">
            {STEPS.map((s) => (
              <motion.article className="glass step" key={s.n} variants={disclose}>
                <div className="step__n">{s.n}</div>
                <h3 className="step__title">{s.title}</h3>
                <p className="muted">{s.body}</p>
              </motion.article>
            ))}
          </div>
        </Slide>

        {/* ============ try it ============
            Step 02 claims the premium fades back down to the dinner credit. This is where the
            reader gets to check that claim against the same math the chain runs, rather than
            taking a marketing page's word for it. */}
        <Slide stagger={0.1} wide>
          <motion.div className="eyebrow" variants={disclose}>
            See for yourself
          </motion.div>
          <motion.h2 className="sec__title" variants={disclose}>
            Watch the premium <span className="script">fade</span>.
          </motion.h2>
          {/* One line, not the paragraph this used to be: the slide has to hold the demo card on
              one screen, and the claim only needs to survive long enough to be checked below. */}
          <motion.p className="sec__lede sec__lede--tight" variants={disclose}>
            Not an illustration — every number below is computed live, in your browser, from the
            same pricing code the contract runs.
          </motion.p>

          <Suspense fallback={<div className="glass decay decay__placeholder" aria-hidden />}>
            <DecayDemo />
          </Suspense>
        </Slide>

        {/* ============ under the hood ============ */}
        <Slide stagger={0.09} wide>
          <motion.div className="eyebrow" variants={disclose}>
            Under the hood
          </motion.div>
          <motion.h2 className="sec__title" variants={disclose}>
            The guarantees are <span className="script">real</span>.
          </motion.h2>
          <motion.p className="sec__lede" variants={disclose}>
            Prices like these only work if the refund is certain, so the rules live somewhere nobody
            can quietly change them later — including us.
          </motion.p>

          <div className="tech">
            {TECH.map((t) => (
              <motion.article className="glass tech__card" key={t.label} variants={disclose}>
                <h3 className="tech__label">{t.label}</h3>
                <p className="muted tech__body">{t.body}</p>
              </motion.article>
            ))}
          </div>
        </Slide>

        {/* ============ both sides ============ */}
        <Slide stagger={0.1} wide>
          <motion.div className="eyebrow" variants={disclose}>
            Who it&apos;s for
          </motion.div>
          <motion.h2 className="sec__title" variants={disclose}>
            Both sides of the <span className="script">table</span>.
          </motion.h2>

          <div className="sides">
            {SIDES.map((s) => (
              <motion.article className="glass side" key={s.who} variants={disclose}>
                <h3 className="side__who">{s.who}</h3>
                <ul className="side__list">
                  {s.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </motion.article>
            ))}
          </div>

          <motion.footer className="footnote home__footer" variants={disclose}>
            hora · tokenized restaurant reservations on an automated market maker.
          </motion.footer>
        </Slide>
      </div>
    </div>
  );
}
