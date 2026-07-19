/**
 * The pool parameters, as sliders.
 *
 * Sliders rather than number inputs on purpose: the lab is for finding the shape of the
 * relationship, not for entering an exact k. Dragging one and watching both charts move is the
 * entire interaction. Anyone who needs exact values is going to open CreatePool instead.
 *
 * n_sold is clamped to n_max here rather than in the model, because a pool that has sold more
 * tables than it has is not a state worth rendering an opinion about.
 */
import type { Params } from './model';

interface Props {
  p: Params;
  onChange: <K extends keyof Params>(key: K, v: Params[K]) => void;
}

interface FieldSpec {
  key: keyof Params;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint: string;
}

const FIELDS: FieldSpec[] = [
  {
    key: 'p0',
    label: 'Meal credit (p0)',
    min: 10,
    max: 200,
    step: 5,
    format: (v) => `$${v}`,
    hint: 'Comes off the bill. Never decays.',
  },
  {
    key: 'k',
    label: 'Price step (k)',
    min: 0,
    max: 20,
    step: 0.5,
    format: (v) => `$${v.toFixed(1)}`,
    hint: 'What each table sold adds.',
  },
  {
    key: 'nMax',
    label: 'Tables (N)',
    min: 2,
    max: 40,
    step: 1,
    format: (v) => String(v),
    hint: 'Fixed once the pool opens.',
  },
  {
    key: 'nSold',
    label: 'Already sold',
    min: 0,
    max: 40,
    step: 1,
    format: (v) => String(v),
    hint: 'Where you are on the curve.',
  },
  {
    key: 'tcHours',
    label: 'Decay window (Tc)',
    min: 1,
    max: 168,
    step: 1,
    format: (v) => (v < 48 ? `${v}h` : `${(v / 24).toFixed(0)}d`),
    hint: 'How long before service the premium starts bleeding.',
  },
  {
    key: 'phiPct',
    label: 'Your cut (φ)',
    min: 0,
    max: 25,
    step: 0.5,
    format: (v) => `${v.toFixed(1)}%`,
    hint: 'Kept on every resale.',
  },
];

export function Controls({ p, onChange }: Props) {
  return (
    <div className="lab__controls">
      {FIELDS.map((f) => {
        // the sold slider can never outrun the pool it is sitting in
        const max = f.key === 'nSold' ? p.nMax : f.max;
        const value = Math.min(p[f.key], max);
        return (
          <div className="lab__control" key={f.key}>
            <div className="lab__control-head">
              <label className="stat-label" htmlFor={f.key}>
                {f.label}
              </label>
              <span className="lab__control-value">{f.format(value)}</span>
            </div>
            <input
              id={f.key}
              className="slider"
              type="range"
              min={f.min}
              max={max}
              step={f.step}
              value={value}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange(f.key, v);
                // shrinking the pool under the sold marker would leave it off the end
                if (f.key === 'nMax' && p.nSold > v) onChange('nSold', v);
              }}
            />
            <span className="hint">{f.hint}</span>
          </div>
        );
      })}
    </div>
  );
}
