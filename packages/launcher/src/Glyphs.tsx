/**
 * Three device glyphs, hand-drawn as SVG instead of pulled from an icon set. An icon
 * dependency for three shapes isn't worth it, and drawing them together keeps the stroke
 * weight, corner radius, and optical size consistent across the row.
 *
 * All three: 1.5px stroke on a 32x28 box, currentColor so the card's hover state tints them.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** desktop diner: a monitor on a stand */
export function Desktop() {
  return (
    <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true">
      <rect x="2" y="3" width="30" height="19" rx="3" {...stroke} />
      <path d="M13 26h8M17 22v4" {...stroke} />
    </svg>
  );
}

/** mobile diner: a phone, with the speaker slot that makes it read as a phone at 30px */
export function Phone() {
  return (
    <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true">
      <rect x="11" y="1" width="12" height="28" rx="3" {...stroke} />
      <path d="M15.5 4.5h3" {...stroke} />
    </svg>
  );
}

/**
 * the restaurant: a host stand, a podium with the book open on top. Chosen over a chef's hat
 * or storefront because the dashboard is the *front* of the house, where the night gets sold.
 */
export function Counter() {
  return (
    <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true">
      <path d="M6 11h22l-2.5 17h-17L6 11z" {...stroke} />
      <path d="M11 11V7a6 6 0 0 1 12 0v4" {...stroke} />
      <path d="M13 18h8" {...stroke} />
    </svg>
  );
}
