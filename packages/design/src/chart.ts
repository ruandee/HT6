/**
 * Chart paint.
 *
 * These are the only colours in the system that have to exist as literals rather than as CSS
 * custom properties, and it is worth being precise about why: Recharts renders SVG and takes
 * paint values as props (`stroke`, `fill`, `stopColor`), which are resolved by the SVG renderer
 * and not by the cascade. `var(--accent-deep)` in a `stroke` prop is simply invalid paint.
 *
 * That is exactly why these drifted. Under the previous palette the same three hex literals were
 * pasted into three separate chart components, so recolouring the product recoloured two of them
 * and left the third on the old ramp until someone noticed. There is now one copy, here, and the
 * values below mirror the ramp in tokens.css.
 *
 * Keep them in step by hand when the ramp moves — `npm run lint:tokens` checks that no OTHER
 * file grows a colour literal, but it cannot check that this file agrees with the CSS.
 */

/** The curve's stroke: olive at the far end of the night, pine at the door. */
export const CHART_STROKE = [
  { offset: '0%', color: '#CCD68F' }, // --accent-warm
  { offset: '55%', color: '#7E9E6C' }, // between --accent and --accent-mid
  { offset: '100%', color: '#3A5734' }, // --accent-deep
] as const;

/** The area under the curve, fading to nothing rather than to a colour. */
export const CHART_FILL = {
  top: '#7E9E6C',
  topOpacity: 0.26,
  bottom: '#E9EED6', // --accent-pale
  bottomOpacity: 0,
} as const;

export const CHART = {
  /** the dot marking where the scrubber is */
  cursor: '#3A5734',
  /** the meal-credit floor the whole thing collapses onto */
  floor: 'rgba(18,21,15,0.28)',
  /** what a holder actually walks away with, always under the buy line */
  payout: 'rgba(18,21,15,0.3)',
  /** a ghost of where the curve started, drawn only once decay has something to say */
  ghost: 'rgba(18,21,15,0.22)',
  /** the vertical marking the start of the decay window */
  onset: 'rgba(58,87,52,0.4)',
  onsetLabel: 'rgba(58,87,52,0.85)',
  /** hover crosshair */
  cursorLine: 'rgba(18,21,15,0.28)',
  /** reference-line captions */
  label: 'rgba(18,21,15,0.5)',
} as const;

/**
 * Axis tick styling.
 *
 * 0.5, not lower. At 10px these are the first thing on the chart to become unreadable, and axis
 * labels are not decoration — a curve with an illegible scale is a picture of a curve.
 */
export const AXIS = {
  fontSize: 10,
  fill: 'rgba(18,21,15,0.5)',
  fontFamily: 'Archivo',
} as const;
