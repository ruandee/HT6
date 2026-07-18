/**
 * Pool overview — every (night × party-size band) pool this venue issues (§4a). Each card is one
 * curve: its own fill, reserve, and current price, because a 2-top and a 6-top are not
 * interchangeable and so cannot share a curve (§4).
 *
 * Grouped by service window so the operator reads the room the way they run it: one night at a
 * time, bands side by side.
 */
import { Money } from './Money';
import { usdc, whenLabel, type IssuerPoolRow } from './api';

interface Props {
  pools: IssuerPoolRow[];
  selected: string;
  onSelect: (poolId: string) => void;
}

export function PoolGrid({ pools, selected, onSelect }: Props) {
  // group by service window; each group is one night, its bands side by side
  const nights = new Map<number, IssuerPoolRow[]>();
  for (const p of pools) {
    const g = nights.get(p.service_time);
    if (g) g.push(p);
    else nights.set(p.service_time, [p]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {[...nights.entries()].map(([serviceTime, band]) => (
        <div key={serviceTime}>
          <div className="eyebrow" style={{ marginBottom: 13 }}>
            {band[0]?.label ?? 'Service'} · {whenLabel(serviceTime)}
          </div>
          <div className="pool-grid">
            {band.map((p) => (
              <PoolCard
                key={p.pool_id}
                pool={p}
                selected={p.pool_id === selected}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PoolCard({
  pool,
  selected,
  onSelect,
}: {
  pool: IssuerPoolRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const pct = Math.round(pool.fill_pct * 100);
  const state = pool.settled ? 'settled' : pool.frozen ? 'in service' : 'selling';

  return (
    <button
      type="button"
      className={`glass pool-card ${selected ? 'pool-card--sel' : ''}`}
      onClick={() => onSelect(pool.pool_id)}
      aria-pressed={selected}
    >
      <div className="pool-card__top">
        {/* the token means "a table seating UP TO party_size" (§4a) */}
        <span className={`band ${pool.frozen ? 'band--frozen' : 'band--live'}`}>
          Seats {pool.party_size}
        </span>
        <Money base={pool.buy_price} />
      </div>

      <div className="meter" aria-hidden>
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginTop: 9,
          fontSize: 12,
          color: 'var(--ink-45)',
        }}
      >
        <span>
          <strong style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
            {pool.n_sold}/{pool.n_max}
          </strong>{' '}
          claimed · {pct}%
        </span>
        <span>{state}</span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 13,
          paddingTop: 12,
          borderTop: '1px solid var(--hairline)',
          fontSize: 11.5,
        }}
      >
        <span style={{ color: 'var(--ink-45)' }}>
          Reserve{' '}
          <strong style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
            {usdc(pool.reserve_balance)}
          </strong>
        </span>
        <span style={{ color: 'var(--ink-45)' }}>
          Royalties{' '}
          <strong style={{ color: 'var(--coral-deep)', fontVariantNumeric: 'tabular-nums' }}>
            {usdc(pool.royalties_accrued)}
          </strong>
        </span>
      </div>
    </button>
  );
}
