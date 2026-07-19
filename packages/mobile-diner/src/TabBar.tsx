/**
 * Bottom tab bar: the app's primary navigation, thumb-reachable at the bottom edge.
 * Three destinations: Tonight (the live curve for the soonest night), Book (browse nights and
 * claim a table), Wallet (tables you hold, and selling back).
 */
export type Tab = 'tonight' | 'book' | 'wallet';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'book', label: 'Book' },
  { id: 'wallet', label: 'Wallet' },
];

export function TabBar({
  tab,
  onTab,
  heldCount,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  heldCount: number;
}) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab ${tab === t.id ? 'tab--on' : ''}`}
          onClick={() => onTab(t.id)}
          aria-current={tab === t.id ? 'page' : undefined}
        >
          <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
            <Icon id={t.id} on={tab === t.id} />
            {t.id === 'wallet' && heldCount > 0 && <span className="tab__badge">{heldCount}</span>}
          </span>
          <span className="tab__label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Icon({ id, on }: { id: Tab; on: boolean }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: on ? 2.2 : 1.9 } as const;
  if (id === 'tonight')
    return (
      <svg width="23" height="23" viewBox="0 0 24 24" {...s} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17.5 8.5 11l4 4L21 5.5" />
        <path d="M15.5 5.5H21V11" />
      </svg>
    );
  if (id === 'book')
    return (
      <svg width="23" height="23" viewBox="0 0 24 24" {...s} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4.8" width="18" height="16.2" rx="3.4" />
        <path d="M3 9.6h18M8.2 3v3.6M15.8 3v3.6" />
      </svg>
    );
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" {...s} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 7.6c0-1.5 1.2-2.7 2.7-2.7h11.6c1.5 0 2.7 1.2 2.7 2.7v9.3c0 1.5-1.2 2.7-2.7 2.7H6.2a2.7 2.7 0 0 1-2.7-2.7z" />
      <path d="M15.4 12.2h4.9" />
      <circle cx="15.9" cy="12.2" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
