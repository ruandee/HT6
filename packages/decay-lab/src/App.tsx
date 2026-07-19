/**
 * hora decay lab. A model of what time does to the price, for explaining the mechanism to
 * someone who has not read §7b.
 *
 * It talks to nothing. There is no server, no pool, no wallet: every number is computed in the
 * browser from @ttr/shared-types, the same math the chain runs. That makes it safe to open in
 * front of anyone and safe to scrub to a state the real demo could never reach on stage, like
 * three seconds before service.
 *
 * The argument the page is built to make, in order: the premium is time, the floor is not, and
 * a holder who bails early is paid out of premium that was going to evaporate anyway.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import { CurveChart, DecayChart } from './Charts';
import { Controls } from './Controls';
import { curve, decayPath, DEFAULTS, pricesAt, tauLabel, type Params } from './model';
import { fadeUp, group } from './motion';

export default function App() {
  const [p, setP] = useState<Params>(DEFAULTS);
  const [playing, setPlaying] = useState(false);

  const set = <K extends keyof Params>(key: K, v: Params[K]) => setP((old) => ({ ...old, [key]: v }));

  /** the scrubber, running itself. One sweep from the shoulder to the door takes ~9 seconds. */
  useEffect(() => {
    if (!playing) return;
    const span = Math.max(p.tcHours * 1.35, 1);
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setP((old) => {
        const next = old.tauHours - (span / 9) * dt;
        if (next <= 0) return { ...old, tauHours: 0 };
        return { ...old, tauHours: next };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, p.tcHours]);

  // stop at the door rather than looping. The end state is the thing being demonstrated.
  useEffect(() => {
    if (playing && p.tauHours <= 0) setPlaying(false);
  }, [playing, p.tauHours]);

  const now = useMemo(() => pricesAt(p, p.tauHours), [p]);
  const atFull = useMemo(() => pricesAt(p, p.tcHours * 2), [p]);
  const curveData = useMemo(() => curve(p, p.tauHours), [p]);
  const decayData = useMemo(() => decayPath(p), [p]);

  const thetaPct = now.thetaBps / 100;
  const burned = atFull.buy - now.buy;

  function replay() {
    setP((old) => ({ ...old, tauHours: Math.max(old.tcHours * 1.35, 1) }));
    setPlaying(true);
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="orbs">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <motion.div className="shell lab" variants={group(0.07)} initial="hidden" animate="show">
        <motion.header className="topbar" variants={fadeUp}>
          <div className="brand">
            <span className="brand-dots">
              <i />
              <i />
            </span>
            hora
          </div>
          <div className="eyebrow">Pricing model</div>
        </motion.header>

        <motion.h1 className="headline" variants={fadeUp}>
          The premium is
          <br />
          <span className="script">time</span>.
        </motion.h1>
        <motion.p className="muted" variants={fadeUp} style={{ maxWidth: 440, marginTop: 20 }}>
          A table is a meal credit with a price on top. The credit holds its value all the way to
          service. The price on top does not, and this is the shape it loses.
        </motion.p>

        {/* ---- the live readout ---- */}
        <motion.section className="lab__readout" variants={fadeUp}>
          <div className="lab__now glass glass--strong">
            <div className="stat-label">Table #{p.nSold + 1} costs</div>
            <div className="lab__price">
              <span className="lab__price-dollars">${Math.floor(now.buy)}</span>
              <span className="lab__price-cents">
                .{String(Math.round((now.buy % 1) * 100)).padStart(2, '0')}
              </span>
            </div>
            <div className="lab__split">
              <div
                className="lab__split-credit"
                style={{ width: `${(p.p0 / Math.max(now.buy, 0.01)) * 100}%` }}
              />
            </div>
            <div className="lab__legend">
              <span>
                <i className="dot dot--credit" /> ${p.p0.toFixed(2)} meal credit
              </span>
              <span>
                <i className="dot dot--premium" /> ${now.premium.toFixed(2)} premium
              </span>
            </div>
          </div>

          <div className="lab__stats">
            <Stat label="θ right now" value={`${thetaPct.toFixed(1)}%`} sub={tauLabel(p.tauHours)} />
            <Stat
              label="Premium burned"
              value={`$${burned.toFixed(2)}`}
              sub={burned <= 0.005 ? 'decay has not started' : 'gone since listing'}
            />
            <Stat
              label="Sells back for"
              value={`$${now.payout.toFixed(2)}`}
              sub={`after your ${p.phiPct}% cut`}
            />
            <Stat
              label="You keep"
              value={`$${now.royalty.toFixed(2)}`}
              sub="per resale, at this price"
            />
          </div>
        </motion.section>

        {/* ---- the scrubber: the one control that matters ---- */}
        <motion.section className="glass lab__scrub" variants={fadeUp}>
          <div className="lab__scrub-head">
            <div>
              <div className="eyebrow">Time until service</div>
              <div className="lab__tau">{tauLabel(p.tauHours)}</div>
            </div>
            <button className="btn btn--primary" onClick={playing ? () => setPlaying(false) : replay}>
              {playing ? 'Pause' : p.tauHours <= 0 ? 'Replay' : 'Run to service'}
            </button>
          </div>
          <input
            className="slider slider--time"
            type="range"
            min={0}
            max={Math.max(p.tcHours * 1.35, 1)}
            step={0.05}
            value={p.tauHours}
            onChange={(e) => {
              setPlaying(false);
              set('tauHours', Number(e.target.value));
            }}
            aria-label="Time until service, hours"
          />
          <div className="lab__scrub-scale">
            <span>listed</span>
            <span>decay begins</span>
            <span>service</span>
          </div>
        </motion.section>

        {/* ---- the two charts ---- */}
        <motion.div className="lab__charts" variants={group(0.08)}>
          <motion.section className="glass lab__panel" variants={fadeUp}>
            <div className="lab__panel-head">
              <div className="eyebrow">The curve, flattening</div>
              <div className="lab__panel-note">
                {thetaPct >= 99.9
                  ? 'Full premium'
                  : thetaPct <= 0
                    ? 'Collapsed onto the credit'
                    : `θ = ${thetaPct.toFixed(1)}%`}
              </div>
            </div>
            <CurveChart data={curveData} p={p} thetaPct={thetaPct} />
            <p className="muted lab__caption">
              Every table on the curve loses the same fraction of its premium at once, so the whole
              line sinks toward the meal credit rather than sliding along it. The dashed line is
              where it started.
            </p>
          </motion.section>

          <motion.section className="glass lab__panel" variants={fadeUp}>
            <div className="lab__panel-head">
              <div className="eyebrow">One table, to the door</div>
              <div className="lab__panel-note">Tc = {p.tcHours}h</div>
            </div>
            <DecayChart data={decayData} p={p} tauHours={p.tauHours} />
            <p className="muted lab__caption">
              Flat while there is time, then a straight bleed once inside the decay window. The
              dashed line underneath is what a holder walks away with after your cut.
            </p>
          </motion.section>
        </motion.div>

        {/* ---- the parameters ---- */}
        <motion.section className="glass lab__panel" variants={fadeUp}>
          <div className="eyebrow" style={{ marginBottom: 18 }}>
            Pool parameters
          </div>
          <Controls p={p} onChange={set} />
        </motion.section>

        <motion.section className="lab__notes" variants={fadeUp}>
          <h2 className="lab__notes-title">Why it is built this way</h2>
          <div className="lab__notes-grid">
            <Note title="The floor never moves">
              p0 is a meal credit, and a credit does not care what time it is. That is what stops a
              table from going to zero and what makes selling back safe to offer.
            </Note>
            <Note title="Only the premium decays">
              θ multiplies the k·n term and nothing else. Scarcity is worth paying for while there
              is still a night to be scarce about.
            </Note>
            <Note title="Decay is linear, and starts late">
              θ holds at 100% until τ drops inside Tc, then falls straight to zero. A cliff would
              be gameable; a curve would be hard to explain. A ramp is neither.
            </Note>
            <Note title="Early exits are paid from evaporating value">
              Someone who sells back a day out gives up premium that was going to burn off anyway.
              The reserve covers it, and your cut comes off the top.
            </Note>
          </div>
        </motion.section>

        <motion.p className="footnote" variants={fadeUp}>
          Every price here comes from the same module the chain prices against. Nothing on this
          page is a re-derivation, and nothing is connected to a live pool.
        </motion.p>
      </motion.div>
    </MotionConfig>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass lab__stat">
      <div className="stat-label">{label}</div>
      <div className="lab__stat-value">{value}</div>
      <div className="lab__stat-sub">{sub}</div>
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lab__note">
      <div className="lab__note-title">{title}</div>
      <p className="lab__note-body">{children}</p>
    </div>
  );
}
