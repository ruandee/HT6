/**
 * Party-size band selector (§4a). Each band is a separate pool with its own curve, because a
 * 2-top and a 6-top aren't interchangeable — that's what keeps the single-curve AMM honest.
 *
 * The token means "a table seating UP TO N", so we ask how many people are coming and book the
 * smallest band that fits. Booking a band larger than your party is disallowed (it would let
 * someone corner the scarcest inventory) unless every band that fits is sold out.
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

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Party of
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Array.from({ length: maxSeat }, (_, i) => i + 1).map((n) => {
          const band = bandFor(bands, n);
          const soldOut = !band || band.n_sold >= band.n_max;
          return (
            <button
              key={n}
              className={`guest ${guests === n ? 'guest--sel' : ''}`}
              onClick={() => onGuests(n)}
              disabled={!band}
              title={
                band
                  ? `Books the ${band.party_size}-top · ${usdc(band.buy_price)}${
                      soldOut ? ' · sold out' : ''
                    }`
                  : 'No table this size'
              }
            >
              {n}
            </button>
          );
        })}
      </div>

      {chosen && chosen.n_sold >= chosen.n_max && (
        <div
          style={{
            marginTop: 12,
            fontSize: 12.5,
            color: 'var(--coral-deep)',
            lineHeight: 1.5,
            fontWeight: 600,
          }}
        >
          Sold out this night.
        </div>
      )}
    </div>
  );
}
