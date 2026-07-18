# SETUP — prerequisites & how to supply secrets

Everything needed before (and during) the build. Ordered so you can start the parallel streams as
early as §8.1 allows. **The whole demo runs on the StubGateway + mock chain with NO external keys**
— the credentials below are only for swapping in the *real* Auth0 / Unifold / Solana paths.

---

## 0. TL;DR — what blocks what

| Prereq | Blocks | When you actually need it |
|---|---|---|
| Node 22+ / npm (✅ installed: Node 26, npm 11) | everything | now |
| `npm install` at repo root | all TS streams | now (wires workspaces) |
| **Phase 0 types** (✅ done, `@ttr/shared-types`) | all streams | done |
| Auth0 tenant | real login on REST | when you wire real auth (stub JWT works earlier) |
| Unifold `sk_`/`pk_` keys, treasury id, webhook secret | **real payments only** (SWAP B) | late — StubGateway covers the demo |
| Rust + Anchor + Solana CLI | **real contract only** (SWAP A) | late — MockChainAdapter covers the demo |
| Postgres (Docker ✅ installed) | §10.3 indexer | when chain-services persists the read model |

If a stream is waiting on anything NOT in this table, the interface is underspecified — flag it (§8.1).

---

## 1. Bootstrap (do this now)

```bash
npm install                 # installs workspaces + typescript at the root
npm run build               # builds every package that has a build script
npm run typecheck           # type-only check across all workspaces
```

All secrets are read from a local `.env` (gitignored). Copy the template and fill it in as keys arrive:

```bash
cp .env.example .env
```

`.env.example` is committed and lists every variable with a comment. **Never commit `.env`.**

---

## 2. How to give me the keys / treasury id / webhook secret  ← your question

**Short version: put them in `.env` yourself. Do NOT paste secret keys into the chat.**

`sk_...` (Unifold secret) and the Auth0 client secret are bearer credentials — anything that can read
them can move money / mint tokens as you. Chat transcripts are the wrong place for them. The clean flow:

### Recommended: you populate `.env`, I write code that reads `process.env`

1. You create the resources in the two dashboards (steps 3–4 below) and paste the values into your
   local `.env`.
2. I write all gateway/auth code to read them via `process.env.UNIFOLD_SECRET_KEY` etc. — I never see
   or hardcode the actual value. The code is testable with the stub, and "goes live" the moment your
   `.env` has real values and you flip `PAYMENT_GATEWAY=unifold`.

### What's safe to share in chat vs. keep to yourself

| Value | Prefix | Share in chat? | Why |
|---|---|---|---|
| Publishable key | `pk_test_` | ✅ fine | designed to ship in the browser bundle |
| Treasury account id | `ta_...` | ✅ fine | an identifier, not a credential |
| Treasury **address** | `0x…` / Solana addr | ✅ fine | a public on-chain address |
| Auth0 domain / client **id** / audience | — | ✅ fine | public config |
| **Secret key** | `sk_test_` / `sk_live_` | ❌ never | full API authority |
| **Webhook signing secret** | `whsec_...` | ❌ never | lets anyone forge settlement webhooks → fake "paid" |
| Auth0 **client secret** | — | ❌ never | full token-issuing authority |

So: if you want to hand me the non-secret ids (`pk_test_`, `ta_`, Auth0 domain/clientId/audience) in
chat so I can pre-fill the config, that's fine. The four ❌ rows go into `.env` by your hand only.

> Use **test-mode** keys (`pk_test_`/`sk_test_`) for the whole hackathon. If a real secret ever lands
> in a commit or the chat, rotate it in the Unifold/Auth0 dashboard immediately — assume it's burned.

---

## 3. Unifold — creating the treasury id & webhook secret

Prereq: an account + project at https://dashboard.unifold.io. Copy your **publishable** (`pk_test_`)
and **secret** (`sk_test_`) keys from the Dashboard → API keys. Put `sk_test_` in `.env` only.

### 3a. Treasury account (source of sell-back payouts) → gives you `UNIFOLD_TREASURY_ID`

One treasury account per chain type. We pay diners out in **Solana** USDC, so create a Solana treasury:

```bash
curl -sX POST https://api.unifold.io/v1/treasury/accounts \
  -H "Authorization: Bearer $UNIFOLD_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "chain_type": "solana" }'
# -> { "id": "ta_...", "address": "<fund THIS address with test USDC>", ... }
```
- `id` → `UNIFOLD_TREASURY_ID` in `.env`.
- `address` → the treasury's on-chain address; **fund it with test USDC** so payouts have balance.
- (Already exists? You'll get `409`; fetch it via `GET /v1/treasury/accounts`.)

### 3b. Webhook endpoint + signing secret → gives you `UNIFOLD_WEBHOOK_SECRET`

The webhook needs a **public HTTPS URL** pointing at app-services' `POST /webhooks/unifold`. Two ways:

- **Local dev:** expose your local server with a tunnel, then register that URL.
  ```bash
  # in one terminal, tunnel your local app-services port (e.g. 8080):
  npx ngrok http 8080        # -> https://<something>.ngrok-free.app
  ```
  Use `https://<tunnel>/webhooks/unifold` as the endpoint URL.
- **Dashboard (easiest):** Dashboard → Webhooks → create endpoint, paste the URL, subscribe to the
  events below, and copy the signing secret it shows once.

Or create it via API and read the returned secret:
```bash
curl -sX POST https://api.unifold.io/v1/webhook_endpoints \
  -H "Authorization: Bearer $UNIFOLD_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "app-services",
    "url": "https://<your-tunnel-or-host>/webhooks/unifold",
    "enabled_events": [
      "payment_intent.processing",
      "payment_intent.succeeded",
      "payment_intent.expired",
      "payment_intent.awaiting_refund",
      "payment_intent.refunded",
      "payment_intent.refund_failed",
      "treasury.outbound_transfer.completed",
      "treasury.outbound_transfer.failed"
    ]
  }'
# -> response includes the signing secret (whsec_...) — shown ONCE.
```
- The `whsec_...` → `UNIFOLD_WEBHOOK_SECRET` in `.env` (secret; your hand only).
- Lost it? `GET /v1/webhook_endpoints/{id}/secret` re-fetches it.
- These are the exact events our handler maps (UNIFOLD_INTEGRATION.md §4). Subscribe to all of them.

> None of 3a/3b is needed to demo: StubGateway fabricates the intent + webhook locally. Do this only
> for SWAP B (real payments).

---

## 4. Auth0 — identity

1. Create a tenant at https://auth0.com, then an **application** (Regular Web App or SPA) and an **API**
   (this gives you the `audience`).
2. From the app settings copy: **Domain**, **Client ID**, **Client Secret**, and the API **Identifier**
   (audience).
3. Fill `.env`: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` (shareable) and `AUTH0_CLIENT_SECRET`
   (secret — your hand only).
4. Seam (§10.5): app-services maps Auth0 `sub` → Unifold `external_user_id` on every intent/transfer.

Until this is wired, app-services can accept a stub/dev JWT so the other streams don't wait.

---

## 5. Solana / Anchor toolchain (contract stream only — SWAP A)

Not installed yet, and NOT required for any other stream (MockChainAdapter stands in). Install when you
build the real program:

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
# Anchor (via avm)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

solana config set --url devnet
solana-keygen new            # dev wallet
solana airdrop 2             # devnet SOL for deploys
```
On Windows, the smoothest path for the Solana toolchain is **WSL2** (Ubuntu) — native Windows Anchor
builds are finicky. Docker is an alternative.

Deliverable: deployed devnet program + IDL, or keep the spec-conformant mock. Match `pricing.ts`
bit-for-bit (buy rounds up, sell rounds down).

---

## 6. Postgres (chain-services read model — §10.3)

Docker is installed. Bring up a local Postgres when the indexer needs to persist:

```bash
docker run --name ttr-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=ttr \
  -p 5432:5432 -d postgres:16
# -> DATABASE_URL=postgres://postgres:dev@localhost:5432/ttr
```
Put `DATABASE_URL` in `.env`. Tables per §10.3 (`readmodel.ts` row types are the source of truth).
Remember: Postgres is a **read cache**, never authoritative over money.

---

## 7. Environment-variable reference

See `.env.example` (committed). Summary of who reads what:

| Var | Stream | Secret? |
|---|---|---|
| `PAYMENT_GATEWAY` (`stub`\|`unifold`) | app-services | no |
| `UNIFOLD_API_BASE` (`https://api.unifold.io/v1`) | app-services | no |
| `UNIFOLD_PUBLISHABLE_KEY` (`pk_test_`) | app-services → diner-frontend | no |
| `UNIFOLD_SECRET_KEY` (`sk_test_`) | app-services | **YES** |
| `UNIFOLD_TREASURY_ID` (`ta_`) | app-services | no |
| `UNIFOLD_WEBHOOK_SECRET` (`whsec_`) | app-services | **YES** |
| `AUTH0_DOMAIN` / `AUTH0_CLIENT_ID` / `AUTH0_AUDIENCE` | app-services + frontends | no |
| `AUTH0_CLIENT_SECRET` | app-services | **YES** |
| `DATABASE_URL` | chain-services | (local dev pw) |
| `SOLANA_RPC_URL` / `ANCHOR_WALLET` | chain-services (SWAP A) | wallet is **YES** |

---

## 8. Verify you're ready

- [ ] `npm install && npm run build && npm run typecheck` all pass.
- [ ] `.env` exists (copied from `.env.example`), is gitignored, and holds whatever keys you have.
- [ ] Demo path works with `PAYMENT_GATEWAY=stub` + MockChainAdapter — no external keys.
- [ ] (For real payments) `ta_` treasury funded with test USDC; webhook endpoint registered to a
      reachable HTTPS URL with all 8 events; `sk_`/`whsec_` in `.env`.
- [ ] (For real auth) Auth0 app + API created; domain/clientId/audience/secret in `.env`.
- [ ] No secret (`sk_`, `whsec_`, client secret, wallet key) is in git or the chat.
