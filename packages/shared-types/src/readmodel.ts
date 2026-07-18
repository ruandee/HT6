/**
 * §10.3 indexer event schema + Postgres read-model row types.
 *
 * FROZEN (PHASE 0). Owned by `chain-services` (writes them); read by app-services (never the
 * frontends directly). Postgres is a READ CACHE only — the chain is authoritative over money
 * (§0 money-authority rule). Do not treat any of these as a source of truth for funds.
 */
import type {
  Bps,
  PoolId,
  TxSig,
  UnixSeconds,
  UsdcBaseUnits,
  UserId,
} from './common.js';

export type EventKind =
  | 'create'
  | 'buy'
  | 'sell'
  | 'redeem'
  | 'checkin'
  | 'sweep';

export type HoldingStatus = 'held' | 'redeemed' | 'sold';

export interface VenueRow {
  id: string;
  name: string;
  auth0_org: string | null;
  created_at: string; // ISO8601
}

export interface PoolRow {
  id: PoolId;
  venue_id: string;
  mint: string;
  p0: UsdcBaseUnits;
  k: UsdcBaseUnits;
  n_max: number;
  phi_bps: Bps;
  service_time: UnixSeconds;
  tc_seconds: number;
  frozen: boolean;
  created_at: string;
}

/** One row per pool; the fast cache the live curve/quote UI reads. */
export interface PoolStateRow {
  pool_id: PoolId; // PK
  n_sold: number;
  last_buy_price: UsdcBaseUnits;
  last_sell_price: UsdcBaseUnits;
  theta_bps: Bps;
  reserve_balance: UsdcBaseUnits;
  updated_at: string;
}

/** Time series powering the live curve chart. */
export interface PriceHistoryRow {
  id: string;
  pool_id: PoolId;
  ts: UnixSeconds;
  n_sold: number;
  spot_price: UsdcBaseUnits;
  theta_bps: Bps;
  event_type: EventKind;
}

export interface HoldingRow {
  id: string;
  user_id: UserId;
  pool_id: PoolId;
  token_amount: number;
  status: HoldingStatus;
  acquired_at: string;
}

/** Raw event log the indexer writes as it observes program events. */
export interface EventRawRow {
  id: string;
  tx_sig: TxSig;
  pool_id: PoolId;
  kind: EventKind;
  payload_json: unknown;
  block_time: UnixSeconds;
}
