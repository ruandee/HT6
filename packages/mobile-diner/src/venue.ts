/**
 * The header line for a diner surface: which room, and what the room is doing.
 *
 * This replaced a slogan ("The good tables go fast"). A diner who has opened the app is already
 * sold, so the top of the page is better spent orienting them than pitching them — and the pitch
 * now lives on the landing page, which is the only surface that has an unsold reader.
 *
 * The state word is DERIVED, never written. The old mobile copy said "filling up" whether the room
 * was empty or gone, which is the kind of thing a judge notices once and then distrusts everything
 * else on the screen.
 */
import type { PoolSummary } from './api';

export type Fill = 'quiet' | 'filling up' | 'nearly full' | 'almost gone';

/**
 * Thresholds are on the fraction of the *whole night* sold, not the band you happen to be looking
 * at. "The room is filling" is a claim about the room; a 4-top band selling out while the 2-tops
 * sit empty is not a full restaurant.
 *
 * Every word fits the frame "<venue> is ___." so the headline never has to branch on grammar.
 *
 * The cut points are deliberately not evenly spaced. A restaurant a day out with a quarter of the
 * room committed is genuinely filling — "quiet" is single digits, not 25%. Spacing them evenly
 * would park almost every real night in one bucket and make the word decorative, which is the
 * failure mode this whole helper exists to avoid.
 */
export function fillWord(sold: number, cap: number): Fill {
  if (cap === 0) return 'quiet';
  const pct = sold / cap;
  if (pct >= 0.85) return 'almost gone';
  if (pct >= 0.6) return 'nearly full';
  if (pct >= 0.25) return 'filling up';
  return 'quiet';
}

export interface VenueState {
  name: string;
  fill: Fill;
  sold: number;
  cap: number;
}

/** Totals across every band on the selected night. */
export function venueState(bandsTonight: PoolSummary[], fallbackName = 'the room'): VenueState {
  const sold = bandsTonight.reduce((n, p) => n + p.n_sold, 0);
  const cap = bandsTonight.reduce((n, p) => n + p.n_max, 0);
  return {
    name: bandsTonight[0]?.venue_name ?? fallbackName,
    fill: fillWord(sold, cap),
    sold,
    cap,
  };
}
