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

/**
 * Projection hooks the issuer read model subscribes to (§10.3 indexer role). `gross` on sell is
 * the sell_price BEFORE the φ royalty; `payout` is what the seller actually received, so
 * `gross − payout` is the restaurant's accrued royalty.
 */
export interface TradeObserver {
  onBuy?: (poolId: PoolId, userId: UserId, pricePaid: UsdcBaseUnits) => void;
  onSell?: (
    poolId: PoolId,
    userId: UserId,
    payout: UsdcBaseUnits,
    gross: UsdcBaseUnits,
  ) => void;
}

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
  /** epoch ms when the locked quote lapses; past this the intent no longer blocks a rebuy. */
  expiresAt: number;
}

export class Orchestrator {
  private holdings: Holding[] = [];
  private pendingBuys = new Map<string, PendingBuy>();
  private processedEvents = new Set<string>();

  /**
   * `siblingPools` returns every pool sharing a service window with the given one (i.e. the
   * other party-size bands that night, §4a). Used for the §7c-C one-table-per-window check.
   * Defaults to "just this pool" so the orchestrator works standalone in tests.
   */
  constructor(
    private readonly chain: ChainAdapter,
    private readonly gateway: PaymentGateway,
    private readonly siblingPools: (poolId: PoolId) => PoolId[] = (id) => [id],
    /**
     * Read-model projection hooks (§10.3). The frozen ChainAdapter exposes no getter for reserve
     * balance / royalties / holders, so the issuer dashboard's read model is fed from the trades
     * observed here — same role the indexer plays against the real program. Optional so the
     * orchestrator still runs standalone.
     */
    private readonly observer: TradeObserver = {},
  ) {}

  /** POST /pools/:id/buy — quote, lock, create deposit intent. Returns checkout handle for the UI. */
  async beginBuy(poolId: PoolId, userId: UserId) {
    const q = await this.chain.quote(poolId);
    if (q.frozen) throw new Error('pool frozen; trading halted');
    if (q.n_sold >= q.n_max) throw new Error('this night is sold out');

    // One table per diner per SERVICE WINDOW, across every band (§7c-C) — checked BEFORE taking
    // money. The chain enforces this too (that's authoritative), but failing only at settlement
    // would mean the diner already paid. Scoped to the whole window so the cross-band straddle
    // (hold a 2-top and a 4-top, sell back whichever leg the curve favours) can't be opened.
    const window = new Set(this.siblingPools(poolId));
    if (
      this.holdings.some(
        (h) => h.userId === userId && h.status === 'held' && window.has(h.poolId),
      )
    ) {
      throw new Error('you already have a table for this night');
    }
    // ...and don't let a second checkout open while one is still LIVE (double-click / two tabs /
    // one tab per band). Lapsed intents are swept first: an abandoned checkout must not lock the
    // diner out of the night forever — the quote lock is time-bounded (§7c-A), so once it expires
    // the diner is free to re-quote.
    const now = Date.now();
    for (const [id, p] of this.pendingBuys) {
      if (p.expiresAt <= now) this.pendingBuys.delete(id);
    }
    for (const p of this.pendingBuys.values()) {
      if (p.userId === userId && window.has(p.poolId)) {
        throw new Error('you already have a checkout open for this night');
      }
    }

    const maxPrice = q.buy_price; // lock the price the diner saw
    const dep = await this.gateway.beginDeposit(
      userId,
      maxPrice,
      maxPrice,
      QUOTE_WINDOW_SECONDS,
      { kind: 'buy', pool_id: poolId },
    );
    this.pendingBuys.set(dep.deposit_intent_id, {
      userId,
      poolId,
      maxPrice,
      expiresAt: Date.parse(dep.quote_expires_at) || Date.now() + QUOTE_WINDOW_SECONDS * 1000,
    });
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

    let result;
    try {
      result = await this.chain.buy(pending.poolId, pending.userId, pending.maxPrice);
    } catch (e) {
      // Chain refused (sold out, already holding, frozen). The diner has already paid, so
      // refund rather than swallow it.
      this.pendingBuys.delete(depositIntentId);
      await this.gateway.payout(pending.userId, pending.maxPrice, {
        kind: 'sell',
        pool_id: pending.poolId,
      });
      return { filled: false, reason: 'rejected_refunded', error: String(e) };
    }
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
    this.observer.onBuy?.(pending.poolId, pending.userId, result.price_paid ?? pending.maxPrice);
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
    // gross sell_price BEFORE φ, read at the same curve state the sell will execute against.
    // royalty = gross − payout, which is what accrues to the restaurant (§4 cooperative issuer).
    const pre = await this.chain.quote(poolId);
    const sold = await this.chain.sell(poolId, userId);
    h.status = 'sold';
    this.observer.onSell?.(poolId, userId, sold.payout, pre.sell_price);
    const payout = await this.gateway.payout(userId, sold.payout, { kind: 'sell', pool_id: poolId });
    return { payout_intent: payout.payout_id, payout_amount: sold.payout };
  }

  /**
   * Mark a holding consumed after the issuer checked the diner in (§7c-B CONSUMED). The chain
   * call itself happens in IssuerService; this keeps the diner-facing holdings view honest.
   * Check-in does NOT free a rebuy for that window (§7c-C) — status becomes 'redeemed', not 'sold'.
   */
  markRedeemed(poolId: PoolId, userId: UserId): void {
    const h = this.holdings.find(
      (x) => x.userId === userId && x.poolId === poolId && x.status === 'held',
    );
    if (h) h.status = 'redeemed';
  }

  /** Users with a live (held) token in this pool — the check-in list the floor manager works. */
  heldUserIds(poolId: PoolId): UserId[] {
    return this.holdings
      .filter((h) => h.poolId === poolId && h.status === 'held')
      .map((h) => h.userId);
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
