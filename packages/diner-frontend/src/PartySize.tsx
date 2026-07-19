/**
 * Party-size selector (§4a). Each band is a separate pool with its own curve, because a
 * 2-top and a 6-top aren't interchangeable, which is what keeps the single-curve AMM honest.
 *
 * The diner picks a headcount, never a table size. The token means "a table seating UP TO N", so
 * we book the smallest band that fits and say which one that was underneath. Booking a band
 * larger than your party is disallowed (it would let someone corner the scarcest inventory)
 * unless every band that fits is sold out.
 */
import { usdc, type PoolSummary } from './api';

interface Props {
  /** all pools for the selected date, one per band. */
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
  const soldOut = !!chosen && chosen.n_sold >= chosen.n_max;

  return (
    <div>
      <label className="eyebrow" htmlFor="guests" style={{ display: 'block', marginBottom: 12 }}>
        How many people?
      </label>

      <div className="psize">
        <select
          id="guests"
          className="psize__select"
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
          width="14"
          height="9"
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

      <div className="psize__routed" style={{ minHeight: 20 }}>
        {chosen &&
          (soldOut ? (
            <span style={{ color: 'var(--coral-deep)', fontWeight: 600 }}>
              The {chosen.party_size}-top is sold out this night.
            </span>
          ) : (
            <>
              Books the <strong>{chosen.party_size}-top</strong> · {usdc(chosen.buy_price)}
            </>
          ))}
      </div>
    </div>
  );
}
