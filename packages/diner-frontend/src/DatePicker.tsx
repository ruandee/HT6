/**
 * Service-window picker. Each date is its own pool with its own curve (§4), so picking a date
 * switches which curve you're trading. Days without a pool are inert; days with one show a dot
 * whose weight hints at how full that night already is.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usdc, type PoolSummary } from './api';
import { EASE } from './motion';

interface Props {
  /** already filtered to the chosen party-size band, one pool per date. */
  pools: PoolSummary[];
  selected: string; // pool_id
  onSelect: (poolId: string) => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function DatePicker({ pools, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const current = pools.find((p) => p.pool_id === selected);
  const byDate = new Map(pools.map((p) => [p.date_iso, p]));

  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = isoOf(new Date());

  const cells: Array<{ day: number; iso: string } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: `${year}-${pad(month + 1)}-${pad(d)}` });
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn--ghost"
        style={{ padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 10 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <CalIcon />
        {current ? current.label : 'Pick a night'}
        <span style={{ opacity: 0.4, fontSize: 9 }}>▼</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="glass glass--strong"
            role="dialog"
            aria-label="Choose a service window"
            /* scales from the top-right, so it reads as unfolding out of the button
               rather than materializing next to it */
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.14, ease: EASE } }}
            transition={{ duration: 0.26, ease: EASE }}
            style={{
              position: 'absolute',
              top: 'calc(100% + 10px)',
              right: 0,
              zIndex: 40,
              width: 316,
              padding: 20,
              borderRadius: 24,
              transformOrigin: 'top right',
            }}
          >
          {/* month nav */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <MonthBtn onClick={() => setMonthOffset((m) => m - 1)} disabled={monthOffset <= 0}>
              ‹
            </MonthBtn>
            <div className="stat-label" style={{ fontSize: 11.5 }}>
              {base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <MonthBtn onClick={() => setMonthOffset((m) => m + 1)} disabled={monthOffset >= 2}>
              ›
            </MonthBtn>
          </div>

          {/* weekday header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {WEEKDAYS.map((w, i) => (
              <div
                key={i}
                className="stat-label"
                style={{ textAlign: 'center', fontSize: 9.5, opacity: 0.55, paddingBottom: 6 }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* days */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {cells.map((c, i) => {
              if (!c) return <div key={i} />;
              const pool = byDate.get(c.iso);
              const isSel = pool?.pool_id === selected;
              const isToday = c.iso === todayIso;
              const fill = pool ? pool.n_sold / pool.n_max : 0;
              return (
                <button
                  key={i}
                  disabled={!pool}
                  onClick={() => {
                    if (pool) {
                      onSelect(pool.pool_id);
                      setOpen(false);
                    }
                  }}
                  title={pool ? `${pool.label} · ${usdc(pool.buy_price)}` : 'No service'}
                  className={`day ${isSel ? 'day--sel' : ''} ${pool ? 'day--has' : ''}`}
                >
                  <span style={{ fontWeight: isToday ? 700 : 500 }}>{c.day}</span>
                  {pool && (
                    <i
                      className="day__dot"
                      style={{ opacity: 0.35 + fill * 0.65, transform: `scale(${0.8 + fill * 0.5})` }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* the selected night, summarized */}
          {current && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid var(--hairline)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div className="stat-label">{current.label}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-45)', marginTop: 3 }}>
                  {current.n_max - current.n_sold} of {current.n_max} left
                </div>
              </div>
              <div
                style={{
                  fontFamily: 'Archivo',
                  fontWeight: 700,
                  fontSize: 21,
                  letterSpacing: '-0.03em',
                }}
              >
                {usdc(current.buy_price)}
              </div>
            </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MonthBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        border: '1px solid var(--hairline)',
        background: 'rgba(255,255,255,0.5)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.3 : 1,
        fontSize: 15,
        lineHeight: 1,
        color: 'var(--ink)',
      }}
    >
      {children}
    </button>
  );
}

function CalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="3" width="13" height="11.5" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 6.5h13M5 1.5V4M11 1.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
