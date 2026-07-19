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

/** strong decelerate, shared by routine entrances and state changes */
export const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const DUR = { quick: 0.16, base: 0.24, slow: 0.28 } as const;

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
  show: { opacity: 1, y: 0, transition: ease(0.22) },
  exit: { opacity: 0, y: -4, transition: ease(0.16) },
};

/** a container that releases its children one after another */
export const group = (staggerChildren = 0.05, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/** shared-element spring for the tab pill: quick, with barely any overshoot */
export const pill: Transition = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 };
