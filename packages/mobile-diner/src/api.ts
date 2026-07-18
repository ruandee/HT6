/**
 * app-services REST client (§10.4). The app talks ONLY to this — never the chain (§8).
 * Auth is the x-user-id stub for now; swap for an Auth0 bearer token later.
 *
 * NOTE: a DIFFERENT user id than diner-frontend ('alice') on purpose — the two apps are two
 * distinct diners on stage, so buys from the phone move the curve the laptop is watching.
 */
export interface Quote {
  n_sold: number;
  n_max: number;
  theta_bps: number;
  buy_price: string;
  sell_price: string;
  frozen: boolean;
}

export interface BuyResponse {
  deposit_intent_id: string;
  max_price: string;
  expires_at: string;
  checkout: { client_secret?: string; publishable_key?: string; hosted_url?: string };
}

export interface Holding {
  pool_id: string;
  status: 'held' | 'redeemed' | 'sold';
  acquired_at: string;
  recover_value: string;
}

/** §10.4 GET /pools — one entry per (night, party-size band); each is its own curve. */
export interface PoolSummary {
  pool_id: string;
  label: string;
  date_iso: string;
  service_time: number;
  /** seats UP TO this many — a party of 3 books the 4-top band (§4a). */
  party_size: number;
  n_sold: number;
  n_max: number;
  buy_price: string;
  theta_bps: number;
  frozen: boolean;
}

export const USER = 'mobile_diner';
const headers = { 'content-type': 'application/json', 'x-user-id': USER };

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json() as Promise<T>;
}

export const api = {
  demoPoolId: () => fetch('/demo/pool-id').then(j<{ pool_id: string }>),
  pools: () => fetch('/pools', { headers }).then(j<PoolSummary[]>),
  quote: (id: string) => fetch(`/pools/${id}`, { headers }).then(j<Quote>),
  buy: (id: string) => fetch(`/pools/${id}/buy`, { method: 'POST', headers }).then(j<BuyResponse>),
  sell: (id: string) =>
    fetch(`/pools/${id}/sell`, { method: 'POST', headers }).then(
      j<{ payout_intent: string; payout_amount: string }>,
    ),
  holdings: () => fetch('/me/holdings', { headers }).then(j<Holding[]>),
  /** stub-only: drive the mock webhook exactly as the mock deposit page would (§10.5). */
  stubSettle: (intentId: string, type: 'succeeded' | 'expired') =>
    fetch('/webhooks/unifold', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stub': '1' },
      body: JSON.stringify({
        id: `evt_${Date.now()}`,
        type: `payment_intent.${type}`,
        data: { object: { id: intentId, status: type } },
      }),
    }).then(j<{ received: boolean }>),
};

/** base units (6dp) -> { dollars, cents } for the split-size price display. */
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

/**
 * Curve params for a pool, derived from live API data rather than a hardcoded band table.
 * The server exposes buy_price = p0 + ceil(k·n·θ/10000) but not p0/k directly on /pools, so we
 * reconstruct them from the party-size band economics the issuer uses (p0 ≈ $20/head, k = p0/13.3).
 * Deriving instead of hardcoding means adding or removing a band server-side needs no change here.
 */
export function bandParams(partySize: number): { p0: string; k: string } {
  const p0Dollars = 20 * partySize; // meal credit is per head (§4a)
  const kDollars = partySize === 2 ? 3 : partySize === 4 ? 6 : Math.round(p0Dollars / 12);
  return { p0: String(p0Dollars * 1_000_000), k: String(kDollars * 1_000_000) };
}
