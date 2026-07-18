/**
 * Issuer dashboard (stream 5). The restaurant side of the demo: monitor every (night × band) pool,
 * check diners in, sweep after service, open new pools.
 *
 * Boundary rule (LOCKED §8): talks ONLY to app-services REST (§10.4 `/restaurant/*`). It never
 * touches the chain. Money is always a USDC base-unit string; splitUsdc/usdc do the arithmetic in
 * BigInt so no float ever touches it.
 *
 * Same visual family as the diner app (shared design system), but denser and more operational —
 * this is a screen someone works behind a host stand, not a consumer hero page.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, usdc, type CreatePoolRequest, type IssuerPoolDetail, type IssuerPoolRow } from './api';
import { PoolGrid } from './PoolGrid';
import { PoolDetail } from './PoolDetail';
import { SweepPanel } from './SweepPanel';
import { CreatePool } from './CreatePool';

type Tab = 'floor' | 'settle' | 'new';

export default function App() {
  const [pools, setPools] = useState<IssuerPoolRow[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<IssuerPoolDetail | null>(null);
  const [tab, setTab] = useState<Tab>('floor');
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const say = useCallback((m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 4500);
  }, []);

  const refresh = useCallback(async (id?: string) => {
    const rows = await api.pools();
    setPools(rows);
    const target = id ?? rows[0]?.pool_id ?? '';
    if (target) {
      setSelected(target);
      setDetail(await api.pool(target));
    }
  }, []);

  useEffect(() => {
    refresh().catch((e) => say(String(e instanceof Error ? e.message : e)));
  }, [refresh, say]);

  // poll so fill/reserve/royalties move live while diners trade in the other browser session
  // (§11 steps 2–3 — the curve ticking up and the royalty accruing on stage)
  useEffect(() => {
    if (!selected) return;
    const t = setInterval(async () => {
      try {
        const [rows, d] = await Promise.all([api.pools(), api.pool(selected)]);
        setPools(rows);
        setDetail(d);
      } catch {
        /* transient — keep the last good render rather than flashing an error */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [selected]);

  async function selectPool(id: string) {
    setSelected(id);
    setDetail(null);
    try {
      setDetail(await api.pool(id));
    } catch (e) {
      say(msg(e));
    }
  }

  async function checkin(userId: string) {
    setBusyUser(userId);
    try {
      await api.checkin(selected, userId);
      await refresh(selected);
      say(`${userId} checked in — table redeemed, their USDC stays in reserve.`);
    } catch (e) {
      say(msg(e));
    } finally {
      setBusyUser(null);
    }
  }

  async function sweep() {
    setBusy(true);
    try {
      const r = await api.sweep(selected);
      await refresh(selected);
      say(
        `Swept ${usdc(r.amount_swept)} — ${r.forfeited_count} no-show${
          r.forfeited_count === 1 ? '' : 's'
        } recovered, ${usdc(r.credits_to_honor)} in credits to honor.`,
      );
    } catch (e) {
      say(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function freeze() {
    setBusy(true);
    try {
      await api.demoFreeze(selected);
      await refresh(selected);
      say('Service reached — trading halted. The pool can now settle.');
    } catch (e) {
      say(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function createPool(body: CreatePoolRequest) {
    setBusy(true);
    try {
      const { pool_id } = await api.createPool(body);
      await refresh(pool_id);
      setTab('floor');
      say(`Pool open — ${body.n_max} tables seating up to ${body.party_size}.`);
    } catch (e) {
      say(msg(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  // venue-wide totals across every pool — what the owner actually cares about
  const totals = pools.reduce(
    (a, p) => ({
      reserve: a.reserve + BigInt(p.reserve_balance),
      royalties: a.royalties + BigInt(p.royalties_accrued),
      sold: a.sold + p.n_sold,
      cap: a.cap + p.n_max,
    }),
    { reserve: 0n, royalties: 0n, sold: 0, cap: 0 },
  );
  const fillPct = totals.cap > 0 ? Math.round((totals.sold / totals.cap) * 100) : 0;

  return (
    <>
      <div className="orbs">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <div className="shell shell--ops">
        <header className="topbar" style={{ marginBottom: 28 }}>
          <div className="brand">
            <span className="brand-dots">
              <i />
              <i />
            </span>
            Prime · Issuer
          </div>
          <div className="tabs">
            <button className={tab === 'floor' ? 'tab--on' : ''} onClick={() => setTab('floor')}>
              Floor
            </button>
            <button className={tab === 'settle' ? 'tab--on' : ''} onClick={() => setTab('settle')}>
              Settle
            </button>
            <button className={tab === 'new' ? 'tab--on' : ''} onClick={() => setTab('new')}>
              New pool
            </button>
          </div>
        </header>

        <h1 className="headline" style={{ fontSize: 'clamp(32px, 4.2vw, 56px)' }}>
          Your no-shows are
          <br />
          <span className="script">earning</span> tonight.
        </h1>

        {/* venue-wide KPI strip */}
        <div className="kpis" style={{ marginTop: 30 }}>
          <div className="glass kpi">
            <div className="stat-label">Royalties accrued</div>
            <MoneyKpi base={totals.royalties.toString()} accent />
            <div className="kpi__sub">Your spread on every resale, across all pools.</div>
          </div>
          <div className="glass kpi">
            <div className="stat-label">Reserve held</div>
            <MoneyKpi base={totals.reserve.toString()} />
            <div className="kpi__sub">Fully collateralizes every outstanding table.</div>
          </div>
          <div className="glass kpi">
            <div className="stat-label">Tables claimed</div>
            <div className="kpi__value">
              {totals.sold}
              <span className="kpi__cents"> / {totals.cap}</span>
            </div>
            <div className="kpi__sub">{fillPct}% of inventory across every night and band.</div>
          </div>
          <div className="glass kpi">
            <div className="stat-label">Pools open</div>
            <div className="kpi__value">{pools.filter((p) => !p.settled).length}</div>
            <div className="kpi__sub">One per night × party-size band.</div>
          </div>
        </div>

        <div style={{ marginTop: 34 }}>
          {tab === 'new' ? (
            <CreatePool onCreate={createPool} busy={busy} />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)',
                gap: 20,
                alignItems: 'start',
              }}
            >
              {/* left rail: every pool */}
              <div className="scroll-y" style={{ maxHeight: '78vh', paddingRight: 4 }}>
                <PoolGrid pools={pools} selected={selected} onSelect={selectPool} />
              </div>

              {/* right: the selected pool */}
              <div>
                {!detail ? (
                  <div className="glass" style={{ padding: 40 }}>
                    <p className="muted">
                      {pools.length === 0
                        ? 'No pools yet — open one from the New pool tab.'
                        : 'Loading pool…'}
                    </p>
                  </div>
                ) : tab === 'settle' ? (
                  <SweepPanel pool={detail} onSweep={sweep} onFreeze={freeze} busy={busy} />
                ) : (
                  <PoolDetail pool={detail} onCheckin={checkin} busy={busyUser} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
            maxWidth: 'min(620px, 92vw)',
            textAlign: 'center',
          }}
        >
          {flash}
        </div>
      )}
    </>
  );
}

function MoneyKpi({ base, accent }: { base: string; accent?: boolean }) {
  const [d, c] = usdc(base).replace('$', '').split('.');
  return (
    <div className="kpi__value" style={accent ? { color: 'var(--coral-deep)' } : undefined}>
      <span>${d}</span>
      <span className="kpi__cents">.{c}</span>
    </div>
  );
}

function msg(e: unknown): string {
  return String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, '');
}
