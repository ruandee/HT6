/**
 * The purchase moment (§7c-A quote-lock made visible), as a bottom sheet. The locked window is a
 * depleting coral ring instead of a digit countdown, so the moment stays calm. When it
 * empties the quote lapses and we tell the diner to try again.
 *
 * On the stub this drives the mock webhook; with the real gateway the same confirm button would
 * hand `checkout.client_secret` to Unifold's beginCheckout().
 */
import { useEffect, useRef, useState } from 'react';
import { splitUsdc, usdc } from './api';
import { Sheet } from './Sheet';

interface Props {
  price: string;
  /** this band's meal-credit floor (p0). Scales with party size (§4a). */
  floor: string;
  partySize: number;
  nightLabel: string;
  expiresAt: string;
  onConfirm: () => void;
  onExpire: () => void;
  onClose: () => void;
}

export function BuySheet({
  price,
  floor,
  partySize,
  nightLabel,
  expiresAt,
  onConfirm,
  onExpire,
  onClose,
}: Props) {
  const total = useRef(Math.max(1, (new Date(expiresAt).getTime() - Date.now()) / 1000));
  const [left, setLeft] = useState(total.current);
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
  const premium = (BigInt(price) - BigInt(floor)).toString();
  const R = 24;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, left / total.current));

  return (
    <Sheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow" style={{ width: 132 }}>
            Table for {partySize}
          </div>
          <div className="price" style={{ fontSize: 52, marginTop: 12 }}>
            <span>${p.dollars}</span>
            <span className="price__cents">.{p.cents}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-45)', marginTop: 8 }}>{nightLabel}</div>
        </div>

        {/* depleting quote-lock ring: the price you see is the price you pay, for now */}
        <svg width="58" height="58" className="ring" aria-label="price held">
          <circle className="ring__track" cx="29" cy="29" r={R} fill="none" strokeWidth="3" />
          <circle
            className="ring__fill"
            cx="29"
            cy="29"
            r={R}
            fill="none"
            strokeWidth="3"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
          />
        </svg>
      </div>

      <div className="split">
        <div className="split__bar">
          <div
            className="split__credit"
            style={{ width: `${(Number(floor) / Number(price)) * 100}%` }}
          />
          <div className="split__premium" style={{ flex: 1 }} />
        </div>
        <div className="split__legend">
          <span>
            <b>{usdc(floor)}</b> meal credit
          </span>
          <span>
            <b>{usdc(premium)}</b> table
          </span>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 18, fontSize: 13.5 }}>
        The meal credit comes straight off your bill at the table. Can&apos;t make it? Sell it back
        any time before service.
      </p>

      <button
        className="btn btn--primary btn--block"
        style={{ marginTop: 20 }}
        disabled={busy || left <= 0}
        onClick={() => {
          setBusy(true);
          onConfirm();
        }}
      >
        {busy ? 'Confirming…' : left <= 0 ? 'Price expired' : 'Confirm & pay'}
      </button>

      <div className="stat-label" style={{ textAlign: 'center', marginTop: 14, opacity: 0.7 }}>
        Price held for you · no wallet needed
      </div>
    </Sheet>
  );
}
