/**
 * MockChainAdapter — the §8.1 "mock FIRST" deliverable. In-memory, spec-conformant implementation
 * of `ChainAdapter` (§10.2) so app-services + both frontends build and demo before the real
 * Anchor program exists. SWAP A later replaces this with the real Solana client, same interface.
 *
 * Honors: §7c-A quote-lock (buy checks max_price), §7b θ decay, shared pricing.ts math, and the
 * solvency invariant (reserve = Σ paid). Clock is injectable so the demo can fast-forward θ.
 */
import {
  buyPrice,
  sellPayout,
  sellPrice,
  thetaBps,
  type Address,
  type BuyResult,
  type ChainAdapter,
  type CreatePoolParams,
  type CreatePoolResult,
  type Pool,
  type PoolId,
  type QuoteResult,
  type RedeemResult,
  type SellResult,
  type SweepResult,
  type CheckInResult,
  type UsdcBaseUnits,
  type UserId,
} from '@ttr/shared-types';

interface HeldToken {
  user_id: UserId;
  paid: UsdcBaseUnits; // what this token paid in (for sweep accounting)
  redeemed: boolean; // true once checked in (consumed)
}

interface MockPool extends Pool {
  reserve_balance: bigint; // Σ paid by outstanding tokens
  royalties: bigint; // accrued φ spread
  tokens: HeldToken[]; // one entry per outstanding (unsold) token
}

let nextId = 1;

export class MockChainAdapter implements ChainAdapter {
  private pools = new Map<PoolId, MockPool>();
  /** injectable clock (seconds) so the demo can fast-forward toward service_time. */
  now: () => number = () => Math.floor(Date.now() / 1000);

  private theta(p: MockPool): number {
    return thetaBps(p.service_time, this.now(), p.tc_seconds);
  }

  private syncFrozen(p: MockPool): void {
    if (!p.frozen && this.now() >= p.service_time) p.frozen = true;
  }

  async create_pool(params: CreatePoolParams): Promise<CreatePoolResult> {
    const pool_id = `pool_${nextId++}`;
    const mint: Address = `mint_${pool_id}`;
    this.pools.set(pool_id, {
      authority: params.authority,
      mint,
      reserve: `reserve_${pool_id}`,
      p0: params.p0,
      k: params.k,
      n_sold: 0,
      n_max: params.n_max,
      phi_bps: params.phi_bps,
      service_time: params.service_time,
      tc_seconds: params.tc_seconds,
      party_size: params.party_size,
      frozen: false,
      reserve_balance: 0n,
      royalties: 0n,
      tokens: [],
    });
    return { pool_id, mint };
  }

  private get(pool_id: PoolId): MockPool {
    const p = this.pools.get(pool_id);
    if (!p) throw new Error(`unknown pool ${pool_id}`);
    this.syncFrozen(p);
    return p;
  }

  async quote(pool_id: PoolId): Promise<QuoteResult> {
    const p = this.get(pool_id);
    const theta = this.theta(p);
    return {
      n_sold: p.n_sold,
      n_max: p.n_max,
      theta_bps: theta,
      buy_price: buyPrice(p.p0, p.k, p.n_sold, theta),
      sell_price: sellPrice(p.p0, p.k, p.n_sold, theta),
      frozen: p.frozen,
    };
  }

  async buy(
    pool_id: PoolId,
    buyer_user_id: UserId,
    max_price: UsdcBaseUnits,
  ): Promise<BuyResult> {
    const p = this.get(pool_id);
    if (p.frozen) throw new Error('pool frozen; trading halted');
    if (p.n_sold >= p.n_max) throw new Error('pool sold out');
    // One table per diner per pool. A reservation is for a table you intend to use; holding
    // several withholds inventory from real diners and turns the curve into a speculation
    // vehicle (buy cheap early, sell into the sold-out premium later). Different NIGHTS are
    // different pools and are unrestricted. The real Anchor program must enforce this too.
    // Note: this counts REDEEMED tokens too — once you've taken the night's table (checked in),
    // you don't get to buy another for the same window. Selling back DOES free you to rebuy,
    // since the token left your hands and returned to the curve.
    if (p.tokens.some((t) => t.user_id === buyer_user_id)) {
      throw new Error('already holding a table for this service window');
    }
    const theta = this.theta(p);
    const current = BigInt(buyPrice(p.p0, p.k, p.n_sold, theta));
    // §7c-A: reject if current price rose past the diner's locked max.
    if (current > BigInt(max_price)) {
      return { tx_sig: `tx_${nextId++}`, status: 'rejected_slippage' };
    }
    // price fell? refund the difference the diner had locked.
    const refund = BigInt(max_price) - current;
    p.n_sold += 1;
    p.reserve_balance += current;
    p.tokens.push({ user_id: buyer_user_id, paid: current.toString(), redeemed: false });
    return {
      tx_sig: `tx_${nextId++}`,
      status: 'filled',
      price_paid: current.toString(),
      ...(refund > 0n ? { refund: refund.toString() } : {}),
    };
  }

  async sell(pool_id: PoolId, seller_user_id: UserId): Promise<SellResult> {
    const p = this.get(pool_id);
    if (p.frozen) throw new Error('pool frozen; trading halted');
    const idx = p.tokens.findIndex((t) => t.user_id === seller_user_id && !t.redeemed);
    if (idx < 0) throw new Error('no sellable token for user');
    const theta = this.theta(p);
    const gross = sellPrice(p.p0, p.k, p.n_sold, theta);
    const payout = sellPayout(gross, p.phi_bps);
    const royalty = BigInt(gross) - BigInt(payout);
    p.n_sold -= 1;
    p.reserve_balance -= BigInt(payout) + royalty; // full sell_price leaves the paid-in pool
    p.royalties += royalty;
    p.tokens.splice(idx, 1);
    return { tx_sig: `tx_${nextId++}`, payout };
  }

  async redeem(pool_id: PoolId, user_id: UserId): Promise<RedeemResult> {
    const p = this.get(pool_id);
    const t = p.tokens.find((x) => x.user_id === user_id && !x.redeemed);
    if (!t) throw new Error('no redeemable token for user');
    t.redeemed = true; // consumed; USDC stays in reserve
    return { tx_sig: `tx_${nextId++}` };
  }

  async check_in(
    pool_id: PoolId,
    user_id: UserId,
    restaurant_authority: Address,
  ): Promise<CheckInResult> {
    const p = this.get(pool_id);
    if (p.authority !== restaurant_authority) throw new Error('not pool authority');
    await this.redeem(pool_id, user_id);
    return { tx_sig: `tx_${nextId++}` };
  }

  async sweep(pool_id: PoolId, restaurant_authority: Address): Promise<SweepResult> {
    const p = this.get(pool_id);
    if (p.authority !== restaurant_authority) throw new Error('not pool authority');
    if (!p.frozen) throw new Error('pool not frozen; cannot sweep before service');
    const consumed = p.tokens.filter((t) => t.redeemed).length;
    const forfeited = p.tokens.filter((t) => !t.redeemed).length; // no-shows
    const amount = p.reserve_balance + p.royalties;
    const creditsToHonor = BigInt(p.p0) * BigInt(consumed);
    p.reserve_balance = 0n;
    p.royalties = 0n;
    return {
      tx_sig: `tx_${nextId++}`,
      amount_swept: amount.toString(),
      consumed_count: consumed,
      forfeited_count: forfeited,
      credits_to_honor: creditsToHonor.toString(),
    };
  }
}
