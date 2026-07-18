/**
 * §10.2 / §7b pricing math — the ONE implementation all streams share so the mock adapter,
 * the real contract, and any UI preview agree bit-for-bit. Integer/base-unit math with the
 * LOCKED rounding directions (buy rounds UP, sell rounds DOWN) so the reserve is never
 * over-drawn (§6 rounding note).
 *
 * Uses BigInt for u128-safe intermediate products (k · n · theta_bps), matching the on-chain
 * fixed-point scheme. Inputs/outputs are base-unit strings (see common.ts money convention).
 */
import { BPS_DENOMINATOR } from './common.js';
import type { Bps, UsdcBaseUnits, UnixSeconds } from './common.js';

/**
 * θ in basis points from remaining time. τ = service_time - now.
 *   θ = 10000            if τ >= Tc
 *   θ = floor(10000τ/Tc) if 0 <= τ < Tc
 *   θ = 0                if τ <= 0
 */
export function thetaBps(
  serviceTime: UnixSeconds,
  now: UnixSeconds,
  tcSeconds: number,
): Bps {
  const tau = serviceTime - now;
  if (tau <= 0) return 0;
  if (tau >= tcSeconds) return BPS_DENOMINATOR;
  return Math.floor((BPS_DENOMINATOR * tau) / tcSeconds);
}

/** premium = k · n · theta_bps / 10000. Rounding controlled by `dir`. Returns bigint base units. */
function premium(
  k: bigint,
  n: bigint,
  thetaBpsValue: bigint,
  dir: 'ceil' | 'floor',
): bigint {
  const num = k * n * thetaBpsValue;
  const den = BigInt(BPS_DENOMINATOR);
  if (dir === 'floor') return num / den;
  // ceil for positive values
  return (num + den - 1n) / den;
}

/** buy_price = p0 + ceil(k · n_sold · θ / 10000). */
export function buyPrice(
  p0: UsdcBaseUnits,
  k: UsdcBaseUnits,
  nSold: number,
  thetaBpsValue: Bps,
): UsdcBaseUnits {
  const price = BigInt(p0) + premium(BigInt(k), BigInt(nSold), BigInt(thetaBpsValue), 'ceil');
  return price.toString();
}

/** sell_price = p0 + floor(k · (n_sold-1) · θ / 10000). Undefined below n_sold=1 (nothing to sell). */
export function sellPrice(
  p0: UsdcBaseUnits,
  k: UsdcBaseUnits,
  nSold: number,
  thetaBpsValue: Bps,
): UsdcBaseUnits {
  const n = nSold - 1;
  const nn = n > 0 ? BigInt(n) : 0n;
  const price = BigInt(p0) + premium(BigInt(k), nn, BigInt(thetaBpsValue), 'floor');
  return price.toString();
}

/** payout = sell_price · (10000 - φ) / 10000, rounded DOWN (reserve never over-pays). */
export function sellPayout(
  sellPriceBaseUnits: UsdcBaseUnits,
  phiBps: Bps,
): UsdcBaseUnits {
  const gross = BigInt(sellPriceBaseUnits);
  const net = (gross * BigInt(BPS_DENOMINATOR - phiBps)) / BigInt(BPS_DENOMINATOR);
  return net.toString();
}
