/**
 * Split-size money display, matching the diner app's `.price` treatment: big tabular dollars,
 * smaller muted cents. Input is always a USDC base-unit string (6dp) — the arithmetic happens in
 * BigInt inside splitUsdc, so no float ever touches money.
 */
import { splitUsdc } from './api';

interface Props {
  base: string;
  /** which typographic scale to render at. */
  variant?: 'kpi' | 'cell' | 'hero' | 'inline';
  className?: string;
}

export function Money({ base, variant = 'inline', className = '' }: Props) {
  const { dollars, cents } = splitUsdc(base);

  if (variant === 'hero') {
    return (
      <div className={`hero-number ${className}`}>
        <span>${dollars}</span>
        <span className="hero-number__cents">.{cents}</span>
      </div>
    );
  }
  const cls =
    variant === 'kpi' ? 'kpi__value' : variant === 'cell' ? 'sweep-cell__value' : 'pool-card__price';
  return (
    <div className={`${cls} ${className}`}>
      <span>${dollars}</span>
      <span className="kpi__cents">.{cents}</span>
    </div>
  );
}
