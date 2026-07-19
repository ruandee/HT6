/** Shared easing for the few purposeful transitions that remain. */
import type { Transition } from 'framer-motion';

/** Strong ease-out: immediate response, gentle landing. */
export const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const ease = (duration = 0.2): Transition => ({ duration, ease: EASE });
