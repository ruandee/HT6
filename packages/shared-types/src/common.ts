/**
 * Shared primitives. See BUILD_SPEC.md §6 (on-chain arithmetic note) and §10.
 *
 * MONEY CONVENTION (LOCKED): every USDC amount crossing an interface is a STRING of
 * integer base units with 6 decimals (e.g. "40000000" = 40 USDC). Never a float, never
 * dollars. This matches on-chain u64 semantics and Unifold's base-unit fields exactly.
 */

/** USDC amount in base units (6 decimals), as a decimal integer string. e.g. "40000000". */
export type UsdcBaseUnits = string;

/** Basis points, 0..10000. e.g. 500 = 5%. */
export type Bps = number;

/** Unix timestamp in seconds. */
export type UnixSeconds = number;

/** Opaque pool identifier (same value on-chain and in the read model). */
export type PoolId = string;

/** App-managed user id. Maps 1:1 to Auth0 `sub` and Unifold `external_user_id` (§10.5 seam). */
export type UserId = string;

/** Solana/base58 public key as a string, or a mock handle behind the §10.2 adapter. */
export type Address = string;

/** On-chain transaction signature, or a mock signature behind the §10.2 adapter. */
export type TxSig = string;

/** USDC has 6 decimals everywhere in this system. */
export const USDC_DECIMALS = 6 as const;
export const BPS_DENOMINATOR = 10_000 as const;
