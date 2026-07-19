-- =====================================================================================
-- §10.3 Postgres read model (owned by chain-services).
--
-- MONEY-AUTHORITY RULE (§0, §7, LOCKED): these tables are a READ CACHE ONLY. The Solana
-- program (or, before SWAP A, the MockChainAdapter) is the SINGLE SOURCE OF TRUTH for funds.
-- Nothing here may ever be used to decide how much USDC someone is owed, what the reserve
-- holds, or whether a trade may proceed. If Postgres and the chain disagree, POSTGRES IS
-- WRONG — drop these tables and replay the events. They exist purely so the UI can render a
-- price/curve/holdings list without hitting an RPC node.
--
-- MONEY REPRESENTATION (§6, LOCKED): all USDC amounts are base units, 6 decimals, stored as
-- NUMERIC(39,0) (u128-safe integers). NEVER float/double/real — no money column in this file
-- is a floating-point type. The TS layer reads them back as strings (UsdcBaseUnits).
-- Basis-point columns (theta_bps, phi_bps) are INTEGER, 0..10000.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS venues (
  id          TEXT PRIMARY KEY,
  name        TEXT        NOT NULL,
  org_id   TEXT,                       -- nullable per VenueRow.org_id: string | null
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pools (
  id            TEXT PRIMARY KEY,                     -- PoolId, same value as on-chain
  venue_id      TEXT        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  mint          TEXT        NOT NULL,
  p0            NUMERIC(39,0) NOT NULL CHECK (p0 >= 0),      -- USDC base units
  k             NUMERIC(39,0) NOT NULL CHECK (k >= 0),       -- USDC base units
  n_max         INTEGER     NOT NULL CHECK (n_max >= 0),
  phi_bps       INTEGER     NOT NULL CHECK (phi_bps BETWEEN 0 AND 10000),
  service_time  BIGINT      NOT NULL,                 -- unix seconds
  tc_seconds    BIGINT      NOT NULL,
  party_size    INTEGER     NOT NULL CHECK (party_size > 0),
  frozen        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pools_venue ON pools (venue_id);
-- §7c-C one-table-per-(authority, service_window) checks and "all bands for this night"
-- listings group by service window.
CREATE INDEX IF NOT EXISTS idx_pools_service_time ON pools (service_time);

-- One row per pool: the fast cache the live curve/quote UI reads.
-- Cached mirror of chain state, NOT authoritative (see header).
CREATE TABLE IF NOT EXISTS pool_state (
  pool_id          TEXT PRIMARY KEY REFERENCES pools(id) ON DELETE CASCADE,
  n_sold           INTEGER       NOT NULL DEFAULT 0 CHECK (n_sold >= 0),
  last_buy_price   NUMERIC(39,0) NOT NULL DEFAULT 0,
  last_sell_price  NUMERIC(39,0) NOT NULL DEFAULT 0,
  theta_bps        INTEGER       NOT NULL DEFAULT 10000 CHECK (theta_bps BETWEEN 0 AND 10000),
  reserve_balance  NUMERIC(39,0) NOT NULL DEFAULT 0 CHECK (reserve_balance >= 0),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Time series powering the live curve chart (§5 "the flashy payoff").
CREATE TABLE IF NOT EXISTS price_history (
  id          TEXT PRIMARY KEY,
  pool_id     TEXT          NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  ts          BIGINT        NOT NULL,          -- unix seconds (chain block_time)
  n_sold      INTEGER       NOT NULL,
  spot_price  NUMERIC(39,0) NOT NULL,          -- USDC base units
  theta_bps   INTEGER       NOT NULL CHECK (theta_bps BETWEEN 0 AND 10000),
  event_type  TEXT          NOT NULL CHECK (event_type IN ('create','buy','sell','redeem','checkin','sweep'))
);

-- The chart query is exactly: WHERE pool_id = $1 AND ts >= $2 ORDER BY ts.
CREATE INDEX IF NOT EXISTS idx_price_history_pool_ts ON price_history (pool_id, ts);

CREATE TABLE IF NOT EXISTS holdings (
  id           TEXT        PRIMARY KEY,
  user_id      TEXT        NOT NULL,
  pool_id      TEXT        NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  token_amount INTEGER     NOT NULL DEFAULT 1 CHECK (token_amount >= 0),
  status       TEXT        NOT NULL CHECK (status IN ('held','redeemed','sold')),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GET /me/holdings
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings (user_id);
-- "who is holding this pool" (restaurant dashboard) + the indexer's held-token lookup.
CREATE INDEX IF NOT EXISTS idx_holdings_pool_status ON holdings (pool_id, status);
CREATE INDEX IF NOT EXISTS idx_holdings_user_pool_status ON holdings (user_id, pool_id, status);

-- Raw event log the indexer writes as it observes program events.
-- tx_sig is UNIQUE: this is the IDEMPOTENCY KEY. Replaying an already-indexed event is a
-- no-op, so a resubscribe / backfill / restart cannot double-apply a buy or sell.
CREATE TABLE IF NOT EXISTS events_raw (
  id           TEXT   PRIMARY KEY,
  tx_sig       TEXT   NOT NULL UNIQUE,
  pool_id      TEXT   NOT NULL,
  kind         TEXT   NOT NULL CHECK (kind IN ('create','buy','sell','redeem','checkin','sweep')),
  payload_json JSONB  NOT NULL,
  block_time   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_raw_pool_block_time ON events_raw (pool_id, block_time);
