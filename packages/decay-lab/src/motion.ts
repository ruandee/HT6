/**
 * Shared motion vocabulary. One easing curve and one distance scale, so every entrance in the app
 * belongs to the same system.
 *
 * Distances stay small (4 to 8px) on purpose. The job is to take the edge off a state change
 * without drawing attention to the animation. If you notice it, it's too much.
 *
 * Call spatial variants with the user's reduced-motion preference. Raw `transform` strings run
 * on the compositor, but Framer cannot classify them as positional on its own.
 */
import type { Transition, Variants } from 'framer-motion';

/** strong decelerate, the same curve the stylesheet uses for controls */
export const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const DUR = { quick: 0.16, base: 0.24, slow: 0.28 } as const;

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

/** panel swap, with shorter travel than fadeUp because this one fires on every click */
export const swap = (reduced = false): Variants => ({
  hidden: { opacity: 0, transform: reduced ? 'none' : 'translateY(6px)' },
  show: { opacity: 1, transform: reduced ? 'none' : 'translateY(0)', transition: ease(0.22) },
  exit: { opacity: 0, transform: reduced ? 'none' : 'translateY(-4px)', transition: ease(0.16) },
});

/** a container that releases its children one after another */
export const group = (staggerChildren = 0.05, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/** shared-element spring for anything that travels between two slots */
export const pill: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };

/**
 * Hover and press for anything clickable, matching the three apps.
 *
 * Springs rather than durations. A spring settles instead of arriving on a schedule, so a pointer
 * that leaves halfway through reverses from wherever the lift got to instead of snapping back to
 * the start. That continuity is most of what makes a hover feel like a physical object.
 *
 * ---- why these are `y` and `scale`, not `transform` strings ----
 *
 * They used to be `transform: 'translateY(-2px)'` and `transform: 'scale(0.97)'`. Both wrote the
 * same CSS property, with different functions in it — so pressing a button that was already
 * hovered asked Framer to interpolate the string `translateY(-2px)` into the string
 * `scale(0.97)`. It does that positionally: it walks the numbers, -2 toward 0.97, and swaps the
 * function name partway. Sampling the inline transform through a press caught it going
 *
 *     translateY(-2px) -> translateY(-0.27px) -> scale(0.58) -> scale(0.97)
 *
 * so the control collapsed to 58% of its size and sprang back. On a small button with an icon in
 * it that reads as a spin rather than a press, which is exactly how it was reported.
 *
 * Given as separate motion values, hover owns `y` and press owns `scale`. They are different
 * transform channels, composed rather than interpolated between, so neither can turn into the
 * other on the way. It also lets <MotionConfig reducedMotion="user"> recognise both as spatial
 * and drop them, which a raw string hides from it.
 */
export const hoverLift = {
  y: -2,
  transition: { type: 'spring', stiffness: 220, damping: 24, mass: 1 },
} as const;

export const tapPress = {
  scale: 0.97,
  transition: { type: 'spring', stiffness: 700, damping: 36, mass: 0.6 },
} as const;
