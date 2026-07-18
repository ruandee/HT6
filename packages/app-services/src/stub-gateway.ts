/**
 * StubGateway — first-class §8.1 / §10.5 deliverable. Runs the FULL buy/sell demo before the
 * Unifold key arrives. Same `PaymentGateway` interface the real UnifoldGateway implements, so
 * SWAP B changes nothing outside this file (and unifold-gateway.ts, TODO).
 *
 * beginDeposit returns a hosted_url to a local mock deposit page whose "Confirm" / "Expired"
 * buttons POST to /webhooks/unifold to drive settlement. Correlation key = deposit_intent_id.
 */
import type {
  BeginDepositResult,
  BuyPurpose,
  PaymentGateway,
  PayoutResult,
  SellPurpose,
  UsdcBaseUnits,
  UserId,
} from '@ttr/shared-types';

export interface PendingIntent {
  deposit_intent_id: string;
  userId: UserId;
  amountUsdc: UsdcBaseUnits;
  maxPrice: UsdcBaseUnits;
  purpose: BuyPurpose;
  expires_at: string;
  status: 'requires_payment' | 'succeeded' | 'expired';
}

export class StubGateway implements PaymentGateway {
  /** in-memory pending-intent store, keyed by deposit_intent_id (the correlation key). */
  readonly pending = new Map<string, PendingIntent>();
  private seq = 1;

  constructor(private readonly mockDepositBaseUrl = 'http://localhost:8080/mock/deposit') {}

  async beginDeposit(
    userId: UserId,
    amountUsdc: UsdcBaseUnits,
    maxPrice: UsdcBaseUnits,
    windowSeconds: number,
    purpose: BuyPurpose,
  ): Promise<BeginDepositResult> {
    const deposit_intent_id = `pi_stub_${this.seq++}`;
    const expires_at = new Date(Date.now() + windowSeconds * 1000).toISOString();
    this.pending.set(deposit_intent_id, {
      deposit_intent_id,
      userId,
      amountUsdc,
      maxPrice,
      purpose,
      expires_at,
      status: 'requires_payment',
    });
    return {
      deposit_intent_id,
      checkout: { hosted_url: `${this.mockDepositBaseUrl}?intent=${deposit_intent_id}` },
      quote_expires_at: expires_at,
    };
  }

  async payout(
    _userId: UserId,
    _amountUsdc: UsdcBaseUnits,
    _purpose: SellPurpose,
  ): Promise<PayoutResult> {
    // Logs + returns a fake id; optionally emit a stub treasury.outbound_transfer.completed.
    return { payout_id: `obt_stub_${this.seq++}` };
  }
}
