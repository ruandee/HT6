/**
 * §10.3 read model query layer — the functions app-services calls to render the UI without
 * hitting an RPC node (§5: "the indexer is the fast cache + is what makes the demo feel
 * real-time").
 *
 * READ CACHE ONLY (§0, LOCKED). These rows describe money but are not authoritative over it.
 * Use them to DRAW things — the curve chart, a holdings list, a fill percentage. Never use them
 * to decide a payout, authorize a trade, or answer "how much is in the reserve" for anything
 * that moves funds; call `ChainAdapter.quote()` (the chain) for that. Any answer here may be
 * stale by one event and, if Postgres is absent entirely, is simply unavailable.
 */
import type {
  HoldingRow,
  PoolId,
  PoolRow,
  PoolStateRow,
  PriceHistoryRow,
  UnixSeconds,
  UserId,
  VenueRow,
  EventRawRow,
} from '@ttr/shared-types';
import type { Db } from './db.js';

/**
 * Row mappers. `pg` hands NUMERIC/BIGINT back as strings (see db.ts type parsers) and INTEGER
 * as a number, which lines up with the frozen types: UsdcBaseUnits is a string, counts and bps
 * are numbers. BIGINT columns that the frozen types declare as `number` (service_time,
 * tc_seconds, ts, block_time — all UnixSeconds) are converted here.
 */
const toSeconds = (v: string | number): UnixSeconds => Number(v);
const toIso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

export class ReadModelRepository {
  constructor(private readonly db: Db) {}

  async getVenue(id: string): Promise<VenueRow | null> {
    const r = await this.db.query(`SELECT * FROM venues WHERE id = $1`, [id]);
    const row = r.rows[0];
    return row
      ? { id: row.id, name: row.name, org_id: row.org_id, created_at: toIso(row.created_at) }
      : null;
  }

  async getPool(poolId: PoolId): Promise<PoolRow | null> {
    const r = await this.db.query(`SELECT * FROM pools WHERE id = $1`, [poolId]);
    const row = r.rows[0];
    return row ? this.mapPool(row) : null;
  }

  /** All pools, newest service window first — backs GET /pools (§10.4). */
  async listPools(): Promise<PoolRow[]> {
    const r = await this.db.query(`SELECT * FROM pools ORDER BY service_time ASC, id ASC`);
    return r.rows.map((row) => this.mapPool(row));
  }

  private mapPool(row: any): PoolRow {
    return {
      id: row.id,
      venue_id: row.venue_id,
      mint: row.mint,
      p0: row.p0,
      k: row.k,
      n_max: row.n_max,
      phi_bps: row.phi_bps,
      service_time: toSeconds(row.service_time),
      tc_seconds: toSeconds(row.tc_seconds),
      frozen: row.frozen,
      created_at: toIso(row.created_at),
    };
  }

  /**
   * Cached curve state for a pool. For DISPLAY. The authoritative quote — and the only price a
   * trade may execute against — comes from `ChainAdapter.quote()` (§10.2), which recomputes θ
   * from the current clock; this row's theta_bps froze at the last indexed event.
   */
  async getPoolState(poolId: PoolId): Promise<PoolStateRow | null> {
    const r = await this.db.query(`SELECT * FROM pool_state WHERE pool_id = $1`, [poolId]);
    const row = r.rows[0];
    if (!row) return null;
    return {
      pool_id: row.pool_id,
      n_sold: row.n_sold,
      last_buy_price: row.last_buy_price,
      last_sell_price: row.last_sell_price,
      theta_bps: row.theta_bps,
      reserve_balance: row.reserve_balance,
      updated_at: toIso(row.updated_at),
    };
  }

  /**
   * The live-curve chart series (GET /pools/:id/history?since=). `since` is unix seconds,
   * inclusive; omit for the pool's full history.
   */
  async getPriceHistory(poolId: PoolId, since?: UnixSeconds): Promise<PriceHistoryRow[]> {
    const r =
      since === undefined
        ? await this.db.query(
            `SELECT * FROM price_history WHERE pool_id = $1 ORDER BY ts ASC, id ASC`,
            [poolId],
          )
        : await this.db.query(
            `SELECT * FROM price_history WHERE pool_id = $1 AND ts >= $2 ORDER BY ts ASC, id ASC`,
            [poolId, since],
          );
    return r.rows.map((row) => ({
      id: row.id,
      pool_id: row.pool_id,
      ts: toSeconds(row.ts),
      n_sold: row.n_sold,
      spot_price: row.spot_price,
      theta_bps: row.theta_bps,
      event_type: row.event_type,
    }));
  }

  /** GET /me/holdings. Pass `status` to filter (e.g. 'held' for the diner's active tables). */
  async getHoldings(
    userId: UserId,
    status?: HoldingRow['status'],
  ): Promise<HoldingRow[]> {
    const r =
      status === undefined
        ? await this.db.query(
            `SELECT * FROM holdings WHERE user_id = $1 ORDER BY acquired_at DESC`,
            [userId],
          )
        : await this.db.query(
            `SELECT * FROM holdings WHERE user_id = $1 AND status = $2 ORDER BY acquired_at DESC`,
            [userId, status],
          );
    return r.rows.map((row) => this.mapHolding(row));
  }

  /** Holders of a pool — the restaurant dashboard's check-in list. Defaults to live tokens. */
  async getPoolHoldings(
    poolId: PoolId,
    status: HoldingRow['status'] | 'all' = 'held',
  ): Promise<HoldingRow[]> {
    const r =
      status === 'all'
        ? await this.db.query(
            `SELECT * FROM holdings WHERE pool_id = $1 ORDER BY acquired_at ASC`,
            [poolId],
          )
        : await this.db.query(
            `SELECT * FROM holdings WHERE pool_id = $1 AND status = $2 ORDER BY acquired_at ASC`,
            [poolId, status],
          );
    return r.rows.map((row) => this.mapHolding(row));
  }

  private mapHolding(row: any): HoldingRow {
    return {
      id: row.id,
      user_id: row.user_id,
      pool_id: row.pool_id,
      token_amount: row.token_amount,
      status: row.status,
      acquired_at: toIso(row.acquired_at),
    };
  }

  /** Raw event log, newest last. Debugging + rebuilding the cache from scratch. */
  async getEvents(poolId: PoolId): Promise<EventRawRow[]> {
    const r = await this.db.query(
      `SELECT * FROM events_raw WHERE pool_id = $1 ORDER BY block_time ASC, id ASC`,
      [poolId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      tx_sig: row.tx_sig,
      pool_id: row.pool_id,
      kind: row.kind,
      payload_json: row.payload_json,
      block_time: toSeconds(row.block_time),
    }));
  }
}
