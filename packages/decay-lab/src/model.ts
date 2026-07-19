/**
 * The model the lab draws.
 *
 * Every number on screen comes from @ttr/shared-types, the same module the chain adapter and
 * app-services price against (§7b, §10.2). That is the whole point of this app: if the lab and
 * the product ever disagree, one of them is lying, and reimplementing p(n) here in floats would
 * guarantee it was this one. So the arithmetic stays in BigInt base units and only the final
 * plotted value becomes a float.
 *
 * The three relations being modelled:
 *
 *   θ(τ)   = 1                 while τ ≥ Tc      the premium is fully "on"
 *           = τ / Tc            while 0 < τ < Tc  it bleeds off linearly inside the cliff
 *           = 0                 at τ ≤ 0          service; only the meal credit is left
 *
 *   buy(n)  = p0 + ceil(k·n·θ)
 *   sell(n) = p0 + floor(k·(n-1)·θ)   then × (1 - φ) for what the holder actually receives
 *
 * p0 never decays. That is the floor the curve collapses onto, and it is why a table is never
 * worth nothing: it is a meal credit wearing a price.
 */
import { buyPrice, sellPayout, sellPrice, thetaBps } from '@ttr/shared-types';

/** Everything the operator can turn. Dollars are dollars here; conversion happens at the edge. */
export interface Params {
  /** meal-credit floor, dollars */
  p0: number;
  /** price step per table sold, dollars */
  k: number;
  /** tables in the pool */
  nMax: number;
  /** tables already gone */
  nSold: number;
  /** decay window, hours. θ is flat until τ drops inside this. */
  tcHours: number;
  /** issuer's cut on resale, percent */
  phiPct: number;
  /** hours until service. The one variable the restaurant does not control. */
  tauHours: number;
}

export const DEFAULTS: Params = {
  p0: 40,
  k: 3,
  nMax: 20,
  nSold: 6,
  tcHours: 24,
  phiPct: 5,
  tauHours: 24,
};

const USDC = 1_000_000;
const toBase = (dollars: number): string => String(Math.round(dollars * USDC));
const toDollars = (base: string): number => Number(base) / USDC;

/** θ in basis points at a given τ, straight from the shared implementation. */
export function thetaAt(tauHours: number, tcHours: number): number {
  // thetaBps takes absolute seconds, so anchor an arbitrary service time and walk back from it.
  const service = 1_000_000_000;
  return thetaBps(service, service - Math.round(tauHours * 3600), Math.round(tcHours * 3600));
}

export interface Prices {
  thetaBps: number;
  /** what the next table costs */
  buy: number;
  /** gross resale price of a held table */
  sell: number;
  /** what the holder actually receives, after φ */
  payout: number;
  /** issuer's take on that resale */
  royalty: number;
  /** the part of the buy price that is premium rather than meal credit */
  premium: number;
}

export function pricesAt(p: Params, tauHours: number): Prices {
  const th = thetaAt(tauHours, p.tcHours);
  const p0 = toBase(p.p0);
  const k = toBase(p.k);
  const phiBps = Math.round(p.phiPct * 100);

  const buy = toDollars(buyPrice(p0, k, p.nSold, th));
  const sell = toDollars(sellPrice(p0, k, p.nSold, th));
  const payout = toDollars(sellPayout(sellPrice(p0, k, p.nSold, th), phiBps));

  return {
    thetaBps: th,
    buy,
    sell,
    payout,
    royalty: sell - payout,
    premium: buy - p.p0,
  };
}

export interface CurvePoint {
  n: number;
  /** the curve as it stands right now */
  price: number;
  /** the same curve with the premium fully on, for the ghost line */
  atFull: number;
  /** the floor it decays onto */
  floor: number;
}

/** p(n) across the whole pool, now and at full premium. The flattening, drawn. */
export function curve(p: Params, tauHours: number): CurvePoint[] {
  const th = thetaAt(tauHours, p.tcHours);
  const p0 = toBase(p.p0);
  const k = toBase(p.k);
  return Array.from({ length: p.nMax + 1 }, (_, n) => ({
    n,
    price: toDollars(buyPrice(p0, k, n, th)),
    atFull: toDollars(buyPrice(p0, k, n, 10_000)),
    floor: p.p0,
  }));
}

export interface DecayPoint {
  /** hours until service, counted DOWN as the chart runs left to right */
  tau: number;
  theta: number;
  buy: number;
  payout: number;
  floor: number;
}

/**
 * The whole life of one table, from listing to service.
 *
 * Plotted against time-to-service descending, so the x axis reads the way the night does: the
 * left edge is "far out, nothing has happened yet" and the right edge is the door opening.
 */
export function decayPath(p: Params, steps = 120): DecayPoint[] {
  // start a little outside the cliff so the flat shoulder before decay begins is visible
  const start = Math.max(p.tcHours * 1.35, p.tauHours, 1);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const tau = start * (1 - i / steps);
    const pr = pricesAt(p, tau);
    return {
      tau: Number(tau.toFixed(3)),
      theta: pr.thetaBps / 100,
      buy: pr.buy,
      payout: pr.payout,
      floor: p.p0,
    };
  });
}

/** "in 3 days", "in 5h", "at the door" — how long is left, said the way a person would say it. */
export function tauLabel(hours: number): string {
  if (hours <= 0) return 'at the door';
  if (hours < 1) return `${Math.round(hours * 60)} min out`;
  if (hours < 36) return `${hours.toFixed(hours < 6 ? 1 : 0)}h out`;
  return `${(hours / 24).toFixed(1)} days out`;
}
