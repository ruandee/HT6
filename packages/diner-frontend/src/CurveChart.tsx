/**
 * Live bonding curve (the hero, §5). Renders p(n) = p0 + k·n·θ across the pool, with the
 * current position marked. As θ decays the whole curve FLATTENS toward the floor — the §11
 * step-4 demo moment — so we draw the floor as a reference line.
 */
import {
  Area,
  AreaChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

interface Props {
  p0: string; // base units
  k: string;
  nMax: number;
  nSold: number;
  thetaBps: number;
}

export function CurveChart({ p0, k, nMax, nSold, thetaBps }: Props) {
  const p0n = Number(p0) / 1e6;
  const kn = Number(k) / 1e6;
  const theta = thetaBps / 10_000;

  const data = Array.from({ length: nMax + 1 }, (_, n) => ({
    n,
    price: p0n + kn * n * theta,
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

          {/* meal-credit floor — the value that never decays (§7b) */}
          <ReferenceLine
            y={p0n}
            stroke="rgba(22,19,15,0.28)"
            strokeDasharray="3 4"
            label={{
              value: 'MEAL CREDIT FLOOR',
              position: 'insideBottomLeft',
              fontSize: 9,
              fill: 'rgba(22,19,15,0.45)',
              fontFamily: 'Archivo',
              letterSpacing: '0.14em',
            }}
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
