# Unifold Skill Reference

## Product summary

Unifold is crypto deposit, checkout, withdrawal, and payout infrastructure for applications. It lets you embed multi-chain funding flows into your product without running cross-chain bridging or swap infrastructure yourself. Unifold is organized into three layers: **funding** (how users get crypto in — crypto transfer, card, connected wallet, Cash App, exchange, or fiat onramp), **settlement** (cross-chain bridging, token swaps, and routing that converts whatever the user sends into your desired token on your destination chain), and **fulfillment** (cryptographically signed webhooks and client-side callbacks that tell your app a transaction completed).

Key files and endpoints:

- Dashboard: https://dashboard.unifold.io (create projects, manage API keys, configure deposit methods and webhooks)
- REST API: `https://api.unifold.io/v1/` (requires `Authorization: Bearer sk_...`)
- Client SDKs: React (`@unifold/connect-react`), Solid (`@unifold/connect-solid`), Svelte (`@unifold/connect-svelte`), React Native (`@unifold/connect-react-native`), iOS/Swift (`unifold-ios`), Android/Kotlin (`io.unifold:unifold-android`)
- Webhooks: Configure at Dashboard or via `POST /v1/webhook_endpoints`; events are HMAC-SHA256 signed via the `unifold-signature` header
- Primary docs: https://docs.unifold.io
- Full LLM-readable docs (authenticated, scoped to your project): https://api.unifold.io/v1/docs/llms-full.txt?token=cHJvamVjdF8zR2V3SUZucXhXMFpYcWFTeWJrZFdERXZHS20.948ed70aa30c310472ff19da987846b77c66730d20e7d95a5a85e69b8998679f

## When to use

Reach for this skill when:

- Accepting deposits: Letting users fund your platform with any token on any chain via a prebuilt modal (`beginDeposit()`)
- Collecting fixed payments (checkout): Creating a server-side Payment Intent and collecting an exact amount (`beginCheckout()`)
- Processing withdrawals: Letting users send crypto out to an external address while your platform retains signing authority (`beginWithdraw()`)
- Adding fiat onramp: Card / Apple Pay / Google Pay / ACH / SEPA purchases via integrated providers (Stripe, Coinbase, Cash App, etc.)
- Crediting balances: Reacting to deposit/payment/treasury/withdraw webhooks to update an internal ledger
- Managing treasury: Creating treasury accounts and executing outbound transfers via the REST API
- Driving the deposit flow yourself: Generating per-user deposit addresses directly (`/v1/deposit_addresses`) instead of through a Payment Intent
- Executing on-chain actions on deposit: Sweeping delivered funds into a contract call (mint, stake, supply) via `contractCalls` (web only)
- Building multi-chain apps: Accepting from Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, Solana, Bitcoin, Algorand, XRPL, and more

## Quick reference

### SDK initialization (React)

```tsx
import { UnifoldProvider } from '@unifold/connect-react';
import '@unifold/connect-react/styles.css';

<UnifoldProvider
  publishableKey="pk_test_your_key"
  config={{
    appearance: 'dark',
  }}
>
  {children}
</UnifoldProvider>;
```

### Launch a deposit (React)

```tsx
import { useUnifold } from '@unifold/connect-react';

function DepositButton() {
  const { beginDeposit } = useUnifold();

  const handleDeposit = () =>
    beginDeposit({
      externalUserId: 'user_abc123',
      destinationChainType: 'ethereum',
      destinationChainId: '8453', // Base
      destinationTokenSymbol: 'USDC',
      destinationTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      recipientAddress: '0xYourTreasury',
      // User can send ETH, SOL, MATIC, BTC — all converted to USDC on Base
    });

  return <button onClick={handleDeposit}>Deposit</button>;
}
```

### REST API authentication

All REST API calls use a secret key in the `Authorization` header (Bearer scheme):

```bash
curl https://api.unifold.io/v1/treasury/accounts \
  -H "Authorization: Bearer sk_live_..."
```

### Core API endpoints

| Task                           | Endpoint                              | Method |
| ------------------------------ | ------------------------------------- | ------ |
| Create payment intent          | `/v1/payment_intents`                 | POST   |
| Get payment intent             | `/v1/payment_intents/{id}`            | GET    |
| List payment intents           | `/v1/payment_intents`                 | GET    |
| Cancel payment intent          | `/v1/payment_intents/{id}/cancel`     | POST   |
| Refund payment intent          | `/v1/payment_intents/{id}/refund`     | POST   |
| Create locked quote            | `/v1/payment_intents/locked_quotes`   | POST   |
| Create / get deposit addresses | `/v1/deposit_addresses`               | POST   |
| Get wallet token balances      | `/v1/addresses/balances`              | POST   |
| List supported deposit tokens  | `/v1/tokens/supported_deposit_tokens` | GET    |
| Create treasury account        | `/v1/treasury/accounts`               | POST   |
| Create outbound transfer       | `/v1/treasury/outbound_transfers`     | POST   |
| List users                     | `/v1/users`                           | GET    |
| List direct executions         | `/v1/direct_executions`               | GET    |
| Retrieve onramp session        | `/v1/onramps/sessions/retrieve`       | POST   |
| Create webhook endpoint        | `/v1/webhook_endpoints`               | POST   |
| Get webhook endpoint secret    | `/v1/webhook_endpoints/{id}/secret`   | GET    |

### API keys

| Key type        | Prefix                  | Used by                       | Capabilities                                                |
| --------------- | ----------------------- | ----------------------------- | ----------------------------------------------------------- |
| Publishable key | `pk_live_` / `pk_test_` | Client SDKs (browser, mobile) | Launch deposit / checkout / withdraw modals                 |
| Secret key      | `sk_live_` / `sk_test_` | Server SDKs, REST API         | Create Payment Intents, manage treasury, configure webhooks |

Publishable keys are safe to expose in client code. Secret keys must only be used in trusted server environments — never bundle them in client applications.

### Client SDK methods

| Method                                  | Purpose                                                         | Key requirement                                  |
| --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `beginDeposit(config)`                  | Open-amount deposit, user chooses how much                      | Publishable key                                  |
| `beginCheckout(config)`                 | Fixed-amount payment against a Payment Intent's `client_secret` | Publishable key (intent created with secret key) |
| `beginWithdraw(config)`                 | Send crypto out; your app signs via the `withdraw` callback     | Publishable key                                  |
| `closeCheckout()` / modal close helpers | Programmatically dismiss the active modal                       | —                                                |

### Funding methods

Transfer Crypto (all platforms), Buy with Card (all platforms), Connect Wallet (web only — MetaMask, Phantom, etc.), Cash App (web, iOS), Exchange Account (varies), Stripe Onramp (Apple Pay, Google Pay, ACH, SEPA — configurable).

### Supported chains (settlement / routing)

Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, Solana, Bitcoin, Algorand, XRPL, MegaETH, and more. `chain_type` values: `ethereum` (covers all supported EVM chains), `solana`, `bitcoin`, `algorand`, `xrpl`.

## Decision guidance

### Deposit vs. checkout vs. withdraw

| Scenario                                           | Use `beginDeposit` | Use `beginCheckout` | Use `beginWithdraw` |
| -------------------------------------------------- | ------------------ | ------------------- | ------------------- |
| User decides the amount (top-ups, account funding) | ✓                  |                     |                     |
| Fixed price (invoice, order, subscription)         |                    | ✓                   |                     |
| Send funds out of your platform                    |                    |                     | ✓                   |
| Purely client-side, no server setup                | ✓                  |                     |                     |
| Need a server-created intent + `client_secret`     |                    | ✓                   |                     |
| Your app must sign the outgoing transaction        |                    |                     | ✓                   |

### Settlement model

| Scenario                                         | Treasury deposit | Direct-to-wallet | Fixed-amount checkout |
| ------------------------------------------------ | ---------------- | ---------------- | --------------------- |
| Internal balances / custodial ledger             | ✓                |                  |                       |
| Users self-custody, no server ledger             |                  | ✓                |                       |
| Exact amount for an order/invoice                |                  |                  | ✓                     |
| Credit balances via webhook + `external_user_id` | ✓                | (optional)       | ✓                     |
| Prediction markets, exchanges, fintech           | ✓                |                  |                       |
| Wallet top-ups, bridging, gaming wallets         |                  | ✓                |                       |

### Destination token

| Scenario                                                | Stablecoin destination | Crypto destination |
| ------------------------------------------------------- | ---------------------- | ------------------ |
| Predictable USD-equivalent balances                     | ✓                      |                    |
| No price volatility between deposit and credit          | ✓                      |                    |
| Protocol operates in ETH/SOL/native or governance token |                        | ✓                  |
| Simplifies accounting in a single unit                  | ✓                      |                    |

### SDK vs. REST API directly

| Scenario                                                 | Use a client SDK | Use REST directly |
| -------------------------------------------------------- | ---------------- | ----------------- |
| Want prebuilt, themeable deposit/checkout/withdraw UI    | ✓                |                   |
| Embedding in React / Solid / Svelte / iOS / Android / RN | ✓                |                   |
| Server-side intent creation, treasury, webhooks          |                  | ✓                 |
| Driving your own deposit-address UX                      |                  | ✓                 |

## Workflow

### 1. Set up your project

1. Create an account at https://dashboard.unifold.io
2. Create a project
3. Copy your publishable key (`pk_`) and secret key (`sk_`); keep the secret key server-side only
4. Configure allowed domains for your client SDK origin
5. Configure deposit methods and providers in the Dashboard

### 2. Add a client SDK (open-amount deposits)

1. Install the SDK for your platform (e.g. `@unifold/connect-react`)
2. Wrap your app with the provider (`UnifoldProvider`) using your publishable key; import the SDK stylesheet
3. Call `beginDeposit()` with `destinationChainType`, `destinationChainId`, `destinationTokenSymbol`/`destinationTokenAddress`, `recipientAddress`, and `externalUserId`
4. Handle `onSuccess` / `onError` / `onClose` callbacks for UI feedback (never as the sole trigger for crediting balances)

### 3. Collect a fixed payment (checkout)

1. On your server, create a Payment Intent via `POST /v1/payment_intents` (secret key) with the amount, destination chain/token, and recipient
2. Return the intent's `client_secret` to your frontend
3. Call `beginCheckout({clientSecret})` in the client SDK
4. Track settlement server-side via webhooks (`payment_intent.*` events) — do not rely on client callbacks for fulfillment

### 4. Process a withdrawal

1. Call `beginWithdraw()` with `sourceChainType`, `sourceChainId`, `sourceTokenAddress`/`sourceTokenSymbol`, `senderAddress`, and `externalUserId`
2. Provide a `withdraw` callback that signs and broadcasts the on-chain transaction (Unifold never holds private keys). For EVM, encode the ERC-20 `transfer` to `txInfo.withdrawIntentAddress` for `txInfo.amountBaseUnit` and send it with your wallet/provider (e.g. Privy `useSendTransaction`)
3. Handle `onSuccess` / `onError`

### 5. Set up webhooks (production)

1. Create a backend endpoint that accepts POST requests and can read the **raw** request body
2. Register the endpoint via `POST /v1/webhook_endpoints` (or in the Dashboard) and subscribe to the event types you need (deposit, payment intent, treasury, withdraw)
3. Fetch the signing secret via `GET /v1/webhook_endpoints/{id}/secret`
4. On each request, verify the `unifold-signature` header (see Common gotchas) and return `2xx`
5. Use `external_user_id` from the payload to credit the right user

### 6. (Optional) Treasury & outbound transfers

1. Create a treasury account via `POST /v1/treasury/accounts`
2. Execute payouts via `POST /v1/treasury/outbound_transfers`
3. Track status via `GET /v1/treasury/outbound_transfers/{id}` and treasury webhook events

### 7. (Optional) Drive the deposit flow yourself

1. Call `POST /v1/deposit_addresses` to generate per-user deposit wallets across source chains for a destination (chain + token + recipient)
2. Show the address/QR in your own UI
3. Use `POST /v1/addresses/balances` to query on-chain balances and `GET /v1/tokens/supported_deposit_tokens` for the deposit-source catalog

### 8. Verify your work

- [ ] Publishable key is used client-side; secret key only server-side
- [ ] Provider wraps your app at the root and the SDK stylesheet is imported
- [ ] Allowed domains are configured for your client origin
- [ ] A deposit completes end-to-end and funds arrive at the destination
- [ ] Payment Intents are created server-side and `client_secret` is passed to `beginCheckout`
- [ ] Withdrawals sign and broadcast via your `withdraw` callback
- [ ] Webhooks are received, signature-verified, idempotent, and credit the correct `external_user_id`

## Common gotchas

- Callbacks are not authoritative: `onSuccess` is for UI feedback only. Credit balances and fulfill orders from **webhooks**, never solely from client callbacks.
- Secret key leaked to the client: Only `pk_` keys belong in client SDKs. Never ship `sk_` keys in browser/mobile bundles.
- Raw body required for webhook verification: The HMAC is computed over `${eventId}.${timestamp}.${rawBody}`. Capture the exact raw bytes before JSON parsing (Express `verify`, NestJS `rawBody: true`). If you can't, `JSON.stringify(body)` is a fallback because Unifold sends compact JSON.
- Webhook signature format: The `unifold-signature` header is `v1,<hex>`. Split on the comma, check the `v1` version, recompute HMAC-SHA256 with your endpoint secret, and compare with `crypto.timingSafeEqual`.
- Missing replay protection: Reject events whose `unifold-timestamp` is more than ~5 minutes from now, and dedupe by `unifold-id` (event ID) since webhooks may be delivered more than once.
- Variable delivered amount: Cross-chain settlement involves slippage and fees, so the delivered amount is not deterministic. For Call Execution / sweeps, read the live allowance/balance at execution time instead of hardcoding an amount.
- Call Execution is web-only: `contractCalls` are supported on `@unifold/connect-react` only and on a limited set of destination chains (Ethereum, Arbitrum, Base, MegaETH). The first call should sweep (read allowance, `transferFrom` the balance).
- Funds aren't lost on a reverting call: If any call in a Call Execution sequence reverts, delivered funds stay at the intent address and Unifold retries; don't treat a failed call as lost funds.
- Test vs. live keys: `pk_test_`/`sk_test_` operate against testnets/test mode; `pk_live_`/`sk_live_` are production. Don't mix environments.
- Withdraw signing is your responsibility: Unifold never custodies user keys for withdrawals. If you omit a valid `withdraw` callback (EVM) or signing path, the withdrawal cannot broadcast.

## Verification checklist

Before submitting work with Unifold:

- [ ] Keys stored securely (secret key in environment variables, never hardcoded or client-bundled)
- [ ] Provider initialized with the correct publishable key and config; SDK styles imported
- [ ] Allowed domains configured in the Dashboard for each environment
- [ ] Deposit flow works end-to-end (modal opens, funds settle to destination, `external_user_id` is set)
- [ ] Checkout uses a server-created Payment Intent and `client_secret`
- [ ] Withdraw callback signs and broadcasts; cross-chain conversion verified on a small amount
- [ ] Webhook endpoint registered and receiving the event types you need
- [ ] Webhook signatures verified (`v1,<hex>` HMAC-SHA256 over `id.timestamp.rawBody`, timing-safe compare)
- [ ] Timestamp tolerance + idempotency (dedupe by event ID) implemented to prevent replay/double-processing
- [ ] Balance crediting and order fulfillment are driven by webhooks, not client callbacks
- [ ] Error handling for failed/canceled deposits, payments, and transfers
- [ ] Test mode (`*_test_`) used in development; live keys only in production

## Resources

Full, authenticated, project-scoped documentation (`llms-full.txt`): https://api.unifold.io/v1/docs/llms-full.txt?token=cHJvamVjdF8zR2V3SUZucXhXMFpYcWFTeWJrZFdERXZHS20.948ed70aa30c310472ff19da987846b77c66730d20e7d95a5a85e69b8998679f

Critical documentation sections (within the full docs above):

1. Key Concepts — Funding, settlement, and fulfillment layers and settlement models
2. Choose your platform — Picking the right SDK (React, Solid, Svelte, React Native, iOS, Android) or REST
3. Quickstart — First deposit in a few minutes
4. Functions / Hook reference — `beginDeposit`, `beginCheckout`, `beginWithdraw` and their config types
5. Webhooks overview & Verify Webhook Signatures — Event types and HMAC verification
6. REST API — Payment Intents, Treasury, Deposit Addresses, Tokens, Users, Webhook Endpoints

---

> For the complete, machine-readable documentation, fetch the authenticated `llms-full.txt` linked above: https://api.unifold.io/v1/docs/llms-full.txt?token=cHJvamVjdF8zR2V3SUZucXhXMFpYcWFTeWJrZFdERXZHS20.948ed70aa30c310472ff19da987846b77c66730d20e7d95a5a85e69b8998679f
