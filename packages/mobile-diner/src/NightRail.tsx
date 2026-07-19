/**
 * Horizontally scrolling night chips, the mobile replacement for the web app's calendar
 * popover. One chip per service window, showing the day, the date and what a table costs now.
 */
import { motion } from 'framer-motion';
import { splitUsdc, type PoolSummary } from './api';
import { ease } from './motion';

export function NightRail({
  nights,
  selectedDate,
  onSelect,
}: {
  /** one pool per night (any band), used purely for the date/price label. */
  nights: PoolSummary[];
  selectedDate: string;
  onSelect: (dateIso: string) => void;
}) {
  return (
    <div className="chiprail">
      {nights.map((n) => {
        const d = new Date(`${n.date_iso}T12:00:00`);
        const soldOut = n.n_sold >= n.n_max;
        const p = splitUsdc(n.buy_price);
        const sel = n.date_iso === selectedDate;
        return (
          <button
            key={n.date_iso}
            className={`chip ${sel ? 'chip--sel' : ''} ${soldOut ? 'chip--gone' : ''}`}
            onClick={() => onSelect(n.date_iso)}
          >
            {/* the coral state crossfades as its own layer, because a gradient can't be transitioned.
                initial={false} so the selected chip is already lit on first paint. */}
            <motion.span
              className="chip__fill"
              initial={false}
              animate={{ opacity: sel ? 1 : 0 }}
              transition={ease(0.22)}
              aria-hidden
            />
            <span className="chip__day">
              {d.toLocaleDateString('en-US', { weekday: 'short' })}
            </span>
            <span className="chip__date">{d.getDate()}</span>
            <span className="chip__price">{soldOut ? 'Full' : `$${p.dollars}`}</span>
          </button>
        );
      })}
    </div>
  );
}
