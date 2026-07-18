/**
 * app-services (stream 3). Auth0 identity + Unifold payments seam + REST API (§10.4).
 * Reaches the chain ONLY via @ttr/chain-services (§8 boundary rule).
 */
export { StubGateway } from './stub-gateway.js';
export type { PaymentGateway } from '@ttr/shared-types';
// TODO: UnifoldGateway (real impl per UNIFOLD_INTEGRATION.md §4) — SWAP B, same interface.
// TODO: REST routes (§10.4), Auth0 JWT middleware, POST /webhooks/unifold signature verify (§10.5).
