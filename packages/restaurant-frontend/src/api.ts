/**
 * app-services REST client for the ISSUER routes (§10.4 `/restaurant/*`).
 *
 * Boundary rule (LOCKED §8): this dashboard talks ONLY to app-services. It never touches the
 * chain, and it never imports chain-services. Auth is the x-user-id stub for now (same as the
 * diner app); the real system puts an Auth0 JWT with an issuer role on every call.
 *
 * MONEY: every USDC value below is a base-unit STRING with 6 decimals ("40000000" = $40). Never
 * parse it into a float. Use splitUsdc/usdc, which do the arithmetic in BigInt.
 */
import type { CreatePoolRequest, SweepResponse } from '@ttr/shared-types';

/** One row of the issuer's pool overview: a (night × party-size band) pool, §4a. */
export interface IssuerPoolRow {
  pool_id: string;
  label: string;
  venue_name: string;
  party_size: number;
  n_sold: number;
  n_max: number;
  fill_pct: number;
  service_time: number;
  buy_price: string;
  p0: string;
  k: string;
  phi_bps: number;
  theta_bps: number;
  frozen: boolean;
  reserve_balance: string;
  royalties_accrued: string;
  settled: boolean;
}

/** §10.4 IssuerPoolView plus the additive fields the dashboard renders. */
export interface IssuerPoolDetail {
  pool_id: string;
  fill_pct: number;
  reserve_balance: string;
  royalties_accrued: string;
  holders: Array<{ user_id: string; token_amount: number; status: 'held' | 'redeemed' | 'sold' }>;
  label: string;
  venue_name: string;
  party_size: number;
  n_sold: number;
  n_max: number;
  p0: string;
  k: string;
  phi_bps: number;
  service_time: number;
  tc_seconds: number;
  frozen: boolean;
  theta_bps: number;
  buy_price: string;
  sell_price: string;
  sell_payout: string;
  consumed_count: number;
  forfeited_pending: number;
  credits_to_honor: string;
  swept: SweepResponse | null;
}

export type { CreatePoolRequest, SweepResponse };

/** Stubbed issuer identity. Swap for an Auth0 bearer token with the issuer role. */
const ISSUER = 'rest_wallet';
const headers = { 'content-type': 'application/json', 'x-user-id': ISSUER };

/**
 * Where app-services lives. Empty (the default) keeps every path RELATIVE, which is what the
 * Vite dev proxy in vite.config.ts rewrites to :8080 — so local dev is unchanged.
 *
 * A deployed build has no such proxy: the dashboard is static hosting on its own origin, and a
 * relative /restaurant/pools would hit the SPA rewrite and come back as index.html. So set
 * VITE_API_URL to the app-services origin at build time (Vite inlines VITE_* — changing it needs
 * a redeploy), and make sure that origin allows this one via CORS_ORIGINS.
 */
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const u = (path: string) => `${API}${path}`;

/**
 * Bootstrap with retry.
 *
 * The deployed backend is Cloud Run with scale-to-zero, so the very first request after an idle
 * period pays a cold start — about a second in practice, occasionally longer if the platform is
 * slow to schedule. Without a retry, that lands as a hard failure on the one request that was
 * always going to be the slowest one, and the visitor sees a dead page.
 *
 * `onWaking` fires from the second attempt onward, so the UI can stop saying "loading" and start
 * saying "waking up". That distinction is most of the value here: a visitor who knows a machine
 * is starting will wait a few seconds; a visitor looking at a stalled spinner leaves.
 */
export async function bootstrap<T>(fn: () => Promise<T>, onWaking?: () => void): Promise<T> {
  const backoff = [600, 1500, 3000, 6000];
  let last: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const wait = backoff[attempt];
      if (wait == null) throw last;
      if (attempt === 0) onWaking?.();
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json() as Promise<T>;
}

export const api = {
  /** every pool this venue issues, one per (night, band). */
  pools: () => fetch(u('/restaurant/pools'), { headers }).then(j<IssuerPoolRow[]>),

  /** fill, reserve, holders, royalties accrued (§10.4). */
  pool: (id: string) => fetch(u(`/restaurant/pools/${id}`), { headers }).then(j<IssuerPoolDetail>),

  /** create_pool passthrough, one call per party-size band (§4a). */
  createPool: (body: CreatePoolRequest) =>
    fetch(u('/restaurant/pools'), { method: 'POST', headers, body: JSON.stringify(body) }).then(
      j<{ pool_id: string; mint: string }>,
    ),

  /** staff marks a diner arrived -> triggers redeem (token burns, USDC stays in reserve). */
  checkin: (id: string, user_id: string) =>
    fetch(u(`/restaurant/pools/${id}/checkin`), {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id }),
    }).then(j<{ tx_sig: string }>),

  /** settle the reserve after service. Returns the §7c-B breakdown. */
  sweep: (id: string) =>
    fetch(u(`/restaurant/pools/${id}/sweep`), { method: 'POST', headers }).then(j<SweepResponse>),

  /**
   * DEMO ONLY: pull this one pool to service time so sweep becomes legal on stage. This is the
   * SINGLE-pool lever; `demoClock` below is the global one.
   */
  demoFreeze: (id: string) =>
    fetch(u(`/restaurant/pools/${id}/demo-freeze`), { method: 'POST', headers }).then(
      j<IssuerPoolDetail>,
    ),

  /**
   * DEMO ONLY (§11 step 4): advance the global clock so θ decays on every pool at once and the
   * curve flattens toward the meal-credit floor. `hours` is relative and cumulative; `reset`
   * returns to the real wall clock and reopens any pool whose service time is future again.
   */
  demoClock: (body: { hours: number } | { reset: true }) =>
    fetch(u('/demo/clock'), { method: 'POST', headers, body: JSON.stringify(body) }).then(
      j<DemoClockState>,
    ),

  demoClockState: () => fetch(u('/demo/clock'), { headers }).then(j<DemoClockState>),
};

/** Where the demo fast-forward currently sits, plus each pool's decayed curve state. */
export interface DemoClockState {
  offset_hours: number;
  now_iso: string;
  is_shifted: boolean;
  pools: Array<{
    pool_id: string;
    label: string;
    party_size: number;
    theta_bps: number;
    buy_price: string;
    frozen: boolean;
    hours_to_service: number;
  }>;
}

/** base units (6dp) -> { dollars, cents } for the split-size money display. BigInt, never float. */
export function splitUsdc(base: string): { dollars: string; cents: string } {
  const n = BigInt(base || '0');
  const d = n / 1_000_000n;
  const c = (n % 1_000_000n) / 10_000n; // 2dp
  return { dollars: d.toLocaleString('en-US'), cents: c.toString().padStart(2, '0') };
}

export function usdc(base: string): string {
  const { dollars, cents } = splitUsdc(base);
  return `$${dollars}.${cents}`;
}

/** dollars (what the issuer types into the create form) -> base-unit string. */
export function toBaseUnits(dollars: string): string {
  const [whole = '0', frac = ''] = dollars.trim().split('.');
  const micros = (frac + '000000').slice(0, 6);
  return (BigInt(whole || '0') * 1_000_000n + BigInt(micros || '0')).toString();
}

/** "in 3 days · Fri 7pm", the operational way a floor manager reads a service window. */
export function whenLabel(serviceTime: number): string {
  const secs = serviceTime - Math.floor(Date.now() / 1000);
  const d = new Date(serviceTime * 1000);
  const clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (secs <= 0) return `service passed · ${clock}`;
  const hrs = secs / 3600;
  if (hrs < 1) return `in ${Math.max(1, Math.round(secs / 60))} min · ${clock}`;
  if (hrs < 24) return `in ${Math.round(hrs)}h · ${clock}`;
  return `in ${Math.round(hrs / 24)}d · ${clock}`;
}
