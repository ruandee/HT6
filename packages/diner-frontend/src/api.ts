/**
 * app-services REST client (§10.4). The frontend talks to this and nothing else. It never touches
 * the chain (§8).
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

/** §10.4 GET /pools. One entry per service window, each with its own curve. */
export interface PoolSummary {
  pool_id: string;
  label: string;
  /** the room this pool seats, so the header doesn't have to hardcode it */
  venue_name: string;
  date_iso: string;
  service_time: number;
  /** seats UP TO this many, so a party of 3 books the 4-top band (§4a). */
  party_size: number;
  n_sold: number;
  n_max: number;
  buy_price: string;
  theta_bps: number;
  frozen: boolean;
}

const USER = 'alice';
const headers = { 'content-type': 'application/json', 'x-user-id': USER };

/**
 * Where app-services lives. Empty (the default) keeps every path RELATIVE, which is what the
 * Vite dev proxy in vite.config.ts rewrites to :8080 — so local dev is unchanged.
 *
 * A deployed build has no such proxy: the frontend is static hosting on its own origin, and a
 * relative /pools would hit the SPA rewrite and come back as index.html. So set VITE_API_URL to
 * the app-services origin at build time (Vite inlines VITE_* — changing it needs a redeploy),
 * and make sure that origin allows this one via CORS_ORIGINS.
 */
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const u = (path: string) => `${API}${path}`;

/**
 * Coerce anything throwable into readable text.
 *
 * Exists because `String(someObject)` yields "[object Object]", and that is precisely what a user
 * sees at the worst possible moment: the payment failed and the interface reports nothing. A real
 * failure (a wallet with no gas) was once hidden behind exactly that string, so this deliberately
 * digs through the shapes an SDK or API error actually arrives in before giving up.
 */
export function errText(e: unknown, fallback = 'Something went wrong.'): string {
  if (e == null) return fallback;
  if (typeof e === 'string') return e.trim() || fallback;
  if (e instanceof Error && e.message) return e.message.replace(/^Error:\s*/, '');
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    // Common carriers, in order of how specific they usually are.
    for (const k of ['message', 'error', 'detail', 'description', 'reason', 'code']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      // `{ error: { message } }` nests one level in several APIs, including ours.
      if (v && typeof v === 'object') {
        const inner = (v as Record<string, unknown>).message;
        if (typeof inner === 'string' && inner.trim()) return inner.trim();
      }
    }
    // Last resort: show SOMETHING structural rather than "[object Object]".
    try {
      const s = JSON.stringify(e);
      if (s && s !== '{}') return s.slice(0, 200);
    } catch {
      /* circular — fall through */
    }
  }
  return fallback;
}

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
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(errText(body, `${r.status} ${r.statusText}`));
  }
  return r.json() as Promise<T>;
}

export const api = {
  demoPoolId: () => fetch(u('/demo/pool-id')).then(j<{ pool_id: string }>),
  pools: () => fetch(u('/pools'), { headers }).then(j<PoolSummary[]>),
  quote: (id: string) => fetch(u(`/pools/${id}`), { headers }).then(j<Quote>),
  buy: (id: string) =>
    fetch(u(`/pools/${id}/buy`), { method: 'POST', headers }).then(j<BuyResponse>),
  sell: (id: string) =>
    fetch(u(`/pools/${id}/sell`), { method: 'POST', headers }).then(
      j<{ payout_intent: string; payout_amount: string }>,
    ),
  holdings: () => fetch(u('/me/holdings'), { headers }).then(j<Holding[]>),
  /** stub-only: drive the mock webhook exactly as the mock deposit page would. */
  stubSettle: (intentId: string, type: 'succeeded' | 'expired') =>
    fetch(u('/webhooks/unifold'), {
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
