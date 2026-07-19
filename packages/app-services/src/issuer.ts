/**
 * Issuer (restaurant) read-model + operations — the §10.4 `/restaurant/*` routes.
 *
 * WHY A READ MODEL LIVES HERE: the frozen §10.2 `ChainAdapter` exposes only `quote()` as a read
 * method. It has no getter for reserve balance, accrued royalties, or the holder list — those are
 * exactly the things §10.3 says the INDEXER projects into Postgres ("pool_state.reserve_balance",
 * "holdings"). So app-services keeps that projection in memory here, derived from the trades it
 * observes plus the pure §7b/§10.2 pricing math from @ttr/shared-types. Postgres is only a read
 * cache and the chain stays authoritative over money (§0), so this is the spec-shaped place for
 * it — and it avoids touching chain-services (stream 2) at all.
 *
 * Every money value is a USDC base-unit STRING (§ common.ts money convention). bigint internally,
 * string at every boundary. Never a float.
 */
import {
  buyPrice,
  sellPayout,
  sellPrice,
  thetaBps,
  type Address,
  type ChainAdapter,
  type CreatePoolRequest,
  type HoldingStatus,
  type IssuerPoolView,
  type PoolId,
  type SweepResponse,
  type UsdcBaseUnits,
  type UserId,
} from '@ttr/shared-types';

/** One outstanding token, mirroring the mock adapter's internal token list (§7c-B states). */
interface LedgerToken {
  user_id: UserId;
  paid: bigint; // what this token paid into the reserve
  redeemed: boolean; // true once checked in => CONSUMED at sweep, else FORFEITED
  acquired_at: string;
}

interface LedgerPool {
  pool_id: PoolId;
  authority: Address;
  label: string;
  venue_name: string;
  p0: bigint;
  k: bigint;
  phi_bps: number;
  n_max: number;
  service_time: number;
  tc_seconds: number;
  /** late-arrival window, seconds past service_time (§ grace). 0 = door closes at service. */
  grace_seconds: number;
  party_size: number;
  reserve: bigint; // Σ paid by outstanding tokens (solvency invariant, §4)
  royalties: bigint; // accrued φ spread — the cooperative-issuer number (§4)
  tokens: LedgerToken[];
  /** set once swept, so the dashboard can keep showing the §7c-B breakdown after settlement. */
  swept: SweepResponse | null;
}

export class IssuerService {
  private pools = new Map<PoolId, LedgerPool>();

  constructor(private readonly chain: ChainAdapter) {}

  /** Register a pool created elsewhere (e.g. the demo seed) so the dashboard can see it. */
  register(p: {
    pool_id: PoolId;
    authority: Address;
    label: string;
    venue_name: string;
    p0: UsdcBaseUnits;
    k: UsdcBaseUnits;
    phi_bps: number;
    n_max: number;
    service_time: number;
    tc_seconds: number;
    party_size: number;
    /** late-arrival window in seconds; check_in valid until service_time + this. Default 0. */
    grace_seconds?: number;
  }): void {
    this.pools.set(p.pool_id, {
      ...p,
      grace_seconds: p.grace_seconds ?? 0,
      p0: BigInt(p.p0),
      k: BigInt(p.k),
      reserve: 0n,
      royalties: 0n,
      tokens: [],
      swept: null,
    });
  }

  /** §10.4 POST /restaurant/pools — create_pool passthrough, one call per band (§4a). */
  async createPool(
    req: CreatePoolRequest,
    authority: Address,
    venue_name: string,
  ): Promise<{ pool_id: PoolId; mint: Address }> {
    if (req.n_max <= 0) throw new Error('n_max must be at least 1');
    if (req.party_size <= 0) throw new Error('party_size must be at least 1');
    if (req.phi_bps < 0 || req.phi_bps > 10_000) throw new Error('phi_bps must be 0..10000');
    if (BigInt(req.p0) <= 0n) throw new Error('p0 must be positive');
    if (BigInt(req.k) < 0n) throw new Error('k must be non-negative');
    // A negative grace would pull the check-in deadline before service and let sweep run early.
    if ((req.grace_seconds ?? 0) < 0) throw new Error('grace_seconds must be non-negative');

    const { pool_id, mint } = await this.chain.create_pool({
      authority,
      p0: req.p0,
      k: req.k,
      n_max: req.n_max,
      phi_bps: req.phi_bps,
      service_time: req.service_time,
      tc_seconds: req.tc_seconds,
      party_size: req.party_size,
      grace_seconds: req.grace_seconds ?? 0,
    });
    this.register({
      pool_id,
      authority,
      label: req.label,
      venue_name,
      p0: req.p0,
      k: req.k,
      phi_bps: req.phi_bps,
      n_max: req.n_max,
      service_time: req.service_time,
      tc_seconds: req.tc_seconds,
      party_size: req.party_size,
      grace_seconds: req.grace_seconds ?? 0,
    });
    return { pool_id, mint };
  }

  /** Observed a filled buy: token enters the reserve at the price actually paid. */
  onBuy(pool_id: PoolId, user_id: UserId, price_paid: UsdcBaseUnits): void {
    const p = this.pools.get(pool_id);
    if (!p) return;
    p.reserve += BigInt(price_paid);
    p.tokens.push({
      user_id,
      paid: BigInt(price_paid),
      redeemed: false,
      acquired_at: new Date().toISOString(),
    });
  }

  /**
   * Observed a sell-back. The seller's payout leaves the reserve and the φ spread stays behind as
   * the restaurant's ROYALTY — this is the whole cooperative-issuer pitch (§4, demo step 3).
   * `payout` is net of φ, so the royalty is gross sell_price − payout.
   */
  onSell(pool_id: PoolId, user_id: UserId, payout: UsdcBaseUnits, gross: UsdcBaseUnits): void {
    const p = this.pools.get(pool_id);
    if (!p) return;
    const idx = p.tokens.findIndex((t) => t.user_id === user_id && !t.redeemed);
    if (idx >= 0) p.tokens.splice(idx, 1);
    const royalty = BigInt(gross) - BigInt(payout);
    p.reserve -= BigInt(gross); // full sell_price leaves the paid-in pool...
    p.royalties += royalty; // ...of which φ is retained as issuer revenue
  }

  /** Current gross sell_price for this pool, so `onSell` can split payout vs. royalty. */
  grossSellPrice(pool_id: PoolId, n_sold: number, now: number): UsdcBaseUnits {
    const p = this.pools.get(pool_id);
    if (!p) return '0';
    const theta = thetaBps(p.service_time, now, p.tc_seconds);
    return sellPrice(p.p0.toString(), p.k.toString(), n_sold, theta);
  }

  /** §10.4 POST /restaurant/pools/:id/checkin — issuer marks a diner arrived, triggering redeem. */
  async checkIn(pool_id: PoolId, user_id: UserId): Promise<{ tx_sig: string }> {
    const p = this.mustGet(pool_id);
    const r = await this.chain.check_in(pool_id, user_id, p.authority);
    const t = p.tokens.find((x) => x.user_id === user_id && !x.redeemed);
    if (t) t.redeemed = true; // CONSUMED (§7c-B) — their USDC stays in reserve
    return { tx_sig: r.tx_sig };
  }

  /**
   * §10.4 POST /restaurant/pools/:id/sweep → §7c-B accounting. Requires the pool to be FROZEN
   * (service_time reached) — the chain enforces that; we surface a legible error.
   */
  async sweep(pool_id: PoolId): Promise<SweepResponse> {
    const p = this.mustGet(pool_id);
    const r = await this.chain.sweep(pool_id, p.authority);
    const out: SweepResponse = {
      amount_swept: r.amount_swept,
      consumed_count: r.consumed_count,
      forfeited_count: r.forfeited_count,
      credits_to_honor: r.credits_to_honor,
    };
    p.swept = out;
    p.reserve = 0n;
    p.royalties = 0n;
    return out;
  }

  /**
   * §10.4 GET /restaurant/pools/:id — fill %, reserve, holders, royalties accrued.
   * Extended (additively) with the params/quote the dashboard needs to render the curve state and
   * the post-sweep §7c-B breakdown; `IssuerPoolView` is frozen so nothing was removed.
   */
  async view(pool_id: PoolId): Promise<IssuerPoolViewPlus> {
    const p = this.mustGet(pool_id);
    const q = await this.chain.quote(pool_id);
    const holders: IssuerPoolView['holders'] = p.tokens.map((t) => ({
      user_id: t.user_id,
      token_amount: 1,
      status: (t.redeemed ? 'redeemed' : 'held') satisfies HoldingStatus,
    }));
    return {
      pool_id,
      fill_pct: q.n_max > 0 ? q.n_sold / q.n_max : 0,
      reserve_balance: p.reserve.toString(),
      royalties_accrued: p.royalties.toString(),
      holders,
      // --- additive dashboard extras ---
      label: p.label,
      venue_name: p.venue_name,
      party_size: p.party_size,
      n_sold: q.n_sold,
      n_max: q.n_max,
      p0: p.p0.toString(),
      k: p.k.toString(),
      phi_bps: p.phi_bps,
      service_time: p.service_time,
      tc_seconds: p.tc_seconds,
      grace_seconds: p.grace_seconds ?? 0,
      frozen: q.frozen,
      theta_bps: q.theta_bps,
      buy_price: q.buy_price,
      sell_price: q.sell_price,
      /** what a sell-back would net the seller right now (payout after φ). */
      sell_payout: sellPayout(q.sell_price, p.phi_bps),
      /** consumed so far — pre-sweep preview of the §7c-B split. */
      consumed_count: p.tokens.filter((t) => t.redeemed).length,
      forfeited_pending: p.tokens.filter((t) => !t.redeemed).length,
      credits_to_honor: (p.p0 * BigInt(p.tokens.filter((t) => t.redeemed).length)).toString(),
      swept: p.swept,
    };
  }

  /** Every pool this issuer owns — one row per (night × band), §4a. */
  async list(authority: Address): Promise<IssuerPoolRow[]> {
    const out: IssuerPoolRow[] = [];
    for (const p of this.pools.values()) {
      if (p.authority !== authority) continue;
      const q = await this.chain.quote(p.pool_id);
      out.push({
        pool_id: p.pool_id,
        label: p.label,
        venue_name: p.venue_name,
        party_size: p.party_size,
        n_sold: q.n_sold,
        n_max: q.n_max,
        fill_pct: q.n_max > 0 ? q.n_sold / q.n_max : 0,
        service_time: p.service_time,
        buy_price: q.buy_price,
        p0: p.p0.toString(),
        k: p.k.toString(),
        phi_bps: p.phi_bps,
        theta_bps: q.theta_bps,
        frozen: q.frozen,
        reserve_balance: p.reserve.toString(),
        royalties_accrued: p.royalties.toString(),
        settled: p.swept !== null,
      });
    }
    // soonest service first — the operational order a floor manager works in
    out.sort((a, b) => a.service_time - b.service_time || a.party_size - b.party_size);
    return out;
  }

  /** Theoretical reserve = Σ p(i) up to n — the §4 solvency invariant, for the dashboard check. */
  expectedReserve(pool_id: PoolId, n_sold: number): UsdcBaseUnits {
    const p = this.pools.get(pool_id);
    if (!p) return '0';
    let sum = 0n;
    for (let i = 0; i < n_sold; i++) sum += BigInt(buyPrice(p.p0.toString(), p.k.toString(), i, 10_000));
    return sum.toString();
  }

  has(pool_id: PoolId): boolean {
    return this.pools.has(pool_id);
  }

  private mustGet(pool_id: PoolId): LedgerPool {
    const p = this.pools.get(pool_id);
    if (!p) throw new Error(`unknown pool ${pool_id}`);
    return p;
  }
}

/** Frozen §10.4 IssuerPoolView + additive fields the dashboard renders. Nothing removed. */
export interface IssuerPoolViewPlus extends IssuerPoolView {
  label: string;
  venue_name: string;
  party_size: number;
  n_sold: number;
  n_max: number;
  p0: UsdcBaseUnits;
  k: UsdcBaseUnits;
  phi_bps: number;
  service_time: number;
  tc_seconds: number;
  /** late-arrival window in seconds; check_in stays valid until service_time + this. */
  grace_seconds: number;
  frozen: boolean;
  theta_bps: number;
  buy_price: UsdcBaseUnits;
  sell_price: UsdcBaseUnits;
  sell_payout: UsdcBaseUnits;
  consumed_count: number;
  forfeited_pending: number;
  credits_to_honor: UsdcBaseUnits;
  swept: SweepResponse | null;
}

/** Row shape for the issuer's pool overview (GET /restaurant/pools). */
export interface IssuerPoolRow {
  pool_id: PoolId;
  label: string;
  venue_name: string;
  party_size: number;
  n_sold: number;
  n_max: number;
  fill_pct: number;
  service_time: number;
  buy_price: UsdcBaseUnits;
  p0: UsdcBaseUnits;
  k: UsdcBaseUnits;
  phi_bps: number;
  theta_bps: number;
  frozen: boolean;
  reserve_balance: UsdcBaseUnits;
  royalties_accrued: UsdcBaseUnits;
  settled: boolean;
}
