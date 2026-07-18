/**
 * UnifoldGateway — the REAL §8.1 SWAP B implementation of the frozen `PaymentGateway` interface.
 * Interchangeable with StubGateway: `server.ts` picks one by `PAYMENT_GATEWAY` and nothing else
 * in the app changes. See UNIFOLD_INTEGRATION.md §4 for the endpoint mapping.
 *
 * Verified against .claude/skills/unifold/llms-full.txt (the real OpenAPI docs):
 *   BUY    = POST /v1/payment_intents/locked_quotes/quote  (preview, quote_id `lqq_`, ~30s TTL)
 *          → POST /v1/payment_intents/locked_quotes        (commit → pi_... + client_secret)
 *   PAYOUT = POST /v1/treasury/outbound_transfers          (REQUIRED Idempotency-Key header)
 *   REFUND = POST /v1/payment_intents/{id}/refund          (late deposit after expiry)
 *
 * There is NO @unifold/node server SDK — this is plain fetch against the REST API.
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
import type { PendingIntent } from './stub-gateway.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface UnifoldGatewayConfig {
  apiBase: string;
  secretKey: string;
  publishableKey: string;
  treasuryId: string;
  webhookSecret: string;
  /**
   * Base-chain address that BUY proceeds settle to. v1 payment intents can ONLY deliver to Base
   * USDC (docs: "v1 only supports Base USDC as the destination"), so this is our Base treasury
   * under the treasury-float model — see the money-flow note below.
   */
  baseRecipientAddress: string;
  /** SPL USDC mint on Solana — the token_address for outbound transfers. */
  solanaUsdcMint: string;
  /**
   * Resolves a diner's Solana USDC address for payouts. In the real system this comes from the
   * user profile / custodial wallet service; injected so this gateway stays free of that concern.
   */
  resolveSolanaAddress: (userId: UserId) => Promise<string> | string;
  /** Source token the diner funds the BUY with. Defaults to USDC on Solana. */
  sourceCurrency?: string;
  sourceNetwork?: string;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
}

/**
 * MONEY-FLOW MODEL — treasury-float (UNIFOLD_INTEGRATION.md §2, recommended option).
 *
 * Unifold v1 payment intents settle ONLY to Base USDC. The Solana reserve PDA that backs
 * reservations therefore is NOT funded directly by a diner's buy. We run the recommended
 * treasury-float model:
 *
 *   - BUY proceeds land as USDC on our BASE treasury (`baseRecipientAddress`).
 *   - On `payment_intent.succeeded` the orchestrator calls `chain-services.buy(...)`, which debits
 *     our PRE-FUNDED Solana reserve float. The Base USDC is the operating float backing that.
 *   - We reconcile Base → Solana out-of-band (periodic sweep), not on the hot path.
 *
 * ALTERNATIVE (real production): bridge-per-buy. Set `baseRecipientAddress` to a per-buy Base
 * deposit address and, on `payment_intent.succeeded`, issue a follow-up transfer/bridge that moves
 * exactly that intent's USDC to the Solana reserve BEFORE calling `chain-services.buy`. That makes
 * every reservation individually collateralized (no float required) at the cost of an extra async
 * hop and a bridge-failure branch between "diner paid" and "token minted". Swapping models is
 * confined to this file plus the succeeded-webhook branch; nothing else in the app changes.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Non-2xx from Unifold, carrying their error body verbatim so failures are diagnosable. */
export class UnifoldApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
    readonly requestId?: string,
  ) {
    super(
      `Unifold ${method} ${path} failed: HTTP ${status}${
        requestId ? ` (request_id=${requestId})` : ''
      } — ${body || '<empty body>'}`,
    );
    this.name = 'UnifoldApiError';
  }
}

/** Network failure / timeout — no response was received, so a POST may or may not have landed. */
export class UnifoldConnectionError extends Error {
  constructor(method: string, path: string, cause: unknown) {
    super(`Unifold ${method} ${path} failed to connect: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'UnifoldConnectionError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Wire types (subset of the documented DTOs we actually read)
// ---------------------------------------------------------------------------

interface LockedQuotePreview {
  quote_id: string;
  expired_at: string;
  source_amount: string;
  source_currency: string;
  source_network: string;
  destination_amount: string;
}

interface PaymentIntent {
  id: string;
  type: 'default' | 'locked_quote';
  status: string;
  client_secret: string;
  destination_amount: string;
  metadata?: Record<string, string> | null;
  expires_at?: string | null;
}

interface OutboundTransfer {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  amount?: string;
  idempotency_key?: string;
  failure_reason?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic idempotency key for a payout: same (user, pool, amount) => same key => safe retry. */
export function payoutIdempotencyKey(
  userId: UserId,
  amountUsdc: UsdcBaseUnits,
  purpose: SellPurpose,
): string {
  // Amount is part of the key on purpose: a diner may legitimately sell in the same pool again
  // later at a different price, and that must NOT collapse into the earlier transfer. Two sells
  // at the identical price in the same pool are indistinguishable here and will dedupe — which is
  // the safe direction to err (Unifold returns the existing transfer, 200 instead of 201).
  return `sell:${purpose.pool_id}:${userId}:${amountUsdc}`;
}

/** Sanitize to Unifold `metadata` shape: flat, string-valued. */
function metadataFor(
  purpose: BuyPurpose,
  maxPrice: UsdcBaseUnits,
  amountUsdc: UsdcBaseUnits,
): Record<string, string> {
  return {
    kind: purpose.kind,
    pool_id: String(purpose.pool_id),
    max_price: String(maxPrice),
    amount_usdc: String(amountUsdc),
  };
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

export class UnifoldGateway implements PaymentGateway {
  /**
   * Pending-intent store keyed by `pi.id` — mirrors StubGateway.pending so both gateways expose
   * the same correlation surface. In-memory here to match the stub; the real deployment persists
   * this row (it survives a restart between "diner paid" and the webhook).
   */
  readonly pending = new Map<string, PendingIntent>();

  private readonly cfg: Required<
    Pick<UnifoldGatewayConfig, 'sourceCurrency' | 'sourceNetwork' | 'timeoutMs'>
  > &
    UnifoldGatewayConfig;

  constructor(config: UnifoldGatewayConfig) {
    // REQUIREMENT 4: fail loudly at construction. A half-configured real gateway must never
    // silently degrade into stub-like behaviour — it would take money and lose the correlation.
    const missing: string[] = [];
    if (!config.secretKey) missing.push('UNIFOLD_SECRET_KEY');
    if (!config.publishableKey) missing.push('UNIFOLD_PUBLISHABLE_KEY');
    if (!config.treasuryId) missing.push('UNIFOLD_TREASURY_ID');
    if (!config.webhookSecret) missing.push('UNIFOLD_WEBHOOK_SECRET');
    if (!config.apiBase) missing.push('UNIFOLD_API_BASE');
    if (!config.baseRecipientAddress) missing.push('UNIFOLD_BASE_RECIPIENT_ADDRESS');
    if (!config.solanaUsdcMint) missing.push('SOLANA_USDC_MINT');
    if (missing.length > 0) {
      throw new Error(
        `UnifoldGateway: missing required configuration: ${missing.join(', ')}. ` +
          `Set these in .env (see .env.example / UNIFOLD_INTEGRATION.md §1), or run with ` +
          `PAYMENT_GATEWAY=stub for the keyless demo.`,
      );
    }
    if (!config.secretKey.startsWith('sk_')) {
      throw new Error(
        `UnifoldGateway: UNIFOLD_SECRET_KEY must be a secret key starting with "sk_" ` +
          `(got "${config.secretKey.slice(0, 6)}..."). Publishable "pk_" keys cannot create intents.`,
      );
    }
    if (!config.publishableKey.startsWith('pk_')) {
      throw new Error('UnifoldGateway: UNIFOLD_PUBLISHABLE_KEY must start with "pk_".');
    }

    this.cfg = {
      ...config,
      sourceCurrency: config.sourceCurrency ?? 'usdc',
      sourceNetwork: config.sourceNetwork ?? 'solana',
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /** The publishable key the diner-frontend needs alongside a client_secret for beginCheckout. */
  get publishableKey(): string {
    return this.cfg.publishableKey;
  }

  // -------------------------------------------------------------------------
  // BUY
  // -------------------------------------------------------------------------

  /**
   * BUY — locked-quote payment intent, TWO calls back to back.
   *
   * The `lqq_` preview expires in ~30 SECONDS, so step 1 and step 2 MUST happen in the same
   * handler with nothing slow between them (no user interaction, no DB round-trip). We persist
   * the pending row only AFTER the commit succeeds, so a failed commit leaves no orphan.
   */
  async beginDeposit(
    userId: UserId,
    amountUsdc: UsdcBaseUnits,
    maxPrice: UsdcBaseUnits,
    windowSeconds: number,
    purpose: BuyPurpose,
  ): Promise<BeginDepositResult> {
    // --- Step 1: preview a locked quote (NOT retried: each call mints a new single-use quote,
    // and a blind retry would leave dangling quotes and could double-charge FX spread).
    const quote = await this.request<LockedQuotePreview>(
      'POST',
      '/payment_intents/locked_quotes/quote',
      {
        source_currency: this.cfg.sourceCurrency,
        source_network: this.cfg.sourceNetwork,
        destination_amount: String(amountUsdc),
        destination_currency: 'usdc', // v1: usdc only
        destination_network: 'base', // v1: base only
      },
    );

    // --- Step 2: commit the quote into a payment intent, immediately.
    // metadata carries pool_id + max_price so the webhook can recover the §7c-A slippage cap
    // without a DB round-trip (UNIFOLD_INTEGRATION.md §4).
    const intent = await this.request<PaymentIntent>('POST', '/payment_intents/locked_quotes', {
      quote_id: quote.quote_id,
      recipient_address: this.cfg.baseRecipientAddress,
      external_user_id: String(userId), // Auth0 `sub` → Unifold external_user_id
      metadata: metadataFor(purpose, maxPrice, amountUsdc),
    });

    // Prefer the intent's own expiry; fall back to our window if the API omits it.
    const quote_expires_at =
      intent.expires_at ?? new Date(Date.now() + windowSeconds * 1000).toISOString();

    // Pending-intent row keyed by pi.id — the correlation key, same shape the stub persists.
    this.pending.set(intent.id, {
      deposit_intent_id: intent.id,
      userId,
      amountUsdc,
      maxPrice,
      purpose,
      expires_at: quote_expires_at,
      status: 'requires_payment',
    });

    return {
      deposit_intent_id: intent.id,
      // client_secret → beginCheckout() in @unifold/connect-react on the diner UI.
      checkout: {
        client_secret: intent.client_secret,
        publishable_key: this.cfg.publishableKey,
      },
      quote_expires_at,
    };
  }

  // -------------------------------------------------------------------------
  // PAYOUT
  // -------------------------------------------------------------------------

  /**
   * SELL / payout — Treasury outbound transfer delivering USDC to the diner on SOLANA.
   * The `Idempotency-Key` header is REQUIRED by the API (400 without it) and is deterministic
   * here, so a retried payout returns the existing transfer (HTTP 200) rather than paying twice.
   */
  async payout(
    userId: UserId,
    amountUsdc: UsdcBaseUnits,
    purpose: SellPurpose,
  ): Promise<PayoutResult> {
    const recipient = await this.cfg.resolveSolanaAddress(userId);
    if (!recipient) {
      throw new Error(`UnifoldGateway.payout: no Solana USDC address on file for user ${userId}`);
    }
    const idempotencyKey = payoutIdempotencyKey(userId, amountUsdc, purpose);

    const transfer = await this.request<OutboundTransfer>(
      'POST',
      '/treasury/outbound_transfers',
      {
        source: {
          treasury_account_id: this.cfg.treasuryId,
          currency: 'usdc',
          // Solana treasury sources MUST pass "mainnet" explicitly (docs: OutboundTransferSourceDto).
          chain_id: 'mainnet',
        },
        external_user_id: String(userId), // REQUIRED on this DTO
        destination: {
          recipient_address: recipient,
          chain_type: 'solana',
          chain_id: 'mainnet',
          token_address: this.cfg.solanaUsdcMint,
        },
        amount: String(amountUsdc),
      },
      {
        idempotencyKey,
        // Safe to retry: the deterministic Idempotency-Key makes this operation idempotent
        // server-side, which is exactly the condition under which retrying a POST is allowed.
        retry: true,
      },
    );

    return { payout_id: transfer.id };
  }

  // -------------------------------------------------------------------------
  // Refund (late deposit after expiry — payment_intent.awaiting_refund)
  // -------------------------------------------------------------------------

  /**
   * Refund a locked-quote intent whose deposit landed after expiry. Called from the
   * `payment_intent.awaiting_refund` webhook branch; the refund address must be valid for the
   * quote's SOURCE chain (base58 for Solana), not the Base destination.
   */
  async refund(paymentIntentId: string, refundAddress: string): Promise<void> {
    await this.request<PaymentIntent>('POST', `/payment_intents/${paymentIntentId}/refund`, {
      refund_address: refundAddress,
    });
  }

  /** GET an intent — e.g. to read `transaction_hash`, which the webhook payload omits. */
  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    return this.request<PaymentIntent>('GET', `/payment_intents/${paymentIntentId}`, undefined, {
      retry: true, // GET is idempotent
    });
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  /**
   * One place for auth, timeouts, error surfacing and retry policy.
   *
   * RETRY POLICY (requirement 5): retries happen ONLY when the caller opts in via `retry: true`,
   * which we set exclusively for GETs and for the outbound transfer that carries a deterministic
   * Idempotency-Key. Quote-preview and intent-commit POSTs are NEVER retried — replaying them
   * would mint duplicate quotes/intents. Even for retryable calls we only retry on network
   * errors, 429, and 5xx; a 4xx is a deterministic rejection and retrying it is pointless.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: { idempotencyKey?: string; retry?: boolean } = {},
  ): Promise<T> {
    const url = `${this.cfg.apiBase.replace(/\/+$/, '')}${path}`;
    const maxAttempts = opts.retry ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      let res: Response;
      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${this.cfg.secretKey}`,
          accept: 'application/json',
        };
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

        res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        lastError = new UnifoldConnectionError(method, path, e);
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const text = await res.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new UnifoldApiError(res.status, method, path, `non-JSON response: ${text.slice(0, 500)}`);
        }
      }

      // Non-2xx: surface Unifold's own error body — that's where `code`/`param`/`detail` live.
      const errBody = await res.text().catch(() => '');
      const requestId = res.headers.get('x-request-id') ?? undefined;
      const apiErr = new UnifoldApiError(res.status, method, path, errBody.slice(0, 2000), requestId);
      const transient = res.status === 429 || res.status >= 500;
      if (attempt < maxAttempts && transient) {
        lastError = apiErr;
        await sleep(backoffMs(attempt, res.headers.get('retry-after')));
        continue;
      }
      throw apiErr;
    }
    throw lastError instanceof Error ? lastError : new Error('UnifoldGateway: request failed');
  }
}

function backoffMs(attempt: number, retryAfter?: string | null): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 10_000);
  return Math.min(250 * 2 ** (attempt - 1), 4_000) + Math.floor(Math.random() * 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Webhook event mapping
// ---------------------------------------------------------------------------

/** The eight subscribable event types (verified against llms-full.txt webhook enum). */
export type UnifoldEventType =
  | 'payment_intent.processing'
  | 'payment_intent.succeeded'
  | 'payment_intent.expired'
  | 'payment_intent.awaiting_refund'
  | 'payment_intent.refunded'
  | 'payment_intent.refund_failed'
  | 'treasury.outbound_transfer.completed'
  | 'treasury.outbound_transfer.failed';

export interface UnifoldWebhookEvent {
  id: string;
  object?: string;
  type: string;
  created?: number;
  livemode?: boolean;
  data: {
    object: {
      id: string;
      status?: string;
      amount?: string;
      destination_amount?: string;
      external_user_id?: string;
      metadata?: Record<string, string> | null;
      failure_reason?: string | null;
      [k: string]: unknown;
    };
  };
}

/**
 * Normalized action the webhook route should take. This is the single place the real Unifold
 * vocabulary is translated into the app's vocabulary, so the route's switch stays identical
 * across the stub and real paths.
 */
export type NormalizedEvent =
  | { action: 'deposit_succeeded'; intentId: string; poolId?: string; maxPrice?: string }
  | { action: 'deposit_expired'; intentId: string; reason: 'expired' | 'refunded' }
  | { action: 'deposit_awaiting_refund'; intentId: string }
  | { action: 'deposit_refund_failed'; intentId: string; failureReason?: string }
  | { action: 'payout_settled'; payoutId: string; status: 'completed' | 'failed'; failureReason?: string }
  | { action: 'ignore'; reason: string };

/**
 * Map a real Unifold event to the normalized action. Deliberately total: an unrecognized type
 * yields `ignore` rather than throwing, because a webhook endpoint must return 2xx for events it
 * does not care about or Unifold will retry them forever.
 */
export function normalizeUnifoldEvent(evt: UnifoldWebhookEvent): NormalizedEvent {
  const obj = evt?.data?.object;
  const id = obj?.id ?? '';
  switch (evt?.type) {
    // Informational ONLY — the deposit was detected but is not final. Never fulfill here.
    case 'payment_intent.processing':
      return { action: 'ignore', reason: 'payment_intent.processing is informational' };

    // The ONE place a buy is fulfilled.
    case 'payment_intent.succeeded':
      return {
        action: 'deposit_succeeded',
        intentId: id,
        poolId: obj?.metadata?.pool_id,
        maxPrice: obj?.metadata?.max_price,
      };

    // Quote window lapsed with no deposit — diner must re-quote.
    case 'payment_intent.expired':
      return { action: 'deposit_expired', intentId: id, reason: 'expired' };

    // Deposit landed AFTER expiry: refund it, do NOT buy.
    case 'payment_intent.awaiting_refund':
      return { action: 'deposit_awaiting_refund', intentId: id };

    // Refund confirmed on-chain — funds are back with the diner; treat as an expired buy.
    case 'payment_intent.refunded':
      return { action: 'deposit_expired', intentId: id, reason: 'refunded' };

    case 'payment_intent.refund_failed':
      return {
        action: 'deposit_refund_failed',
        intentId: id,
        failureReason: obj?.failure_reason ?? undefined,
      };

    case 'treasury.outbound_transfer.completed':
      return { action: 'payout_settled', payoutId: id, status: 'completed' };

    case 'treasury.outbound_transfer.failed':
      return {
        action: 'payout_settled',
        payoutId: id,
        status: 'failed',
        failureReason: obj?.failure_reason ?? undefined,
      };

    default:
      return { action: 'ignore', reason: `unhandled event type: ${String(evt?.type)}` };
  }
}
