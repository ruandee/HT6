/**
 * Shared motion vocabulary, using the same curve and distance scale as the other three apps, so the
 * launcher's entrance reads as the same system the moment before you land in one of them.
 *
 * Call spatial variants with the user's reduced-motion preference. Raw `transform` strings run
 * on the compositor, but Framer cannot classify them as positional on its own.
 */
import type { Transition, Variants } from 'framer-motion';

/** strong decelerate, the same curve the stylesheet uses for hovers */
export const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

// The long reveal is marketing-only; routine screen entrances stay under 300ms.
export const DUR = { quick: 0.16, base: 0.24, slow: 0.5 } as const;

export const ease = (duration: number = DUR.base): Transition => ({ duration, ease: EASE });

/** the workhorse: rise-and-fade for anything arriving on mount */
export const fadeUp = (reduced = false): Variants => ({
  hidden: { opacity: 0, transform: reduced ? 'none' : 'translateY(8px)' },
  show: { opacity: 1, transform: reduced ? 'none' : 'translateY(0)', transition: ease() },
  exit: {
    opacity: 0,
    transform: reduced ? 'none' : 'translateY(-6px)',
    transition: ease(DUR.quick),
  },
});

/** a container that releases its children one after another */
export const group = (staggerChildren = 0.05, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/**
 * Hover and press for anything clickable, matching the three apps.
 *
 * Springs rather than durations. A spring settles instead of arriving on a schedule, so a pointer
 * that leaves halfway through reverses from wherever the lift got to instead of snapping back to
 * the start. That continuity is most of what makes a hover feel like a physical object.
 */
export const hoverLift = {
  transform: 'translateY(-2px)',
  transition: { type: 'spring', stiffness: 220, damping: 24, mass: 1 },
} as const;

export const tapPress = {
  transform: 'scale(0.97)',
  transition: { type: 'spring', stiffness: 700, damping: 36, mass: 0.6 },
} as const;

/**
 * Scroll reveal. Travel is longer than fadeUp (18px vs 8px) because this fires on a section the
 * viewport is arriving at rather than an element appearing in place, so it has further to come
 * before it reads as "arriving" at all.
 */
export const reveal = (reduced = false): Variants => ({
  hidden: { opacity: 0, transform: reduced ? 'none' : 'translateY(18px)' },
  show: {
    opacity: 1,
    transform: reduced ? 'none' : 'translateY(0)',
    transition: ease(DUR.slow),
  },
});

/** viewport config for scroll reveals: fire once, a little before the section is fully on screen */
export const inView = { once: true, amount: 0.25 } as const;
