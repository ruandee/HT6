# Website (stream 4 — `diner-frontend`)

The desktop diner experience. React consumer app: hero = live bonding-curve chart; buy / sell-back /
redeem flows; holdings. The **mobile app** (`mobile-diner`) is the same product, phone-native, on the
same REST surface.

**Boundary (LOCKED §8):** talks ONLY to app-services REST (import request/response types from
`@ttr/shared-types` §10.4) and the Unifold checkout modal. NEVER touches the chain.

**Buy UI:** `POST /pools/:id/buy` returns `checkout`, either `{ client_secret, publishable_key }`
(→ `beginCheckout()` from `@unifold/connect-react`) or `{ hosted_url }` (StubGateway mock page).
Use whichever is present. Token is minted from the webhook, NOT the client callback
(UNIFOLD_INTEGRATION.md §6).

**Wait-gate:** none. Build against a mock REST server typed by §10.4 (§8.1). Scaffold with Vite +
React when you start (`npm create vite@latest . -- --template react-ts`).
