/**
 * Unifold webhook signature verification (UNIFOLD_INTEGRATION.md §4; docs "Verify Webhook
 * Signatures"). Header `unifold-signature: v1,<hex>` = HMAC-SHA256(secret,
 * `${id}.${timestamp}.${rawBody}`). Verify over the RAW body, reject >5min skew, dedupe by id.
 *
 * On the StubGateway path there is no real signature; requests carry `x-stub: 1` and skip the
 * HMAC (so the exact same route/handler runs in both modes — only verification differs).
 *
 * SECURITY: that bypass is a DEMO affordance and is refused whenever the real gateway is active
 * (`allowStub: false`). Without that condition, anyone who can reach the deployed service could
 * POST `x-stub: 1` and mint reservations for free — the endpoint is public by necessity, since
 * Unifold has to be able to call it. The bypass must therefore be scoped to the mode that has no
 * signing secret to check against, not merely to the presence of a header the caller controls.
 */
import * as crypto from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;

export interface VerifyInput {
  headers: {
    'unifold-id'?: string;
    'unifold-timestamp'?: string;
    'unifold-signature'?: string;
    'x-stub'?: string;
  };
  rawBody: string;
  secret: string;
  /**
   * Whether the `x-stub` bypass is permitted at all. Callers pass `cfg.gateway !== 'unifold'`.
   * Defaults to false so a caller that forgets it fails CLOSED rather than open.
   */
  allowStub?: boolean;
}

export type VerifyResult =
  | { ok: true; eventId: string; stub: boolean }
  | { ok: false; error: string };

export function verifyWebhook(input: VerifyInput): VerifyResult {
  const { headers, rawBody, secret, allowStub = false } = input;

  // Stub bypass: local mock deposit page has no signing secret. Refused on the real gateway —
  // there, an unsigned event is exactly what an attacker would send to mint a free reservation.
  if (headers['x-stub'] === '1') {
    if (!allowStub) {
      return {
        ok: false,
        error:
          'x-stub is not accepted while PAYMENT_GATEWAY=unifold — real webhooks must be signed',
      };
    }
    return { ok: true, eventId: `stub_${crypto.randomUUID()}`, stub: true };
  }

  const id = headers['unifold-id'];
  const tsStr = headers['unifold-timestamp'];
  const sig = headers['unifold-signature'];
  if (!id || !tsStr || !sig) return { ok: false, error: 'missing signature headers' };

  const ts = Number.parseInt(tsStr, 10);
  if (Number.isNaN(ts)) return { ok: false, error: 'invalid timestamp' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return { ok: false, error: 'timestamp skew too large' };

  const [version, received] = sig.split(',');
  if (version !== 'v1' || !received) return { ok: false, error: 'unexpected signature version' };

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${id}.${ts}.${rawBody}`, 'utf8')
    .digest('hex');

  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'signature mismatch' };
  }
  return { ok: true, eventId: id, stub: false };
}
