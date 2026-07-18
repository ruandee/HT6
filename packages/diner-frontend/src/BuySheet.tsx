/**
 * The purchase moment (§7c-A quote-lock made visible). A glass sheet lifts over the canvas,
 * blurring the orbs beneath. The locked window is a depleting coral ring rather than a digit
 * countdown — frictionless, not clock-anxious. On the stub this drives the mock webhook; with
 * the real gateway it would hand client_secret to beginCheckout().
 */
import { useEffect, useState } from 'react';
import { splitUsdc, usdc } from './api';

interface Props {
  price: string;
  /** this band's meal-credit floor (p0) — scales with party size (§4a). */
  floor: string;
  partySize: number;
  expiresAt: string;
  onConfirm: () => void;
  onExpire: () => void;
  onClose: () => void;
}

export function BuySheet({
  price,
  floor,
  partySize,
  expiresAt,
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
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="glass glass--strong sheet" onClick={(e) => e.stopPropagation()}>
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
          disabled={busy || left <= 0}
          onClick={() => {
            setBusy(true);
            onConfirm();
          }}
        >
          {busy ? 'One moment…' : 'Confirm & pay'}
        </button>

        <button
          className="btn btn--ghost"
          style={{ width: '100%', marginTop: 10 }}
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>

        <div
          className="stat-label"
          style={{ textAlign: 'center', marginTop: 16, opacity: 0.7 }}
        >
          Gas-free · no wallet needed
        </div>
      </div>
    </div>
  );
}
