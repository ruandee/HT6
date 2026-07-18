/**
 * §10.5 PaymentGateway — the stable seam behind which the real Unifold impl and the StubGateway
 * both live. Owned by `app-services`. FROZEN (PHASE 0): this interface does NOT change when the
 * real Unifold key/impl swaps in (§8.1 SWAP B). See UNIFOLD_INTEGRATION.md for the real mapping.
 */
import type { PoolId, UsdcBaseUnits, UserId } from './common.js';
import type { CheckoutHandle } from './rest.js';

export interface BeginDepositResult {
  /** correlation key = Unifold payment-intent id (or a stub id). */
  deposit_intent_id: string;
  checkout: CheckoutHandle;
  quote_expires_at: string; // ISO8601
}

export interface PayoutResult {
  /** id of the Treasury outbound transfer (or a stub id). */
  payout_id: string;
}

export type BuyPurpose = { kind: 'buy'; pool_id: PoolId };
export type SellPurpose = { kind: 'sell'; pool_id: PoolId };

export interface PaymentGateway {
  /**
   * BUY: create a locked-quote payment intent for `amountUsdc` (= quoted buy_price), locked for
   * `windowSeconds`. Real impl: preview locked quote (lqq_, ~30s) -> commit intent -> return
   * client_secret. `maxPrice` is persisted for the §7c-A on-chain check at settlement.
   */
  beginDeposit(
    userId: UserId,
    amountUsdc: UsdcBaseUnits,
    maxPrice: UsdcBaseUnits,
    windowSeconds: number,
    purpose: BuyPurpose,
  ): Promise<BeginDepositResult>;

  /** SELL / payout: real impl = Treasury outbound transfer (Idempotency-Key, Solana USDC). */
  payout(
    userId: UserId,
    amountUsdc: UsdcBaseUnits,
    purpose: SellPurpose,
  ): Promise<PayoutResult>;

  // Webhook ingress is a ROUTE on app-services (POST /webhooks/unifold), not a method here.
  // It verifies the signature and normalizes events to DepositSettled / PayoutSettled below.
}

/** Normalized webhook outcome for a buy funding. */
export interface DepositSettled {
  deposit_intent_id: string;
  userId: UserId;
  amountUsdc: UsdcBaseUnits;
  purpose: BuyPurpose;
  status: 'succeeded' | 'expired' | 'failed';
}

/** Normalized webhook outcome for a sell payout (Treasury outbound transfer). */
export interface PayoutSettled {
  payout_id: string;
  userId: UserId;
  amountUsdc: UsdcBaseUnits;
  purpose: SellPurpose;
  status: 'completed' | 'failed';
}
