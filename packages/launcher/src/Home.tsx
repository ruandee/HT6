/**
 * The landing page: what hora is, for someone who has never seen it.
 *
 * This is the only surface in the repo with a selling job. That's deliberate, and it's what frees
 * the three apps to stop pitching in their own headers — a diner who has opened the app is already
 * sold, and a slogan there just costs them a screenful of the thing they came for.
 *
 * Motion rules for this page:
 *   - Sections reveal once, on approach, and never again. A page that re-animates on every scroll
 *     up turns reading into a slideshow.
 *   - The only scroll-*linked* motion is the hero's exit and the progress rail. Everything else is
 *     time-based and triggered by the viewport, so nothing feels welded to the scrollbar.
 *   - Reduced motion keeps the fades but removes spatial transforms.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { group, reveal, inView, hoverLift, tapPress, ease, EASE } from './motion';

/**
 * The decay demo pulls in recharts, which is heavier than the entire rest of this page. It also
 * lives four screenfuls down, so loading it before the hero has painted trades the first
 * impression for a section most visitors haven't scrolled to yet. Split out, it arrives while
 * they read — and .decay__placeholder reserves its height so nothing jumps when it does.
 */
const DecayDemo = lazy(() => import('./DecayDemo'));

/* ---- the opening ----
   The two dots arrive alone and oversized in the middle of the screen — ink first, then coral —
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
 * every approach" failure the motion rules at the top of this file rule out for the sections.
 *
 * It lives outside the component, not in a ref, because it has to survive that unmount. It is set
 * when the intro finishes rather than when it starts, so StrictMode's double-invoked effects in
 * development still see `false` on the second pass and the intro is not swallowed in dev.
 */
let introPlayed = false;

/** A section that rises into place the first time it's approached, releasing its children in turn. */
function Section({
  id,
  children,
  stagger = 0.08,
}: {
  id?: string;
  children: React.ReactNode;
  stagger?: number;
}) {
  return (
    <motion.section
      id={id}
      className="sec"
      variants={group(stagger)}
      initial="hidden"
      whileInView="show"
      viewport={inView}
    >
      {children}
    </motion.section>
  );
}

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
 * The blockchain section. Every card leads with what it means for the reader and mentions the
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

export default function Home({
  onEnter,
  onWriteup,
}: {
  onEnter: (e: React.MouseEvent) => void;
  onWriteup: (e: React.MouseEvent) => void;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const disclose = useMemo(() => reveal(reduceMotion), [reduceMotion]);
  const { scrollYProgress } = useScroll();

  /** null until measured; once set, the dots jump to centre and the sequence starts. */
  const [lift, setLift] = useState<Lift | null>(null);
  /** true once the dots have been told to go home and the hero has been released. */
  const [settled, setSettled] = useState(false);
  const dotsRef = useRef<HTMLDivElement>(null);

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
    // Belt to main.tsx's braces: the centre offset is measured against the viewport, so the page
    // has to actually be at the top rather than merely expected to be.
    window.scrollTo(0, 0);
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

  /**
   * The hero doesn't scroll away flat — it settles back and dims over the first screenful, so the
   * content arriving underneath reads as being *in front of* it rather than merely after it. The
   * ranges stop well short of 1: by 22% of the page the hero is long gone, and animating a thing
   * that isn't on screen is wasted work.
   */
  const heroY = useTransform(scrollYProgress, [0, 0.22], [0, -70]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.14], [1, 0]);
  const cueOpacity = useTransform(scrollYProgress, [0, 0.05], [1, 0]);

  return (
    <div className="home">
      {/* reading position, pinned to the top edge. scaleX off the raw progress value means this
          never re-renders React — the transform is applied on the compositor. */}
      <motion.div className="progress" style={{ scaleX: scrollYProgress }} />

      {/* ============ hero ============ */}
      <div className="hero">
        {/* `disclose` rather than the shorter `fadeUp`: after the dots have cleared the middle of
            the screen the hero is arriving from nothing, not adjusting in place, and 8px of travel
            reads as a flicker against a mark that just crossed half the viewport. */}
        <motion.div
          className="hero__inner"
          style={{ y: reduceMotion ? 0 : heroY, opacity: heroOpacity }}
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
            right up until the night it's for.
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

        {/* Scroll cue: it breathes on its own and disappears the instant you take the hint.
            Mounted only once the hero has landed — during the opening there is nothing above it to
            scroll past, and an arrow nodding at the bottom of an otherwise empty screen invites
            the reader to leave before the page has said anything. */}
        {settled && (
          <motion.div
            className="cue"
            style={{ opacity: cueOpacity }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...ease(0.5), delay: 0.7 }}
          >
            <motion.span
              animate={{
                transform: reduceMotion
                  ? 'translateY(0)'
                  : ['translateY(0)', 'translateY(6px)', 'translateY(0)'],
              }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              &#8595;
            </motion.span>
          </motion.div>
        )}
      </div>

      {/* ============ the problem ============ */}
      <Section>
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
          gets hoarded and quietly resold in a third-party auction, the easy one gets abandoned at 7:58, and
          the restaurant pays for both. 
        </motion.p>
      </Section>

      {/* ============ how it works ============ */}
      <Section stagger={0.1}>
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
      </Section>

      {/* ============ try it ============
          Step 02 above claims the premium fades back down to the dinner credit. This is where the
          reader gets to check that claim against the same math the chain runs, rather than taking
          a marketing page's word for it. */}
      <Section stagger={0.1}>
        <motion.div className="eyebrow" variants={disclose}>
          See for yourself
        </motion.div>
        <motion.h2 className="sec__title" variants={disclose}>
          Watch the premium <span className="script">fade</span>.
        </motion.h2>
        <motion.p className="sec__lede" variants={disclose}>
          Nothing below is an illustration. Every number is computed live from the same pricing
          code the contract runs, so you can drag the night right up to the door and see exactly
          what a table is worth when there is no time left in it.
        </motion.p>

        <Suspense fallback={<div className="glass decay decay__placeholder" aria-hidden />}>
          <DecayDemo />
        </Suspense>
      </Section>

      {/* ============ under the hood ============ */}
      <Section stagger={0.09}>
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
      </Section>

      {/* ============ both sides ============ */}
      <Section stagger={0.1}>
        <motion.div className="eyebrow" variants={disclose}>
          Who it's for
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
      </Section>
    </div>
  );
}
