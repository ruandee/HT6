/**
 * Sweep: the §7c-B settlement, and demo step 5.
 *
 * At service time the pool freezes and every outstanding token is in exactly one terminal state:
 *   CONSUMED:  diner checked in (redeem fired). Their USDC sweeps to the restaurant, and the
 *               meal-credit floor (p0) is honored against their bill off-chain.
 *   FORFEITED: no-show, never checked in and never sold back. Their USDC sweeps in full. This is
 *               the no-show recovery, and it is the whole point of the product.
 *   SOLD-BACK: already settled at sell time (φ retained). Not part of sweep.
 *
 * So FORFEITED is the hero number: money that used to be a pure loss, now revenue.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Money } from './Money';
import { usdc, type IssuerPoolDetail, type SweepResponse } from './api';
import { ease } from './motion';

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
        {swept ? 'Settled' : pool.frozen ? 'Ready to sweep' : "Preview · service hasn't started"}
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
              color: 'var(--accent-deep)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {/* the count rolls over when the pool freezes and again at sweep, keyed on the
                value so it only moves when the number actually changes */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={s.forfeited_count}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={ease(0.24)}
                style={{ display: 'inline-block' }}
              >
                {s.forfeited_count}
              </motion.span>
            </AnimatePresence>
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
              <>Everyone showed up. Nothing forfeited tonight.</>
            ) : (
              <>
                {s.forfeited_count} table{s.forfeited_count === 1 ? '' : 's'} paid for, nobody came.
                That used to be a{' '}
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>pure loss</span>. Tonight
                it&apos;s{' '}
                <span className="script" style={{ fontSize: '1.5em' }}>
                  revenue
                </span>
                {' '}of {usdc(recovered)}.
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
          <div className="kpi__sub">Reserve plus royalties.</div>
        </div>
        <div className="sweep-cell">
          <div className="stat-label">Dined</div>
          <div className="sweep-cell__value">{s.consumed_count}</div>
        </div>
        <div className="sweep-cell">
          <div className="stat-label">Forfeited</div>
          <div className="sweep-cell__value" style={{ color: 'var(--accent-deep)' }}>
            {s.forfeited_count}
          </div>
          <div className="kpi__sub">You keep what they paid.</div>
        </div>
        <div className="sweep-cell">
          <div className="stat-label">Credits to honor</div>
          <Money base={s.credits_to_honor} variant="cell" />
          <div className="kpi__sub">
            {usdc(pool.p0)} × {s.consumed_count}, off their bill.
          </div>
        </div>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
        {!swept && !pool.frozen && (
          <motion.button
            className="btn btn--ghost"
            whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
            onClick={onFreeze}
            disabled={busy}
          >
            Advance to service time
          </motion.button>
        )}
        {!swept && (
          <motion.button
            className="btn btn--primary"
            whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
            onClick={onSweep}
            disabled={busy || !pool.frozen}
            title={pool.frozen ? undefined : 'Service time has to pass first'}
          >
            {busy ? 'Settling…' : 'Sweep reserve'}
          </motion.button>
        )}
        {swept && (
          <div className="muted" style={{ fontSize: 13.5 }}>
            Settled. {usdc(swept.amount_swept)} is in your wallet. Diners still get their credit.
          </div>
        )}
      </div>

      {!pool.frozen && !swept && (
        <p className="hint" style={{ marginTop: 14 }}>
          These numbers move until service time. You can settle after that.
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
