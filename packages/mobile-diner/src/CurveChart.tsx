/**
 * The live price curve, the hero (§5), sized for a phone. Renders p(n) = p0 + k·n·θ across the
 * pool with the current position marked by a glowing dot. As θ decays the whole curve FLATTENS
 * toward the meal-credit floor (§7b), so the floor is drawn as a dashed reference line.
 *
 * Touch adaptation: tapping the chart moves an active point (recharts treats touch as a click),
 * so the per-slot detail is reachable without hover. Axis density is reduced for the narrow
 * viewport and the tooltip is compact.
 */
import {
  Area,
  AreaChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART, CHART_FILL, CHART_STROKE } from '@ttr/design/chart';

interface Props {
  p0: string; // base units
  k: string;
  nMax: number;
  nSold: number;
  thetaBps: number;
  phiBps?: number;
  height?: number;
}

interface Datum {
  n: number;
  price: number;
  premium: number;
  floor: number;
  state: 'sold' | 'current' | 'remaining';
}

/** Per-slot detail on tap, showing what this unit of the curve actually means. */
function CurveTip({
  active,
  payload,
  phiBps = 500,
}: {
  active?: boolean;
  payload?: Array<{ payload: Datum }>;
  phiBps?: number;
}) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  const net = d.price * (1 - phiBps / 10_000);
  const copy =
    d.state === 'sold'
      ? 'Already claimed.'
      : d.state === 'current'
        ? "You're buying here."
        : `Once ${d.n} tables are gone.`;
  return (
    <div
      className="glass glass--strong"
      style={{ padding: '11px 13px', minWidth: 152, borderRadius: 15 }}
    >
      <div className="stat-label" style={{ marginBottom: 6 }}>
        Table #{d.n === 0 ? 1 : d.n}
      </div>
      <div
        style={{
          fontFamily: 'Archivo',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        ${d.price.toFixed(2)}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.7, color: 'var(--ink-70)' }}>
        <Row label="Meal credit" value={`$${d.floor.toFixed(2)}`} />
        <Row label="Sell back for" value={`$${net.toFixed(2)}`} />
      </div>
      <div
        style={{
          marginTop: 7,
          paddingTop: 6,
          borderTop: '1px solid var(--hairline)',
          fontSize: 10.5,
          color: 'var(--ink-45)',
        }}
      >
        {copy}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function CurveChart({ p0, k, nMax, nSold, thetaBps, phiBps = 500, height = 178 }: Props) {
  const p0n = Number(p0) / 1e6;
  const kn = Number(k) / 1e6;
  const theta = thetaBps / 10_000;

  const data: Datum[] = Array.from({ length: nMax + 1 }, (_, n) => ({
    n,
    price: p0n + kn * n * theta,
    premium: kn * n * theta,
    floor: p0n,
    state: n < nSold ? 'sold' : n === nSold ? 'current' : 'remaining',
  }));
  const current = data[Math.min(nSold, nMax)];

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 16, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="mCurveStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset={CHART_STROKE[0].offset} stopColor={CHART_STROKE[0].color} />
              <stop offset={CHART_STROKE[1].offset} stopColor={CHART_STROKE[1].color} />
              <stop offset={CHART_STROKE[2].offset} stopColor={CHART_STROKE[2].color} />
            </linearGradient>
            <linearGradient id="mCurveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_FILL.top} stopOpacity={CHART_FILL.topOpacity} />
              <stop offset="100%" stopColor={CHART_FILL.bottom} stopOpacity={CHART_FILL.bottomOpacity} />
            </linearGradient>
            <filter id="mDotGlow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <XAxis
            dataKey="n"
            tick={{ fontSize: 9.5, fill: CHART.label, fontFamily: 'Inter' }}
            axisLine={false}
            tickLine={false}
            interval={Math.max(1, Math.floor(nMax / 4))}
            height={18}
          />
          <YAxis
            domain={['dataMin - 4', 'dataMax + 4']}
            tick={{ fontSize: 9.5, fill: CHART.label, fontFamily: 'Inter' }}
            axisLine={false}
            tickLine={false}
            width={30}
            tickCount={4}
            tickFormatter={(v) => `$${Math.round(v)}`}
          />

          {/* meal-credit floor, the value that never decays (§7b) */}
          <ReferenceLine
            y={p0n}
            stroke={CHART.floor}
            strokeDasharray="3 4"
            label={{
              value: 'MEAL CREDIT',
              /* Right, not left: the curve leaves the floor at n=0 and climbs away from it, so the
                 left end of this line is the one place on the chart the label is guaranteed to
                 collide with the stroke. At the right end the curve is at its highest and the
                 floor is empty. */
              position: 'insideBottomRight',
              fontSize: 8.5,
              fill: CHART.label,
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />

          <Tooltip
            content={<CurveTip phiBps={phiBps} />}
            cursor={{ stroke: CHART.cursorLine, strokeWidth: 1, strokeDasharray: '3 3' }}
            animationDuration={120}
            wrapperStyle={{ zIndex: 5 }}
          />

          <Area
            type="monotone"
            dataKey="price"
            stroke="url(#mCurveStroke)"
            strokeWidth={2.75}
            fill="url(#mCurveFill)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4.5, fill: CHART.cursor, stroke: '#fff', strokeWidth: 2 }}
          />

          {current && (
            <ReferenceDot
              x={current.n}
              y={current.price}
              r={6}
              fill={CHART.cursor}
              stroke="#fff"
              strokeWidth={2.5}
              filter="url(#mDotGlow)"
              isFront
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
