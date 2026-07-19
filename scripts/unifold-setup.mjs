/**
 * One-time Unifold account setup — creates the Base treasury account and registers the webhook
 * endpoint, then prints the exact .env lines to paste.
 *
 * Run it once, when your live keys land:
 *
 *   node scripts/unifold-setup.mjs --webhook-url https://<your-cloud-run>.run.app
 *
 * Reads UNIFOLD_SECRET_KEY from .env (gitignored). Nothing secret is printed except the webhook
 * signing secret. That one is re-readable later via scripts/unifold-webhook-secret.mjs, so losing
 * this output is not fatal.
 *
 * Safe to re-run: it lists what already exists first and never creates a duplicate.
 *
 * WHY BASE, NOT SOLANA (Unifold team guidance, 2026-07-18): use mainnet with small amounts rather
 * than testnet ("not maintained very well with the providers"), and prefer Base for treasury.
 * Payment intents already settle to Base USDC only, so keeping the treasury on Base makes the whole
 * Unifold side single-chain. Note `chain_type: "ethereum"` COVERS Base — the enum is
 * ethereum | solana | bitcoin, and Base is selected per-transfer by chain_id 8453.
 */
import { requireSecretKey, die as fail } from './unifold-env.mjs';

const API_BASE = process.env.UNIFOLD_API_BASE ?? 'https://api.unifold.io/v1';

// The eight events our webhook handler actually branches on (unifold-gateway.ts
// `normalizeUnifoldEvent`). Subscribing to more just means 2xx-ing events we ignore.
const ENABLED_EVENTS = [
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.expired',
  'payment_intent.awaiting_refund',
  'payment_intent.refunded',
  'payment_intent.refund_failed',
  'treasury.outbound_transfer.completed',
  'treasury.outbound_transfer.failed',
];

// --- args -------------------------------------------------------------------

const args = process.argv.slice(2);
const webhookBase = valueOf('--webhook-url');
if (!webhookBase) {
  fail(
    'Missing --webhook-url.\n\n' +
      '  node scripts/unifold-setup.mjs --webhook-url https://<your-cloud-run>.run.app\n\n' +
      'Use the public origin only — the script appends /webhooks/unifold itself.',
  );
}
const webhookUrl = `${webhookBase.replace(/\/+$/, '')}/webhooks/unifold`;
if (!webhookUrl.startsWith('https://')) {
  fail(`Webhook URL must be https (got ${webhookUrl}). Unifold will not deliver to plain http.`);
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// --- secret key -------------------------------------------------------------

const secretKey = requireSecretKey();

// --- http -------------------------------------------------------------------

async function call(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** Endpoints that may not exist on this API version shouldn't abort the whole run. */
async function tryCall(method, path) {
  try {
    return await call(method, path);
  } catch {
    return null;
  }
}

// --- run --------------------------------------------------------------------

console.log(`\nUnifold setup → ${API_BASE}`);
console.log(`Key: ${secretKey.slice(0, 11)}…  (never printed in full)\n`);

const out = {};

// 1. Treasury account on Base. One per chain_type per project, so if it exists we reuse it.
console.log('1/2  Treasury account (chain_type: ethereum → Base)…');
const existingAccounts = await tryCall('GET', '/treasury/accounts');
const list = Array.isArray(existingAccounts)
  ? existingAccounts
  : (existingAccounts?.data ?? existingAccounts?.accounts ?? []);
let treasury = list.find?.((a) => a?.chain_type === 'ethereum');

if (treasury) {
  console.log(`     reusing existing: ${treasury.id}`);
} else {
  try {
    treasury = await call('POST', '/treasury/accounts', { chain_type: 'ethereum' });
    console.log(`     created: ${treasury.id}`);
  } catch (e) {
    // "one treasury account per chain type" — a conflict means it exists but we couldn't list it.
    if (e.status === 409 || /exist/i.test(JSON.stringify(e.body ?? ''))) {
      fail(
        'A treasury account for this chain already exists, but listing it failed.\n' +
          'Grab its ta_… id from https://dashboard.unifold.io and set UNIFOLD_TREASURY_ID by hand.',
      );
    }
    throw e;
  }
}
out.UNIFOLD_TREASURY_ID = treasury.id;
if (treasury.address) out.UNIFOLD_BASE_RECIPIENT_ADDRESS = treasury.address;

// 2. Webhook endpoint. The signing secret comes back on create, and stays re-readable afterwards
// via GET /webhook_endpoints/{id}/secret — see scripts/unifold-webhook-secret.mjs.
console.log(`\n2/2  Webhook endpoint → ${webhookUrl} …`);
const existingHooks = await tryCall('GET', '/webhook_endpoints');
const hooks = Array.isArray(existingHooks)
  ? existingHooks
  : (existingHooks?.data ?? existingHooks?.endpoints ?? []);
const dupe = hooks.find?.((h) => h?.url === webhookUrl);

if (dupe) {
  console.log(`     already registered: ${dupe.id}`);
  const secret = await tryCall('GET', `/webhook_endpoints/${dupe.id}/secret`);
  if (secret?.secret) out.UNIFOLD_WEBHOOK_SECRET = secret.secret;
  else console.log('     could not re-read its secret — try scripts/unifold-webhook-secret.mjs');
} else {
  const hook = await call('POST', '/webhook_endpoints', {
    name: 'hora app-services',
    url: webhookUrl,
    enabled_events: ENABLED_EVENTS,
  });
  console.log(`     created: ${hook.id}`);
  if (hook.secret) out.UNIFOLD_WEBHOOK_SECRET = hook.secret;
}

// --- report -----------------------------------------------------------------

console.log('\n' + '─'.repeat(72));
console.log('Paste these into .env (it is gitignored — never commit them):\n');
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);

if (out.UNIFOLD_BASE_RECIPIENT_ADDRESS) {
  console.log(
    `\nNote: UNIFOLD_BASE_RECIPIENT_ADDRESS above is the TREASURY's own address, so buy proceeds\n` +
      `land in the same treasury that funds sell-back payouts — the demo money circulates instead\n` +
      `of draining. Point it at your own Base wallet instead if you'd rather keep them separate.`,
  );
}
if (!out.UNIFOLD_WEBHOOK_SECRET) {
  console.log(
    `\n⚠  No webhook secret captured. Without it, signature verification cannot pass and every\n` +
      `   real webhook is rejected. Retrieve it with:  node scripts/unifold-webhook-secret.mjs`,
  );
}
console.log(
  `\nStill needed by hand from https://dashboard.unifold.io:\n` +
    `  UNIFOLD_PUBLISHABLE_KEY=pk_live_…   (also as VITE_UNIFOLD_PUBLISHABLE_KEY for the frontend)\n` +
    `  PAYMENT_GATEWAY=unifold             (flips app-services onto the real gateway)\n`,
);
