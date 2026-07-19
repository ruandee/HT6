/**
 * §10.1 on-chain pool state + §10.2 program-instruction / mock-chain adapter interface.
 *
 * FROZEN (BUILD_SPEC.md §10, PHASE 0). Owned by `contract`, mirrored by `chain-services`.
 * `chain-services` exposes `ChainAdapter` with EXACTLY these methods so app-services builds
 * against the mock, then swaps to the real Solana client with no caller changes (§8.1 SWAP A).
 *
 * Boundary rule (LOCKED §8): only `chain-services` imports/implements this. app-services calls
 * it; frontends never see it.
 */
import type {
  Address,
  Bps,
  PoolId,
  TxSig,
  UnixSeconds,
  UsdcBaseUnits,
  UserId,
} from './common.js';

/** §10.1 on-chain pool state. u64/i64 fields are strings/numbers per the money convention. */
export interface Pool {
  authority: Address; // restaurant wallet (royalties, check_in/sweep)
  mint: Address; // fungible SPL token for this pool
  reserve: Address; // PDA holding USDC reserve
  p0: UsdcBaseUnits; // floor (e.g. "40000000")
  k: UsdcBaseUnits; // slope per slot (e.g. "3000000")
  n_sold: number; // current supply outstanding (0..n_max)
  n_max: number; // N
  phi_bps: Bps; // royalty spread (e.g. 500)
  service_time: UnixSeconds;
  tc_seconds: number; // decay cliff length (e.g. 86400)
  /**
   * How long after `service_time` the restaurant holds the table for a late diner, in seconds.
   * Defaults to 0 (door closes at service).
   *
   * Grace does NOT touch pricing: θ still hits 0 and trading still freezes at `service_time`, so
   * the curve and the solvency invariant are unchanged. It moves exactly two deadlines — the last
   * moment `check_in` is valid, and the first moment `sweep` is legal. Sweep has to wait, or the
   * restaurant could settle at service time and forfeit a diner still inside their window.
   */
  grace_seconds?: number;
  frozen: boolean; // true once service reached / trading halted
  /**
   * Party-size band: this pool sells tables that seat UP TO `party_size` (§4a). A pool is
   * (venue, service_window, party_size) — a 2-top and a 6-top are NOT interchangeable, so they
   * cannot share a curve without breaking the fungibility rule the single-curve AMM rests on.
   * A party of 3 books the 4-top band. Table-combining is a pool-CREATION decision by the
   * restaurant (it sets n_max per band), never a trade-time one — N must stay fixed for the
   * solvency invariant to hold.
   */
  party_size: number;
}

// ---- §10.2 method params / results ----

export interface CreatePoolParams {
  authority: Address;
  p0: UsdcBaseUnits;
  k: UsdcBaseUnits;
  n_max: number;
  phi_bps: Bps;
  service_time: UnixSeconds;
  tc_seconds: number;
  /** seats UP TO this many (§4a). One pool per band; p0/k typically scale with it. */
  party_size: number;
  /** late-arrival window in seconds; check_in stays valid until service_time + this. Default 0. */
  grace_seconds?: number;
}
export interface CreatePoolResult {
  pool_id: PoolId;
  mint: Address;
}

/** Read-only current curve state. buy_price/sell_price already fold in θ decay (§7b/§7c). */
export interface QuoteResult {
  n_sold: number;
  n_max: number;
  theta_bps: Bps;
  buy_price: UsdcBaseUnits;
  sell_price: UsdcBaseUnits;
  frozen: boolean;
}

/**
 * §7c-A quote-lock: `max_price` is REQUIRED. Program recomputes current buy_price and either
 * fills (current <= max) or rejects on slippage. On fill where price fell, `refund` is the
 * difference credited back. On reject, caller (app-services) issues the failed-buy refund via
 * the payment gateway `payout` (real buy funds are Base USDC — see UNIFOLD_INTEGRATION.md §2).
 */
export interface BuyResult {
  tx_sig: TxSig;
  status: 'filled' | 'rejected_slippage';
  price_paid?: UsdcBaseUnits; // present when filled
  refund?: UsdcBaseUnits; // present when price fell below max_price
}

export interface SellResult {
  tx_sig: TxSig;
  payout: UsdcBaseUnits; // sell_price net of φ royalty
}

export interface RedeemResult {
  tx_sig: TxSig;
}

export interface CheckInResult {
  tx_sig: TxSig;
}

/** §7c-B sweep accounting. credits_to_honor = p0 × consumed_count (off-chain meal credits). */
export interface SweepResult {
  tx_sig: TxSig;
  amount_swept: UsdcBaseUnits;
  consumed_count: number;
  forfeited_count: number;
  credits_to_honor: UsdcBaseUnits;
}

/**
 * The single seam between app-services and the chain. Mock and real Solana client implement
 * this identically. Method names mirror the on-chain instructions (§10.2).
 */
export interface ChainAdapter {
  create_pool(params: CreatePoolParams): Promise<CreatePoolResult>;
  /** read-only; safe to poll for the live curve. */
  quote(pool_id: PoolId): Promise<QuoteResult>;
  /**
   * n -> n+1 iff current buy_price <= max_price, else rejected+refund (§7c-A).
   *
   * ONE TABLE PER USER PER SERVICE WINDOW (§7c-C; enforced here, the authoritative layer — not
   * just in the UI): throws if `buyer_user_id` holds a token in ANY pool sharing this pool's
   * (authority, service_time) — i.e. across every party-size band, not just this one.
   *
   * Scoped to the window rather than the pool to close the cross-band straddle (hold a 2-top AND
   * a 4-top for the same night, then sell back whichever leg the curve favours — a cheap option
   * on the night selling out, and it withholds a table from a real diner). Counts redeemed
   * tokens too. Selling back frees a rebuy, which is how a diner switches party size. Different
   * nights and different venues are unrestricted.
   */
  buy(pool_id: PoolId, buyer_user_id: UserId, max_price: UsdcBaseUnits): Promise<BuyResult>;
  /** n -> n-1; curve is the counterparty. */
  sell(pool_id: PoolId, seller_user_id: UserId): Promise<SellResult>;
  /** burn on check-in; the diner's USDC stays in reserve. */
  redeem(pool_id: PoolId, user_id: UserId): Promise<RedeemResult>;
  /** issuer marks diner arrived -> triggers redeem. */
  check_in(
    pool_id: PoolId,
    user_id: UserId,
    restaurant_authority: Address,
  ): Promise<CheckInResult>;
  /** after freeze: partition reserve into consumed/forfeited, sweep to authority (§7c-B). */
  sweep(pool_id: PoolId, restaurant_authority: Address): Promise<SweepResult>;
}
