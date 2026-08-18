/**
 * The interactive bit of the landing page: one table, priced across the run-up to service.
 *
 * Everything above this section on the page is an assertion — "the premium fades away again",
 * "most of what you pay is a credit off your bill". This is where the reader gets to check.
 * The numbers are computed in the browser from @ttr/shared-types, the same math the chain runs,
 * so scrubbing to three seconds before service shows the real answer rather than an illustration
 * of one.
 *
 * It demonstrates itself once, on approach, then hands over the scrubber. A visitor who never
 * touches it still sees the argument; a visitor who does can park it anywhere on the night.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { DECAY_PATH, POOL, START_HOURS, pricesAt, tauLabel, type DecayPoint } from './decay';
import { reveal, hoverLift, tapPress } from './motion';
import { AXIS, CHART, CHART_FILL, CHART_STROKE } from '@ttr/design/chart';

const LAB_URL = import.meta.env.VITE_LAB_URL ?? '/lab/';

/** One sweep from the shoulder to the door, in seconds. Slow enough to read the numbers move. */
const SWEEP_SECONDS = 9;

/**
 * The chart, in the same visual language as the diner app's curve: warm gradient stroke, soft
 * fill, dashed floor. Anyone who has seen the diner should recognise this on sight.
 *
 * No tooltip. The lab has one, and it earns it — there the reader is hunting for values. Here the
 * live readout under the chart already says what the dot is worth, and a hover card that competes
 * with it would just be a second answer to a question nobody asked twice.
 */
function Chart({ at }: { at: DecayPoint }) {
  return (
    <div className="decay__chart">
      <ResponsiveContainer>
        <AreaChart data={DECAY_PATH} margin={{ top: 16, right: 16, bottom: 6, left: 2 }}>
          <defs>
            <linearGradient id="decayStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset={CHART_STROKE[0].offset} stopColor={CHART_STROKE[0].color} />
              <stop offset={CHART_STROKE[1].offset} stopColor={CHART_STROKE[1].color} />
              <stop offset={CHART_STROKE[2].offset} stopColor={CHART_STROKE[2].color} />
            </linearGradient>
            <linearGradient id="decayFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_FILL.top} stopOpacity={CHART_FILL.topOpacity} />
              <stop offset="100%" stopColor={CHART_FILL.bottom} stopOpacity={CHART_FILL.bottomOpacity} />
            </linearGradient>
            <filter id="decayGlow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* τ counts DOWN left to right: the left edge is far out, the right edge is the door.
              Plotting it ascending would be technically fine and read backwards to everyone. */}
          {/* tickMargin on both axes: without it the first hour tick sits directly beneath the
              lowest dollar tick and the two labels touch in the corner */}
          <XAxis
            dataKey="tau"
            type="number"
            reversed
            domain={['dataMin', 'dataMax']}
            tick={AXIS}
            tickMargin={10}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) =>
              v <= 0 ? 'service' : v < 36 ? `${Math.round(v)}h` : `${Math.round(v / 24)}d`
            }
          />
          {/* The floor is the bottom of the story, so the scale stops just under it. At p0 - 6 a
              fifth of the plot was empty canvas below a line nothing ever crosses, which flattened
              the very fall the section exists to show. */}
          <YAxis
            domain={[POOL.p0 - 3, 'dataMax + 4']}
            tick={AXIS}
            tickMargin={8}
            axisLine={false}
            tickLine={false}
            width={46}
            tickFormatter={(v: number) => `$${Math.round(v)}`}
          />

          {/* The floor the whole thing collapses onto. Labelled on the left, where the curve is
              still up at its opening price: at the right the price has arrived on this very line,
              so the caption was sitting on top of the moment it describes. */}
          <ReferenceLine
            y={POOL.p0}
            stroke={CHART.floor}
            strokeDasharray="3 4"
            label={{
              value: 'DINNER CREDIT',
              position: 'insideBottomLeft',
              fontSize: 9,
              fill: CHART.label,
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />
          <ReferenceLine
            x={POOL.tcHours}
            stroke={CHART.onset}
            strokeDasharray="2 4"
            label={{
              value: 'PREMIUM STARTS FADING',
              position: 'insideTopLeft',
              fontSize: 9,
              fill: CHART.onsetLabel,
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />

          <Area
            type="monotone"
            dataKey="buy"
            stroke="url(#decayStroke)"
            strokeWidth={3}
            fill="url(#decayFill)"
            dot={false}
            isAnimationActive={false}
          />
          {/* what a holder walks away with, always under the buy line by the restaurant's cut */}
          <Line
            type="monotone"
            dataKey="payout"
            stroke={CHART.payout}
            strokeWidth={1.5}
            strokeDasharray="4 5"
            dot={false}
            isAnimationActive={false}
          />

          <ReferenceDot
            x={at.tau}
            y={at.buy}
            r={6.5}
            fill={CHART.cursor}
            stroke="#fff"
            strokeWidth={2.5}
            filter="url(#decayGlow)"
            isFront
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DecayDemo() {
  const [tau, setTau] = useState(START_HOURS);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const reduceMotion = Boolean(useReducedMotion());
  const disclose = useMemo(() => reveal(reduceMotion), [reduceMotion]);

  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.45 });

  /**
   * Play itself the first time it's reached — but only for readers who haven't asked for less
   * motion. MotionConfig covers Framer's transforms globally; a requestAnimationFrame loop is
   * invisible to it, so this one has to ask the media query directly. With reduced motion the
   * scrubber still works, it just waits to be dragged.
   */
  useEffect(() => {
    if (!inView || hasPlayed) return;
    if (reduceMotion) return;
    const t = setTimeout(() => {
      setPlaying(true);
      setHasPlayed(true);
    }, 550);
    return () => clearTimeout(t);
  }, [inView, hasPlayed, reduceMotion]);

  /** The sweep. Time-based rather than per-frame so it runs the same on a 60Hz and a 120Hz screen. */
  useEffect(() => {
    if (!playing) return;
    if (reduceMotion) {
      setPlaying(false);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTau((old) => Math.max(0, old - (START_HOURS / SWEEP_SECONDS) * dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduceMotion]);

  // stop at the door rather than looping. The end state is the thing being demonstrated, and a
  // loop would snatch it away the moment it lands.
  useEffect(() => {
    if (playing && tau <= 0) setPlaying(false);
  }, [playing, tau]);

  const now = pricesAt(tau);
  const at = DECAY_PATH.reduce((best, d) =>
    Math.abs(d.tau - tau) < Math.abs(best.tau - tau) ? d : best,
  );
  const atDoor = tau <= 0;

  /** Play from wherever it is; if it's already spent, rewind first. */
  function toggle() {
    setHasPlayed(true);
    if (playing) {
      setPlaying(false);
      return;
    }
    if (reduceMotion) {
      setTau((old) => (old <= 0.01 ? START_HOURS : 0));
      return;
    }
    if (tau <= 0.01) setTau(START_HOURS);
    setPlaying(true);
  }

  function scrub(v: number) {
    setPlaying(false);
    setHasPlayed(true);
    setTau(v);
  }

  return (
    <motion.div className="glass decay" ref={ref} variants={disclose}>
      <div className="decay__head">
        <div>
          <div className="stat-label">One table, one night</div>
          <p className="decay__caption">
            A {POOL.nMax}-seat Friday with {POOL.nSold} tables gone. Drag the night forward and
            watch what the {POOL.nMax - POOL.nSold} remaining are worth.
          </p>
        </div>
        <div className="decay__tau">{tauLabel(tau)}</div>
      </div>

      <Chart at={at} />

      <div className="decay__transport">
        <motion.button
          type="button"
          className="decay__play"
          onClick={toggle}
          whileHover={reduceMotion ? undefined : hoverLift}
          whileTap={reduceMotion ? undefined : tapPress}
          aria-label={playing ? 'Pause' : 'Play the night'}
        >
          <span aria-hidden>{playing ? '‖' : atDoor ? '↻' : '▶'}</span>
          {playing ? 'Pause' : atDoor ? 'Again' : 'Play the night'}
        </motion.button>

        {/* Reversed: dragging right moves toward service, matching the chart's x axis. Without
            this the slider and the thing it controls would run in opposite directions. */}
        <input
          className="decay__slider"
          type="range"
          min={0}
          max={START_HOURS}
          step={0.05}
          value={START_HOURS - tau}
          onChange={(e) => scrub(START_HOURS - Number(e.target.value))}
          aria-label="Time until service"
          aria-valuetext={tauLabel(tau)}
        />
      </div>

      <div className="decay__stats">
        <div className="decay__stat">
          <div className="stat-label">Costs to buy</div>
          <div className="decay__value">${now.buy.toFixed(2)}</div>
        </div>
        <div className="decay__stat">
          <div className="stat-label">Sells back for</div>
          <div className="decay__value">${now.payout.toFixed(2)}</div>
        </div>
        <div className="decay__stat">
          <div className="stat-label">Of that, dinner</div>
          <div className="decay__value">${POOL.p0.toFixed(2)}</div>
        </div>
        <div className="decay__stat">
          <div className="stat-label">Premium left</div>
          <div className="decay__value">{Math.round(now.thetaPct)}%</div>
        </div>
      </div>

      <p className="decay__note muted">
        {atDoor
          ? `The premium is gone. The table costs exactly the $${POOL.p0.toFixed(0)} of dinner it was always worth, and selling it back at this point returns $${now.payout.toFixed(2)} — the credit, less the restaurant's cut. Late in the night there is nothing left to speculate on, which is the point.`
          : now.thetaPct >= 99.9
            ? `Nothing has faded yet. $${now.premium.toFixed(2)} of that price is premium, and every hour from here gives some of it back.`
            : `$${(POOL.p0 + POOL.k * POOL.nSold - now.buy).toFixed(2)} of premium has burned off. It never comes back, and it was never dinner — the $${POOL.p0.toFixed(0)} underneath does not move.`}
      </p>

      <a className="decay__link" href={LAB_URL} target="_blank" rel="noreferrer">
        Turn the knobs yourself in the pricing lab
        <span aria-hidden>&#8599;</span>
      </a>
    </motion.div>
  );
}
