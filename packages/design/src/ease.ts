/**
 * The one shared easing curve, and the duration scale that goes with it.
 *
 * Deliberately narrow. The five clients each keep their own `motion.ts` with their own variants,
 * and that is not duplication waiting to be cleaned up — the mobile app's is a seven-line stub
 * because a phone gets almost no entrance animation, and the launcher branches on reduced motion
 * per variant while the diner relies on a global <MotionConfig reducedMotion="user">. Collapsing
 * those into one module would produce a shared abstraction that no surface actually wants and
 * nobody owns.
 *
 * What IS genuinely common is the curve. If a CSS hover and a Framer entrance land on the same
 * element and decelerate differently, the element reads as two objects. So the curve lives here
 * and matches `--ease` in tokens.css exactly.
 */

/** strong decelerate: immediate response, gentle landing */
export const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

/**
 * Durations. `slow` is marketing-only — routine screen entrances stay under 300ms, because past
 * that the animation stops taking the edge off a state change and starts being the state change.
 */
export const DUR = { quick: 0.16, base: 0.24, slow: 0.5 } as const;
