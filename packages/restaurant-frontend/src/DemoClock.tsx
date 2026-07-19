/**
 * Demo step 4 (§11): the θ-decay fast-forward.
 *
 * Advancing the clock decays the scarcity premium (`k·n·θ`) on every pool at once while the
 * meal-credit floor `p0` stays put, so the curve visibly flattens onto the floor instead of
 * falling to zero (§7b). That is the whole point of the step: resale value bleeds out as service
 * approaches, but the prepaid dinner never does.
 *
 * DEMO ONLY. Against a real validator you cannot move the block clock — you wait for it — so this
 * control disappears with SWAP A, along with the /demo/clock route behind it.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, usdc, type DemoClockState } from './api';

/** How far each button jumps. Chosen so the 24h cliff (Tc) is crossed in two or three taps. */
const STEPS = [6, 12, 24];

export function DemoClock({ onChange, busy }: { onChange: () => void; busy?: boolean }) {
  const [state, setState] = useState<DemoClockState | null>(null);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .demoClockState()
      .then((s) => {
        setState(s);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const move = useCallback(
    async (body: { hours: number } | { reset: true }) => {
      setWorking(true);
      try {
        setState(await api.demoClock(body));
        setErr(null);
        onChange();
      } catch (e) {
        // Surface it. Swallowing this made the whole panel silently vanish, which is a much worse
        // failure on stage than a visible line of red.
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setWorking(false);
      }
    },
    [onChange],
  );

  // Render the shell even before the first fetch lands, so the control is always visibly present.
  if (!state) {
    return (
      <div className="glass demo-clock">
        <div className="stat-label">Time to service</div>
        <div className="demo-clock__now">{err ? 'unavailable' : 'loading…'}</div>
        {err && <p className="demo-clock__note">{err}</p>}
      </div>
    );
  }

  // The headline pool is the one the curve chart is showing, but θ is global, so any unfrozen
  // pool tells the same story. Prefer a 2-top that is still trading.
  const lead = state.pools.find((p) => !p.frozen) ?? state.pools[0];
  const disabled = busy || working;

  return (
    <div className="glass demo-clock">
      <div className="demo-clock__head">
        <div>
          <div className="stat-label">Time to service</div>
          <div className="demo-clock__now">
            {state.is_shifted ? (
              <>
                {state.offset_hours > 0 ? '+' : ''}
                {state.offset_hours}h ahead
              </>
            ) : (
              'now'
            )}
          </div>
        </div>
        {lead && (
          <div className="demo-clock__lead">
            <div className="stat-label">{lead.label}</div>
            <div className="demo-clock__price">
              {usdc(lead.buy_price)}
              <span className="demo-clock__theta">
                θ {(lead.theta_bps / 100).toFixed(0)}%
                {lead.frozen ? ' · closed' : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="demo-clock__row">
        {STEPS.map((h) => (
          <button
            key={h}
            className="btn btn--ghost btn--sm"
            onClick={() => move({ hours: h })}
            disabled={disabled}
          >
            +{h}h
          </button>
        ))}
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => move({ reset: true })}
          disabled={disabled || !state.is_shifted}
        >
          Reset
        </button>
      </div>

      <p className="demo-clock__note">
        {err ?? 'The premium decays toward service. The meal credit underneath it never does.'}
      </p>
    </div>
  );
}
