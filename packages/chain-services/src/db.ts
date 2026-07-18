/**
 * Postgres connection + migration runner for the §10.3 read model.
 *
 * OPTIONAL BY DESIGN: if DATABASE_URL is unset there is no database, no indexer, and the demo
 * runs exactly as it does today on pure in-memory chain state. Postgres is a READ CACHE (§0) —
 * the chain is authoritative over money — so the system is fully correct without it; you just
 * lose the fast chart/holdings queries and have to ask the adapter directly.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
export type Db = pg.Pool;

/**
 * `pg` parses NUMERIC as a JS number by default, which would silently destroy precision on
 * u64 USDC base units. Force NUMERIC (OID 1700) and BIGINT (OID 20) to come back as STRINGS so
 * money never touches a float (§6 money convention, LOCKED).
 */
pg.types.setTypeParser(1700, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => v);

/**
 * Returns a connection pool, or `null` when DATABASE_URL is unset — callers MUST treat null as
 * "run without a read model" rather than as an error.
 */
export function createDb(databaseUrl: string | undefined = process.env['DATABASE_URL']): Db | null {
  if (!databaseUrl) return null;
  return new Pool({ connectionString: databaseUrl });
}

/** Applies migrations/001_read_model.sql. Idempotent (every statement is IF NOT EXISTS). */
export async function migrate(db: Db): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/db.js -> package root -> migrations/
  const sql = await readFile(join(here, '..', 'migrations', '001_read_model.sql'), 'utf8');
  await db.query(sql);
}
