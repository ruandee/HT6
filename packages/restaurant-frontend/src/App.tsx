/**
 * Issuer dashboard (stream 5). The restaurant side of the demo: monitor every (night × band) pool,
 * check diners in, sweep after service, open new pools.
 *
 * Boundary rule (LOCKED §8): talks ONLY to app-services REST (§10.4 `/restaurant/*`). It never
 * touches the chain. Money is always a USDC base-unit string; splitUsdc/usdc do the arithmetic in
 * BigInt so no float ever touches it.
 *
 * Same visual family as the diner app (shared design system), but denser and more operational.
 * Someone works this screen from behind a host stand, so it reads like a tool.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { api, usdc, type CreatePoolRequest, type IssuerPoolDetail, type IssuerPoolRow } from './api';
import { PoolGrid } from './PoolGrid';
import { PoolDetail } from './PoolDetail';
import { DemoClock } from './DemoClock';
import { SweepPanel } from './SweepPanel';
import { CreatePool } from './CreatePool';
import { ease, fadeUp, group, pill, swap } from './motion';

type Tab = 'floor' | 'settle' | 'new';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'floor', label: 'Floor' },
  { id: 'settle', label: 'Settle' },
  { id: 'new', label: 'New pool' },
];

export default function App() {
  const [pools, setPools] = useState<IssuerPoolRow[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<IssuerPoolDetail | null>(null);
  const [tab, setTab] = useState<Tab>('floor');
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
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
  // (§11 steps 2 and 3: the curve ticking up and the royalty accruing on stage)
  useEffect(() => {
    if (!selected) return;
    const t = setInterval(async () => {
      try {
        const [rows, d] = await Promise.all([api.pools(), api.pool(selected)]);
        setPools(rows);
        setDetail(d);
      } catch {
        /* transient, so keep the last good render instead of flashing an error */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [selected]);

  async function selectPool(id: string) {
    if (id === selected) return;
    setSelected(id);
    // Keep the outgoing panel on screen while the next one loads. Blanking to null here is what
    // made the swap flash an empty box and jump the page height.
    setPending(true);
    try {
      setDetail(await api.pool(id));
    } catch (e) {
      say(msg(e));
    } finally {
      setPending(false);
    }
  }

  async function checkin(userId: string) {
    setBusyUser(userId);
    try {
      await api.checkin(selected, userId);
      await refresh(selected);
      say(`${userId} checked in.`);
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
        `${usdc(r.amount_swept)} swept, ${r.forfeited_count} no-show${
          r.forfeited_count === 1 ? '' : 's'
        }, ${usdc(r.credits_to_honor)} in credits to honor.`,
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
      say('Service time. Trading is closed, and you can settle now.');
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
      say(`Pool open with ${body.n_max} tables, up to ${body.party_size} seats.`);
    } catch (e) {
      say(msg(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  // venue-wide totals across every pool, which is what the owner actually cares about
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
    <MotionConfig reducedMotion="user">
      <div className="orbs orbs--drift">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <motion.div
        className="shell shell--ops"
        variants={group(0.06)}
        initial="hidden"
        animate="show"
      >
        <motion.header className="topbar" variants={fadeUp} style={{ marginBottom: 28 }}>
          <div className="brand">
            <span className="brand-dots">
              <i />
              <i />
            </span>
            hora · restaurant
          </div>
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'tab--on' : ''}
                onClick={() => setTab(t.id)}
              >
                {/* one shared element slides between tabs instead of three separate
                    backgrounds blinking on and off */}
                {tab === t.id && (
                  <motion.span layoutId="tab-pill" className="tab__pill" transition={pill} />
                )}
                <span className="tab__label">{t.label}</span>
              </button>
            ))}
          </div>
        </motion.header>

        {/* venue-wide KPI strip. This is the top of the page now: the numbers are the headline,
            and a slogan above them only pushed them below the fold. */}
        <motion.div className="kpis" variants={group(0.055)} style={{ marginTop: 8 }}>
          <motion.div className="glass kpi" variants={fadeUp}>
            <div className="stat-label">Royalties</div>
            <MoneyKpi base={totals.royalties.toString()} accent />
            <div className="kpi__sub">Your cut of every resale.</div>
          </motion.div>
          <motion.div className="glass kpi" variants={fadeUp}>
            <div className="stat-label">Reserve</div>
            <MoneyKpi base={totals.reserve.toString()} />
            <div className="kpi__sub">Backs every table sold.</div>
          </motion.div>
          <motion.div className="glass kpi" variants={fadeUp}>
            <div className="stat-label">Tables sold</div>
            <div className="kpi__value">
              {totals.sold}
              <span className="kpi__cents"> / {totals.cap}</span>
            </div>
            <div className="kpi__sub">{fillPct}% full.</div>
          </motion.div>
          <motion.div className="glass kpi" variants={fadeUp}>
            <div className="stat-label">Pools open</div>
            <div className="kpi__value">{pools.filter((p) => !p.settled).length}</div>
            <div className="kpi__sub">One per night, per party size.</div>
          </motion.div>
        </motion.div>

        {/* position:relative anchors the outgoing tab panel, which popLayout takes out of flow */}
        <motion.div variants={fadeUp} style={{ marginTop: 34, position: 'relative' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {tab === 'new' ? (
              <motion.div key="new" variants={swap} initial="hidden" animate="show" exit="exit">
                <CreatePool onCreate={createPool} busy={busy} />
              </motion.div>
            ) : (
              <motion.div
                key="board"
                variants={swap}
                initial="hidden"
                animate="show"
                exit="exit"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)',
                  gap: 20,
                  alignItems: 'start',
                }}
              >
                {/* left rail: the demo clock, then every pool */}
                <div className="scroll-y" style={{ maxHeight: '78vh', paddingRight: 4 }}>
                  {/* §11 step 4. θ is global, so this moves every curve at once — refresh the
                      selected pool afterwards so the chart redraws at the decayed price. */}
                  <DemoClock onChange={() => refresh(selected)} busy={busy} />
                  <PoolGrid pools={pools} selected={selected} onSelect={selectPool} />
                </div>

                {/* right: the selected pool. popLayout pulls the outgoing panel out of flow so
                    the incoming one takes its place immediately, so you get a crossfade and never
                    a gap. Keyed on pool+tab, so the 2.5s poll never retriggers it. */}
                <motion.div
                  className="swap"
                  animate={{ opacity: pending ? 0.7 : 1 }}
                  transition={ease(0.2)}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {!detail ? (
                      <motion.div
                        key="empty"
                        className="glass"
                        variants={swap}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        style={{ padding: 40 }}
                      >
                        <p className="muted">
                          {pools.length === 0
                            ? 'No pools yet. Open one from the New pool tab.'
                            : 'Loading…'}
                        </p>
                      </motion.div>
                    ) : tab === 'settle' ? (
                      <motion.div
                        key={`${detail.pool_id}-settle`}
                        variants={swap}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                      >
                        <SweepPanel pool={detail} onSweep={sweep} onFreeze={freeze} busy={busy} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`${detail.pool_id}-floor`}
                        variants={swap}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                      >
                        <PoolDetail pool={detail} onCheckin={checkin} busy={busyUser} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {flash && (
          <motion.div
            className="glass"
            /* x stays at -50% through every state, because motion writes `transform` wholesale and the
               usual translateX(-50%) centering trick would be overwritten */
            initial={{ opacity: 0, x: '-50%', y: 10, scale: 0.98 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: 6, scale: 0.98 }}
            transition={ease(0.26)}
            style={{
              position: 'fixed',
              bottom: 26,
              left: '50%',
              padding: '15px 26px',
              zIndex: 30,
              fontSize: 14,
              fontWeight: 500,
              maxWidth: 'min(620px, 92vw)',
              textAlign: 'center',
            }}
          >
            {flash}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
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
