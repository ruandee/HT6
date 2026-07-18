/**
 * Orchestrator — the buy/sell business logic that ties the payment gateway (§10.5) to the chain
 * adapter (§10.2). This is what the REST routes call and what the webhook handler drives.
 *
 * Buy is async (§7c-A): quote -> beginDeposit(locked) -> [diner pays] -> webhook succeeded ->
 * chain.buy(maxPrice). Sell is sync: chain.sell -> gateway.payout. Holdings are an in-memory
 * read model here (real system: Postgres via chain-services indexer, §10.3).
 */
import {
  type ChainAdapter,
  type PaymentGateway,
  type PoolId,
  type UsdcBaseUnits,
  type UserId,
} from '@ttr/shared-types';

const QUOTE_WINDOW_SECONDS = 90; // §7c-A diner-facing lock window

interface Holding {
  userId: UserId;
  poolId: PoolId;
  status: 'held' | 'redeemed' | 'sold';
  acquiredAt: string;
}

/** correlation: deposit_intent_id -> what to do when it settles. */
interface PendingBuy {
  userId: UserId;
  poolId: PoolId;
  maxPrice: UsdcBaseUnits;
}

export class Orchestrator {
  private holdings: Holding[] = [];
  private pendingBuys = new Map<string, PendingBuy>();
  private processedEvents = new Set<string>();

  constructor(
    private readonly chain: ChainAdapter,
    private readonly gateway: PaymentGateway,
  ) {}

  /** POST /pools/:id/buy — quote, lock, create deposit intent. Returns checkout handle for the UI. */
  async beginBuy(poolId: PoolId, userId: UserId) {
    const q = await this.chain.quote(poolId);
    if (q.frozen) throw new Error('pool frozen; trading halted');
    const maxPrice = q.buy_price; // lock the price the diner saw
    const dep = await this.gateway.beginDeposit(
      userId,
      maxPrice,
      maxPrice,
      QUOTE_WINDOW_SECONDS,
      { kind: 'buy', pool_id: poolId },
    );
    this.pendingBuys.set(dep.deposit_intent_id, { userId, poolId, maxPrice });
    return {
      deposit_intent_id: dep.deposit_intent_id,
      max_price: maxPrice,
      expires_at: dep.quote_expires_at,
      checkout: dep.checkout,
    };
  }

  /** Called by the webhook handler on payment_intent.succeeded. Executes the on-chain buy (§7c-A). */
  async onDepositSucceeded(depositIntentId: string, eventId: string) {
    if (this.processedEvents.has(eventId)) return { duplicate: true };
    this.processedEvents.add(eventId);
    const pending = this.pendingBuys.get(depositIntentId);
    if (!pending) return { unknownIntent: true };

    const result = await this.chain.buy(pending.poolId, pending.userId, pending.maxPrice);
    this.pendingBuys.delete(depositIntentId);

    if (result.status === 'rejected_slippage') {
      // Price rose past the lock: refund the diner's deposit (real: gateway.payout of Base proceeds).
      await this.gateway.payout(pending.userId, pending.maxPrice, {
        kind: 'sell',
        pool_id: pending.poolId,
      });
      return { filled: false, reason: 'slippage_refunded' };
    }

    this.holdings.push({
      userId: pending.userId,
      poolId: pending.poolId,
      status: 'held',
      acquiredAt: new Date().toISOString(),
    });
    // If the price fell, result.refund is credited back (mock returns it; real: gateway.payout).
    return { filled: true, price_paid: result.price_paid, refund: result.refund };
  }

  /** payment_intent.expired / refunded — drop the pending buy so the diner re-quotes. */
  onDepositExpired(depositIntentId: string) {
    this.pendingBuys.delete(depositIntentId);
  }

  /** POST /pools/:id/sell — sync: burn to curve, then pay the diner out. */
  async sell(poolId: PoolId, userId: UserId) {
    const h = this.holdings.find(
      (x) => x.userId === userId && x.poolId === poolId && x.status === 'held',
    );
    if (!h) throw new Error('no held token to sell');
    const sold = await this.chain.sell(poolId, userId);
    h.status = 'sold';
    const payout = await this.gateway.payout(userId, sold.payout, { kind: 'sell', pool_id: poolId });
    return { payout_intent: payout.payout_id, payout_amount: sold.payout };
  }

  async holdingsFor(userId: UserId) {
    const out = [];
    for (const h of this.holdings.filter((x) => x.userId === userId)) {
      const q = await this.chain.quote(h.poolId);
      out.push({
        pool_id: h.poolId,
        status: h.status,
        acquired_at: h.acquiredAt,
        recover_value: q.sell_price,
      });
    }
    return out;
  }
}
