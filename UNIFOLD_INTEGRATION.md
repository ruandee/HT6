# §10.5 Unifold boundary — REWORKED FROM REAL DOCS (replaces the PROVISIONAL section in BUILD_SPEC.md)

> Owner: `app-services`. This supersedes BUILD_SPEC.md §10.5 (which was written before the real
> Unifold docs were in hand). Source of truth: `.claude/skills/unifold/SKILL.md` +
> `.claude/skills/unifold/llms-full.txt` (project-scoped, generated 2026-07-18).
> **The internal `PaymentGateway` interface and everything outside this file are UNCHANGED** — the
> corrections here live entirely behind the gateway seam, exactly as the spec intended.

---

## 0. What the real docs changed vs. the spec's guesses (read this first)

The architecture the spec confirmed (Payment Intents for buy, Treasury/withdraw for payout, signed
webhooks, testnet) is right. Seven concrete details were wrong or underspecified and are corrected here:

1. **There is NO `@unifold/node` server SDK.** The server side is plain **REST** against
   `https://api.unifold.io/v1/` with an `Authorization: Bearer sk_...` secret key. The only npm
   packages are client SDKs; this repo has `@unifold/connect-react` installed (v0.1.70).
2. **Locked-quote is a TWO-STEP flow**, not one call:
   `POST /v1/payment_intents/locked_quotes/quote` (preview → `quote_id`, prefix `lqq_`, **expires
   ~30s**) → `POST /v1/payment_intents/locked_quotes` (commit `quote_id` into a payment intent).
   The spec's single "create-locked-quote-payment-intent" call is actually these two.
3. **v1 destination is BASE USDC ONLY.** Both default and locked-quote payment intents can only
   settle to `destination_network: base`, `destination_currency: usdc`. **Buy USDC does NOT land on
   the Solana reserve directly** — it arrives on Base. This is the one place the spec's "settles in
   USDC on Solana" assumption breaks; see §4 for how the reserve is funded.
4. **The buy is collected with `beginCheckout({clientSecret})`, not `beginDeposit`.** `beginDeposit`
   is the open-amount flow (user picks the amount) — wrong for a fixed, quote-locked buy price. We
   create the intent server-side and hand its `client_secret` to `beginCheckout` on the diner UI.
5. **Payout = Treasury outbound transfer** (`POST /v1/treasury/outbound_transfers`), NOT a
   "beginWithdraw" call. Outbound transfers CAN deliver USDC to a **Solana** recipient address
   (`chain_type: "solana"`, `chain_id: "mainnet"`) and require an **`Idempotency-Key`** request
   header. (`beginWithdraw` exists but is a client-signed flow where the app holds keys — wrong for
   our custodial model.)
6. **Exact webhook event names** (the subscribable set):
   `payment_intent.processing | succeeded | expired | awaiting_refund | refunded | refund_failed`
   and `treasury.outbound_transfer.completed | failed`. There is **no** `deposit.*` event for our
   path. The late-deposit-after-expiry branch is `expired` → (deposit lands) → `awaiting_refund` →
   we call the **refund endpoint** → `refunded`.
7. **Webhook signature**: header `unifold-signature: v1,<hex>`, HMAC-SHA256 over
   `` `${unifold-id}.${unifold-timestamp}.${rawBody}` `` using the endpoint secret. Verify raw body,
   reject timestamps >5 min skew, dedupe by `unifold-id`.

---

## 1. Environment / config (app-services)

```
UNIFOLD_API_BASE        = https://api.unifold.io/v1
UNIFOLD_SECRET_KEY      = sk_test_...        # server only, never bundled
UNIFOLD_PUBLISHABLE_KEY = pk_test_...        # handed to diner-frontend UnifoldProvider
UNIFOLD_WEBHOOK_SECRET  = whsec_...          # from GET /v1/webhook_endpoints/{id}/secret
UNIFOLD_TREASURY_ID     = ta_...             # created once via POST /v1/treasury/accounts
```

- Use **test keys** (`*_test_`) for the hackathon — Unifold has explicit testnet/test mode. Don't
  mix test and live.
- Auth seam holds exactly as specced: Auth0 `sub` → Unifold `external_user_id` on every call.

---

## 2. Money-flow reality (the one architectural consequence)

Because v1 payment intents only settle to **Base USDC**, the funds path is:

```
BUY:   diner deposits any crypto  --Unifold-->  USDC on BASE (project recipient / treasury)
                                                        │
                                   (bridge Base-USDC ── our step ──> Solana reserve PDA)
SELL:  Solana reserve --chain-services.sell--> USDC back into reserve
                                                        │
       Treasury outbound_transfer  --Unifold-->  USDC on SOLANA to the diner
```

Two clean ways to handle the Base-side buy proceeds — **decide at build, gateway hides it either way:**

- **(Recommended for demo) Treasury-custodial:** buy intents recipient = our **Base treasury**.
  On `payment_intent.succeeded` we call `chain-services.buy(...)` which mints the reservation token
  and debits the Solana reserve from **our own pre-funded Solana treasury float** (we top the reserve
  up off the Base proceeds out-of-band / post-demo). The chain reserve stays the money-authority for
  reservations; the Base USDC is our operating float that backs it. Clean, and never blocks the demo.
- **(Real production) Bridge per buy:** recipient = a Base deposit address, then a follow-up
  outbound transfer / bridge moves that USDC to the Solana reserve before/at `buy`. More moving parts;
  not needed for the demo.

**On StubGateway (the demo) none of this matters** — the stub fakes the intent + webhook and calls
`chain-services.buy` directly. The Base-vs-Solana settlement detail only surfaces when the real
gateway swaps in, and it stays entirely inside the gateway impl.

---

## 3. Internal `PaymentGateway` interface — UNCHANGED (still the seam)

Do **not** change this. It is what §8.1 SWAP B swaps behind. Callers (REST routes, frontends) are
untouched by everything above.

```ts
interface PaymentGateway {
  // BUY: create a locked-quote payment intent for the quoted price, locked for `window`
  beginDeposit(userId, amountUsdc, maxPrice, window, purpose:{kind:'buy', pool_id})
      -> { deposit_intent_id, deposit_addresses?, hosted_url?, sdk_params?, quote_expires_at }
  // SELL: withdraw/payout to the user
  payout(userId, amountUsdc, purpose:{kind:'sell', pool_id}) -> { payout_id }
  // webhook ingress is a route on app-services, not a method:
  //   POST /webhooks/unifold  (verify signature) -> normalizes to DepositSettled / PayoutSettled
}
type DepositSettled = { deposit_intent_id, userId, amountUsdc, purpose, status:'succeeded'|'expired'|'failed' }
type PayoutSettled  = { payout_id, userId, amountUsdc, purpose, status:'completed'|'failed' }
```

Note the method is still named `beginDeposit` on OUR interface (it's our abstraction name) even
though the real Unifold impl uses the locked-quote payment-intent endpoints, not Unifold's
`beginDeposit`. `sdk_params` carries the intent `client_secret` for `beginCheckout`.

---

## 4. Real `UnifoldGateway` — how each method maps to the API

### `beginDeposit(...)` → locked-quote payment intent (BUY)

The diner's `buy_price` (from `chain-services.quote`) is the exact USD amount to lock. Two REST calls:

**Step 1 — preview a locked quote** (locks the FX rate for the source token the diner will pay in):
```
POST /v1/payment_intents/locked_quotes/quote        Authorization: Bearer sk_test_...
{
  "source_currency":     "usdc",        // or whatever the diner funds with (btc, eth, sol, ...)
  "source_network":      "solana",      // source-token network slug
  "destination_amount":  "58000000",    // buy_price in Base-USDC base units (6 dp) — e.g. $58.00
  "destination_currency":"usdc",
  "destination_network": "base"         // v1: base only
}
-> 200 { quote_id:"lqq_...", expired_at, source_amount, source_currency, ... }
```
⚠️ **Quote preview expires in ~30s** — commit it immediately (step 2 in the same request handler).
This is tighter than the spec's 90s; the 90s "window" the diner experiences is really the committed
intent's life, but the `lqq_` preview itself must be committed within ~30s of previewing.

**Step 2 — commit the quote into a payment intent:**
```
POST /v1/payment_intents/locked_quotes              Authorization: Bearer sk_test_...
{
  "quote_id":         "lqq_...",
  "recipient_address":"<Base treasury / recipient>",
  "external_user_id": "<Auth0 sub>",
  "metadata": { "pool_id":"...", "max_price":"58000000", "kind":"buy" }   // correlation
}
-> 200 { id:"pi_...", client_secret:"pi_..._secret_...", status:"requires_payment", type:"locked_quote", ... }
```

Return from `beginDeposit`:
```
{ deposit_intent_id: pi.id,
  sdk_params: { client_secret: pi.client_secret },   // -> beginCheckout on diner-frontend
  quote_expires_at: <intent expiry> }
```

Persist a **pending-intent row** keyed by `pi.id` (our `deposit_intent_id` = correlation key):
`{ pi_id, userId, amountUsdc, maxPrice, pool_id, purpose:'buy', status:'requires_payment' }`.
Stash `max_price` in `metadata` too so the webhook handler can recover it without a DB round-trip.

### `payout(...)` → Treasury outbound transfer (SELL)

```
POST /v1/treasury/outbound_transfers      Authorization: Bearer sk_test_...
Idempotency-Key: <deterministic key, e.g. `sell:${pool_id}:${userId}:${sellSeq}`>   // REQUIRED
{
  "source":      { "treasury_account_id":"ta_...", "currency":"usdc", "chain_id":"mainnet" },  // Solana treasury -> chain_id MUST be "mainnet"
  "external_user_id": "<Auth0 sub>",
  "destination": { "recipient_address":"<diner Solana USDC addr>", "chain_type":"solana",
                   "chain_id":"mainnet", "token_address":"<Solana USDC mint>" },
  "amount": "55100000"     // sell_price_net in USDC base units
}
-> 201 { id:"obt_...", status:"pending"|"processing"|"completed", ... }
```
Return `{ payout_id: obt.id }`. Settlement confirms via `treasury.outbound_transfer.completed`.
The idempotency key makes a retried `payout` safe (Unifold returns the existing transfer, 200 not 201).

### Webhook ingress → `POST /webhooks/unifold`

One route, signature-verified, that normalizes Unifold events to our `DepositSettled`/`PayoutSettled`.

**Verify first (raw body!):** `unifold-signature: v1,<hex>` = HMAC-SHA256(secret,
`` `${unifold-id}.${unifold-timestamp}.${rawBody}` ``). Reject if headers missing, timestamp skew
>5 min, or `crypto.timingSafeEqual` fails. Dedupe by `unifold-id`. (Capture raw bytes before JSON
parse — e.g. Express `express.json({ verify: (req,_,buf)=>{ req.rawBody = buf.toString('utf8') } })`.)

**Event mapping** (event object is under `data.object`; correlate via `id` = our `pi.id`, or `metadata`):

| Unifold event                         | Our normalized result / action                                            |
|---------------------------------------|---------------------------------------------------------------------------|
| `payment_intent.processing`           | informational only — do NOT fulfill. (deposit detected)                   |
| `payment_intent.succeeded`            | `DepositSettled{status:'succeeded'}` → call `chain-services.buy(pool_id, userId, maxPrice)` → update holdings. **Only fulfill here.** |
| `payment_intent.expired`              | window lapsed, no deposit → `DepositSettled{status:'expired'}` → tell diner to re-quote. |
| `payment_intent.awaiting_refund`      | late deposit after expiry → call `POST /v1/payment_intents/{id}/refund` with payer source address; do NOT buy. |
| `payment_intent.refunded`             | refund confirmed → `DepositSettled{status:'expired'}` (funds returned), notify diner. |
| `payment_intent.refund_failed`        | log + alert; retry refund with corrected address.                         |
| `treasury.outbound_transfer.completed`| `PayoutSettled{status:'completed'}` → mark sell settled.                  |
| `treasury.outbound_transfer.failed`   | `PayoutSettled{status:'failed'}` → mark sell failed, re-credit holding, alert. |

Note: the destination payout tx hash is **not** in the `payment_intent.succeeded` payload — if you
need it, GET `/v1/payment_intents/{id}` and read `transaction_hash`.

---

## 5. StubGateway — BUILD THIS NOW (first-class; full demo runs without the key)

Unchanged in spirit from the spec — corrected only so its shape matches the real gateway's:

- `beginDeposit` returns a fake `deposit_intent_id` (`pi_stub_...`) + `quote_expires_at` + a
  `hosted_url` to a **local mock deposit page**. Persist the pending intent
  (`pi_id → userId, amountUsdc, maxPrice, expires_at, purpose`) exactly like the real path.
- Mock deposit page has two buttons that POST to `/webhooks/unifold` with a **stub envelope shaped
  like the real one** (`{ id, type, data:{ object:{ id: pi_id, status, metadata } } }`):
  - **"Confirm payment"** → `type:"payment_intent.succeeded"` → handler runs the real
    `chain-services.buy(pool_id, userId, maxPrice)` branch.
  - **"Simulate late/expired deposit"** → `type:"payment_intent.expired"` → the re-quote branch.
- Stub webhook route **skips signature verification** when `UNIFOLD_WEBHOOK_SECRET` is a stub
  sentinel (or a `X-Stub: 1` header is present) — so the exact same handler code path runs in both
  modes; only verification is bypassed.
- `payout` logs + returns `payout_id:"obt_stub_..."`, then (optionally) fires a stub
  `treasury.outbound_transfer.completed` so the sell flow closes end-to-end.

**Correlation is the load-bearing detail** (unchanged): our `deposit_intent_id` (= Unifold `pi.id`)
is the key. Store Unifold's `pi.id` on the pending row and key the webhook off `data.object.id`.
Only §10.5 / this file changes when the stub becomes real.

---

## 6. Diner-frontend (client SDK) — BUY UI

```tsx
import { UnifoldProvider, useUnifold } from '@unifold/connect-react';
import '@unifold/connect-react/styles.css';

// root:
<UnifoldProvider publishableKey={PK_TEST} config={{ appearance:'dark' }}>{app}</UnifoldProvider>

// buy handler: app-services POST /pools/:id/buy returns sdk_params.client_secret
const { beginCheckout } = useUnifold();
beginCheckout({ clientSecret });   // fixed-amount, quote-locked checkout modal
```
`onSuccess`/`onError` are **UI feedback only** — the token is minted from the
`payment_intent.succeeded` **webhook**, never from the client callback. (Frontend still talks only to
app-services REST + the Unifold modal; it never touches the chain.)

---

## 7. Still-open / confirmed-resolved from the real docs

Resolved by the real docs (no longer TODO):
- ✅ Locked-quote exact endpoints + request/response fields (§4).
- ✅ Exact webhook event names + payload envelope + signature scheme (§4 + §0.7).
- ✅ Payout on Solana = Treasury outbound transfer with `Idempotency-Key` (§4). (`beginWithdraw`
  rejected: client-signed, not custodial.)
- ✅ Testnet: use `*_test_` keys / test mode.
- ✅ User model: `external_user_id` = Auth0 `sub`.

Genuinely decide-at-build (both fine, gateway hides it):
- [ ] Base-USDC buy proceeds → Solana reserve: treasury-float (recommended, §2) vs. per-buy bridge.
- [ ] Solana USDC mint address + your project's Base/Solana treasury addresses (fill from Dashboard).
- [ ] Gas sponsorship flag — confirm in Dashboard config; not required for the stub demo.

---

## 8. app-services build checklist (Unifold slice)

- [ ] `UnifoldGateway implements PaymentGateway` (REST, `sk_` key) + `StubGateway` behind the same interface; select by env.
- [ ] `beginDeposit`: preview locked quote → commit intent (within 30s) → persist pending row → return `client_secret`.
- [ ] `payout`: outbound transfer with deterministic `Idempotency-Key`, Solana destination.
- [ ] `POST /webhooks/unifold`: raw-body signature verify (`v1,<hex>`, HMAC over `id.ts.rawBody`), 5-min skew, dedupe by `unifold-id`.
- [ ] Event switch mapping (§4 table); fulfill buy ONLY on `payment_intent.succeeded`; refund on `awaiting_refund`.
- [ ] Auth0 `sub` → `external_user_id` on every intent/transfer.
- [ ] Test keys only; secret key server-side; publishable key to frontend.
- [ ] Stub deposit page with Confirm / Expired buttons hitting the same webhook handler.
