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
        // Diner Solana USDC payout address. The x-user-id auth stub has no wallet registry yet;
        // when Auth0 + the custodial wallet service land, resolve it from the user profile here.
        resolveSolanaAddress: (uid) => process.env.DEMO_DINER_SOLANA_ADDRESS ?? String(uid),
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
const VENUE_NAME = 'Bar Aurelia';

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

/** Party-size bands offered each night: seats up to N, how many such tables, and their economics. */
const BANDS = [
  { party_size: 2, n_max: 20, p0: '40000000', k: '3000000' }, // §7d headline params
  { party_size: 4, n_max: 8, p0: '80000000', k: '6000000' },
];

/** seats[] = how many already sold in each band, index-aligned with BANDS. */
const SEED_PLAN = [
  // tonight — inside the 24h cliff, so θ is already decaying (§7b) and the curve reads flatter
  { inHours: 6, seats: [14, 6] },
  { inDays: 2, hour: 19, seats: [6, 3] }, // the headline demo night
  { inDays: 3, hour: 19, seats: [9, 5] },
  { inDays: 4, hour: 20, seats: [3, 1] },
  { inDays: 8, hour: 19, seats: [1, 0] },
];

async function seed() {
  const now = Math.floor(Date.now() / 1000);
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
        const buyer = `seed_${i}_${b}_${s}`;
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
        orchestrator.onDepositExpired(n.intentId);
        const refundTo = process.env.DEMO_DINER_SOLANA_ADDRESS ?? '';
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

seed().then(() => {
  app.listen(cfg.port, () => {
    console.log(`app-services on http://localhost:${cfg.port} (gateway=${cfg.gateway})`);
  });
});
