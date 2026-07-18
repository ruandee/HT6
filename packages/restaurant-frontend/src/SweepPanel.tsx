/**
 * Sweep — the §7c-B settlement, and demo step 5.
 *
 * At service time the pool freezes and every outstanding token is in exactly one terminal state:
 *   CONSUMED  — diner checked in (redeem fired). Their USDC sweeps to the restaurant, and the
 *               meal-credit floor (p0) is honored against their bill off-chain.
 *   FORFEITED — no-show: never checked in, never sold back. Their USDC sweeps in full. This is
 *               the no-show recovery, and it is the whole point of the product.
 *   SOLD-BACK — already settled at sell time (φ retained). Not part of sweep.
 *
 * So FORFEITED is the hero number: money that used to be a pure loss, now revenue.
 */
import { Money } from './Money';
import { usdc, type IssuerPoolDetail, type SweepResponse } from './api';

interface Props {
  pool: IssuerPoolDetail;
  onSweep: () => Promise<void>;
  onFreeze: () => Promise<void>;
  busy: boolean;
}

export function SweepPanel({ pool, onSweep, onFreeze, busy }: Props) {
  const swept = pool.swept;

  // Before settlement we can only PREVIEW the split from current state.
  const preview: SweepResponse = {
    amount_swept: (BigInt(pool.reserve_balance) + BigInt(pool.royalties_accrued)).toString(),
    consumed_count: pool.consumed_count,
    forfeited_count: pool.forfeited_pending,
    credits_to_honor: pool.credits_to_honor,
  };
  const s = swept ?? preview;
  const recovered = recoveredValue(pool, s);

  return (
    <section className="glass glass--strong" style={{ padding: 32 }}>
      <div className="eyebrow" style={{ marginBottom: 22 }}>
        {swept ? 'Settled' : pool.frozen ? 'Ready to sweep' : 'Sweep preview · service not reached'}
      </div>

      {/* THE hero: no-shows that became revenue */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 'clamp(96px, 14vw, 180px)',
              lineHeight: 0.82,
              letterSpacing: '-0.05em',
              color: 'var(--coral-deep)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {s.forfeited_count}
          </div>
        </div>
        <div style={{ paddingBottom: 10, maxWidth: 380 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            No-shows recovered
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 14 }}>
            {s.forfeited_count === 0 ? (
              <>Every table was claimed or checked in. Nothing forfeited this service.</>
            ) : (
              <>
                {s.forfeited_count} table{s.forfeited_count === 1 ? '' : 's'} paid for and never
                walked in. That used to be a{' '}
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>pure loss</span>. It is now{' '}
                <span className="script" style={{ fontSize: '1.5em' }}>
                  revenue
                </span>
                {' '}— {usdc(recovered)} of it.
              </>
            )}
          </p>
        </div>
      </div>

      {/* the full §7c-B partition */}
      <div className="sweep-split">
        <div className="sweep-cell">
          <div className="stat-label">Total swept</div>
          <Money base={s.amount_swept} variant="cell" />
          <div className="kpi__sub">Reserve + accrued royalties, to your wallet.</div>
        </div>
        <div className="sweep-cell">
          <div className="stat-label">Consumed</div>
          <div className="sweep-cell__value">{s.consumed_count}</div>
          <div className="kpi__sub">Diners who checked in and dined.</div>
        </div>
        <div className="sweep-cell">
          <div className="stat-label">Forfeited</div>
          <div className="sweep-cell__value" style={{ color: 'var(--coral-deep)' }}>
            {s.forfeited_count}
          </div>
          <div className="kpi__sub">No-shows. Their USDC sweeps in full.</div>
        </div>
        <div className="sweep-cell">
          <div className="stat-label">Meal credits to honor</div>
          <Money base={s.credits_to_honor} variant="cell" />
          <div className="kpi__sub">
            {usdc(pool.p0)} × {s.consumed_count} — applied against their bill at the table.
          </div>
        </div>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
        {!swept && !pool.frozen && (
          <button className="btn btn--ghost" onClick={onFreeze} disabled={busy}>
            Advance to service time
          </button>
        )}
        {!swept && (
          <button
            className="btn btn--primary"
            onClick={onSweep}
            disabled={busy || !pool.frozen}
            title={pool.frozen ? undefined : 'The pool must reach service time before it can settle'}
          >
            {busy ? 'Settling…' : 'Sweep reserve'}
          </button>
        )}
        {swept && (
          <div className="muted" style={{ fontSize: 13.5 }}>
            Settled. {usdc(swept.amount_swept)} transferred to your wallet; the diner still gets
            their credit.
          </div>
        )}
      </div>

      {!pool.frozen && !swept && (
        <p className="hint" style={{ marginTop: 14 }}>
          Trading halts at service time (θ → 0). Sweep only settles once the pool is frozen — these
          numbers are a live preview until then.
        </p>
      )}
    </section>
  );
}

/**
 * On-chain value attributable to the no-shows. Each forfeited token swept whatever it paid in;
 * we don't get a per-token breakdown back from sweep, so approximate with the pool's average
 * paid-in per outstanding token. Honest framing: it's the recovered slice of the reserve.
 */
function recoveredValue(pool: IssuerPoolDetail, s: SweepResponse): string {
  const outstanding = s.consumed_count + s.forfeited_count;
  if (outstanding === 0) return '0';
  const total = BigInt(s.amount_swept);
  return ((total * BigInt(s.forfeited_count)) / BigInt(outstanding)).toString();
}
