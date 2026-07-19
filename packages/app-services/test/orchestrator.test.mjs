import assert from 'node:assert/strict';
import test from 'node:test';
import { MockChainAdapter } from '@ttr/chain-services';
import { Orchestrator } from '../dist/orchestrator.js';
import { StubGateway } from '../dist/stub-gateway.js';

class RecordingGateway extends StubGateway {
  payouts = [];
  failPayouts = 0;

  async payout(userId, amount, purpose) {
    this.payouts.push({ userId, amount, purpose });
    if (this.failPayouts > 0) {
      this.failPayouts--;
      throw new Error('temporary payout failure');
    }
    return super.payout(userId, amount, purpose);
  }
}

async function setup() {
  let now = 1_000;
  const chain = new MockChainAdapter();
  chain.now = () => now;
  const { pool_id: poolId } = await chain.create_pool({
    authority: 'restaurant',
    p0: '40000000',
    k: '3000000',
    n_max: 10,
    phi_bps: 500,
    service_time: 3_000,
    tc_seconds: 1_000,
    party_size: 2,
  });
  await chain.buy(poolId, 'seed', '40000000');
  const gateway = new RecordingGateway();
  const orchestrator = new Orchestrator(chain, gateway);
  const buy = await orchestrator.beginBuy(poolId, 'diner');
  return { chain, gateway, orchestrator, poolId, buy, setNow: (value) => (now = value) };
}

test('a lower fill price pays the difference exactly once', async () => {
  const { gateway, orchestrator, poolId, buy, setNow } = await setup();
  setNow(2_500); // theta falls from 10000 to 5000: 43 USDC quote -> 41.5 USDC fill

  assert.deepEqual(await orchestrator.onDepositSucceeded(buy.deposit_intent_id, 'evt-lower'), {
    filled: true,
    price_paid: '41500000',
    refund: '1500000',
  });
  assert.deepEqual(gateway.payouts, [
    { userId: 'diner', amount: '1500000', purpose: { kind: 'sell', pool_id: poolId } },
  ]);
  assert.deepEqual(await orchestrator.onDepositSucceeded(buy.deposit_intent_id, 'evt-lower'), {
    duplicate: true,
  });
  assert.equal(gateway.payouts.length, 1);
});

test('a failed difference payout retries without buying twice', async () => {
  const { chain, gateway, orchestrator, poolId, buy, setNow } = await setup();
  setNow(2_500);
  gateway.failPayouts = 1;

  await assert.rejects(
    orchestrator.onDepositSucceeded(buy.deposit_intent_id, 'evt-retry'),
    /temporary payout failure/,
  );
  assert.equal((await chain.quote(poolId)).n_sold, 2, 'the first chain buy filled');

  const retried = await orchestrator.onDepositSucceeded(buy.deposit_intent_id, 'evt-retry');
  assert.equal(retried.filled, true);
  assert.equal((await chain.quote(poolId)).n_sold, 2, 'retry did not execute a second chain buy');
  assert.deepEqual(gateway.payouts.map((p) => p.amount), ['1500000', '1500000']);
});

test('a rejected buy keeps retrying its refund until payout succeeds', async () => {
  const { chain, gateway, orchestrator, poolId, buy, setNow } = await setup();
  setNow(3_000); // trading freezes, so the paid buy is rejected and must be fully refunded
  gateway.failPayouts = 1;

  await assert.rejects(
    orchestrator.onDepositSucceeded(buy.deposit_intent_id, 'evt-rejected'),
    /temporary payout failure/,
  );
  assert.equal((await chain.quote(poolId)).n_sold, 1);

  const retried = await orchestrator.onDepositSucceeded(buy.deposit_intent_id, 'evt-rejected');
  assert.equal(retried.filled, false);
  assert.equal(retried.reason, 'rejected_refunded');
  assert.deepEqual(gateway.payouts.map((p) => p.amount), [buy.max_price, buy.max_price]);
});

test('a failed sell payout retries without selling twice', async () => {
  const { chain, gateway, orchestrator, poolId, buy } = await setup();
  await orchestrator.onDepositSucceeded(buy.deposit_intent_id, 'evt-buy');
  gateway.failPayouts = 1;

  await assert.rejects(orchestrator.sell(poolId, 'diner'), /temporary payout failure/);
  assert.equal((await chain.quote(poolId)).n_sold, 1, 'the first chain sell completed');

  const retried = await orchestrator.sell(poolId, 'diner');
  assert.equal(retried.payout_amount, '40850000');
  assert.equal((await chain.quote(poolId)).n_sold, 1, 'retry did not execute a second chain sell');
  assert.deepEqual(gateway.payouts.map((p) => p.amount), ['40850000', '40850000']);
});
