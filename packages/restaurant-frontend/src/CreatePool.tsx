/**
 * Create pool — set p0, k, N, φ, service_time, Tc, party_size (§8 stream 5, §10.4).
 *
 * ONE POOL PER PARTY-SIZE BAND (§4a). A 2-top and a 6-top are not interchangeable, so they cannot
 * share a curve without breaking the fungibility rule the single-curve AMM rests on — each band
 * gets its own honest (and for bigger tables, steeper) curve. p0 scales ≈ $20/head because the
 * meal credit is per person.
 *
 * n_max is where "you can push tables together" lives: the restaurant decides its room
 * configuration HERE, at pool creation. It is never a trade-time decision, because N must stay
 * fixed for the solvency invariant (reserve = area under the curve) to hold.
 *
 * The form works in DOLLARS for the operator and converts to base units on submit — money crosses
 * the wire only as a base-unit string.
 */
import { useState } from 'react';
import { toBaseUnits, usdc, type CreatePoolRequest } from './api';

interface Props {
  onCreate: (body: CreatePoolRequest) => Promise<void>;
  busy: boolean;
}

/** §4a suggested economics per band — p0 ≈ $20/head, k scaling with it. */
const BAND_DEFAULTS: Record<number, { p0: string; k: string; n_max: string }> = {
  2: { p0: '40', k: '3', n_max: '20' }, // §7d headline demo params
  4: { p0: '80', k: '6', n_max: '8' },
  6: { p0: '120', k: '10', n_max: '3' },
};

/** default service window: 7pm, two days out — a prime weekend-ish slot, not a sleepy Tuesday (§7). */
function defaultServiceLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(19, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function CreatePool({ onCreate, busy }: Props) {
  const [partySize, setPartySize] = useState(2);
  const [p0, setP0] = useState(BAND_DEFAULTS[2]!.p0);
  const [k, setK] = useState(BAND_DEFAULTS[2]!.k);
  const [nMax, setNMax] = useState(BAND_DEFAULTS[2]!.n_max);
  const [phiPct, setPhiPct] = useState('5');
  const [serviceLocal, setServiceLocal] = useState(defaultServiceLocal());
  const [tcHours, setTcHours] = useState('24');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function pickBand(n: number) {
    setPartySize(n);
    const d = BAND_DEFAULTS[n];
    if (d) {
      setP0(d.p0);
      setK(d.k);
      setNMax(d.n_max);
    }
  }

  const nMaxNum = Number(nMax) || 0;
  const p0Base = toBaseUnits(p0 || '0');
  const kBase = toBaseUnits(k || '0');

  // §4 solvency invariant: a full pool locks Σ p(i) for i = 0..N-1 = N·p0 + k·N(N-1)/2.
  const lockedAtFull = (
    BigInt(nMaxNum) * BigInt(p0Base) +
    (BigInt(kBase) * BigInt(nMaxNum) * BigInt(Math.max(0, nMaxNum - 1))) / 2n
  ).toString();
  const lastPrice = (BigInt(p0Base) + BigInt(kBase) * BigInt(Math.max(0, nMaxNum - 1))).toString();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const serviceTime = Math.floor(new Date(serviceLocal).getTime() / 1000);
    if (!Number.isFinite(serviceTime)) return setErr('Pick a valid service time.');
    if (nMaxNum < 1) return setErr('N must be at least 1 table.');
    const phiBps = Math.round(Number(phiPct) * 100);
    if (!Number.isFinite(phiBps) || phiBps < 0 || phiBps > 10_000) {
      return setErr('Royalty must be between 0% and 100%.');
    }
    try {
      await onCreate({
        venue_id: 'aurelia',
        label:
          label.trim() ||
          new Date(serviceLocal).toLocaleDateString('en-US', {
            weekday: 'short',
            hour: 'numeric',
          }),
        party_size: partySize,
        p0: p0Base,
        k: kBase,
        n_max: nMaxNum,
        phi_bps: phiBps,
        service_time: serviceTime,
        tc_seconds: Math.round(Number(tcHours) * 3600),
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
    return undefined;
  }

  return (
    <form className="glass glass--strong" style={{ padding: 30 }} onSubmit={submit}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Open a new pool
      </div>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 12, marginBottom: 24, maxWidth: 560 }}>
        One pool per party-size band. Each band is internally fungible — any 4-top is like any
        other 4-top — so each gets its own curve. Combining tables is a decision you make{' '}
        <span className="script" style={{ fontSize: '1.5em' }}>here</span>, by setting N, never at
        trade time.
      </p>

      {/* band */}
      <div className="field" style={{ marginBottom: 20 }}>
        <label className="stat-label">Party-size band — seats up to</label>
        <div className="seg">
          {[2, 4, 6].map((n) => (
            <button
              key={n}
              type="button"
              className={partySize === n ? 'seg__on' : ''}
              onClick={() => pickBand(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="hint">
          A party of 3 books the 4-top — the smallest band that fits. Picks sensible p0/k/N for the
          band; override anything below.
        </span>
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="stat-label" htmlFor="p0">
            p0 · floor ($)
          </label>
          <input
            id="p0"
            className="input"
            inputMode="decimal"
            value={p0}
            onChange={(e) => setP0(e.target.value)}
          />
          <span className="hint">Meal credit, redeemable against the bill.</span>
        </div>

        <div className="field">
          <label className="stat-label" htmlFor="k">
            k · slope ($/table)
          </label>
          <input
            id="k"
            className="input"
            inputMode="decimal"
            value={k}
            onChange={(e) => setK(e.target.value)}
          />
          <span className="hint">How fast scarcity prices in.</span>
        </div>

        <div className="field">
          <label className="stat-label" htmlFor="nmax">
            N · tables
          </label>
          <input
            id="nmax"
            className="input"
            inputMode="numeric"
            value={nMax}
            onChange={(e) => setNMax(e.target.value)}
          />
          <span className="hint">Fixed supply. Your room configuration.</span>
        </div>

        <div className="field">
          <label className="stat-label" htmlFor="phi">
            φ · royalty (%)
          </label>
          <input
            id="phi"
            className="input"
            inputMode="decimal"
            value={phiPct}
            onChange={(e) => setPhiPct(e.target.value)}
          />
          <span className="hint">Your cut of every resale.</span>
        </div>

        <div className="field">
          <label className="stat-label" htmlFor="svc">
            Service time
          </label>
          <input
            id="svc"
            className="input"
            type="datetime-local"
            value={serviceLocal}
            onChange={(e) => setServiceLocal(e.target.value)}
          />
          <span className="hint">Trading halts here.</span>
        </div>

        <div className="field">
          <label className="stat-label" htmlFor="tc">
            Tc · decay cliff (h)
          </label>
          <input
            id="tc"
            className="input"
            inputMode="decimal"
            value={tcHours}
            onChange={(e) => setTcHours(e.target.value)}
          />
          <span className="hint">Premium bleeds to the floor across this window.</span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label className="stat-label" htmlFor="label">
          Label (optional)
        </label>
        <input
          id="label"
          className="input"
          placeholder="Fri 7–9pm"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      {/* live economics preview — the solvency invariant, before you commit */}
      <div
        style={{
          marginTop: 24,
          paddingTop: 18,
          borderTop: '1px solid var(--hairline)',
          display: 'flex',
          gap: 28,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="stat-label">First table</div>
          <div className="pool-card__price" style={{ marginTop: 6 }}>
            {usdc(p0Base)}
          </div>
        </div>
        <div>
          <div className="stat-label">Last table</div>
          <div className="pool-card__price" style={{ marginTop: 6 }}>
            {usdc(lastPrice)}
          </div>
        </div>
        <div>
          <div className="stat-label">Reserve at full</div>
          <div className="pool-card__price" style={{ marginTop: 6, color: 'var(--coral-deep)' }}>
            {usdc(lockedAtFull)}
          </div>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        A full pool locks Σ p(i) = the area under the curve. Every sell-back removes exactly
        p(n−1), so the reserve can always pay out — insolvency is mathematically impossible.
      </p>

      {err && (
        <div style={{ color: 'var(--coral-deep)', fontSize: 13, marginTop: 16 }}>{err}</div>
      )}

      <button
        className="btn btn--primary"
        type="submit"
        style={{ width: '100%', marginTop: 22 }}
        disabled={busy}
      >
        {busy ? 'Opening…' : `Open the ${partySize}-top pool`}
      </button>
    </form>
  );
}
