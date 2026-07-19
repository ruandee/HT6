/**
 * Offline verification for UnifoldGateway (no network, no API keys).
 *
 * Asserts the EXACT JSON bodies + headers we would send for a buy and a payout by stubbing
 * globalThis.fetch, and that every real webhook event type maps to the right normalized outcome.
 *
 * Run: node packages/app-services/test/unifold-gateway.test.mjs
 */
import assert from 'node:assert/strict';
import {
  UnifoldGateway,
  UnifoldApiError,
  normalizeUnifoldEvent,
  payoutIdempotencyKey,
} from '../dist/unifold-gateway.js';

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}

const CFG = {
  apiBase: 'https://api.unifold.io/v1',
  secretKey: 'sk_test_FAKE',
  publishableKey: 'pk_test_FAKE',
  treasuryId: 'ta_FAKE',
  webhookSecret: 'whsec_FAKE',
  baseRecipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0aB12',
  baseUsdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  resolvePayoutAddress: () => '0x606C49ca2Fa4982F07016265040F777eD3DA3160',
};

/** Records every fetch call and replays queued responses. */
function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body ?? 'null') });
    const r = responses.shift();
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Map([['x-request-id', 'req_test']]),
      text: async () => JSON.stringify(r.body),
    };
  };
  return calls;
}

console.log('\n== 1. Construction fails loudly on missing config ==');
for (const [key, envName] of [
  ['secretKey', 'UNIFOLD_SECRET_KEY'],
  ['publishableKey', 'UNIFOLD_PUBLISHABLE_KEY'],
  ['treasuryId', 'UNIFOLD_TREASURY_ID'],
  ['webhookSecret', 'UNIFOLD_WEBHOOK_SECRET'],
  ['baseRecipientAddress', 'UNIFOLD_BASE_RECIPIENT_ADDRESS'],
]) {
  assert.throws(
    () => new UnifoldGateway({ ...CFG, [key]: '' }),
    (e) => e.message.includes(envName) && e.message.includes('missing required configuration'),
    `should reject missing ${envName}`,
  );
  ok(`missing ${envName} -> throws naming the env var`);
}
assert.throws(
  () => new UnifoldGateway({ ...CFG, secretKey: 'pk_test_oops' }),
  /must be a secret key starting with "sk_"/,
);
ok('publishable key in the secret slot -> throws');
// A fully-but-fakely configured gateway CONSTRUCTS fine; it only fails on the first HTTP call.
const gw = new UnifoldGateway(CFG);
ok('fully (if fakely) configured -> constructs');

console.log('\n== 2. beginDeposit sends the exact two-step locked-quote calls ==');
{
  const calls = mockFetch([
    { status: 200, body: { quote_id: 'lqq_TEST123', expired_at: '2026-07-18T12:00:30.000Z', source_amount: '58000000', source_currency: 'usdc', source_network: 'solana', destination_amount: '58000000' } },
    { status: 200, body: { id: 'pi_TEST456', type: 'locked_quote', status: 'requires_payment', client_secret: 'pi_TEST456_secret_abc', destination_amount: '58000000', expires_at: '2026-07-18T12:01:30.000Z' } },
  ]);
  const out = await gw.beginDeposit('auth0|diner1', '58000000', '58000000', 90, { kind: 'buy', pool_id: 'pool_7' });

  assert.equal(calls.length, 2, 'exactly two HTTP calls');
  // --- step 1: preview
  assert.equal(calls[0].url, 'https://api.unifold.io/v1/payment_intents/locked_quotes/quote');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.authorization, 'Bearer sk_test_FAKE');
  assert.deepEqual(calls[0].body, {
    source_currency: 'usdc',
    source_network: 'base',
    destination_amount: '58000000',
    destination_currency: 'usdc',
    destination_network: 'base',
  });
  ok('step 1 POST /payment_intents/locked_quotes/quote body + auth header');
  // --- step 2: commit
  assert.equal(calls[1].url, 'https://api.unifold.io/v1/payment_intents/locked_quotes');
  assert.deepEqual(calls[1].body, {
    quote_id: 'lqq_TEST123',
    recipient_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0aB12',
    external_user_id: 'auth0|diner1',
    metadata: { kind: 'buy', pool_id: 'pool_7', max_price: '58000000', amount_usdc: '58000000' },
  });
  ok('step 2 commits the lqq_ quote with pool_id + max_price in metadata');
  assert.equal(calls[1].headers['idempotency-key'], undefined);
  ok('intent-commit carries NO idempotency key (non-idempotent, never retried)');

  // --- return shape
  assert.deepEqual(out, {
    deposit_intent_id: 'pi_TEST456',
    checkout: { client_secret: 'pi_TEST456_secret_abc', publishable_key: 'pk_test_FAKE' },
    quote_expires_at: '2026-07-18T12:01:30.000Z',
  });
  ok('returns { deposit_intent_id, checkout{client_secret,publishable_key}, quote_expires_at }');

  // --- pending row persisted, keyed by pi.id (the correlation key)
  const pending = gw.pending.get('pi_TEST456');
  assert.equal(pending.userId, 'auth0|diner1');
  assert.equal(pending.maxPrice, '58000000');
  assert.equal(pending.purpose.pool_id, 'pool_7');
  assert.equal(pending.status, 'requires_payment');
  ok('pending intent persisted keyed by pi.id, mirroring StubGateway');
}

console.log('\n== 3. payout sends an outbound transfer with a deterministic Idempotency-Key ==');
{
  const calls = mockFetch([{ status: 201, body: { id: 'obt_TEST789', status: 'pending' } }]);
  const out = await gw.payout('auth0|diner1', '55100000', { kind: 'sell', pool_id: 'pool_7' });

  assert.equal(calls[0].url, 'https://api.unifold.io/v1/treasury/outbound_transfers');
  assert.deepEqual(calls[0].body, {
    // '8453' on BOTH sides selects Base. Note 'mainnet' in this enum means SOLANA, not Ethereum
    // mainnet — sending it here would silently route the payout off the wrong treasury.
    source: { treasury_account_id: 'ta_FAKE', currency: 'usdc', chain_id: '8453' },
    external_user_id: 'auth0|diner1',
    destination: {
      recipient_address: '0x606C49ca2Fa4982F07016265040F777eD3DA3160',
      chain_type: 'ethereum',
      chain_id: '8453',
      token_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
    amount: '55100000',
  });
  ok('outbound transfer body: Base destination, chain_id "8453" on both sides');
  assert.equal(calls[0].headers['idempotency-key'], 'sell:pool_7:auth0|diner1:55100000');
  ok('REQUIRED Idempotency-Key header present and deterministic');
  assert.deepEqual(out, { payout_id: 'obt_TEST789' });
  ok('returns { payout_id }');

  // determinism: same inputs -> same key (a retried payout cannot pay twice)
  const k1 = payoutIdempotencyKey('u', '100', { kind: 'sell', pool_id: 'p' });
  const k2 = payoutIdempotencyKey('u', '100', { kind: 'sell', pool_id: 'p' });
  assert.equal(k1, k2);
  assert.notEqual(k1, payoutIdempotencyKey('u', '200', { kind: 'sell', pool_id: 'p' }));
  ok('idempotency key is deterministic and amount-sensitive');

  // A Solana address left over from the pre-Base configuration must be caught BEFORE the HTTP
  // call, not surface as an opaque 4xx after money has started moving.
  const solanaCfg = {
    ...CFG,
    resolvePayoutAddress: () => 'DinerSo1anaUSDCAddr11111111111111111111111',
  };
  const badGw = new UnifoldGateway(solanaCfg);
  const before = calls.length;
  await assert.rejects(
    () => badGw.payout('u', '100', { kind: 'sell', pool_id: 'p' }),
    /not a Base \(EVM\) address/,
  );
  assert.equal(calls.length, before, 'rejected without issuing any HTTP call');
  ok('payout rejects a non-EVM address before spending money');
}

console.log('\n== 4. Retry policy: only idempotent ops retry ==');
{
  // Payout carries a deterministic key -> safe to retry a 500.
  const calls = mockFetch([
    { status: 500, body: { error: 'upstream boom' } },
    { status: 201, body: { id: 'obt_RETRIED', status: 'pending' } },
  ]);
  const out = await gw.payout('u2', '1000000', { kind: 'sell', pool_id: 'p2' });
  assert.equal(calls.length, 2);
  assert.equal(out.payout_id, 'obt_RETRIED');
  ok('payout retries a 5xx (idempotency-keyed) and succeeds');
}
{
  // A quote preview must NEVER be retried — one call only, error surfaces.
  const calls = mockFetch([{ status: 500, body: { error: 'boom' } }]);
  await assert.rejects(
    () => gw.beginDeposit('u3', '1000000', '1000000', 90, { kind: 'buy', pool_id: 'p3' }),
    (e) => e instanceof UnifoldApiError && e.status === 500 && e.message.includes('boom'),
  );
  assert.equal(calls.length, 1, 'quote preview attempted exactly once');
  ok('beginDeposit does NOT retry the non-idempotent quote POST; error carries Unifold body');
}
{
  // 4xx is deterministic: not retried even on a retryable operation.
  const calls = mockFetch([{ status: 400, body: { code: 'insufficient_funds', detail: 'treasury empty' } }]);
  await assert.rejects(
    () => gw.payout('u4', '1000000', { kind: 'sell', pool_id: 'p4' }),
    (e) => e.status === 400 && e.message.includes('insufficient_funds') && e.message.includes('treasury empty'),
  );
  assert.equal(calls.length, 1);
  ok('4xx is not retried and the Unifold error body is surfaced verbatim');
}

console.log('\n== 5. Webhook event mapping (all 8 real event types) ==');
const evt = (type, object = {}) => ({ id: 'evt_1', object: 'event', type, data: { object: { id: 'pi_X', ...object } } });

const cases = [
  ['payment_intent.processing', evt('payment_intent.processing'), { action: 'ignore' }],
  ['payment_intent.succeeded', evt('payment_intent.succeeded', { metadata: { pool_id: 'pool_7', max_price: '58000000' } }),
    { action: 'deposit_succeeded', intentId: 'pi_X', poolId: 'pool_7', maxPrice: '58000000' }],
  ['payment_intent.expired', evt('payment_intent.expired'), { action: 'deposit_expired', intentId: 'pi_X', reason: 'expired' }],
  ['payment_intent.awaiting_refund', evt('payment_intent.awaiting_refund'), { action: 'deposit_awaiting_refund', intentId: 'pi_X' }],
  ['payment_intent.refunded', evt('payment_intent.refunded'), { action: 'deposit_expired', intentId: 'pi_X', reason: 'refunded' }],
  ['payment_intent.refund_failed', evt('payment_intent.refund_failed', { failure_reason: 'bad addr' }),
    { action: 'deposit_refund_failed', intentId: 'pi_X', failureReason: 'bad addr' }],
  ['treasury.outbound_transfer.completed', { id: 'evt_2', type: 'treasury.outbound_transfer.completed', data: { object: { id: 'ot_9', status: 'completed' } } },
    { action: 'payout_settled', payoutId: 'ot_9', status: 'completed' }],
  ['treasury.outbound_transfer.failed', { id: 'evt_3', type: 'treasury.outbound_transfer.failed', data: { object: { id: 'ot_9', status: 'failed', failure_reason: 'Insufficient funds in treasury account' } } },
    { action: 'payout_settled', payoutId: 'ot_9', status: 'failed', failureReason: 'Insufficient funds in treasury account' }],
];
for (const [name, input, expected] of cases) {
  const got = normalizeUnifoldEvent(input);
  for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, `${name}.${k}`);
  ok(`${name} -> ${expected.action}`);
}
// unknown events must be ignored (2xx), never thrown — otherwise Unifold retries forever
assert.equal(normalizeUnifoldEvent({ id: 'e', type: 'deposit.created', data: { object: { id: 'x' } } }).action, 'ignore');
assert.equal(normalizeUnifoldEvent({}).action, 'ignore');
ok('unknown / malformed events -> ignore (endpoint still returns 2xx)');

// The stub's envelope shape flows through the SAME normalizer as the real one.
const stubEnvelope = { id: 'evt_123', type: 'payment_intent.succeeded', data: { object: { id: 'pi_stub_1', status: 'succeeded' } } };
assert.deepEqual(normalizeUnifoldEvent(stubEnvelope), { action: 'deposit_succeeded', intentId: 'pi_stub_1', poolId: undefined, maxPrice: undefined });
ok('stub-shaped envelope normalizes identically (one code path for both gateways)');

console.log(`\nALL ${passed} ASSERTIONS PASSED\n`);
