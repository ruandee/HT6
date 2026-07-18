/**
 * Horizontally scrolling night chips — the mobile replacement for the web app's calendar
 * popover. One chip per service window, showing the day, the date and what a table costs now.
 */
import { splitUsdc, type PoolSummary } from './api';

export function NightRail({
  nights,
  selectedDate,
  onSelect,
}: {
  /** one pool per night (any band) — used purely for the date/price label. */
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
        return (
          <button
            key={n.date_iso}
            className={`chip ${n.date_iso === selectedDate ? 'chip--sel' : ''} ${
              soldOut ? 'chip--gone' : ''
            }`}
            onClick={() => onSelect(n.date_iso)}
          >
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
