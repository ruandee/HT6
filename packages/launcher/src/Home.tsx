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
 *   - Reduced motion is handled once by <MotionConfig reducedMotion="user"> in App: Framer drops
 *     the transforms and keeps the opacity, so none of this needs to branch.
 */
import { lazy, Suspense } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { fadeUp, group, reveal, inView, hoverLift, tapPress, ease } from './motion';

/**
 * The decay demo pulls in recharts, which is heavier than the entire rest of this page. It also
 * lives four screenfuls down, so loading it before the hero has painted trades the first
 * impression for a section most visitors haven't scrolled to yet. Split out, it arrives while
 * they read — and .decay__placeholder reserves its height so nothing jumps when it does.
 */
const DecayDemo = lazy(() => import('./DecayDemo'));

/** Devpost lives outside this repo, so it's env-driven like the three app URLs. */
const DEVPOST_URL =
  import.meta.env.VITE_DEVPOST_URL ?? 'https://devpost.com/software/hora';

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
    body: 'Choose the date and how many of you there are. Every table of that size on that night shares one price, and most of what you pay is a credit off your bill when you turn up — so you are mostly just paying for dinner early.',
  },
  {
    n: '02',
    title: 'The price follows the room',
    body: 'Each table sold nudges the price up for the next one, so booking early is genuinely cheaper and a nearly full Saturday costs what a nearly full Saturday is worth. As service gets close the premium fades away again, back down to the dinner credit it started from.',
  },
  {
    n: '03',
    title: 'Changed your mind? Sell it back',
    body: 'There is always someone to sell to, because the app itself is the buyer. Hand the table back any time before service and the money returns immediately, minus a small cut for the restaurant. No phone call, no pleading with the host, no writing off the whole thing because Tuesday fell apart.',
  },
  {
    n: '04',
    title: 'A no-show finally pays',
    body: 'If nobody shows and nobody sold it back, the table was still paid for, and that money goes to the restaurant at the end of the night. No card holds, no penalty emails, no chasing anyone. The empty seat simply stops being a loss.',
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
      'Book early and pay less for it.',
      'Change your mind and get most of it back.',
      'Most of the price is dinner you have already paid for.',
      'A table you cannot use costs you almost nothing.',
    ],
  },
  {
    who: 'For restaurants',
    lines: [
      'Every seat is paid for before service, not after.',
      'A no-show turns into revenue instead of a hole in the night.',
      'Every resale pays the house a cut, so reselling stops being the enemy.',
      'You see the room filling in real time, and what you are owed at the end.',
    ],
  },
];

export default function Home({ onEnter }: { onEnter: (e: React.MouseEvent) => void }) {
  const { scrollYProgress } = useScroll();

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
        <motion.div
          className="hero__inner"
          style={{ y: heroY, opacity: heroOpacity }}
          variants={group(0.09, 0.1)}
          initial="hidden"
          animate="show"
        >
          <motion.div className="hero__eyebrow" variants={fadeUp}>
            Tokenized reservations
          </motion.div>

          {/* the wordmark IS the hero. Everything else on this screen is a caption to it. */}
          <motion.h1 className="wordmark" variants={fadeUp}>
            <span className="wordmark__dots">
              <i />
              <i />
            </span>
            hora
          </motion.h1>

          <motion.p className="hero__sub" variants={fadeUp}>
            A restaurant table you can buy, price, and <span className="script">sell back</span>
            <br />
            right up until the night it's for.
          </motion.p>

          <motion.div className="ctas" variants={fadeUp}>
            <motion.a
              className="cta cta--ink"
              href={DEVPOST_URL}
              target="_blank"
              rel="noreferrer"
              whileHover={hoverLift}
              whileTap={tapPress}
            >
              Read the Devpost
              <span className="cta__arrow">&#8599;</span>
            </motion.a>
            <motion.a
              className="cta cta--coral"
              href="/demo"
              onClick={onEnter}
              whileHover={hoverLift}
              whileTap={tapPress}
            >
              See the demo
              <span className="cta__arrow">&#8594;</span>
            </motion.a>
          </motion.div>
        </motion.div>

        {/* scroll cue: it breathes on its own and disappears the instant you take the hint */}
        <motion.div
          className="cue"
          style={{ opacity: cueOpacity }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...ease(0.5), delay: 1.1 }}
        >
          <motion.span
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            &#8595;
          </motion.span>
        </motion.div>
      </div>

      {/* ============ the problem ============ */}
      <Section>
        <motion.div className="eyebrow" variants={reveal}>
          The problem
        </motion.div>
        <motion.h2 className="sec__title" variants={reveal}>
          A booking is a promise
          <br />
          with <span className="script">nothing</span> behind it.
        </motion.h2>
        <motion.p className="sec__lede" variants={reveal}>
          The hardest table in town costs the same as an empty Tuesday: nothing. So the good one
          gets hoarded and quietly resold in a group chat, the easy one gets abandoned at 7:58, and
          the restaurant pays for both. A reservation is one of the last genuinely scarce things
          nobody ever bothered to put a price on.
        </motion.p>
      </Section>

      {/* ============ how it works ============ */}
      <Section stagger={0.1}>
        <motion.div className="eyebrow" variants={reveal}>
          How it works
        </motion.div>
        <motion.h2 className="sec__title" variants={reveal}>
          Give the table a <span className="script">price</span>.
        </motion.h2>

        <div className="steps">
          {STEPS.map((s) => (
            <motion.article className="glass step" key={s.n} variants={reveal}>
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
        <motion.div className="eyebrow" variants={reveal}>
          See for yourself
        </motion.div>
        <motion.h2 className="sec__title" variants={reveal}>
          Watch the premium <span className="script">fade</span>.
        </motion.h2>
        <motion.p className="sec__lede" variants={reveal}>
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
        <motion.div className="eyebrow" variants={reveal}>
          Under the hood
        </motion.div>
        <motion.h2 className="sec__title" variants={reveal}>
          The guarantees are <span className="script">real</span>.
        </motion.h2>
        <motion.p className="sec__lede" variants={reveal}>
          Prices like these only work if the refund is certain, so the rules live somewhere nobody
          can quietly change them later — including us.
        </motion.p>

        <div className="tech">
          {TECH.map((t) => (
            <motion.article className="glass tech__card" key={t.label} variants={reveal}>
              <h3 className="tech__label">{t.label}</h3>
              <p className="muted tech__body">{t.body}</p>
            </motion.article>
          ))}
        </div>
      </Section>

      {/* ============ both sides ============ */}
      <Section stagger={0.1}>
        <motion.div className="eyebrow" variants={reveal}>
          Who it's for
        </motion.div>
        <motion.h2 className="sec__title" variants={reveal}>
          Both sides of the <span className="script">table</span>.
        </motion.h2>

        <div className="sides">
          {SIDES.map((s) => (
            <motion.article className="glass side" key={s.who} variants={reveal}>
              <h3 className="side__who">{s.who}</h3>
              <ul className="side__list">
                {s.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </motion.article>
          ))}
        </div>

        <motion.footer className="footnote home__footer" variants={reveal}>
          hora · tokenized restaurant reservations on an automated market maker.
        </motion.footer>
      </Section>
    </div>
  );
}
