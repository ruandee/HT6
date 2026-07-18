/**
 * chain-services (stream 2). The ONLY module that touches the chain (or its mock). Exposes the
 * frozen §10.2 ChainAdapter; ships the mock first (§8.1), real Solana client swaps in later.
 */
export { MockChainAdapter } from './mock-adapter.js';
export type { ChainAdapter } from '@ttr/shared-types';
// TODO: SolanaChainAdapter (real @solana/web3.js + Anchor IDL) — SWAP A, same interface.
// TODO: event indexer (program events -> Postgres §10.3) + AMM read model.
