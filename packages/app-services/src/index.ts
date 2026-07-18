/**
 * app-services (stream 3). Auth0 identity + Unifold payments seam + REST API (§10.4).
 * Reaches the chain ONLY via @ttr/chain-services (§8 boundary rule).
 *
 * Run the server: `npm run dev --workspace @ttr/app-services` (or `start` after build).
 */
export { StubGateway } from './stub-gateway.js';
export { Orchestrator } from './orchestrator.js';
export { verifyWebhook } from './webhook-verify.js';
export { loadConfig } from './config.js';
export type { PaymentGateway } from '@ttr/shared-types';
// TODO: UnifoldGateway (real impl per UNIFOLD_INTEGRATION.md §4) — SWAP B, same interface.
// TODO: Auth0 JWT middleware (replace x-user-id stub); full §10.4 issuer routes.
