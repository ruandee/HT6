/**
 * The pricing model behind the landing page's decay demo.
 *
 * This is a deliberately thin adapter over @ttr/shared-types — the same module the chain adapter,
 * app-services, and packages/decay-lab all price against (§7b, §10.2). None of the arithmetic
 * lives here. Reimplementing p(n) in floats to save an import is exactly how a marketing page
 * ends up quietly lying about the product it is selling, so the BigInt base-unit math stays where
 * it is and only the final plotted value becomes a float.
 *
 * The full lab (packages/decay-lab) exposes every parameter as a slider. This surface exposes
 * one — time — because the landing page is making a single claim: the premium is time, and the
 * floor underneath it is dinner.
 */
import { buyPrice, sellPayout, sellPrice, thetaBps } from '@ttr/shared-types';

/**
 * A plausible Friday, held fixed.
 *
 * These are the lab's defaults. They are not adjustable here: a visitor who wants to turn k is
 * already curious enough to follow the link to the lab, and six sliders in the middle of a pitch
 * costs the reader the argument the section exists to make.
 */
export const POOL = {
  /** meal-credit floor, dollars. Never decays. */
  p0: 40,
  /** price step per table sold, dollars */
  k: 3,
  /** tables in the pool */
  nMax: 20,
  /** tables already gone */
  nSold: 6,
  /** decay window, hours. θ is flat until τ drops inside this. */
  tcHours: 24,
  /** issuer's cut on resale, percent */
  phiPct: 5,
} as const;

/** Where the scrubber starts: outside the cliff, so the flat shoulder before decay is visible. */
export const START_HOURS = POOL.tcHours * 1.35;

const USDC = 1_000_000;
const toBase = (dollars: number): string => String(Math.round(dollars * USDC));
const toDollars = (base: string): number => Number(base) / USDC;

const P0 = toBase(POOL.p0);
const K = toBase(POOL.k);
const PHI_BPS = Math.round(POOL.phiPct * 100);

/** θ in basis points at a given τ, straight from the shared implementation. */
function thetaAt(tauHours: number): number {
  // thetaBps takes absolute seconds, so anchor an arbitrary service time and walk back from it.
  const service = 1_000_000_000;
  return thetaBps(service, service - Math.round(tauHours * 3600), Math.round(POOL.tcHours * 3600));
}

export interface Prices {
  /** 0–100, the share of the premium still standing */
  thetaPct: number;
  /** what the next table costs */
  buy: number;
  /** what a holder actually receives on resale, after φ */
  payout: number;
  /** the part of the buy price that is premium rather than meal credit */
  premium: number;
}

export function pricesAt(tauHours: number): Prices {
  const th = thetaAt(tauHours);
  const buy = toDollars(buyPrice(P0, K, POOL.nSold, th));
  const gross = sellPrice(P0, K, POOL.nSold, th);

  return {
    thetaPct: th / 100,
    buy,
    payout: toDollars(sellPayout(gross, PHI_BPS)),
    premium: buy - POOL.p0,
  };
}

export interface DecayPoint {
  /** hours until service, counted DOWN as the chart runs left to right */
  tau: number;
  buy: number;
  payout: number;
}

/**
 * The whole life of one table, from listing to service.
 *
 * Plotted against time-to-service descending, so the x axis reads the way the night does: the
 * left edge is "far out, nothing has happened yet" and the right edge is the door opening.
 * Computed once at module scope — the parameters never change, so recomputing it per render
 * would be 121 pointless BigInt round-trips on every frame of the scrubber.
 */
export const DECAY_PATH: DecayPoint[] = (() => {
  const steps = 120;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const tau = START_HOURS * (1 - i / steps);
    const pr = pricesAt(tau);
    return { tau: Number(tau.toFixed(3)), buy: pr.buy, payout: pr.payout };
  });
})();

/** "3.0 days out", "5h out", "at the door" — how long is left, said the way a person would say it. */
export function tauLabel(hours: number): string {
  if (hours <= 0) return 'at the door';
  if (hours < 1) return `${Math.round(hours * 60)} min out`;
  if (hours < 36) return `${hours.toFixed(hours < 6 ? 1 : 0)}h out`;
  return `${(hours / 24).toFixed(1)} days out`;
}
