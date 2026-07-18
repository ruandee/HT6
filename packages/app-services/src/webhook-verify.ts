/**
 * Unifold webhook signature verification (UNIFOLD_INTEGRATION.md §4; docs "Verify Webhook
 * Signatures"). Header `unifold-signature: v1,<hex>` = HMAC-SHA256(secret,
 * `${id}.${timestamp}.${rawBody}`). Verify over the RAW body, reject >5min skew, dedupe by id.
 *
 * On the StubGateway path there is no real signature; requests carry `x-stub: 1` and skip the
 * HMAC (so the exact same route/handler runs in both modes — only verification differs).
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
}

export type VerifyResult =
  | { ok: true; eventId: string; stub: boolean }
  | { ok: false; error: string };

export function verifyWebhook(input: VerifyInput): VerifyResult {
  const { headers, rawBody, secret } = input;

  // Stub bypass: local mock deposit page has no signing secret.
  if (headers['x-stub'] === '1') {
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
