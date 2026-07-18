/**
 * §10.3 event indexer: subscribes to chain events and writes the Postgres read model.
 *
 * MONEY-AUTHORITY (§0, LOCKED): everything this module writes is a CACHE of state the chain
 * already committed. It never decides anything — no balance it stores may be used to authorize
 * a payout, and if it disagrees with the chain, the chain wins and this data should be dropped
 * and rebuilt from events_raw. The indexer is downstream of money, never upstream of it.
 *
 * IDEMPOTENCY: every event is applied inside one transaction that begins with an INSERT into
 * events_raw ON CONFLICT (tx_sig) DO NOTHING. If the row already existed, the event was already
 * applied and we roll back without touching anything else. So replaying a stream — on restart,
 * backfill, or a duplicated subscription — can never double-count a buy, double-append a
 * price_history point, or resurrect a sold holding.
 */
import type pg from 'pg';
import type { PoolId } from '@ttr/shared-types';
import type { Db } from './db.js';
import type { ChainEvent, ChainEventListener } from './events.js';

/** Deterministic-ish unique id for cache rows. Not a chain identifier. */
function rowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Venue attribution: §10.3 pools.venue_id is NOT NULL, but the §10.2 create_pool instruction
 * carries only `authority` (the restaurant wallet) — there is no venue_id on-chain. The chain
 * knows wallets; venues are an app-layer concept. So the indexer maps authority -> venue,
 * auto-creating a placeholder venue row keyed by the authority when app-services hasn't
 * registered one. app-services can UPDATE venues.name later without the indexer caring.
 */
async function ensureVenueForAuthority(
  client: pg.PoolClient,
  authority: string,
): Promise<string> {
  const venueId = `venue_${authority}`;
  await client.query(
    `INSERT INTO venues (id, name, auth0_org) VALUES ($1, $2, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [venueId, `Venue ${authority}`],
  );
  return venueId;
}

export class Indexer {
  constructor(private readonly db: Db) {}

  /**
   * Serializes event application. Events arrive synchronously from the emitter but are applied
   * asynchronously, so without this a `buy` can open its transaction before the `create` that
   * precedes it has committed — and its pool_state insert then fails the pools FK. Chain events
   * are causally ordered; applying them concurrently would lose that order. Throughput is a
   * non-issue (one pool's trades are inherently sequential), so a simple promise chain is the
   * right tool.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /** Enqueue an event, preserving arrival order. Resolves with `handle`'s result. */
  enqueue(event: ChainEvent): Promise<boolean> {
    const next = this.queue.then(
      () => this.handle(event),
      () => this.handle(event), // a previous failure must not poison the queue
    );
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * Apply one chain event to the read model. Safe to call twice with the same event.
   * Returns true if it was newly applied, false if it was a deduped replay.
   */
  async handle(event: ChainEvent): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Idempotency gate: the raw-event insert is the lock. If tx_sig is already present the
      // whole effect of this event is already durable, so we bail out without re-applying.
      const inserted = await client.query(
        `INSERT INTO events_raw (id, tx_sig, pool_id, kind, payload_json, block_time)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (tx_sig) DO NOTHING
         RETURNING id`,
        [
          rowId('evt'),
          event.tx_sig,
          event.pool_id,
          event.kind,
          JSON.stringify(event),
          event.block_time,
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      if (event.kind === 'create') {
        const venueId = await ensureVenueForAuthority(client, event.authority);
        await client.query(
          `INSERT INTO pools
             (id, venue_id, mint, p0, k, n_max, phi_bps, service_time, tc_seconds, party_size, frozen)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)
           ON CONFLICT (id) DO NOTHING`,
          [
            event.pool_id,
            venueId,
            event.mint,
            event.p0,
            event.k,
            event.n_max,
            event.phi_bps,
            event.service_time,
            event.tc_seconds,
            event.party_size,
          ],
        );
      }

      // pool_state: one row per pool, always overwritten with the post-event snapshot the chain
      // handed us. last_buy_price/last_sell_price are only carried by trade events; on
      // redeem/checkin/sweep we keep the previous values (the curve did not move).
      const buyPrice = 'buy_price' in event ? event.buy_price : null;
      const sellPrice = 'sell_price' in event ? event.sell_price : null;
      await client.query(
        `INSERT INTO pool_state
           (pool_id, n_sold, last_buy_price, last_sell_price, theta_bps, reserve_balance, updated_at)
         VALUES ($1,$2,COALESCE($3,0),COALESCE($4,0),$5,$6, now())
         ON CONFLICT (pool_id) DO UPDATE SET
           n_sold          = EXCLUDED.n_sold,
           last_buy_price  = COALESCE($3, pool_state.last_buy_price),
           last_sell_price = COALESCE($4, pool_state.last_sell_price),
           theta_bps       = EXCLUDED.theta_bps,
           reserve_balance = EXCLUDED.reserve_balance,
           updated_at      = now()`,
        [
          event.pool_id,
          event.n_sold,
          buyPrice,
          sellPrice,
          event.theta_bps,
          event.reserve_balance,
        ],
      );

      // price_history: the series behind the live curve chart. Spot = the current BUY price
      // (what the UI quotes), so the chart shows exactly what a diner would pay.
      const spot = buyPrice ?? (await this.currentSpot(client, event.pool_id));
      await client.query(
        `INSERT INTO price_history (id, pool_id, ts, n_sold, spot_price, theta_bps, event_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          rowId('ph'),
          event.pool_id,
          event.block_time,
          event.n_sold,
          spot,
          event.theta_bps,
          event.kind,
        ],
      );

      // holdings
      if (event.kind === 'buy') {
        await client.query(
          `INSERT INTO holdings (id, user_id, pool_id, token_amount, status)
           VALUES ($1,$2,$3,1,'held')`,
          [rowId('hold'), event.user_id, event.pool_id],
        );
      } else if (event.kind === 'sell') {
        // Mark the user's oldest live holding sold. §7c-C guarantees at most one per window,
        // but LIMIT 1 keeps this correct even if that ever loosens.
        await client.query(
          `UPDATE holdings SET status = 'sold'
           WHERE id = (
             SELECT id FROM holdings
             WHERE user_id = $1 AND pool_id = $2 AND status = 'held'
             ORDER BY acquired_at ASC LIMIT 1
           )`,
          [event.user_id, event.pool_id],
        );
      } else if (event.kind === 'redeem') {
        await client.query(
          `UPDATE holdings SET status = 'redeemed'
           WHERE id = (
             SELECT id FROM holdings
             WHERE user_id = $1 AND pool_id = $2 AND status = 'held'
             ORDER BY acquired_at ASC LIMIT 1
           )`,
          [event.user_id, event.pool_id],
        );
      } else if (event.kind === 'sweep') {
        // Freeze is what sweep implies; §7c-B: still-held collapses into forfeited. Holdings
        // keep their held/redeemed status (the dashboard reads consumed vs forfeited off it).
        await client.query(`UPDATE pools SET frozen = TRUE WHERE id = $1`, [event.pool_id]);
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Last known spot for non-trade events, so redeem/sweep points sit on the existing line. */
  private async currentSpot(
    client: pg.PoolClient,
    poolId: PoolId,
  ): Promise<string> {
    const r = await client.query<{ last_buy_price: string }>(
      `SELECT last_buy_price FROM pool_state WHERE pool_id = $1`,
      [poolId],
    );
    return r.rows[0]?.last_buy_price ?? '0';
  }

  /** Listener form, for `adapter.emitter.on(indexer.listener())`. Fire-and-forget by design. */
  listener(onError?: (err: unknown) => void): ChainEventListener {
    return (event) => {
      void this.enqueue(event).catch((err) => {
        // A cache write failing must NEVER fail the trade that produced it (§0).
        (onError ?? ((e: unknown) => console.error('[indexer] failed:', e)))(err);
      });
    };
  }
}
