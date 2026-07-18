/**
 * Pool detail — fill, reserve, holders, and ROYALTIES ACCRUED.
 *
 * The royalty number is the cooperative-issuer pitch (§4, demo step 3): every resale leaves the φ
 * spread in the contract, routed to the restaurant. That is why the venue WANTS a liquid resale
 * market instead of fighting one — so the number is sized to read from across a room.
 *
 * Check-in (§10.4) marks a diner arrived, which triggers redeem: the token burns and their USDC
 * stays in the reserve to be swept after service (§7c-B CONSUMED).
 */
import { useState } from 'react';
import { Money } from './Money';
import { usdc, whenLabel, type IssuerPoolDetail } from './api';

interface Props {
  pool: IssuerPoolDetail;
  onCheckin: (userId: string) => Promise<void>;
  busy: string | null;
}

export function PoolDetail({ pool, onCheckin, busy }: Props) {
  const [filter, setFilter] = useState('');
  const pct = Math.round(pool.fill_pct * 100);

  const holders = pool.holders.filter((h) =>
    filter ? h.user_id.toLowerCase().includes(filter.toLowerCase()) : true,
  );
  const arrived = pool.holders.filter((h) => h.status === 'redeemed').length;
  const awaiting = pool.holders.filter((h) => h.status === 'held').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ---- the cooperative-issuer moment: royalties accrued, front and centre ---- */}
      <section className="glass glass--strong" style={{ padding: 30 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              Royalties accrued · {pool.label} · seats {pool.party_size}
            </div>
            <Money base={pool.royalties_accrued} variant="hero" />
            <p className="muted" style={{ maxWidth: 430, marginTop: 16, fontSize: 13.5 }}>
              Your {(pool.phi_bps / 100).toFixed(1)}% spread on every resale. The curve is the
              counterparty, so holders who can&apos;t make it sell back instantly — and you earn on
              the resale instead of <span className="script">fighting</span> it.
            </p>
          </div>

          <div style={{ minWidth: 220, flex: '0 1 auto' }}>
            <div className="kpis" style={{ gridTemplateColumns: '1fr' }}>
              <div className="glass kpi">
                <div className="stat-label">Reserve balance</div>
                <Money base={pool.reserve_balance} variant="kpi" />
                <div className="kpi__sub">
                  Σ paid by outstanding tables — the solvency invariant. Sell-backs can always be
                  honored.
                </div>
              </div>
              <div className="glass kpi">
                <div className="stat-label">Current price</div>
                <Money base={pool.buy_price} variant="kpi" />
                <div className="kpi__sub">
                  Floor {usdc(pool.p0)} + premium · θ {(pool.theta_bps / 100).toFixed(0)}%
                  {pool.frozen ? ' · trading halted' : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- fill + operational stats ---- */}
      <section className="glass" style={{ padding: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 15 }}>
          Fill · {whenLabel(pool.service_time)}
        </div>
        <div
          style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 40,
              letterSpacing: '-0.035em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            {pool.n_sold}
            <span style={{ color: 'var(--ink-45)', fontSize: '0.5em' }}> / {pool.n_max}</span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 24,
              color: 'var(--coral-deep)',
              letterSpacing: '-0.03em',
            }}
          >
            {pct}%
          </div>
        </div>
        <div className="meter" style={{ height: 10, marginTop: 14 }} aria-hidden>
          <div className="meter__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="pips" style={{ marginTop: 16 }}>
          {Array.from({ length: pool.n_max }, (_, i) => (
            <span key={i} className={`pip ${i < pool.n_sold ? 'pip--sold' : ''}`} />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 24,
            marginTop: 18,
            paddingTop: 15,
            borderTop: '1px solid var(--hairline)',
            fontSize: 12.5,
            color: 'var(--ink-45)',
            flexWrap: 'wrap',
          }}
        >
          <span>
            Arrived <strong style={{ color: 'var(--ink)' }}>{arrived}</strong>
          </span>
          <span>
            Awaiting <strong style={{ color: 'var(--ink)' }}>{awaiting}</strong>
          </span>
          <span>
            Credits to honor{' '}
            <strong style={{ color: 'var(--ink)' }}>{usdc(pool.credits_to_honor)}</strong>
          </span>
          <span>
            Sell-back now <strong style={{ color: 'var(--ink)' }}>{usdc(pool.sell_payout)}</strong>
          </span>
        </div>
      </section>

      {/* ---- holders / check-in ---- */}
      <section className="glass" style={{ padding: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <div className="eyebrow" style={{ flex: 1, minWidth: 160 }}>
            Holders · check in on arrival
          </div>
          <input
            className="input"
            style={{ width: 180 }}
            placeholder="Find a diner"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter holders"
          />
        </div>

        {holders.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5 }}>
            {pool.holders.length === 0
              ? 'No tables claimed on this pool yet.'
              : 'No diner matches that search.'}
          </p>
        ) : (
          <div className="rows scroll-y">
            {holders.map((h) => (
              <div className="row" key={h.user_id}>
                <span className="row__id">{h.user_id}</span>
                {h.status === 'redeemed' ? (
                  <span className="tag tag--redeemed">Arrived</span>
                ) : pool.frozen ? (
                  // frozen and never checked in = a no-show; it forfeits at sweep (§7c-B)
                  <span className="tag tag--noshow">No-show</span>
                ) : (
                  <>
                    <span className="tag tag--held">Holding</span>
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={() => onCheckin(h.user_id)}
                      disabled={busy === h.user_id}
                    >
                      {busy === h.user_id ? '…' : 'Check in'}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
