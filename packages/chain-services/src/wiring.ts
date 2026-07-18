/**
 * OPTIONAL read-model wiring. This is the whole "does the demo need Postgres?" answer: NO.
 *
 * If DATABASE_URL is unset, `attachReadModel` returns { db: null, repo: null } and does nothing
 * else — the adapter trades on pure in-memory state exactly as it does today, no database, no
 * indexer, no behavior change. Postgres is a read cache (§0), so its absence costs you the fast
 * chart/holdings queries and nothing else; the chain remains authoritative either way.
 *
 * If DATABASE_URL IS set, we migrate, subscribe an Indexer to the adapter's event emitter, and
 * hand back a repository. Indexing is fire-and-forget: a cache write that fails logs and is
 * dropped, it never fails the trade that produced it.
 */
import { createDb, migrate, type Db } from './db.js';
import { Indexer } from './indexer.js';
import { ReadModelRepository } from './repository.js';
import type { MockChainAdapter } from './mock-adapter.js';

export interface ReadModel {
  db: Db | null;
  repo: ReadModelRepository | null;
  indexer: Indexer | null;
  /** Unsubscribe + close the pool. Safe to call when disabled (no-op). */
  close: () => Promise<void>;
}

export interface AttachReadModelOptions {
  /** Defaults to process.env.DATABASE_URL. Unset/empty => read model disabled. */
  databaseUrl?: string | undefined;
  /** Run migrations on attach. Default true (hackathon-friendly; the SQL is idempotent). */
  runMigrations?: boolean;
  onError?: (err: unknown) => void;
}

/** Anything exposing the chain event seam — the mock today, the Solana client after SWAP A. */
type EventSource = Pick<MockChainAdapter, 'emitter'>;

export async function attachReadModel(
  adapter: EventSource,
  opts: AttachReadModelOptions = {},
): Promise<ReadModel> {
  const db = createDb(opts.databaseUrl ?? process.env['DATABASE_URL']);
  if (!db) {
    // No DATABASE_URL: demo path. Identical behavior to before this stream existed.
    return { db: null, repo: null, indexer: null, close: async () => {} };
  }
  if (opts.runMigrations !== false) await migrate(db);

  const indexer = new Indexer(db);
  const unsubscribe = adapter.emitter.on(indexer.listener(opts.onError));

  return {
    db,
    repo: new ReadModelRepository(db),
    indexer,
    close: async () => {
      unsubscribe();
      await db.end();
    },
  };
}
