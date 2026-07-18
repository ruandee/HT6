/**
 * @ttr/shared-types — PHASE 0 frozen interface contracts (BUILD_SPEC.md §10).
 *
 * Every stream imports from here. Changing any exported signature is a coordination event:
 * flag it, because all five streams depend on these (§8, §10).
 */
export * from './common.js';
export * from './chain.js'; // §10.1 Pool + §10.2 ChainAdapter
export * from './pricing.js'; // §10.2 / §7b shared pricing math
export * from './readmodel.js'; // §10.3 indexer events + Postgres rows
export * from './rest.js'; // §10.4 REST request/response
export * from './payments.js'; // §10.5 PaymentGateway seam
