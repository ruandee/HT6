/**
 * Live bonding curve (the hero, §5). Renders p(n) = p0 + k·n·θ across the pool, with the
 * current position marked. As θ decays the whole curve FLATTENS toward the floor, which is the §11
 * step-4 demo moment, so we draw the floor as a reference line.
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

interface Props {
  p0: string; // base units
  k: string;
  nMax: number;
  nSold: number;
  thetaBps: number;
  phiBps?: number;
}

interface Datum {
  n: number;
  price: number;
  premium: number;
  floor: number;
  state: 'sold' | 'current' | 'remaining';
}

/** Per-slot detail on hover, showing what this unit of the curve actually means (§4/§7b). */
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
      ? 'Taken'
      : d.state === 'current'
        ? "Yours if you book now"
        : `Once ${d.n} are gone`;
  return (
    <div
      className="glass glass--strong"
      style={{ padding: '13px 15px', minWidth: 178, borderRadius: 16 }}
    >
      <div className="stat-label" style={{ marginBottom: 7 }}>
        Table #{d.n === 0 ? 1 : d.n}
      </div>
      <div
        style={{
          fontFamily: 'Archivo',
          fontWeight: 700,
          fontSize: 25,
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        ${d.price.toFixed(2)}
      </div>
      <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.75, color: 'var(--ink-70)' }}>
        <Row label="Off your bill" value={`$${d.floor.toFixed(2)}`} />
        <Row label="Sell back for" value={`$${net.toFixed(2)}`} />
      </div>
      <div
        style={{
          marginTop: 9,
          paddingTop: 8,
          borderTop: '1px solid var(--hairline)',
          fontSize: 11,
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
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
      <span>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function CurveChart({ p0, k, nMax, nSold, thetaBps, phiBps = 500 }: Props) {
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
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 18, right: 14, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="curveStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#FFC861" />
              <stop offset="55%" stopColor="#FF7A59" />
              <stop offset="100%" stopColor="#F2542D" />
            </linearGradient>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF7A59" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#FFE8A3" stopOpacity={0} />
            </linearGradient>
            <filter id="dotGlow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <XAxis
            dataKey="n"
            tick={{ fontSize: 10, fill: 'rgba(22,19,15,0.4)', fontFamily: 'Inter' }}
            axisLine={false}
            tickLine={false}
            interval={Math.max(1, Math.floor(nMax / 5))}
          />
          <YAxis
            domain={['dataMin - 4', 'dataMax + 4']}
            tick={{ fontSize: 10, fill: 'rgba(22,19,15,0.4)', fontFamily: 'Inter' }}
            axisLine={false}
            tickLine={false}
            width={34}
            tickFormatter={(v) => `$${Math.round(v)}`}
          />

          {/* meal-credit floor, the value that never decays (§7b) */}
          <ReferenceLine
            y={p0n}
            stroke="rgba(22,19,15,0.28)"
            strokeDasharray="3 4"
            label={{
              value: 'DINNER CREDIT',
              /* Right, not left: the curve leaves the floor at n=0 and climbs away from it, so the
                 left end of this line is the one place on the chart the label is guaranteed to
                 collide with the stroke. At the right end the curve is at its highest and the
                 floor is empty. */
              position: 'insideBottomRight',
              fontSize: 9,
              fill: 'rgba(22,19,15,0.45)',
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
          />

          <Tooltip
            content={<CurveTip phiBps={phiBps} />}
            cursor={{ stroke: 'rgba(22,19,15,0.28)', strokeWidth: 1, strokeDasharray: '3 3' }}
            animationDuration={140}
          />

          <Area
            type="monotone"
            dataKey="price"
            stroke="url(#curveStroke)"
            strokeWidth={3}
            fill="url(#curveFill)"
            isAnimationActive
            animationDuration={650}
            animationEasing="ease-out"
            dot={false}
          />

          {current && (
            <ReferenceDot
              x={current.n}
              y={current.price}
              r={6.5}
              fill="#F2542D"
              stroke="#fff"
              strokeWidth={2.5}
              filter="url(#dotGlow)"
              isFront
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
