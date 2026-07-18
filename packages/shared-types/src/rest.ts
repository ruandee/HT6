/**
 * §10.4 REST API request/response types. Owned by `app-services`; consumed by BOTH frontends.
 *
 * FROZEN (PHASE 0). Auth: Bearer Auth0 JWT on every call; `/restaurant/*` requires issuer role.
 * Frontends build against these types with a mock REST server until app-services is live (§8.1).
 */
import type {
  Bps,
  PoolId,
  UnixSeconds,
  UsdcBaseUnits,
  UserId,
} from './common.js';
import type { HoldingStatus, PriceHistoryRow } from './readmodel.js';

// ---- GET /pools ----
export interface PoolSummary {
  id: PoolId;
  venue_name: string;
  label: string; // e.g. "Fri 7–9pm"
  /** seats UP TO this many (§4a). Pools are (venue, window, party_size). */
  party_size: number;
  n_sold: number;
  n_max: number;
  spot_price: UsdcBaseUnits;
  frozen: boolean;
}

// ---- GET /pools/:id ----
export interface PoolDetail extends PoolSummary {
  p0: UsdcBaseUnits;
  k: UsdcBaseUnits;
  phi_bps: Bps;
  service_time: UnixSeconds;
  tc_seconds: number;
  quote: {
    theta_bps: Bps;
    buy_price: UsdcBaseUnits;
    sell_price: UsdcBaseUnits;
  };
}

// ---- GET /pools/:id/history?since= ----
export type PoolHistoryResponse = PriceHistoryRow[];

// ---- POST /pools/:id/buy ----
/**
 * §7c-A quote-lock. `checkout` carries whatever the diner UI needs to collect payment:
 *  - real gateway: { client_secret, publishable_key } -> beginCheckout()
 *  - StubGateway:  { hosted_url } -> local mock deposit page
 * Exactly one variant is present; the frontend uses whichever it gets.
 * (See UNIFOLD_INTEGRATION.md §4/§6 and the corrected §10.4 in BUILD_SPEC.md.)
 */
export interface BuyResponse {
  deposit_intent_id: string;
  max_price: UsdcBaseUnits;
  expires_at: string; // ISO8601
  checkout: CheckoutHandle;
}
export type CheckoutHandle =
  | { client_secret: string; publishable_key: string }
  | { hosted_url: string };

// ---- POST /pools/:id/sell ----
export interface SellResponse {
  /** id of the payout (Treasury outbound transfer) initiated for the sell-back. */
  payout_intent: string;
}

// ---- GET /me/holdings ----
export interface HoldingView {
  pool_id: PoolId;
  pool_label: string;
  token_amount: number;
  status: HoldingStatus;
  acquired_at: string;
  /** current recover value if sold back now (sell payout), for the "sell it back" button. */
  recover_value: UsdcBaseUnits;
}
export type HoldingsResponse = HoldingView[];

// ---- POST /me/redeem ----
export interface RedeemRequest {
  pool_id: PoolId;
}

// ---- issuer (restaurant-frontend) ----

// POST /restaurant/pools
export interface CreatePoolRequest {
  venue_id: string;
  label: string;
  /** seats UP TO this many. The issuer creates one pool per band it wants to sell (§4a). */
  party_size: number;
  p0: UsdcBaseUnits;
  k: UsdcBaseUnits;
  n_max: number;
  phi_bps: Bps;
  service_time: UnixSeconds;
  tc_seconds: number;
}
export interface CreatePoolResponse {
  pool_id: PoolId;
}

// GET /restaurant/pools/:id
export interface IssuerPoolView {
  pool_id: PoolId;
  fill_pct: number; // n_sold / n_max
  reserve_balance: UsdcBaseUnits;
  royalties_accrued: UsdcBaseUnits;
  holders: Array<{ user_id: UserId; token_amount: number; status: HoldingStatus }>;
}

// POST /restaurant/pools/:id/checkin
export interface CheckinRequest {
  user_id: UserId;
}

// POST /restaurant/pools/:id/sweep  (response mirrors §7c-B sweep accounting)
export interface SweepResponse {
  amount_swept: UsdcBaseUnits;
  consumed_count: number;
  forfeited_count: number;
  credits_to_honor: UsdcBaseUnits;
}
