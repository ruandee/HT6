/**
 * The purchase moment (§7c-A quote-lock made visible). A glass sheet lifts over the canvas,
 * blurring the orbs beneath. The locked window is a depleting coral ring rather than a digit
 * countdown, so the moment stays calm.
 *
 * `onConfirm` fans out in App: with a publishable key configured it hands the intent's
 * client_secret to Unifold's `beginCheckout()`; without one it drives the StubGateway mock webhook.
 * Either way the token is minted server-side on `payment_intent.succeeded`, which is why paying
 * moves this sheet into `settling` rather than straight to success.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { splitUsdc, usdc } from './api';
import { EASE, ease } from './motion';

interface Props {
  price: string;
  /** this band's meal-credit floor (p0). Scales with party size (§4a). */
  floor: string;
  partySize: number;
  expiresAt: string;
  /**
   * The diner has paid through Unifold and we're waiting on `payment_intent.succeeded` to reach
   * app-services and mint the token. Paid is not yet booked, and the copy says so.
   */
  settling?: boolean;
  onConfirm: () => void | Promise<void>;
  onExpire: () => void;
  onClose: () => void;
}

export function BuySheet({
  price,
  floor,
  partySize,
  expiresAt,
  settling = false,
  onConfirm,
  onExpire,
  onClose,
}: Props) {
  const total = Math.max(1, (new Date(expiresAt).getTime() - Date.now()) / 1000);
  const [left, setLeft] = useState(total);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      const s = (new Date(expiresAt).getTime() - Date.now()) / 1000;
      setLeft(s);
      if (s <= 0) {
        clearInterval(t);
        onExpire();
      }
    }, 250);
    return () => clearInterval(t);
  }, [expiresAt, onExpire]);

  const p = splitUsdc(price);
  const R = 26;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, left / total));

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
        /* leaves faster than it arrives, and downward, so dismissal feels decisive */
        exit={{ opacity: 0, y: 14, scale: 0.98, transition: { duration: 0.18, ease: EASE } }}
        transition={{ duration: 0.28, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <div className="eyebrow" style={{ width: 150 }}>
              Table for {partySize}
            </div>
            <div className="price" style={{ fontSize: 58, marginTop: 14 }}>
              <span>${p.dollars}</span>
              <span className="price__cents">.{p.cents}</span>
            </div>
          </div>

          {/* depleting quote-lock ring */}
          <svg width="64" height="64" className="ring" aria-label="quote lock remaining">
            <circle
              className="ring__track"
              cx="32"
              cy="32"
              r={R}
              fill="none"
              strokeWidth="3"
            />
            <circle
              className="ring__fill"
              cx="32"
              cy="32"
              r={R}
              fill="none"
              strokeWidth="3"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct)}
            />
          </svg>
        </div>

        <p className="muted" style={{ marginTop: 22, fontSize: 14 }}>
          <strong style={{ color: 'var(--ink)' }}>{usdc(floor)}</strong> comes off your bill at the
          table. Change of plans? Sell it back.
        </p>

        <button
          className="btn btn--primary"
          style={{ width: '100%', marginTop: 26 }}
          disabled={busy || settling || left <= 0}
          onClick={async () => {
            setBusy(true);
            // Always clear `busy`: on the real path onConfirm returns as soon as the Unifold modal
            // opens, and if the diner dismisses it without paying the button must work again.
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {settling ? 'Confirming your table…' : busy ? 'One moment…' : 'Confirm & pay'}
        </button>

        <button
          className="btn btn--ghost"
          style={{ width: '100%', marginTop: 10 }}
          onClick={onClose}
          disabled={busy || settling}
        >
          Cancel
        </button>

        <div
          className="stat-label"
          style={{ textAlign: 'center', marginTop: 16, opacity: 0.7 }}
        >
          {settling ? 'Payment received · settling on-chain' : 'Gas-free · no wallet needed'}
        </div>
      </motion.div>
    </motion.div>
  );
}
