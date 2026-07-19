/**
 * The wallet, brought over from the phone (mobile-diner's Wallet tab).
 *
 * On the phone it's a tab because a phone can only show one thing. A desktop can show two, so
 * there is no tab and no navigation: your tables live at the bottom of the same page you book
 * from, and the summary in the top bar scrolls you to them. Nothing to open, nothing to close.
 *
 * The ticket is the phone's ticket — same perforation, same "sell back for" figure, same words —
 * so a diner who used one recognises the other. Selling still asks once, because it's the one
 * action here that spends something.
 */
import { motion } from 'framer-motion';
import { splitUsdc, usdc, type Holding, type PoolSummary } from './api';
import { EASE, ease, fadeUp, group } from './motion';

interface Props {
  holdings: Holding[];
  pools: PoolSummary[];
  /** highlighted because it's the night the page is currently priced on */
  viewingPoolId: string;
  onSell: (h: Holding) => void;
}

export function Wallet({ holdings, pools, viewingPoolId, onSell }: Props) {
  const total = holdings.reduce((n, h) => n + BigInt(h.recover_value), 0n).toString();

  return (
    <section id="wallet" className="wallet">
      <div className="eyebrow" style={{ marginBottom: 20 }}>
        Your tables
      </div>

      {holdings.length === 0 ? (
        <div className="wallet__empty">
          <span className="empty__mark">nothing yet</span>
          <p className="muted" style={{ marginTop: 12, maxWidth: 300 }}>
            Claim a table and it shows up here — with what it's worth back, any time before service.
          </p>
        </div>
      ) : (
        <>
          <motion.div className="wallet__grid" variants={group(0.06)} initial="hidden" animate="show">
            {holdings.map((h) => {
              const pool = pools.find((p) => p.pool_id === h.pool_id);
              const when = pool ? new Date(pool.service_time * 1000) : null;
              const v = splitUsdc(h.recover_value);
              return (
                <motion.article
                  key={h.pool_id}
                  className="glass glass--strong ticket"
                  variants={fadeUp}
                  layout
                  transition={{ duration: 0.24, ease: EASE }}
                >
                  <div className="ticket__top">
                    <div>
                      <div className="ticket__when">{pool?.label ?? 'Your table'}</div>
                      <div className="ticket__meta">
                        {pool?.venue_name ?? 'Your table'}
                        {pool ? ` · table for ${pool.party_size}` : ''}
                        {when
                          ? ` · ${when.toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}`
                          : ''}
                      </div>
                    </div>
                    <span className="badge badge--live">
                      {h.pool_id === viewingPoolId ? 'Viewing' : 'Booked'}
                    </span>
                  </div>

                  <div className="ticket__perf" aria-hidden>
                    <span />
                    <i />
                    <span />
                  </div>

                  <div className="stat-label">Sell back for</div>
                  <div className="price" style={{ fontSize: 34, marginTop: 6 }}>
                    <span>${v.dollars}</span>
                    <span className="price__cents">.{v.cents}</span>
                  </div>

                  <button
                    className="btn btn--ghost"
                    style={{ width: '100%', marginTop: 18 }}
                    onClick={() => onSell(h)}
                  >
                    Can&apos;t make it? Sell it back
                  </button>
                </motion.article>
              );
            })}
          </motion.div>

          <div className="wallet__foot muted">
            {holdings.length} {holdings.length === 1 ? 'table' : 'tables'} ·{' '}
            <strong style={{ color: 'var(--ink)' }}>{usdc(total)}</strong> recoverable right now
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Top-bar summary. Not a menu — a press scrolls to the wallet, so nothing overlays the page.
 */
export function WalletPill({ holdings }: { holdings: Holding[] }) {
  const total = holdings.reduce((n, h) => n + BigInt(h.recover_value), 0n).toString();
  return (
    <button
      className="wpill"
      onClick={() =>
        document.getElementById('wallet')?.scrollIntoView({ block: 'start' })
      }
    >
      <TicketIcon />
      <span className="wpill__n">
        {holdings.length} {holdings.length === 1 ? 'table' : 'tables'}
      </span>
      {holdings.length > 0 && <span className="wpill__v">{usdc(total)}</span>}
    </button>
  );
}

/** Confirmation for the one action here that spends something. Mirrors the phone's sell sheet. */
export function SellSheet({
  holding,
  label,
  onConfirm,
  onClose,
}: {
  holding: Holding;
  label: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const p = splitUsdc(holding.recover_value);
  return (
    <motion.div
      className="sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={ease(0.22)}
      onClick={onClose}
    >
      <motion.div
        className="glass glass--strong sheet"
        initial={{ opacity: 0, y: 22, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98, transition: { duration: 0.18, ease: EASE } }}
        transition={{ duration: 0.28, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow" style={{ width: 150 }}>
          Sell it back
        </div>
        <div className="price" style={{ fontSize: 58, marginTop: 14 }}>
          <span>${p.dollars}</span>
          <span className="price__cents">.{p.cents}</span>
        </div>
        <p className="muted" style={{ marginTop: 22, fontSize: 14 }}>
          We&apos;ll take back your {label} table right now, with no waiting for someone else to
          want it. The money is on its way as soon as you confirm.
        </p>
        <button
          className="btn btn--primary"
          style={{ width: '100%', marginTop: 26 }}
          onClick={onConfirm}
        >
          Sell it back
        </button>
        <button
          className="btn btn--ghost"
          style={{ width: '100%', marginTop: 10 }}
          onClick={onClose}
        >
          Keep it
        </button>
      </motion.div>
    </motion.div>
  );
}

function TicketIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.75 6.4V4.5A1.5 1.5 0 0 1 3.25 3h9.5a1.5 1.5 0 0 1 1.5 1.5v1.9a1.6 1.6 0 0 0 0 3.2v1.9a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5V9.6a1.6 1.6 0 0 0 0-3.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
