import { useCallback, useEffect, useRef, useState } from 'react';
import { api, splitUsdc, usdc, type Holding, type Quote } from './api';
import { CurveChart } from './CurveChart';
import { BuySheet } from './BuySheet';

// demo pool params (§7d) — mirrors what app-services seeds.
const P0 = '40000000';
const K = '3000000';

export default function App() {
  const [poolId, setPoolId] = useState('');
  const [q, setQ] = useState<Quote | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [sheet, setSheet] = useState<null | { intentId: string; price: string; expires: string }>(
    null,
  );
  const [flash, setFlash] = useState<string | null>(null);
  const prevN = useRef(0);

  const refresh = useCallback(async (id: string) => {
    const [quote, hs] = await Promise.all([api.quote(id), api.holdings()]);
    setQ(quote);
    setHoldings(hs);
    return quote;
  }, []);

  useEffect(() => {
    api.demoPoolId().then(({ pool_id }) => {
      setPoolId(pool_id);
      refresh(pool_id);
    });
  }, [refresh]);

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
    const r = await api.buy(poolId);
    setSheet({ intentId: r.deposit_intent_id, price: r.max_price, expires: r.expires_at });
  }

  async function confirmBuy(intentId: string) {
    await api.stubSettle(intentId, 'succeeded');
    setSheet(null);
    const quote = await refresh(poolId);
    setFlash(`Table secured — curve moved to ${usdc(quote.buy_price)}`);
    setTimeout(() => setFlash(null), 4200);
  }

  async function sellBack() {
    const r = await api.sell(poolId);
    await refresh(poolId);
    setFlash(`Sold back — ${usdc(r.payout_amount)} returned to you`);
    setTimeout(() => setFlash(null), 4200);
  }

  const held = holdings.filter((h) => h.status === 'held');
  const price = q ? splitUsdc(q.buy_price) : { dollars: '—', cents: '00' };
  const left = q ? q.n_max - q.n_sold : 0;

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
          <div className="eyebrow" style={{ width: 210 }}>
            Fri 7–9pm
          </div>
        </header>

        <h1 className="headline">
          Tonight&apos;s table is
          <br />
          <span className="script">selling</span> right now.
        </h1>
        <p className="muted" style={{ maxWidth: 430, marginTop: 20 }}>
          The price rises as tables go. Can&apos;t make it? Sell it back to the curve
          instantly — always liquid, no waiting for a buyer.
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
            <div className="eyebrow" style={{ marginBottom: 18 }}>
              Live price curve
            </div>
            {q && (
              <CurveChart
                p0={P0}
                k={K}
                nMax={q.n_max}
                nSold={q.n_sold}
                thetaBps={q.theta_bps}
              />
            )}
            <div style={{ marginTop: 20 }}>
              <div className="stat-label" style={{ marginBottom: 9 }}>
                {q ? `${q.n_sold} of ${q.n_max} claimed` : 'loading'}
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
            <div className="eyebrow" style={{ marginBottom: 16 }}>
              Price now
            </div>
            <div className="price price--hero">
              <span>${price.dollars}</span>
              <span className="price__cents">.{price.cents}</span>
            </div>
            <div className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>
              <strong style={{ color: 'var(--ink)' }}>{usdc(P0)}</strong> of this is meal
              credit — redeemable against your bill.
              {left > 0 && (
                <>
                  {' '}
                  Only <strong style={{ color: 'var(--coral-deep)' }}>{left}</strong> left.
                </>
              )}
            </div>

            <button
              className="btn btn--primary"
              style={{ width: '100%', marginTop: 26 }}
              onClick={startBuy}
              disabled={!q || q.frozen || left === 0}
            >
              Claim this table
            </button>

            {held.length > 0 && (
              <>
                <div
                  style={{
                    height: 1,
                    background: 'var(--hairline)',
                    margin: '26px 0 22px',
                  }}
                />
                <div className="eyebrow" style={{ marginBottom: 12 }}>
                  You hold {held.length}
                </div>
                <div className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
                  Recover{' '}
                  <strong style={{ color: 'var(--ink)' }}>
                    {usdc(held[0]!.recover_value)}
                  </strong>{' '}
                  if you sell back now.
                </div>
                <button className="btn btn--ghost" style={{ width: '100%' }} onClick={sellBack}>
                  Can&apos;t make it? Sell back
                </button>
              </>
            )}
          </section>
        </div>
      </div>

      {sheet && (
        <BuySheet
          price={sheet.price}
          expiresAt={sheet.expires}
          onConfirm={() => confirmBuy(sheet.intentId)}
          onExpire={async () => {
            await api.stubSettle(sheet.intentId, 'expired');
            setSheet(null);
            setFlash('Quote window lapsed — price moved. Try again.');
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
