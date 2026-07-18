import { useCallback, useEffect, useRef, useState } from 'react';
import { api, splitUsdc, usdc, type Holding, type PoolSummary, type Quote } from './api';
import { CurveChart } from './CurveChart';
import { BuySheet } from './BuySheet';
import { DatePicker } from './DatePicker';
import { PartySize, bandFor } from './PartySize';

// p0/k per band, mirroring the server's BANDS table (§4a). Used to draw the curve.
const BAND_PARAMS: Record<number, { p0: string; k: string }> = {
  2: { p0: '40000000', k: '3000000' },
  4: { p0: '80000000', k: '6000000' },
};

export default function App() {
  const [poolId, setPoolId] = useState('');
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [guests, setGuests] = useState(2);
  const [q, setQ] = useState<Quote | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [sheet, setSheet] = useState<null | { intentId: string; price: string; expires: string }>(
    null,
  );
  const [flash, setFlash] = useState<string | null>(null);
  const prevN = useRef(0);

  const refresh = useCallback(async (id: string) => {
    const [quote, hs, ps] = await Promise.all([api.quote(id), api.holdings(), api.pools()]);
    setQ(quote);
    setHoldings(hs);
    setPools(ps);
    return quote;
  }, []);

  useEffect(() => {
    api.demoPoolId().then(({ pool_id }) => {
      setPoolId(pool_id);
      refresh(pool_id);
    });
  }, [refresh]);

  function selectPool(id: string) {
    setPoolId(id);
    setQ(null); // avoid showing the previous night's curve while the new one loads
    refresh(id);
  }

  const currentPool = pools.find((p) => p.pool_id === poolId);
  // all bands offered on the selected night, and the dates available in the chosen band
  const bandsTonight = currentPool
    ? pools.filter((p) => p.date_iso === currentPool.date_iso)
    : [];
  const datesInBand = currentPool
    ? pools.filter((p) => p.party_size === currentPool.party_size)
    : [];

  /** Changing party size keeps the date and swaps to the band that fits. */
  function selectGuests(n: number) {
    setGuests(n);
    const target = bandFor(bandsTonight, n);
    if (target && target.pool_id !== poolId) selectPool(target.pool_id);
  }

  // poll so the curve moves when other sessions buy (the §11 "ticks up" moment)
  useEffect(() => {
    if (!poolId) return;
    const t = setInterval(() => refresh(poolId), 2500);
    return () => clearInterval(t);
  }, [poolId, refresh]);

  useEffect(() => {
    if (q && q.n_sold !== prevN.current) prevN.current = q.n_sold;
  }, [q]);

  async function startBuy() {
    try {
      const r = await api.buy(poolId);
      setSheet({ intentId: r.deposit_intent_id, price: r.max_price, expires: r.expires_at });
    } catch (e) {
      setFlash(String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, ''));
      setTimeout(() => setFlash(null), 4200);
    }
  }

  async function confirmBuy(intentId: string) {
    await api.stubSettle(intentId, 'succeeded');
    setSheet(null);
    const label = currentPool?.label;
    await refresh(poolId);
    setFlash(label ? `You're in. See you ${label}.` : "You're in.");
    setTimeout(() => setFlash(null), 4200);
  }

  async function sellBack() {
    const r = await api.sell(poolId);
    await refresh(poolId);
    setFlash(`${usdc(r.payout_amount)} back in your account.`);
    setTimeout(() => setFlash(null), 4200);
  }

  // scope to the night being viewed — sell-back acts on this pool's token.
  const held = holdings.filter((h) => h.status === 'held' && h.pool_id === poolId);
  // §7c-C is per SERVICE WINDOW, so holding any band tonight blocks buying another.
  const windowPoolIds = new Set(bandsTonight.map((b) => b.pool_id));
  const heldThisWindow = holdings.filter(
    (h) => h.status === 'held' && windowPoolIds.has(h.pool_id),
  );
  const heldOtherBand = heldThisWindow.filter((h) => h.pool_id !== poolId);
  const heldElsewhere = holdings.filter(
    (h) => h.status === 'held' && !windowPoolIds.has(h.pool_id),
  );
  const price = q ? splitUsdc(q.buy_price) : { dollars: '—', cents: '00' };
  const left = q ? q.n_max - q.n_sold : 0;
  const floorP0 = currentPool
    ? (BAND_PARAMS[currentPool.party_size]?.p0 ?? '40000000')
    : '40000000';

  return (
    <>
      <div className="orbs">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-dots">
              <i />
              <i />
            </span>
            Prime
          </div>
          <DatePicker pools={datesInBand} selected={poolId} onSelect={selectPool} />
        </header>

        <h1 className="headline">
          The good tables
          <br />
          go <span className="script">fast</span>.
        </h1>
        <p className="muted" style={{ maxWidth: 380, marginTop: 20 }}>
          Plans change. Sell your table back anytime before service.
        </p>

        {/* ---- main grid ---- */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)',
            gap: 22,
            marginTop: 46,
            alignItems: 'start',
          }}
        >
          {/* curve panel */}
          <section className="glass" style={{ padding: 26 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 18,
                gap: 16,
              }}
            >
              <div className="eyebrow" style={{ flex: 1 }}>
                Tonight&apos;s pricing
              </div>
            </div>
            {q && currentPool ? (
              <CurveChart
                p0={BAND_PARAMS[currentPool.party_size]?.p0 ?? '40000000'}
                k={BAND_PARAMS[currentPool.party_size]?.k ?? '3000000'}
                nMax={q.n_max}
                nSold={q.n_sold}
                thetaBps={q.theta_bps}
                phiBps={500}
              />
            ) : (
              <div style={{ height: 260 }} />
            )}
            <div style={{ marginTop: 20 }}>
              <div className="stat-label" style={{ marginBottom: 9 }}>
                {q ? `${q.n_sold} of ${q.n_max} taken` : ' '}
              </div>
              <div className="pips">
                {q &&
                  Array.from({ length: q.n_max }, (_, i) => (
                    <span key={i} className={`pip ${i < q.n_sold ? 'pip--sold' : ''}`} />
                  ))}
              </div>
            </div>
          </section>

          {/* buy panel */}
          <section className="glass glass--strong" style={{ padding: 30 }}>
            <PartySize bands={bandsTonight} guests={guests} onGuests={selectGuests} />

            <div
              style={{ height: 1, background: 'var(--hairline)', margin: '24px 0 22px' }}
            />

            <div className="eyebrow" style={{ marginBottom: 16 }}>
              Right now
            </div>
            <div className="price price--hero">
              <span>${price.dollars}</span>
              <span className="price__cents">.{price.cents}</span>
            </div>
            <div className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>
              {usdc(floorP0)} comes off your bill.
              {left > 0 && left <= 5 && (
                <>
                  {' '}
                  <strong style={{ color: 'var(--coral-deep)' }}>
                    {left} left.
                  </strong>
                </>
              )}
            </div>

            <button
              className="btn btn--primary"
              style={{ width: '100%', marginTop: 26 }}
              onClick={startBuy}
              disabled={!q || q.frozen || left === 0 || heldThisWindow.length > 0}
            >
              {heldThisWindow.length > 0
                ? "You're booked"
                : left === 0
                  ? 'Sold out'
                  : 'Claim this table'}
            </button>
            {heldOtherBand.length > 0 && (
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink-45)',
                  textAlign: 'center',
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                You have the table for{' '}
                {bandsTonight.find((b) => b.pool_id === heldOtherBand[0]!.pool_id)?.party_size ??
                  ''}{' '}
                this night.
              </div>
            )}

            {held.length > 0 && (
              <>
                <div
                  style={{
                    height: 1,
                    background: 'var(--hairline)',
                    margin: '26px 0 22px',
                  }}
                />
                <div className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
                  Worth{' '}
                  <strong style={{ color: 'var(--ink)' }}>
                    {usdc(held[0]!.recover_value)}
                  </strong>{' '}
                  back right now.
                </div>
                <button className="btn btn--ghost" style={{ width: '100%' }} onClick={sellBack}>
                  Can&apos;t make it? Sell it back
                </button>
              </>
            )}

            {heldElsewhere.length > 0 && (
              <div
                className="muted"
                style={{ fontSize: 12.5, marginTop: 18, color: 'var(--ink-45)' }}
              >
                Also booked:{' '}
                {heldElsewhere
                  .map((h) => pools.find((p) => p.pool_id === h.pool_id)?.label ?? 'another night')
                  .join(', ')}
              </div>
            )}
          </section>
        </div>
      </div>

      {sheet && (
        <BuySheet
          price={sheet.price}
          floor={floorP0}
          partySize={currentPool?.party_size ?? 2}
          expiresAt={sheet.expires}
          onConfirm={() => confirmBuy(sheet.intentId)}
          onExpire={async () => {
            await api.stubSettle(sheet.intentId, 'expired');
            setSheet(null);
            setFlash('That price expired. Have another look.');
            setTimeout(() => setFlash(null), 4200);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {flash && (
        <div
          className="glass fade-in"
          style={{
            position: 'fixed',
            bottom: 26,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '15px 26px',
            zIndex: 30,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {flash}
        </div>
      )}
    </>
  );
}
