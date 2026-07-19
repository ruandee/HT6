/**
 * hora, the diner app on a phone. Three tabs: Tonight (the live curve), Book (browse nights,
 * pick a table size, claim it) and Wallet (what you hold, and selling it back).
 *
 * Talks ONLY to app-services REST (§8 boundary rule) and never to the chain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import {
  api,
  bandParams,
  splitUsdc,
  usdc,
  type Holding,
  type PoolSummary,
  type Quote,
} from './api';
import { CurveChart } from './CurveChart';
import { BuySheet } from './BuySheet';
import { NightRail } from './NightRail';
import { PartySize, bandFor } from './PartySize';
import { TabBar, type Tab } from './TabBar';
import { Sheet } from './Sheet';
import { usePullToRefresh } from './usePullToRefresh';
import { ease, swap } from './motion';
import { venueState } from './venue';

export default function App() {
  const [tab, setTab] = useState<Tab>('tonight');
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [poolId, setPoolId] = useState('');
  const [guests, setGuests] = useState(2);
  const [q, setQ] = useState<Quote | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [sheet, setSheet] = useState<null | { intentId: string; price: string; expires: string }>(
    null,
  );
  const [sellFor, setSellFor] = useState<Holding | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async (id: string) => {
    const [ps, hs] = await Promise.all([api.pools(), api.holdings()]);
    setPools(ps);
    setHoldings(hs);
    if (id) {
      const quote = await api.quote(id);
      setQ(quote);
      return quote;
    }
    return null;
  }, []);

  // first load: land on the headline demo pool
  useEffect(() => {
    (async () => {
      const [{ pool_id }, ps] = await Promise.all([api.demoPoolId(), api.pools()]);
      setPools(ps);
      setPoolId(pool_id);
      await refresh(pool_id);
    })().catch((e) => flash(String(e instanceof Error ? e.message : e)));
  }, [refresh, flash]);

  // poll so the curve moves when the other session buys (the §11 "ticks up" moment)
  useEffect(() => {
    if (!poolId) return;
    const t = setInterval(() => {
      refresh(poolId).catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [poolId, refresh]);

  const ptr = usePullToRefresh(() => refresh(poolId));

  // ---- derived view model -------------------------------------------------
  const current = pools.find((p) => p.pool_id === poolId);
  const selectedDate = current?.date_iso ?? '';

  /** one representative pool per night, cheapest band first, for the date rail. */
  const nights = useMemo(() => {
    const byDate = new Map<string, PoolSummary>();
    for (const p of [...pools].sort((a, b) => a.party_size - b.party_size)) {
      if (!byDate.has(p.date_iso)) byDate.set(p.date_iso, p);
    }
    return [...byDate.values()].sort((a, b) => a.service_time - b.service_time);
  }, [pools]);

  /** every band offered on the selected night, read off the API and never hardcoded (§4a). */
  const bandsTonight = useMemo(
    () => pools.filter((p) => p.date_iso === selectedDate),
    [pools, selectedDate],
  );

  const venue = venueState(bandsTonight);

  // §7c-C: one table per person per NIGHT, across every band.
  const windowPoolIds = new Set(bandsTonight.map((b) => b.pool_id));
  const heldThisNight = holdings.filter(
    (h) => h.status === 'held' && windowPoolIds.has(h.pool_id),
  );
  const heldOtherBand = heldThisNight.find((h) => h.pool_id !== poolId);
  const allHeld = holdings.filter((h) => h.status === 'held');

  const params = bandParams(current?.party_size ?? 2);
  const floorP0 = params.p0;
  const left = q ? q.n_max - q.n_sold : 0;
  const price = q ? splitUsdc(q.buy_price) : { dollars: '—', cents: '00' };

  function selectDate(dateIso: string) {
    // the headcount is the thing the diner chose, so it survives the night change and we
    // re-route to whatever band seats it on the new date.
    const onDate = pools.filter((p) => p.date_iso === dateIso);
    const target = bandFor(onDate, guests) ?? onDate[0];
    if (target) selectPool(target.pool_id);
  }

  /** Changing headcount keeps the night and swaps to the band that fits. */
  function selectGuests(n: number) {
    setGuests(n);
    const target = bandFor(bandsTonight, n);
    if (target && target.pool_id !== poolId) selectPool(target.pool_id);
  }

  function selectPool(id: string) {
    setPoolId(id);
    setQ(null); // don't show the previous night's curve while the new one loads
    refresh(id).catch(() => {});
  }

  // ---- actions ------------------------------------------------------------
  async function startBuy() {
    try {
      const r = await api.buy(poolId);
      setSheet({ intentId: r.deposit_intent_id, price: r.max_price, expires: r.expires_at });
    } catch (e) {
      flash(String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, ''));
    }
  }

  async function confirmBuy(intentId: string) {
    try {
      await api.stubSettle(intentId, 'succeeded');
      setSheet(null);
      const quote = await refresh(poolId);
      flash(quote ? `Table booked. It's ${usdc(quote.buy_price)} now.` : 'Table booked.');
      setTab('wallet');
    } catch (e) {
      setSheet(null);
      flash(String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, ''));
    }
  }

  async function sellBack(h: Holding) {
    setSellFor(null);
    try {
      const r = await api.sell(h.pool_id);
      await refresh(poolId);
      flash(`Sold back. ${usdc(r.payout_amount)} returned to you.`);
    } catch (e) {
      flash(String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, ''));
    }
  }

  const nightLabel = current?.label ?? '';

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
      <div className="app__orbs" aria-hidden>
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <div className="scroll" {...ptr.handlers}>
        {/* pull-to-refresh affordance */}
        <div
          className={`ptr ${ptr.spinning ? 'ptr--spinning' : ''}`}
          style={{ height: ptr.pull }}
          aria-hidden
        >
          <div
            className="ptr__spinner"
            style={{
              opacity: Math.min(1, ptr.pull / 40),
              transform: ptr.spinning ? undefined : `rotate(${ptr.pull * 4}deg)`,
              borderTopColor: ptr.armed ? 'var(--coral-deep)' : 'var(--ink-25)',
            }}
          />
        </div>

        {/* Wallet and the curve view swap as whole pages. Keyed 'wallet' vs 'main' rather than
            on `tab`, so moving between Tonight and Book does NOT remount the recharts curve.
            Only the header copy below crossfades. */}
        <AnimatePresence mode="wait" initial={false}>
        {tab === 'wallet' ? (
          <motion.div key="wallet" variants={swap} initial="hidden" animate="show" exit="exit">
          <WalletTab
            holdings={allHeld}
            pools={pools}
            onSell={setSellFor}
            onBrowse={() => setTab('book')}
          />
          </motion.div>
        ) : (
          <motion.div key="main" variants={swap} initial="hidden" animate="show" exit="exit">
            <header className="mhead">
              <div className="mhead__row">
                <div className="brand">
                  <span className="brand-dots">
                    <i />
                    <i />
                  </span>
                  hora
                </div>
                <div className="avatar">MD</div>
              </div>

              {/* only the copy changes between Tonight and Book, so only the copy moves */}
              <AnimatePresence mode="wait" initial={false}>
                {tab === 'tonight' ? (
                  <motion.div
                    key="tonight"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={ease(0.22)}
                  >
                    {/* same shape as the desktop header, sized for a phone. The fill word is
                        derived (see venue.ts) rather than asserted, so it stays true. */}
                    <h1 className="mtitle">
                      {venue.name} is
                      <br />
                      <span className="script">{venue.fill}</span>.
                    </h1>
                    <p className="msub">
                      {venue.cap > 0
                        ? `${venue.sold} of ${venue.cap} tables gone tonight. Sell yours back any time before service.`
                        : 'Sell your table back any time before service.'}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="book"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={ease(0.22)}
                  >
                    <h1 className="mtitle">Pick a night</h1>
                    <p className="msub">{venue.name} · dinner service</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </header>

            {/* the night rail unfolds rather than shoving the curve down */}
            <AnimatePresence initial={false}>
              {tab === 'book' && (
                <motion.div
                  key="rail"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={ease(0.28)}
                  style={{ overflow: 'hidden' }}
                >
                  <NightRail nights={nights} selectedDate={selectedDate} onSelect={selectDate} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* ---- the live curve: the hero ---- */}
            <section className="glass card">
              <div className="card__head">
                <div className="eyebrow" style={{ flex: 1 }}>
                  {tab === 'tonight' ? nightLabel || 'Live price' : 'Live price'}
                </div>
                {q && (
                  <span className="badge badge--live">
                    {left > 0 ? `${left} left` : 'Full'}
                  </span>
                )}
              </div>

              {q && current ? (
                <CurveChart
                  p0={params.p0}
                  k={params.k}
                  nMax={q.n_max}
                  nSold={q.n_sold}
                  thetaBps={q.theta_bps}
                  phiBps={500}
                />
              ) : (
                <div style={{ height: 178 }} />
              )}

              <div style={{ marginTop: 14 }}>
                <div className="stat-label" style={{ marginBottom: 8 }}>
                  {q ? `${q.n_sold} of ${q.n_max} claimed` : 'Loading'}
                </div>
                <div className="pips">
                  {q &&
                    Array.from({ length: q.n_max }, (_, i) => (
                      <span key={i} className={`pip ${i < q.n_sold ? 'pip--sold' : ''}`} />
                    ))}
                </div>
              </div>
            </section>

            {/* ---- price + party size ---- */}
            <section className="glass glass--strong card">
              {tab === 'book' && bandsTonight.length > 0 && (
                <>
                  <div className="eyebrow" style={{ marginBottom: 12 }}>
                    How many people?
                  </div>
                  <PartySize bands={bandsTonight} guests={guests} onGuests={selectGuests} />
                  <div style={{ height: 1, background: 'var(--hairline)', margin: '20px 0 18px' }} />
                </>
              )}

              <div className="pricerow">
                <div>
                  <div className="eyebrow" style={{ marginBottom: 10, width: 108 }}>
                    Price now
                  </div>
                  {/* the §11 "ticks up" moment: the poll brings a new price and it rolls */}
                  <div className="price price--phone">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={q?.buy_price ?? 'pending'}
                        initial={{ opacity: 0, y: 9 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -9 }}
                        transition={ease(0.26)}
                        style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}
                      >
                        <span>${price.dollars}</span>
                        <span className="price__cents">.{price.cents}</span>
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>
                {current && (
                  <div style={{ textAlign: 'right', paddingBottom: 6 }}>
                    <div className="stat-label">Table for</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 30,
                        fontWeight: 700,
                        lineHeight: 1,
                        marginTop: 4,
                      }}
                    >
                      {current.party_size}
                    </div>
                  </div>
                )}
              </div>

              {/* how much of this is real prepaid dinner */}
              {q && (
                <div className="split">
                  <div className="split__bar">
                    <div
                      className="split__credit"
                      style={{
                        width: `${Math.min(
                          100,
                          (Number(floorP0) / Math.max(1, Number(q.buy_price))) * 100,
                        )}%`,
                      }}
                    />
                    <div className="split__premium" style={{ flex: 1 }} />
                  </div>
                  <div className="split__legend">
                    <span>
                      <b>{usdc(floorP0)}</b> comes off your bill
                    </span>
                    <span>
                      <b>{usdc((BigInt(q.buy_price) - BigInt(floorP0)).toString())}</b> table
                    </span>
                  </div>
                </div>
              )}

              {tab === 'tonight' && (
                <button
                  className="btn btn--ghost btn--block"
                  style={{ marginTop: 20 }}
                  onClick={() => setTab('book')}
                >
                  See other nights
                </button>
              )}
            </section>

            {/* room for the docked button */}
            <div style={{ height: 74 }} />
          </motion.div>
        )}
        </AnimatePresence>

        <AnimatePresence>
          {toast && (
            <motion.div
              className="glass toast"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={ease(0.3)}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---- thumb-reachable primary action ---- */}
      {tab !== 'wallet' && (
        <div className="dock">
          <button
            className="btn btn--primary btn--block"
            onClick={startBuy}
            disabled={!q || q.frozen || left === 0 || heldThisNight.length > 0}
          >
            {heldThisNight.length > 0
              ? "You've got this night"
              : q?.frozen
                ? 'Service has started'
                : left === 0
                  ? 'Fully booked'
                  : 'Claim this table'}
          </button>
          {heldThisNight.length > 0 && (
            <div className="dock__note">
              {heldOtherBand
                ? `You hold the table for ${
                    bandsTonight.find((b) => b.pool_id === heldOtherBand.pool_id)?.party_size ?? ''
                  } this night. Sell it back to switch sizes.`
                : 'One table per person per night. Pick another night to book again.'}
            </div>
          )}
        </div>
      )}

      <TabBar tab={tab} onTab={setTab} heldCount={allHeld.length} />

      {/* AnimatePresence so both sheets can animate OUT, not just in */}
      <AnimatePresence>
      {sheet && (
        <BuySheet
          key="buy"
          price={sheet.price}
          floor={floorP0}
          partySize={current?.party_size ?? 2}
          nightLabel={nightLabel}
          expiresAt={sheet.expires}
          onConfirm={() => confirmBuy(sheet.intentId)}
          onExpire={async () => {
            await api.stubSettle(sheet.intentId, 'expired').catch(() => {});
            setSheet(null);
            flash('That price expired. Tap claim again for a fresh one.');
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sellFor && (
        <SellSheet
          key="sell"
          holding={sellFor}
          label={pools.find((p) => p.pool_id === sellFor.pool_id)?.label ?? 'your table'}
          onConfirm={() => sellBack(sellFor)}
          onClose={() => setSellFor(null)}
        />
      )}
      </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ wallet */

function WalletTab({
  holdings,
  pools,
  onSell,
  onBrowse,
}: {
  holdings: Holding[];
  pools: PoolSummary[];
  onSell: (h: Holding) => void;
  onBrowse: () => void;
}) {
  return (
    <>
      <header className="mhead">
        <div className="mhead__row">
          <div className="brand">
            <span className="brand-dots">
              <i />
              <i />
            </span>
            hora
          </div>
          <div className="avatar">MD</div>
        </div>
        <h1 className="mtitle">Your tables</h1>
        <p className="msub">Show this at the door. Plans changed? Sell it back in a tap.</p>
      </header>

      {holdings.length === 0 ? (
        <div className="glass card empty">
          <span className="empty__mark">nothing yet</span>
          <p className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>
            Book a table and it shows up here.
          </p>
          <button className="btn btn--primary btn--block" style={{ marginTop: 20 }} onClick={onBrowse}>
            Find a table
          </button>
        </div>
      ) : (
        holdings.map((h) => {
          const pool = pools.find((p) => p.pool_id === h.pool_id);
          const when = pool ? new Date(pool.service_time * 1000) : null;
          return (
            <article key={h.pool_id} className="glass glass--strong ticket" >
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
                <span className="badge badge--live">Booked</span>
              </div>

              <div className="ticket__perf" aria-hidden>
                <span />
                <i />
                <span />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div className="stat-label">Sell back for</div>
                  <div
                    className="price"
                    style={{ fontSize: 30, marginTop: 6 }}
                  >
                    <span>${splitUsdc(h.recover_value).dollars}</span>
                    <span className="price__cents">.{splitUsdc(h.recover_value).cents}</span>
                  </div>
                </div>
              </div>

              <button
                className="btn btn--ghost btn--block"
                style={{ marginTop: 18 }}
                onClick={() => onSell(h)}
              >
                Can&apos;t make it? Sell it back
              </button>
            </article>
          );
        })
      )}
    </>
  );
}

function SellSheet({
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
    <Sheet onClose={onClose}>
      <div className="eyebrow" style={{ width: 128 }}>
        Sell it back
      </div>
      <div className="price" style={{ fontSize: 52, marginTop: 14 }}>
        <span>${p.dollars}</span>
        <span className="price__cents">.{p.cents}</span>
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 13.5 }}>
        We&apos;ll take back your {label} table right now, with no waiting for someone else to want it.
        The money is on its way as soon as you confirm.
      </p>
      <button className="btn btn--primary btn--block" style={{ marginTop: 22 }} onClick={onConfirm}>
        Sell it back
      </button>
      <button className="btn btn--ghost btn--block" style={{ marginTop: 10 }} onClick={onClose}>
        Keep it
      </button>
    </Sheet>
  );
}
