/**
 * app-services HTTP server (Express). Wires the StubGateway + MockChainAdapter into a runnable
 * end-to-end loop — no external keys needed (PAYMENT_GATEWAY=stub).
 *
 * Routes: a subset of §10.4 (buy/sell/holdings/quote) plus the §10.5 webhook ingress and the
 * StubGateway's local mock deposit page. Auth is stubbed (x-user-id header) so other streams
 * don't wait on Auth0; swap in JWT middleware later.
 *
 * IMPORTANT: /webhooks/unifold needs the RAW body for signature verification, so it uses
 * express.raw() and is mounted BEFORE express.json().
 */
import express, { type Request, type Response } from 'express';
import { MockChainAdapter } from '@ttr/chain-services';
import type { CheckinRequest, CreatePoolRequest } from '@ttr/shared-types';
import { loadConfig } from './config.js';
import { StubGateway } from './stub-gateway.js';
import { Orchestrator } from './orchestrator.js';
import { IssuerService } from './issuer.js';
import { verifyWebhook } from './webhook-verify.js';
import {
  UnifoldGateway,
  normalizeUnifoldEvent,
  type UnifoldWebhookEvent,
} from './unifold-gateway.js';
import { fetchUnifoldStatus, renderStatusHtml } from './unifold-status.js';

const cfg = loadConfig();
const chain = new MockChainAdapter();
/**
 * §8.1 SWAP B. `PAYMENT_GATEWAY=stub` (the default) keeps the keyless demo exactly as it was;
 * `unifold` constructs the real REST gateway, which throws immediately if any key is missing.
 */
const unifoldGateway =
  cfg.gateway === 'unifold'
    ? new UnifoldGateway({
        ...cfg.unifold,
        // Diner Base USDC payout address. The x-user-id auth stub has no wallet registry yet;
        // when Auth0 + the custodial wallet service land, resolve it from the user profile here.
        resolvePayoutAddress: (uid) => process.env.DEMO_DINER_BASE_ADDRESS ?? String(uid),
      })
    : undefined;
const gateway = unifoldGateway ?? new StubGateway(`${cfg.baseUrl}/mock/deposit`);
/** Pools sharing a service window = the other party-size bands that night (§4a/§7c-C). */
function siblingPools(poolId: string): string[] {
  const self = POOLS.find((p) => p.pool_id === poolId);
  if (!self) return [poolId];
  return POOLS.filter(
    (p) => p.date_iso === self.date_iso && p.service_time === self.service_time,
  ).map((p) => p.pool_id);
}
/** Issuer read model (§10.3 role) — feeds the restaurant dashboard's reserve/royalties/holders. */
const issuer = new IssuerService(chain);
const orchestrator = new Orchestrator(chain, gateway, siblingPools, {
  onBuy: (poolId, userId, pricePaid) => issuer.onBuy(poolId, userId, pricePaid),
  onSell: (poolId, userId, payout, gross) => issuer.onSell(poolId, userId, payout, gross),
});

/** The demo venue. Auth is the x-user-id stub, so the issuer identity is stubbed the same way. */
const RESTAURANT_AUTHORITY = 'rest_wallet';
const VENUE_NAME = 'Library Bar';

// --- demo seed: one buzzy pool, θ far out, seeded to n=6 (§7d) so the curve already shows premium.
/**
 * Demo seed. A pool is (venue, service_window, party_size) — §4/§4a. A 2-top and a 6-top are
 * not interchangeable, so each party-size BAND gets its own curve; that keeps the single-curve
 * AMM honest. Tokens mean "a table seating UP TO party_size", so a party of 3 books the 4-top.
 *
 * p0 scales ~$20/head (the meal credit is per person) and k scales with it — a 6-top on a
 * Friday is scarcer, so its curve is steeper. n_max per band is the restaurant's room
 * configuration, decided at pool creation (this is where "push tables together" lives — it is
 * never a trade-time decision, because N must stay fixed for the solvency invariant).
 */
interface PoolMeta {
  pool_id: string;
  label: string; // "Fri 7–9pm"
  date_iso: string; // yyyy-mm-dd, for the calendar
  service_time: number;
  party_size: number;
}
let DEMO_POOL_ID = '';
const POOLS: PoolMeta[] = [];

/**
 * Party-size bands offered each night: seats up to N, how many such tables, and their economics.
 *
 * `DEMO_PRICE_DIVISOR` scales p0/k down for a real-money run. Unifold has no usable testnet, so
 * exercising the live rail means mainnet with genuinely small amounts — at the headline params a
 * single demo click charges $58. Divisor 10 puts a buy near $5.80, which still clears Unifold's
 * ~3 USDC L2 minimum. The curve's SHAPE is unchanged, so the demo looks identical; only the axis
 * labels shrink.
 */
const BANDS = [
  { party_size: 2, n_max: 20, p0: '40000000', k: '3000000' }, // §7d headline params
  { party_size: 4, n_max: 8, p0: '80000000', k: '6000000' },
].map((b) => ({
  ...b,
  p0: (BigInt(b.p0) / cfg.priceDivisor).toString(),
  k: (BigInt(b.k) / cfg.priceDivisor).toString(),
}));

/** seats[] = how many already sold in each band, index-aligned with BANDS. */
const SEED_PLAN = [
  // tonight — inside the 24h cliff, so θ is already decaying (§7b) and the curve reads flatter
  { inHours: 6, seats: [14, 6] },
  { inDays: 2, hour: 19, seats: [6, 3] }, // the headline demo night
  { inDays: 3, hour: 19, seats: [9, 5] },
  { inDays: 4, hour: 20, seats: [3, 1] },
  { inDays: 8, hour: 19, seats: [1, 0] },
];

/**
 * Names for the seeded buyers. The issuer dashboard lists holders by user_id, and a floor manager
 * reading "seed_0_1_3" learns nothing; a name is what they'd actually see at the door.
 *
 * Consumed in order by a single counter across the whole seed, so no two holders collide. That
 * matters beyond looks: §7c-C is one table per person per service window, and the adapter rejects
 * a buyer who already holds a sibling band that night, so duplicate names would drop inventory.
 */
const SEED_NAMES = [
  'Maya Fontaine', 'Daniel Okafor', 'Priya Raman', 'Tom Whitaker', 'Alice Chen',
  'Marcus Bell', 'Sofia Marchetti', 'James Ellery', 'Nina Kowalski', 'Andre Duval',
  'Grace Yamamoto', 'Oliver Bench', 'Rosa Delgado', 'Henry Ashworth', 'Leila Nasser',
  'Peter Stavros', 'Claire Beaumont', 'Samuel Adeyemi', 'Hannah Lindqvist', 'Victor Moreau',
  'Iris Tanaka', 'Reuben Castellanos', 'Freya Nilsen', 'Omar Haddad', 'Beatrice Lowell',
  'Nathan Pryce', 'Camille Rousseau', 'Elias Vogel', 'Tessa Brannigan', 'Jonah Reyes',
  'Margot Delacroix', 'Felix Nakamura', 'Adaeze Nwosu', 'Rory MacAllister', 'Simone Aubert',
  'Caleb Fitzgerald', 'Yara Boutros', 'Dominic Sartori', 'Esme Hollander', 'Kofi Mensah',
  'Lucia Ferreira', 'Bennett Croft', 'Anya Volkova', 'Theo Lindgren', 'Mirela Popescu',
  'Gideon Frost', 'Saoirse Byrne', 'Rafael Ibarra', 'Wren Callahan', 'Milo Bergström',
  'Delphine Marchand', 'Casper Voss', 'Amara Sithole', 'Linus Hartmann', 'Verity Sloane',
  'Ezra Goldman', 'Noor Rahimi', 'Django Pallavicini', 'Harriet Vance', 'Soren Kjeldsen',
];

async function seed() {
  const now = Math.floor(Date.now() / 1000);
  let nextName = 0;
  for (const [i, plan] of SEED_PLAN.entries()) {
    const d = new Date();
    if ('inHours' in plan && plan.inHours !== undefined) {
      d.setHours(d.getHours() + plan.inHours, 0, 0, 0);
    } else {
      d.setDate(d.getDate() + (plan.inDays ?? 0));
      d.setHours(plan.hour ?? 19, 0, 0, 0);
    }
    const service_time = Math.floor(d.getTime() / 1000);
    const h = d.getHours();
    const h12 = (x: number) => (x > 12 ? x - 12 : x === 0 ? 12 : x);
    const label = `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${h12(h)}–${h12(
      h + 2,
    )}${h + 2 >= 12 ? 'pm' : 'am'}`;
    const date_iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;

    // one pool per band — each band is internally fungible, so each gets its own curve
    for (const [b, band] of BANDS.entries()) {
      const { pool_id } = await chain.create_pool({
        authority: RESTAURANT_AUTHORITY,
        p0: band.p0,
        k: band.k,
        n_max: band.n_max,
        phi_bps: 500,
        service_time,
        tc_seconds: 86400,
        party_size: band.party_size,
      });
      // mirror into the issuer read model so the dashboard sees the seeded inventory too
      issuer.register({
        pool_id,
        authority: RESTAURANT_AUTHORITY,
        label,
        venue_name: VENUE_NAME,
        p0: band.p0,
        k: band.k,
        phi_bps: 500,
        n_max: band.n_max,
        service_time,
        tc_seconds: 86400,
        party_size: band.party_size,
      });
      const sold = Math.min(plan.seats[b] ?? 0, band.n_max);
      for (let s = 0; s < sold; s++) {
        const buyer = SEED_NAMES[nextName++ % SEED_NAMES.length]!;
        const r = await chain.buy(pool_id, buyer, '9990000000');
        if (r.status === 'filled') issuer.onBuy(pool_id, buyer, r.price_paid ?? '0');
      }
      POOLS.push({ pool_id, label, date_iso, service_time, party_size: band.party_size });
      if (i === 1 && band.party_size === 2) DEMO_POOL_ID = pool_id; // §7d headline pool
    }
  }
  DEMO_POOL_ID ||= POOLS[0]!.pool_id;
  console.log(
    `[seed] ${POOLS.length} pools (${SEED_PLAN.length} nights × ${BANDS.length} bands); ` +
      `default ${DEMO_POOL_ID}`,
    { now: new Date(now * 1000).toISOString() },
  );
}

const app = express();

/**
 * CORS. Local dev needs none — the Vite proxy makes every call same-origin — but a deployed
 * build has the frontends on their own origins (static hosting) calling app-services on another,
 * so without these headers the browser blocks the request before it is ever sent.
 *
 * Mounted FIRST so preflights are answered for every route, including the raw-body webhook below.
 *
 * CORS_ORIGINS is a comma-separated allowlist; unset falls back to `*`, which is only safe here
 * because auth is still the x-user-id header stub and nothing rides on cookies. The moment Auth0
 * lands (or anything uses credentials), set the allowlist — `*` is illegal with credentials and
 * the browser will reject it.
 */
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use((req: Request, res: Response, next) => {
  const origin = req.header('origin');
  if (CORS_ORIGINS.length === 0) res.setHeader('access-control-allow-origin', '*');
  else if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    // the response varies by request origin, so caches must not serve one origin's copy to another
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  // x-user-id is the auth stub; x-stub drives the mock webhook from the browser (§10.5)
  res.setHeader('access-control-allow-headers', 'content-type,x-user-id,x-stub');
  res.setHeader('access-control-max-age', '86400');
  if (req.method === 'OPTIONS') return void res.sendStatus(204);
  next();
});

// simple stubbed auth: userId from header (replace with Auth0 JWT middleware later).
function userId(req: Request): string {
  return (req.header('x-user-id') ?? 'demo_diner').toString();
}

// ---- §10.5 webhook ingress (RAW body; mounted before json) ----
app.post(
  '/webhooks/unifold',
  express.raw({ type: '*/*' }),
  async (req: Request, res: Response) => {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '';
    const v = verifyWebhook({
      headers: {
        'unifold-id': req.header('unifold-id'),
        'unifold-timestamp': req.header('unifold-timestamp'),
        'unifold-signature': req.header('unifold-signature'),
        'x-stub': req.header('x-stub'),
      },
      rawBody,
      secret: cfg.unifold.webhookSecret,
      // Demo affordance only. On the real gateway every event must carry a valid HMAC.
      allowStub: cfg.gateway !== 'unifold',
    });
    if (!v.ok) return res.status(400).json({ error: v.error });

    let evt: UnifoldWebhookEvent;
    try {
      evt = JSON.parse(rawBody) as UnifoldWebhookEvent;
    } catch {
      return res.status(400).json({ error: 'invalid JSON body' });
    }

    // ONE mapping for both paths: the stub posts real-shaped envelopes (with x-stub:1 to skip the
    // HMAC), the real gateway posts signature-verified ones. Same normalizer, same branches.
    const n = normalizeUnifoldEvent(evt);
    switch (n.action) {
      case 'deposit_succeeded': {
        // The ONLY place a buy is fulfilled (§7c-A). max_price rides in metadata on the real
        // path; the orchestrator's pending row remains authoritative for the on-chain cap.
        const out = await orchestrator.onDepositSucceeded(n.intentId, v.eventId);
        console.log('[webhook] succeeded', n.intentId, out);
        break;
      }
      case 'deposit_expired':
        orchestrator.onDepositExpired(n.intentId);
        console.log('[webhook] expired/refunded', n.intentId, n.reason);
        break;
      case 'deposit_awaiting_refund': {
        // Late deposit after expiry: refund the payer on the SOURCE chain, never buy.
        // The source chain is now Base (see UnifoldGateway.sourceNetwork), so this must be an
        // 0x… address — a Solana base58 address would be rejected by the refund endpoint.
        orchestrator.onDepositExpired(n.intentId);
        const refundTo = process.env.DEMO_DINER_BASE_ADDRESS ?? '';
        if (unifoldGateway && refundTo) {
          try {
            await unifoldGateway.refund(n.intentId, refundTo);
            console.log('[webhook] refund requested', n.intentId);
          } catch (e) {
            console.error('[webhook] refund FAILED', n.intentId, msg(e));
          }
        } else {
          console.warn('[webhook] awaiting_refund but no refund address resolved', n.intentId);
        }
        break;
      }
      case 'deposit_refund_failed':
        console.error('[webhook] REFUND FAILED — manual intervention', n.intentId, n.failureReason);
        break;
      case 'payout_settled':
        console.log('[webhook] payout', n.status, n.payoutId, n.failureReason ?? '');
        break;
      default:
        console.log('[webhook] ignored:', n.reason);
    }
    return res.status(200).json({ received: true });
  },
);

app.use(express.json());

// ---- StubGateway local mock deposit page (stands in for the Unifold checkout modal) ----
app.get('/mock/deposit', (req: Request, res: Response) => {
  const intent = String(req.query.intent ?? '');
  res.type('html').send(mockDepositPage(intent));
});

// ---- §10.4 REST (subset; buy/sell/holdings/quote) ----
/** §10.4 GET /pools — summaries for every service window (powers the date picker). */
app.get('/pools', async (_req, res) => {
  const out = [];
  for (const p of POOLS) {
    const q = await chain.quote(p.pool_id);
    out.push({
      pool_id: p.pool_id,
      label: p.label,
      // the diner headers name the room they're booking, so the venue travels with the pool
      // rather than being hardcoded in two frontends
      venue_name: VENUE_NAME,
      date_iso: p.date_iso,
      service_time: p.service_time,
      party_size: p.party_size,
      n_sold: q.n_sold,
      n_max: q.n_max,
      buy_price: q.buy_price,
      theta_bps: q.theta_bps,
      frozen: q.frozen,
    });
  }
  res.json(out);
});

app.get('/pools/:id', async (req, res) => {
  try {
    res.json(await chain.quote(req.params.id));
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});

app.post('/pools/:id/buy', async (req, res) => {
  try {
    res.json(await orchestrator.beginBuy(req.params.id, userId(req)));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.post('/pools/:id/sell', async (req, res) => {
  try {
    res.json(await orchestrator.sell(req.params.id, userId(req)));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/me/holdings', async (req, res) => {
  res.json(await orchestrator.holdingsFor(userId(req)));
});

/**
 * LIVE Unifold status — read-only evidence that the payment rail is real and configured.
 *
 * Independent of PAYMENT_GATEWAY on purpose: it only needs the secret key, so the demo can keep
 * running on StubGateway (free, unfailable) while this proves the real integration is live.
 * Only GETs are issued upstream; nothing here can create or move money.
 */
async function unifoldStatus() {
  return fetchUnifoldStatus({
    apiBase: cfg.unifold.apiBase,
    secretKey: cfg.unifold.secretKey,
    gateway: cfg.gateway,
    treasuryId: cfg.unifold.treasuryId,
    webhookSecretConfigured: Boolean(cfg.unifold.webhookSecret),
  });
}

app.get('/unifold/status', async (_req, res) => {
  try {
    const s = await unifoldStatus();
    // no-store: a cached page would defeat the entire point of it being live evidence.
    res.setHeader('cache-control', 'no-store');
    res.type('html').send(renderStatusHtml(s));
  } catch (e) {
    res.status(500).type('html').send(`<pre>status unavailable: ${msg(e)}</pre>`);
  }
});

app.get('/unifold/status.json', async (_req, res) => {
  try {
    res.setHeader('cache-control', 'no-store');
    res.json(await unifoldStatus());
  } catch (e) {
    res.status(500).json({ error: msg(e) });
  }
});

app.get('/demo/pool-id', (_req, res) => res.json({ pool_id: DEMO_POOL_ID }));

// ============================================================================
// §10.4 issuer routes (restaurant-frontend). Auth is the same x-user-id stub as above; the real
// system requires an Auth0 issuer role on every /restaurant/* call.
// ============================================================================

/** Every pool this venue issues — one row per (night × party-size band), §4a. */
app.get('/restaurant/pools', async (_req, res) => {
  try {
    res.json(await issuer.list(RESTAURANT_AUTHORITY));
  } catch (e) {
    res.status(500).json({ error: msg(e) });
  }
});

/** §10.4 POST /restaurant/pools — create_pool passthrough; one call per band (§4a). */
app.post('/restaurant/pools', async (req, res) => {
  try {
    const body = req.body as CreatePoolRequest;
    const { pool_id, mint } = await issuer.createPool(body, RESTAURANT_AUTHORITY, VENUE_NAME);
    // keep the diner-facing /pools list in sync — same (night, band) grid it renders
    const d = new Date(body.service_time * 1000);
    POOLS.push({
      pool_id,
      label: body.label,
      date_iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`,
      service_time: body.service_time,
      party_size: body.party_size,
    });
    res.status(201).json({ pool_id, mint });
  } catch (e) {
    res.status(400).json({ error: msg(e) });
  }
});

/** §10.4 GET /restaurant/pools/:id — fill %, reserve, holders, ROYALTIES ACCRUED (demo step 3). */
app.get('/restaurant/pools/:id', async (req, res) => {
  try {
    res.json(await issuer.view(req.params.id));
  } catch (e) {
    res.status(404).json({ error: msg(e) });
  }
});

/** §10.4 POST /restaurant/pools/:id/checkin — staff marks a diner arrived; triggers redeem. */
app.post('/restaurant/pools/:id/checkin', async (req, res) => {
  try {
    const { user_id } = req.body as CheckinRequest;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const r = await issuer.checkIn(req.params.id, user_id);
    orchestrator.markRedeemed(req.params.id, user_id);
    return res.json(r);
  } catch (e) {
    return res.status(400).json({ error: msg(e) });
  }
});

/**
 * §10.4 POST /restaurant/pools/:id/sweep → §7c-B breakdown (demo step 5). Requires the pool to be
 * FROZEN; the chain rejects an early sweep and we pass that message straight through.
 */
app.post('/restaurant/pools/:id/sweep', async (req, res) => {
  try {
    res.json(await issuer.sweep(req.params.id));
  } catch (e) {
    res.status(400).json({ error: msg(e) });
  }
});

/**
 * DEMO ONLY — advance this ONE pool to service time so `sweep` can be exercised on stage without
 * waiting for the real clock. Scoped to a single pool by design: global clock control (the §11
 * step-4 θ-decay fast-forward) is owned elsewhere and lives outside this stream, and the mock
 * adapter's clock plumbing is deliberately untouched here. Implemented by re-creating nothing —
 * it just moves the pool's service_time into the past via a chain-level freeze trigger.
 */
app.post('/restaurant/pools/:id/demo-freeze', async (req, res) => {
  try {
    const ok = freezePoolForDemo(req.params.id);
    if (!ok) return res.status(404).json({ error: `unknown pool ${req.params.id}` });
    return res.json(await issuer.view(req.params.id));
  } catch (e) {
    return res.status(400).json({ error: msg(e) });
  }
});

/**
 * DEMO ONLY — §11 step 4, the θ-decay fast-forward.
 *
 * Moves the adapter's injectable clock forward so the scarcity premium decays on every pool at
 * once and the curve visibly flattens toward the meal-credit floor. This is the GLOBAL lever, as
 * opposed to `demo-freeze` above which pulls a single pool to service time for the sweep.
 *
 * Only `k·n·θ` decays — `p0` never does, so the curve settles onto the floor rather than to zero
 * (§7b). Advancing the clock can also trip the adapter's own freeze rule (`now >= service_time`)
 * on nights the offset moves past, which is the intended behaviour: those tables stop trading.
 *
 * Body: `{ "hours": <number> }` — relative, cumulative, and may be negative to rewind. `{ "reset":
 * true }` returns to the real wall clock. Like `demo-freeze`, this route goes away with SWAP A:
 * against a real validator you cannot move the block clock, you wait for it.
 */
let demoClockOffsetSeconds = 0;
chain.now = () => Math.floor(Date.now() / 1000) + demoClockOffsetSeconds;

app.post('/demo/clock', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { hours?: unknown; reset?: unknown };
    if (body.reset === true) {
      demoClockOffsetSeconds = 0;
    } else {
      const hours = Number(body.hours);
      if (!Number.isFinite(hours)) {
        return res.status(400).json({ error: 'body must be { hours: <number> } or { reset: true }' });
      }
      demoClockOffsetSeconds += Math.round(hours * 3600);
    }
    unfreezeFuturePools();
    return res.json(await demoClockState());
  } catch (e) {
    return res.status(400).json({ error: msg(e) });
  }
});

/** Current demo clock, so a dashboard control can render where the fast-forward is sitting. */
app.get('/demo/clock', async (_req, res) => res.json(await demoClockState()));

/**
 * Rewinding the demo clock has to un-latch `frozen`, or the fast-forward is one-way: the mock's
 * `syncFrozen` only ever sets the flag (correct against a real chain, where time does not run
 * backwards), so a rehearsal would leave pools permanently untradeable. Only pools whose service
 * time is genuinely in the future are reopened — anything still past stays frozen, and a pool
 * frozen by `demo-freeze` stays frozen because that route rewrites service_time into the past.
 */
function unfreezeFuturePools(): void {
  const pools = (chain as unknown as { pools: Map<string, { service_time: number; frozen: boolean }> })
    .pools;
  if (!pools) return;
  const now = chain.now();
  for (const p of pools.values()) if (p.frozen && now < p.service_time) p.frozen = false;
}

async function demoClockState() {
  const now = chain.now();
  return {
    offset_hours: demoClockOffsetSeconds / 3600,
    now_iso: new Date(now * 1000).toISOString(),
    is_shifted: demoClockOffsetSeconds !== 0,
    pools: await Promise.all(
      POOLS.map(async (p) => {
        const q = await chain.quote(p.pool_id);
        return {
          pool_id: p.pool_id,
          label: p.label,
          party_size: p.party_size,
          theta_bps: q.theta_bps,
          buy_price: q.buy_price,
          frozen: q.frozen,
          hours_to_service: Math.round(((p.service_time - now) / 3600) * 10) / 10,
        };
      }),
    ),
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * DEMO-ONLY lever for §11 step 5: pull ONE pool's service_time into the past so the adapter's
 * own freeze rule (`now >= service_time`) trips on the next read and `sweep` becomes legal.
 *
 * Deliberately does NOT touch the adapter's injectable clock — that is global (it would move every
 * pool and every curve at once) and clock control is owned by another stream. This only edits one
 * pool's timestamp, so the rest of the demo grid is unaffected. It reaches into the mock's private
 * pool map, which is acceptable precisely because this is scaffolding around a MOCK: when the real
 * Solana adapter lands (SWAP A) this route goes away — you freeze by waiting for the block clock.
 */
function freezePoolForDemo(poolId: string): boolean {
  const pools = (chain as unknown as { pools: Map<string, { service_time: number; frozen: boolean }> })
    .pools;
  const p = pools?.get(poolId);
  if (!p) return false;
  p.service_time = Math.floor(Date.now() / 1000) - 1;
  p.frozen = true;
  return true;
}

function mockDepositPage(intent: string): string {
  const post = (type: string) => `
    fetch('/webhooks/unifold', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stub': '1' },
      body: JSON.stringify({ id: 'evt_'+Date.now(), type: '${type}',
        data: { object: { id: ${JSON.stringify(intent)}, status: '${type.split('.')[1]}' } } })
    }).then(r => r.json()).then(j => { document.getElementById('out').textContent = JSON.stringify(j); });`;
  return `<!doctype html><meta charset="utf-8"><title>Mock deposit</title>
  <body style="font-family:system-ui;max-width:34rem;margin:3rem auto">
  <h2>Unifold mock deposit</h2>
  <p>Intent: <code>${intent}</code></p>
  <button onclick="confirmPay()">Confirm payment (succeeded)</button>
  <button onclick="expire()">Simulate late/expired deposit</button>
  <pre id="out"></pre>
  <script>function confirmPay(){${post('payment_intent.succeeded')}}
  function expire(){${post('payment_intent.expired')}}</script>`;
}

/**
 * Real keys move real money — Unifold's Checkout is mainnet-only, there is no sandbox to fall back
 * on. Make that impossible to run into by accident: a full-price pool on the live gateway charges
 * a diner $58 per click, so say so at boot rather than in the transaction history.
 */
function announceGateway() {
  if (cfg.gateway !== 'unifold') {
    console.log(`  gateway=stub — no keys used, no money moves.`);
    return;
  }
  const sample = BANDS[0];
  const dollars = (Number(BigInt(sample!.p0)) / 1e6).toFixed(2);
  console.log(`  gateway=unifold — LIVE. Buys charge REAL USDC on Base.`);
  console.log(`  meal-credit floor is $${dollars} (DEMO_PRICE_DIVISOR=${cfg.priceDivisor}).`);
  if (cfg.priceDivisor === 1n) {
    console.log(
      `  ⚠  DEMO_PRICE_DIVISOR is unset, so pools run at FULL demo price — about $58 of real\n` +
        `     money per buy. Set DEMO_PRICE_DIVISOR=10 for a ~$5.80 buy before clicking anything.`,
    );
  }
  if (!process.env.DEMO_DINER_BASE_ADDRESS) {
    console.log(
      `  ⚠  DEMO_DINER_BASE_ADDRESS is unset, so payouts fall back to the user id as an address\n` +
        `     and every sell-back will fail. Set it to a Base (0x…) address you control.`,
    );
  }
}

seed().then(() => {
  app.listen(cfg.port, () => {
    console.log(`app-services on http://localhost:${cfg.port}`);
    announceGateway();
  });
});
