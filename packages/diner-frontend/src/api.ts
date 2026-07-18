/**
 * app-services REST client (§10.4). The frontend talks ONLY to this — never the chain (§8).
 * Auth is the x-user-id stub for now; swap for an Auth0 bearer token later.
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

/** §10.4 GET /pools — one entry per service window (each its own curve). */
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

const USER = 'alice';
const headers = { 'content-type': 'application/json', 'x-user-id': USER };

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json() as Promise<T>;
}

export const api = {
  demoPoolId: () => fetch('/demo/pool-id').then(j<{ pool_id: string }>),
  pools: () => fetch('/pools', { headers }).then(j<PoolSummary[]>),
  quote: (id: string) => fetch(`/pools/${id}`, { headers }).then(j<Quote>),
  buy: (id: string) =>
    fetch(`/pools/${id}/buy`, { method: 'POST', headers }).then(j<BuyResponse>),
  sell: (id: string) =>
    fetch(`/pools/${id}/sell`, { method: 'POST', headers }).then(
      j<{ payout_intent: string; payout_amount: string }>,
    ),
  holdings: () => fetch('/me/holdings', { headers }).then(j<Holding[]>),
  /** stub-only: drive the mock webhook exactly as the mock deposit page would. */
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
