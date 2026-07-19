/**
 * Party-size picker. Each band is a separate pool with its own curve, because a 2-top and a
 * 4-top aren't interchangeable, which is what keeps the single-curve pricing honest (§4a).
 *
 * The diner picks a headcount, never a table size. We route to the smallest band that seats them
 * and name it underneath, so the bands on offer never have to be explained. Bands come straight
 * off the API response for the selected night, never hardcoded, so the server adding or removing
 * one needs no change here.
 *
 * A native <select> on purpose: on a phone that is the OS wheel picker, which is thumb-reachable,
 * scrollable at speed, and already familiar. Nothing hand-rolled competes with it.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { usdc, type PoolSummary } from './api';
import { ease } from './motion';

interface Props {
  /** every pool for the selected night, one per band. */
  bands: PoolSummary[];
  guests: number;
  onGuests: (n: number) => void;
}

/** smallest band that seats `guests` and still has tables; falls back to any band that fits. */
export function bandFor(bands: PoolSummary[], guests: number): PoolSummary | undefined {
  const fits = bands
    .filter((b) => b.party_size >= guests)
    .sort((a, b) => a.party_size - b.party_size);
  return fits.find((b) => b.n_sold < b.n_max) ?? fits[0];
}

export function PartySize({ bands, guests, onGuests }: Props) {
  const maxSeat = Math.max(0, ...bands.map((b) => b.party_size));
  const chosen = bandFor(bands, guests);
  const left = chosen ? chosen.n_max - chosen.n_sold : 0;

  return (
    <div>
      <div className="psize">
        <select
          className="psize__select"
          aria-label="How many people"
          value={guests}
          onChange={(e) => onGuests(Number(e.target.value))}
        >
          {Array.from({ length: maxSeat }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n} disabled={!bandFor(bands, n)}>
              {n} {n === 1 ? 'guest' : 'guests'}
            </option>
          ))}
        </select>
        <svg
          className="psize__chev"
          width="15"
          height="10"
          viewBox="0 0 14 9"
          fill="none"
          aria-hidden
        >
          <path
            d="M1 1.5 7 7.5l6-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* the routing, said out loud. Keyed on the band, so changing headcount within the same
          table size reads as "nothing moved" rather than a flicker. */}
      <div className="psize__routed" style={{ minHeight: 20 }}>
        <AnimatePresence mode="wait" initial={false}>
          {chosen && (
            <motion.span
              key={chosen.pool_id}
              style={{ display: 'block' }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={ease(0.24)}
            >
              {left <= 0 ? (
                <span style={{ color: 'var(--coral-deep)', fontWeight: 600 }}>
                  The {chosen.party_size}-top is fully booked.
                </span>
              ) : (
                <>
                  Books the <strong>{chosen.party_size}-top</strong> · {usdc(chosen.buy_price)} ·{' '}
                  {left <= 3 ? `only ${left} left` : `${left} left`}
                </>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
