/**
 * The wallet, matching the phone's Wallet tab (mobile-diner).
 *
 * It used to be a section wedged under the buy panel, and the top-bar pill scrolled you to it.
 * That worked while it held one ticket and stopped working the moment it held three: a column
 * 260px wide is not where you review what you own. It is its own route now — `#wallet` — for the
 * same reason the phone gives it a tab. Booking and reviewing are two different jobs.
 *
 * A hash route rather than a path: this is a static SPA behind a catch-all rewrite, and `#wallet`
 * needs no server rule, no history shim, and survives being pasted to someone.
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

/** One ticket. Identical on the phone and here, deliberately. */
function Ticket({
  holding,
  pool,
  badge,
  onSell,
}: {
  holding: Holding;
  pool?: PoolSummary;
  badge: string;
  onSell: (h: Holding) => void;
}) {
  const when = pool ? new Date(pool.service_time * 1000) : null;
  const v = splitUsdc(holding.recover_value);
  return (
    <motion.article
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
              ? ` · ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : ''}
          </div>
        </div>
        <span className="badge badge--live">{badge}</span>
      </div>

      <div className="ticket__perf" aria-hidden>
        <span />
        <i />
        <span />
      </div>

      <div className="stat-label">Sell back for</div>
      <div className="price ticket__price">
        <span>${v.dollars}</span>
        <span className="price__cents">.{v.cents}</span>
      </div>

      <button className="btn btn--ghost ticket__sell" onClick={() => onSell(holding)}>
        Can&apos;t make it? Sell it back
      </button>
    </motion.article>
  );
}

/**
 * The wallet route.
 *
 * Same content the phone's tab shows, laid out for a screen that has room: the tickets flow into
 * as many columns as fit rather than stacking in a 260px gutter. The empty state carries the way
 * out, because a diner who lands here with nothing came looking for something to do.
 */
export function WalletPage({
  holdings,
  pools,
  viewingPoolId,
  onSell,
  onBrowse,
}: Props & { onBrowse: () => void }) {
  const total = holdings.reduce((n, h) => n + BigInt(h.recover_value), 0n).toString();

  return (
    <motion.section className="walletpage" variants={group(0.07)} initial="hidden" animate="show">
      <motion.header variants={fadeUp}>
        <h1 className="headline">Your tables</h1>
        <p className="muted lede walletpage__sub">
          Show this at the door. Plans changed? Sell it back in a tap.
        </p>
      </motion.header>

      {holdings.length === 0 ? (
        <motion.div className="walletpage__empty" variants={fadeUp}>
          <span className="empty__mark">nothing yet</span>
          <p className="muted walletpage__emptynote">
            Claim a table and it shows up here — with what it&apos;s worth back, any time before
            service.
          </p>
          <button className="btn btn--primary" onClick={onBrowse}>
            Find a table
          </button>
        </motion.div>
      ) : (
        <>
          <motion.div className="walletpage__grid" variants={group(0.06)}>
            {holdings.map((h) => (
              <Ticket
                key={h.pool_id}
                holding={h}
                pool={pools.find((p) => p.pool_id === h.pool_id)}
                badge={h.pool_id === viewingPoolId ? 'Viewing' : 'Booked'}
                onSell={onSell}
              />
            ))}
          </motion.div>

          <motion.p className="walletpage__foot muted" variants={fadeUp}>
            {holdings.length} {holdings.length === 1 ? 'table' : 'tables'} ·{' '}
            <strong style={{ color: 'var(--ink)' }}>{usdc(total)}</strong> recoverable right now
          </motion.p>
        </>
      )}
    </motion.section>
  );
}

/**
 * Top-bar wallet button.
 *
 * Reads "Wallet", not "0 tables · $0.00". The old label put a running total in the corner of every
 * screen, which made the top bar a readout rather than a way to get somewhere — and at zero it
 * announced nothing twice. The count rides along as a badge only when there is one.
 */
export function WalletPill({ holdings, active }: { holdings: Holding[]; active: boolean }) {
  return (
    <a className={`wpill${active ? ' wpill--on' : ''}`} href="#wallet" aria-current={active || undefined}>
      <TicketIcon />
      <span className="wpill__n">Wallet</span>
      {holdings.length > 0 && <span className="wpill__badge">{holdings.length}</span>}
    </a>
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
