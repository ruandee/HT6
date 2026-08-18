/**
 * The two charts, sharing the diner app's visual language: warm gradient stroke, soft fill,
 * dashed floor line, glass tooltip. Anyone who has seen the diner curve should recognise these
 * on sight, because they are the same curve with the time axis exposed.
 */
import {
  Area,
  AreaChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CurvePoint, DecayPoint, Params } from './model';
import { tauLabel } from './model';
import { AXIS, CHART, CHART_FILL, CHART_STROKE } from '@ttr/design/chart';


/** Shared gradient + glow defs. Duplicated ids across two charts would collide, hence the prefix. */
function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}Stroke`} x1="0" y1="0" x2="1" y2="0">
        <stop offset={CHART_STROKE[0].offset} stopColor={CHART_STROKE[0].color} />
        <stop offset={CHART_STROKE[1].offset} stopColor={CHART_STROKE[1].color} />
        <stop offset={CHART_STROKE[2].offset} stopColor={CHART_STROKE[2].color} />
      </linearGradient>
      <linearGradient id={`${id}Fill`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={CHART_FILL.top} stopOpacity={CHART_FILL.topOpacity} />
        <stop offset="100%" stopColor={CHART_FILL.bottom} stopOpacity={CHART_FILL.bottomOpacity} />
      </linearGradient>
      <filter id={`${id}Glow`} x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur stdDeviation="5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function Tip({ title, rows, note }: { title: string; rows: [string, string][]; note?: string }) {
  return (
    <div
      className="glass glass--strong"
      style={{ padding: '13px 15px', minWidth: 186, borderRadius: 16 }}
    >
      <div className="stat-label" style={{ marginBottom: 9 }}>
        {title}
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.8, color: 'var(--ink-70)' }}>
        {rows.map(([l, v]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span>{l}</span>
            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
      {note && (
        <div
          style={{
            marginTop: 9,
            paddingTop: 8,
            borderTop: '1px solid var(--hairline)',
            fontSize: 11,
            color: 'var(--ink-45)',
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * The curve, now versus at full premium.
 *
 * The ghost line is the point of the chart. A single curve tells you what a table costs; two tell
 * you how much of that price is time, and the gap between them closes to nothing at service.
 */
export function CurveChart({
  data,
  p,
  thetaPct,
}: {
  data: CurvePoint[];
  p: Params;
  thetaPct: number;
}) {
  const here = data[Math.min(p.nSold, p.nMax)];
  const decayed = thetaPct < 99.5;

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 18, right: 16, bottom: 4, left: 4 }}>
          <Defs id="curve" />
          <XAxis
            dataKey="n"
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            interval={Math.max(1, Math.floor(p.nMax / 6))}
            label={{
              value: 'TABLES SOLD',
              position: 'insideBottom',
              offset: -2,
              fontSize: 9,
              fill: CHART.label,
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />
          <YAxis
            domain={['dataMin - 4', 'dataMax + 6']}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => `$${Math.round(v)}`}
          />

          <ReferenceLine
            y={p.p0}
            stroke={CHART.floor}
            strokeDasharray="3 4"
            label={{
              value: 'MEAL CREDIT',
              position: 'insideBottomRight',
              fontSize: 9,
              fill: CHART.label,
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />

          <Tooltip
            cursor={{ stroke: CHART.cursorLine, strokeWidth: 1, strokeDasharray: '3 3' }}
            animationDuration={140}
            content={({ active, payload }) => {
              const d = (payload?.[0]?.payload ?? null) as CurvePoint | null;
              if (!active || !d) return null;
              return (
                <Tip
                  title={`Table #${d.n === 0 ? 1 : d.n}`}
                  rows={[
                    ['Costs now', `$${d.price.toFixed(2)}`],
                    ['At full premium', `$${d.atFull.toFixed(2)}`],
                    ['Meal credit', `$${d.floor.toFixed(2)}`],
                  ]}
                  note={
                    d.atFull - d.price < 0.005
                      ? 'Nothing has decayed yet.'
                      : `$${(d.atFull - d.price).toFixed(2)} of premium has burned off.`
                  }
                />
              );
            }}
          />

          {/* where the curve started, drawn only once it has something to say */}
          {decayed && (
            <Line
              type="monotone"
              dataKey="atFull"
              stroke={CHART.ghost}
              strokeWidth={1.5}
              strokeDasharray="4 5"
              dot={false}
              isAnimationActive={false}
            />
          )}

          <Area
            type="monotone"
            dataKey="price"
            stroke="url(#curveStroke)"
            strokeWidth={3}
            fill="url(#curveFill)"
            dot={false}
            isAnimationActive={false}
          />

          {here && (
            <ReferenceDot
              x={here.n}
              y={here.price}
              r={6.5}
              fill={CHART.cursor}
              stroke="#fff"
              strokeWidth={2.5}
              filter="url(#curveGlow)"
              isFront
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * One table's price over the run-up to service, with θ underneath it.
 *
 * x runs from far-out on the left to the door on the right, which means the axis is REVERSED:
 * τ counts down. Plotting it ascending would be technically fine and read backwards to everyone.
 */
export function DecayChart({
  data,
  p,
  tauHours,
}: {
  data: DecayPoint[];
  p: Params;
  tauHours: number;
}) {
  const at = data.reduce((best, d) =>
    Math.abs(d.tau - tauHours) < Math.abs(best.tau - tauHours) ? d : best,
  );

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 18, right: 16, bottom: 4, left: 4 }}>
          <Defs id="decay" />
          <XAxis
            dataKey="tau"
            type="number"
            reversed
            domain={['dataMin', 'dataMax']}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => (v <= 0 ? 'service' : v < 36 ? `${Math.round(v)}h` : `${Math.round(v / 24)}d`)}
            label={{
              value: 'TIME UNTIL SERVICE',
              position: 'insideBottom',
              offset: -2,
              fontSize: 9,
              fill: CHART.label,
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />
          <YAxis
            domain={[(min: number) => Math.min(min, p.p0) - 4, 'dataMax + 6']}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => `$${Math.round(v)}`}
          />

          <ReferenceLine
            y={p.p0}
            stroke={CHART.floor}
            strokeDasharray="3 4"
            label={{
              value: 'MEAL CREDIT',
              position: 'insideBottomRight',
              fontSize: 9,
              fill: CHART.label,
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />
          {/* where the premium starts coming off */}
          {p.tcHours < data[0]!.tau && (
            <ReferenceLine
              x={p.tcHours}
              stroke={CHART.onset}
              strokeDasharray="2 4"
              label={{
                value: 'DECAY BEGINS',
                position: 'insideTopLeft',
                fontSize: 9,
                fill: CHART.onsetLabel,
                fontFamily: 'Archivo',
                letterSpacing: '0.14em',
              }}
            />
          )}

          <Tooltip
            cursor={{ stroke: CHART.cursorLine, strokeWidth: 1, strokeDasharray: '3 3' }}
            animationDuration={140}
            content={({ active, payload }) => {
              const d = (payload?.[0]?.payload ?? null) as DecayPoint | null;
              if (!active || !d) return null;
              return (
                <Tip
                  title={tauLabel(d.tau)}
                  rows={[
                    ['Costs to buy', `$${d.buy.toFixed(2)}`],
                    ['Sells back for', `$${d.payout.toFixed(2)}`],
                    ['θ', `${d.theta.toFixed(1)}%`],
                  ]}
                  note={
                    d.theta >= 99.9
                      ? 'Full premium. Decay has not started.'
                      : d.theta <= 0
                        ? 'Service. Only the meal credit is left.'
                        : `${(100 - d.theta).toFixed(0)}% of the premium is gone.`
                  }
                />
              );
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
          {/* what a holder walks away with, always under the buy line by φ */}
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
