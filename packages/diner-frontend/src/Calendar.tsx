/**
 * Service-window picker, laid straight onto the canvas.
 *
 * It used to be a dropdown: a button that opened a glass popover over the page. That put two
 * presses and a dismissable layer between the diner and the only question that matters — which
 * night. So the month is just *there* now, part of the page rather than a thing that appears on
 * top of it, and the arrows page through it. No glass, no border, no shadow: the only chrome is
 * the coral on the day you picked.
 *
 * Each date is its own pool with its own curve (§4), so picking a date switches which curve
 * you're trading. Days with no pool are inert. Choosing one unfolds the service windows that
 * night actually has — read off /pools, never invented, so the demo only ever offers what the
 * seed really seats.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usdc, type PoolSummary } from './api';
import { ease } from './motion';
import { bandFor } from './PartySize';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  /** every pool, all dates and all bands. Slots are derived from it, not passed in. */
  pools: PoolSummary[];
  /** currently selected pool_id */
  selected: string;
  /** headcount, so pressing a window books the band that seats it */
  guests: number;
  onSelect: (poolId: string) => void;
}

export function Calendar({ pools, selected, guests, onSelect }: Props) {
  /** null = follow the selection; a number = the diner paged somewhere themselves. */
  const [cursor, setCursor] = useState<number | null>(null);

  const current = pools.find((p) => p.pool_id === selected);
  const selectedDate = current?.date_iso ?? '';

  /** dates that have service, and the months they fall in — the pager's whole world. */
  const { byDate, months } = useMemo(() => {
    const byDate = new Map<string, PoolSummary[]>();
    for (const p of pools) {
      const list = byDate.get(p.date_iso);
      if (list) list.push(p);
      else byDate.set(p.date_iso, [p]);
    }
    const keys = [...byDate.keys()].map(monthKeyOf).sort((a, b) => a - b);
    return { byDate, months: { min: keys[0], max: keys[keys.length - 1] } };
  }, [pools]);

  // No pools yet: render the frame at its final height so the page doesn't jump when they land.
  const fallback = monthKeyOf(isoOf(new Date()));
  const month = cursor ?? (selectedDate ? monthKeyOf(selectedDate) : (months.min ?? fallback));
  const year = Math.floor(month / 12);
  const mon = month % 12;

  const canPrev = months.min !== undefined && month > months.min;
  const canNext = months.max !== undefined && month < months.max;

  const firstWeekday = new Date(year, mon, 1).getDay();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const todayIso = isoOf(new Date());

  const cells: Array<{ day: number; iso: string } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, iso: `${year}-${pad(mon + 1)}-${pad(d)}` });

  /**
   * The windows on the chosen night. One entry per distinct service time, carrying every band
   * that seats it — so the slot can price itself off the band this party would actually book.
   */
  const slots = useMemo(() => {
    const onDate = byDate.get(selectedDate) ?? [];
    const byTime = new Map<number, PoolSummary[]>();
    for (const p of onDate) {
      const list = byTime.get(p.service_time);
      if (list) list.push(p);
      else byTime.set(p.service_time, [p]);
    }
    return [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([service_time, bands]) => ({ service_time, bands }));
  }, [byDate, selectedDate]);

  /** picking a day keeps the headcount and routes to the band that seats it (§4a). */
  function pickDate(iso: string) {
    const onDate = byDate.get(iso) ?? [];
    const target = bandFor(onDate, guests) ?? onDate[0];
    if (target) onSelect(target.pool_id);
  }

  return (
    <div className="cal">
      <div className="cal__head">
        <MonthBtn label="Previous month" onClick={() => setCursor(month - 1)} disabled={!canPrev}>
          ‹
        </MonthBtn>
        {/* the month name crossfades rather than swapping, so paging reads as one surface
            sliding under the arrows instead of the label blinking */}
        <div className="cal__month">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={month}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={ease(0.2)}
            >
              {new Date(year, mon, 1).toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </motion.span>
          </AnimatePresence>
        </div>
        <MonthBtn label="Next month" onClick={() => setCursor(month + 1)} disabled={!canNext}>
          ›
        </MonthBtn>
      </div>

      <div className="cal__grid cal__grid--head">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="cal__wd">
            {w}
          </div>
        ))}
      </div>

      {/* the grid itself travels with the paging, in the direction you pressed */}
      <div className="cal__body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={month}
            className="cal__grid"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={ease(0.24)}
          >
            {cells.map((c, i) => {
              if (!c) return <div key={i} />;
              const onDate = byDate.get(c.iso);
              const isSel = c.iso === selectedDate;
              const sold = onDate?.reduce((n, p) => n + p.n_sold, 0) ?? 0;
              const cap = onDate?.reduce((n, p) => n + p.n_max, 0) ?? 0;
              const fill = cap > 0 ? sold / cap : 0;
              return (
                <button
                  key={i}
                  disabled={!onDate}
                  onClick={() => onDate && pickDate(c.iso)}
                  aria-pressed={isSel}
                  title={onDate ? `${cap - sold} of ${cap} tables left` : 'No service'}
                  className={`day ${isSel ? 'day--sel' : ''} ${onDate ? 'day--has' : ''}`}
                >
                  <span style={{ fontWeight: c.iso === todayIso ? 700 : 500 }}>{c.day}</span>
                  {onDate && (
                    <i
                      className="day__dot"
                      style={{ opacity: 0.35 + fill * 0.65, transform: `scale(${0.8 + fill * 0.5})` }}
                    />
                  )}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ---- the windows that night actually serves ---- */}
      <div className="cal__slots">
        <div className="stat-label" style={{ marginBottom: 10 }}>
          {slots.length > 0 ? 'Available' : ' '}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selectedDate || 'none'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={ease(0.24)}
            style={{ display: 'grid', gap: 8 }}
          >
            {slots.map(({ service_time, bands }) => {
              const band = bandFor(bands, guests) ?? bands[0]!;
              const left = bands.reduce((n, p) => n + (p.n_max - p.n_sold), 0);
              const on = band.pool_id === selected;
              return (
                <button
                  key={service_time}
                  className={`slot ${on ? 'slot--on' : ''}`}
                  onClick={() => onSelect(band.pool_id)}
                  aria-pressed={on}
                  disabled={left === 0}
                >
                  <span className="slot__time">{timeOf(service_time)}</span>
                  <span className="slot__left">
                    {left === 0 ? 'Full' : `${left} left`}
                  </span>
                  <span className="slot__price">{usdc(band.buy_price)}</span>
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function MonthBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="cal__nav" aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** months as one sortable integer, so paging and clamping are plain arithmetic */
const monthKeyOf = (iso: string) => {
  const [y, m] = iso.split('-');
  return Number(y) * 12 + (Number(m) - 1);
};
const timeOf = (unix: number) =>
  new Date(unix * 1000)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(':00', '')
    .toLowerCase();
