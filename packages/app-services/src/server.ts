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
import { loadConfig } from './config.js';
import { StubGateway } from './stub-gateway.js';
import { Orchestrator } from './orchestrator.js';
import { verifyWebhook } from './webhook-verify.js';

const cfg = loadConfig();
const chain = new MockChainAdapter();
const gateway =
  cfg.gateway === 'stub'
    ? new StubGateway(`${cfg.baseUrl}/mock/deposit`)
    : (() => {
        throw new Error('UnifoldGateway not implemented yet (SWAP B). Use PAYMENT_GATEWAY=stub.');
      })();
/** Pools sharing a service window = the other party-size bands that night (§4a/§7c-C). */
function siblingPools(poolId: string): string[] {
  const self = POOLS.find((p) => p.pool_id === poolId);
  if (!self) return [poolId];
  return POOLS.filter(
    (p) => p.date_iso === self.date_iso && p.service_time === self.service_time,
  ).map((p) => p.pool_id);
}
const orchestrator = new Orchestrator(chain, gateway, siblingPools);

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
  { party_size: 6, n_max: 3, p0: '120000000', k: '10000000' },
];

/** seats[] = how many already sold in each band, index-aligned with BANDS. */
const SEED_PLAN = [
  // tonight — inside the 24h cliff, so θ is already decaying (§7b) and the curve reads flatter
  { inHours: 6, seats: [14, 6, 2] },
  { inDays: 2, hour: 19, seats: [6, 3, 1] }, // the headline demo night
  { inDays: 3, hour: 19, seats: [9, 5, 0] },
  { inDays: 4, hour: 20, seats: [3, 1, 0] },
  { inDays: 8, hour: 19, seats: [1, 0, 0] },
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
        authority: 'rest_wallet',
        p0: band.p0,
        k: band.k,
        n_max: band.n_max,
        phi_bps: 500,
        service_time,
        tc_seconds: 86400,
        party_size: band.party_size,
      });
      const sold = Math.min(plan.seats[b] ?? 0, band.n_max);
      for (let s = 0; s < sold; s++) {
        await chain.buy(pool_id, `seed_${i}_${b}_${s}`, '9990000000');
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

    let evt: { type?: string; data?: { object?: { id?: string } } };
    try {
      evt = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    const intentId = evt.data?.object?.id ?? '';

    switch (evt.type) {
      case 'payment_intent.succeeded': {
        const out = await orchestrator.onDepositSucceeded(intentId, v.eventId);
        console.log('[webhook] succeeded', intentId, out);
        break;
      }
      case 'payment_intent.expired':
      case 'payment_intent.refunded':
        orchestrator.onDepositExpired(intentId);
        console.log('[webhook] expired/refunded', intentId);
        break;
      case 'treasury.outbound_transfer.completed':
      case 'treasury.outbound_transfer.failed':
        console.log('[webhook] payout', evt.type, intentId);
        break;
      default:
        console.log('[webhook] ignored', evt.type);
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
