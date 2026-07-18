/**
 * chain-services (stream 2). The ONLY module that touches the chain (or its mock). Exposes the
 * frozen §10.2 ChainAdapter; ships the mock first (§8.1), real Solana client swaps in later.
 *
 * Also owns the §10.3 read model: the event indexer and the Postgres query layer. That half is
 * OPTIONAL — with DATABASE_URL unset the adapter runs on pure in-memory state and the demo is
 * unaffected. Postgres is a READ CACHE ONLY; the chain is authoritative over money (§0).
 */
export { MockChainAdapter } from './mock-adapter.js';
export type { ChainAdapter } from '@ttr/shared-types';

// §10.3 event seam (mock emitter today, Anchor event log after SWAP A — same shapes).
export {
  ChainEventEmitter,
  type ChainEvent,
  type ChainEventListener,
  type BuyEvent,
  type SellEvent,
  type RedeemEvent,
  type CheckInEvent,
  type SweepEvent,
  type PoolCreatedEvent,
} from './events.js';

// §10.3 read model (all optional — see wiring.ts).
export { createDb, migrate, type Db } from './db.js';
export { Indexer } from './indexer.js';
export { ReadModelRepository } from './repository.js';
export {
  attachReadModel,
  type ReadModel,
  type AttachReadModelOptions,
} from './wiring.js';

// TODO: SolanaChainAdapter (real @solana/web3.js + Anchor IDL) — SWAP A, same interface.
