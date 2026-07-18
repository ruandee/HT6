/**
 * Party-size picker. Each band is a separate pool with its own curve, because a 2-top and a
 * 4-top aren't interchangeable — that's what keeps the single-curve pricing honest (§4a).
 *
 * Bands are read straight off the API response for the selected night, never hardcoded, so the
 * server adding or removing a band needs no change here. Rendered as two large cards because
 * the product currently offers a table for 2 and a table for 4.
 */
import { splitUsdc, type PoolSummary } from './api';

export function BandPicker({
  bands,
  selected,
  onSelect,
}: {
  /** every pool for the selected night, one per band. */
  bands: PoolSummary[];
  selected: string;
  onSelect: (poolId: string) => void;
}) {
  const sorted = [...bands].sort((a, b) => a.party_size - b.party_size);

  return (
    <div className="bands">
      {sorted.map((b) => {
        const left = b.n_max - b.n_sold;
        const soldOut = left <= 0;
        const p = splitUsdc(b.buy_price);
        return (
          <button
            key={b.pool_id}
            className={`band ${b.pool_id === selected ? 'band--sel' : ''}`}
            onClick={() => onSelect(b.pool_id)}
            disabled={soldOut && b.pool_id !== selected}
          >
            <span className="band__seats">Table for {b.party_size}</span>
            <span className="band__price">${p.dollars}</span>
            <span className="band__left">
              {soldOut ? 'Fully booked' : left <= 3 ? `Only ${left} left` : `${left} left`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
