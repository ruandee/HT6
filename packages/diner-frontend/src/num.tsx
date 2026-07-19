/**
 * Numbers that change while you're looking at them.
 *
 * Clicking through nights and party sizes re-quotes the whole panel at once, and a price that
 * jumps from $46.20 to $58.90 in a single frame reads as a glitch rather than as a move along
 * the curve. Every figure here rides one spring instead: React sets a target, Framer writes the
 * digits straight into the DOM node. A re-quote costs one render and the count that follows
 * costs none, which is why this stays smooth even while the 2.5s poll is running.
 *
 * The type is already tabular (.price, .stat-label), so the width is fixed and nothing beside a
 * counting number reflows mid-count.
 *
 * Reduced motion is handled globally by <MotionConfig reducedMotion="user"> in App; springs
 * resolve to an immediate set, so the figure just lands.
 */
import { motion, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useEffect, useRef } from 'react';

/** Quick enough to answer the click, damped enough that money never bounces past itself. */
const SPRING = { stiffness: 260, damping: 34, mass: 0.7, restDelta: 0.004 } as const;

/**
 * A motion value that chases `to`. The FIRST real figure lands instantly rather than counting
 * up from zero — on load there's no previous number, so there's nothing to travel from.
 */
function useTweened(to: number, live = true): MotionValue<number> {
  const mv = useSpring(to, SPRING);
  const seen = useRef(false);
  useEffect(() => {
    if (!live) return;
    if (seen.current) mv.set(to);
    else {
      seen.current = true;
      mv.jump(to);
    }
  }, [live, mv, to]);
  return mv;
}

/** A whole number that counts to its next value: "6 of 20 taken", "3 left". */
export function Num({ value }: { value: number }) {
  const text = useTransform(useTweened(value), (v) => String(Math.round(v)));
  return <motion.span>{text}</motion.span>;
}

/**
 * USDC base units as $dd.cc. Dollars and cents come off the same spring and are derived from one
 * rounded cent count, so the pair can never disagree by a frame ($45.99 -> $46.00, never $45.00).
 */
export function Price({ base, className }: { base?: string; className?: string }) {
  const cents = useTransform(
    useTweened(base ? Number(base) / 1e6 : 0, !!base),
    (v) => Math.max(0, Math.round(v * 100)),
  );
  const dollars = useTransform(cents, (c) => Math.floor(c / 100).toLocaleString());
  const frac = useTransform(cents, (c) => `.${String(c % 100).padStart(2, '0')}`);

  return (
    <span className={className} style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
      <span>${base ? <motion.span>{dollars}</motion.span> : '—'}</span>
      <span className="price__cents">{base ? <motion.span>{frac}</motion.span> : '.00'}</span>
    </span>
  );
}
