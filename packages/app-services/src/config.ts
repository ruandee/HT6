/**
 * Config from process.env (populated from .env — see SETUP.md). No secret is hardcoded.
 * The demo runs entirely with defaults + PAYMENT_GATEWAY=stub; no keys required.
 */
export interface Config {
  port: number;
  gateway: 'stub' | 'unifold';
  baseUrl: string; // public/base URL app-services is reachable at (for hosted_url / webhooks)
  unifold: {
    apiBase: string;
    publishableKey: string;
    secretKey: string;
    treasuryId: string;
    webhookSecret: string;
    /** Base-chain address BUY proceeds settle to (v1 destination is Base USDC only). */
    baseRecipientAddress: string;
    /** USDC contract on Base, used as token_address on payouts. */
    baseUsdcAddress: string;
  };
  /**
   * Divides every seeded pool's p0 and k. Exists so a REAL-money run charges a few dollars instead
   * of the demo's headline $58 — Unifold has no usable testnet, so the only way to exercise the
   * live rail is mainnet with small amounts. 1 = the full-price demo (default).
   */
  priceDivisor: bigint;
}

export function loadConfig(): Config {
  /**
   * PORT first: Render (and most PaaS) assign a port and inject it as PORT, then health-check
   * that exact port — bind anything else and the deploy is marked failed. APP_SERVICES_PORT stays
   * the local-dev knob, so `npm run dev` on :8080 is unaffected.
   */
  const port = Number(process.env.PORT ?? process.env.APP_SERVICES_PORT ?? 8080);
  const gateway = (process.env.PAYMENT_GATEWAY ?? 'stub') as 'stub' | 'unifold';

  // Clamp to >=1: a zero or negative divisor would divide by zero or invert the curve, and this
  // value is the only thing standing between a demo click and a real charge.
  const rawDivisor = BigInt(
    Number.isFinite(Number(process.env.DEMO_PRICE_DIVISOR))
      ? Math.trunc(Number(process.env.DEMO_PRICE_DIVISOR))
      : 1,
  );
  const priceDivisor = rawDivisor > 0n ? rawDivisor : 1n;

  return {
    port,
    gateway,
    priceDivisor,
    baseUrl: process.env.APP_BASE_URL ?? `http://localhost:${port}`,
    unifold: {
      apiBase: process.env.UNIFOLD_API_BASE ?? 'https://api.unifold.io/v1',
      publishableKey: process.env.UNIFOLD_PUBLISHABLE_KEY ?? '',
      secretKey: process.env.UNIFOLD_SECRET_KEY ?? '',
      treasuryId: process.env.UNIFOLD_TREASURY_ID ?? '',
      webhookSecret: process.env.UNIFOLD_WEBHOOK_SECRET ?? '',
      baseRecipientAddress: process.env.UNIFOLD_BASE_RECIPIENT_ADDRESS ?? '',
      // Canonical USDC on Base mainnet.
      baseUsdcAddress:
        process.env.BASE_USDC_ADDRESS ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  };
}
