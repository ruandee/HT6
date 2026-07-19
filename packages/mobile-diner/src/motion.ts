/**
 * Shared motion vocabulary. One easing curve and one distance scale, so every entrance in the app
 * belongs to the same system.
 *
 * Distances stay small (4 to 8px) on purpose. The job is to take the edge off a state change
 * without drawing attention to the animation. If you notice it, it's too much.
 *
 * Reduced motion is handled once, globally, by <MotionConfig reducedMotion="user"> in App.
 * Framer then drops the transforms and keeps opacity, so nothing here needs to branch on it.
 */
import type { Transition, Variants } from 'framer-motion';

/** soft decelerate, the same curve the stylesheet already uses for hovers and meters */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const DUR = { quick: 0.22, base: 0.42, slow: 0.62 } as const;

export const ease = (duration: number = DUR.base): Transition => ({ duration, ease: EASE });

/** the workhorse: rise-and-fade for anything arriving on mount */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: ease() },
  exit: { opacity: 0, y: -6, transition: ease(DUR.quick) },
};

/** panel swap, with shorter travel than fadeUp because this one fires on every click */
export const swap: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: ease(0.3) },
  exit: { opacity: 0, y: -4, transition: ease(0.16) },
};

/** a container that releases its children one after another */
export const group = (staggerChildren = 0.05, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/** shared-element spring for anything that travels between two slots */
export const pill: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };

/**
 * Hover and press for anything clickable.
 *
 * Springs rather than durations. A spring settles instead of arriving on a schedule, so a pointer
 * that leaves halfway through reverses from wherever the lift got to instead of snapping back to
 * the start. That continuity is most of what makes a hover feel like a physical object.
 *
 * The lift is slow and small; the press is fast. Anything the pointer merely passes over should
 * take its time, and anything it commits to should answer immediately.
 */
export const hoverLift = {
  y: -2,
  transition: { type: 'spring', stiffness: 220, damping: 24, mass: 1 },
} as const;

export const tapPress = {
  scale: 0.985,
  transition: { type: 'spring', stiffness: 700, damping: 36, mass: 0.6 },
} as const;
