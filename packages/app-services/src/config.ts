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
    /** SPL USDC mint used as token_address on Solana payouts. */
    solanaUsdcMint: string;
  };
}

export function loadConfig(): Config {
  const port = Number(process.env.APP_SERVICES_PORT ?? 8080);
  const gateway = (process.env.PAYMENT_GATEWAY ?? 'stub') as 'stub' | 'unifold';
  return {
    port,
    gateway,
    baseUrl: process.env.APP_BASE_URL ?? `http://localhost:${port}`,
    unifold: {
      apiBase: process.env.UNIFOLD_API_BASE ?? 'https://api.unifold.io/v1',
      publishableKey: process.env.UNIFOLD_PUBLISHABLE_KEY ?? '',
      secretKey: process.env.UNIFOLD_SECRET_KEY ?? '',
      treasuryId: process.env.UNIFOLD_TREASURY_ID ?? '',
      webhookSecret: process.env.UNIFOLD_WEBHOOK_SECRET ?? '',
      baseRecipientAddress: process.env.UNIFOLD_BASE_RECIPIENT_ADDRESS ?? '',
      // Mainnet SPL USDC mint by default; override for devnet.
      solanaUsdcMint:
        process.env.SOLANA_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
  };
}
