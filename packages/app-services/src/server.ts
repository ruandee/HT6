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
const orchestrator = new Orchestrator(chain, gateway);

// --- demo seed: one buzzy pool, θ far out, seeded to n=6 (§7d) so the curve already shows premium.
let DEMO_POOL_ID = '';
async function seed() {
  const now = Math.floor(Date.now() / 1000);
  const { pool_id } = await chain.create_pool({
    authority: 'rest_wallet',
    p0: '40000000',
    k: '3000000',
    n_max: 20,
    phi_bps: 500,
    service_time: now + 200_000, // > Tc, θ = 1
    tc_seconds: 86400,
  });
  for (let i = 0; i < 6; i++) await chain.buy(pool_id, `seed_${i}`, '999000000');
  DEMO_POOL_ID = pool_id;
  console.log(`[seed] demo pool ${pool_id} at n=6`);
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
