# Tokenized Restaurant Reservations — AMM Build Spec

> Purpose of this file: a self-contained build spec for **Claude Code**, structured so the work
> splits across five independent streams (§8) that build in parallel behind shared interface
> contracts (§10). It captures the product model, the math, the stack, the constraints, and —
> critically — the **sequencing/wait-gates** (§8.1) that tell each stream what it can start
> immediately and what it must wait on.
> **Status: build-ready EXCEPT the Unifold payment integration (§10.5), which is stubbed behind
> a stable internal interface and reworked on-site once the API key + docs are in hand. Nothing
> outside §10.5 depends on Unifold internals — the stub lets all five streams build to completion.**

---

---

## 0. Stack at a glance

| Layer | Tech | Stream | Notes |
|---|---|---|---|
| Smart contract | **Solana + Anchor** (Rust) | contract | AMM bonding curve, reserve PDA, on-chain θ decay, fee routing. Devnet, or mock behind §10.2. Hits MLH Solana track. |
| Chain access | **TypeScript** Solana client (`@solana/web3.js` + Anchor IDL) + **mock-chain adapter** | chain-services | Only module that touches the chain. Ships mock FIRST so others don't block. |
| Indexer + read model | **TypeScript** event listener → **Postgres** | chain-services | Subscribes to program events, writes read-cache. UI never hits RPC directly. |
| Backend API | **Node + TypeScript** (Express/Fastify) | app-services | REST for both frontends; orchestrates buy/sell; owns auth + payments seams. |
| Identity | **Auth0** (email login, JWT) | app-services | `sub` = Unifold `externalUserId`. Hits MLH Auth0 track. |
| Payments | **Unifold** — locked-quote Payment Intents for buy (settle **Base USDC**, v1), **Treasury outbound transfers** for payout (Solana USDC OK), signed webhooks, test mode — **stubbed until API key; architecture REWORKED from real docs, see [UNIFOLD_INTEGRATION.md](UNIFOLD_INTEGRATION.md)** | app-services | Behind `PaymentGateway` (§10.5). Server side is REST (`sk_` key), no `@unifold/node`. StubGateway runs the full demo without the key. Hits Unifold track. |
| Diner app | **React** (+ charting lib for live curve) | diner-frontend | Talks only to app-services REST. Hero = live bonding-curve chart. |
| Restaurant app | **React** dashboard | restaurant-frontend | Create pool, monitor fill/reserve, check-in, sweep. |
| Shared | **TypeScript types package** (§10 contracts) | PHASE 0 (all) | Frozen interfaces every stream imports. Build this FIRST. |

**Money-authority rule:** the Solana program is the single source of truth for funds; Postgres
is only a read cache; frontends never touch the chain; app-services reaches the chain only via
chain-services. **Language:** TypeScript everywhere except the Anchor program (Rust).
**Prize tracks touched:** Solana, Auth0, Unifold, Base44 (consumer-product framing).

---

## 1. One-paragraph summary

A marketplace where a restaurant tokenizes a fixed pool of interchangeable prime reservation
slots (one pool per venue + service window) and sells/prices them through an automated market
maker (bonding curve). Buyers purchase a table; holders who can't attend sell the token back
to the curve (always-liquid, the contract is the counterparty). The restaurant is a
**cooperative issuer**: it earns a royalty on every resale and converts no-shows from pure
loss into fee income. Payments settle in stablecoin with the wallet abstracted away so
everyday diners never touch gas or Metamask.

## 2. Target customer (locked)

**Buzzy mid-tier / aspirational-casual restaurants** — hard enough to book that genuine
resale demand exists (feeds the AMM), covers valuable enough that recovered no-shows matter
(feeds the royalty pitch), but NOT tasting-menu tier (those already solved no-shows with
prepaid ticketing — problem already captured). Casual spots were rejected: highest no-show
RATE but no real scarcity, so the curve would have nothing to price.

## 3. What the token represents (locked — hybrid model)

- Token = a **market-priced access right** to a scarce table, with a **floor** equal to a
  prepaid **meal credit** (e.g. $40, redeemable against the diner's bill).
- Floor from the credit; upside above floor from the scarcity premium set by the curve.
- Softens the "isn't this scalping?" objection: most of what a buyer pays is real prepaid
  dinner, and the royalty means the RESTAURANT (not a scalper) captures the premium.

## 4. The AMM / bonding-curve math (locked)

Scope: ONE pool = one venue + one service window + one **party-size band** (e.g. Friday 7–9pm,
tables seating up to 2), N interchangeable prime slots. **Fungibility within a pool is
mandatory** — one fungible token type per (venue, service-window, party-size), fixed supply N.
Different nights = different pools = different curves; so are different party sizes (§4a).
The moment users pick a *specific* table, fungibility breaks and the single-curve AMM is
invalid (would require per-slot NFTs — do NOT do this).

Let `n` = slots currently sold (0 ≤ n ≤ N). Linear curve (clean to demo/defend):

```
p(n) = p0 + k * n
```

Example params: p0 = $40 (meal-credit floor), k = $3, N = 20.
- First table: $40. Tenth: 40 + 3*9 = $67. Last: 40 + 3*19 = $97.
- (Optional exponential variant p0*(1+r)^n if you want the last tables to spike harder;
  linear preferred for the demo.)

**Buy** (n → n+1): buyer pays `p(n)` in stablecoin → reserve; one token minted.
**Sell-back** (n → n−1): contract pays `p(n−1)` from reserve; token burned. Curve is always
the counterparty ⇒ always liquid. This is the whole reason to use an AMM over peer listings.

**Solvency invariant (say this on stage):**
```
Reserve = Σ_{i=0}^{n-1} p(i)   (area under the curve up to n)
```
Every buy adds exactly p(n); every sell-back removes exactly p(n−1). The contract can ALWAYS
honor a sell-back — insolvency is mathematically impossible. Full 20-slot pool locks
Σ(40+3n), n=0..19 = **$1,370**.

**Restaurant royalty = buy/sell spread.** Buyers pay `p(n)`; sellers-back receive
`p(n) * (1 − φ)` with φ ≈ 5%. Every round-trip leaves 5% in the contract, routed to the
restaurant wallet. This is what makes the issuer COOPERATIVE (wants a liquid resale market).

**Redemption:** holder shows up → token burns → their stablecoin stays in reserve; after
service, restaurant sweeps reserve for consumed/forfeited slots (meal-credit floor applied
to bill). Trading disabled at service time — this is where THETA DECAY will live (resale
value should bleed toward the floor as the window approaches). Hook is already here.

## 4a. Table sizes / party size (LOCKED)

**Problem:** a 2-top and a 6-top are NOT interchangeable, so they cannot share a curve without
breaking the fungibility rule §4 rests on. But per-table pricing would mean per-slot NFTs, which
§4 forbids.

**Decision — one pool per party-size BAND** (not per table):
```
pool = (venue, service_window, party_size)
Fri 7–9pm · seats ≤2  → N=20, p0=$40, k=$3
Fri 7–9pm · seats ≤4  → N=8,  p0=$80, k=$6
```
**Shipped scope: exactly these TWO bands (2-top and 4-top).** The model generalizes to any number
of bands — a 6-top would just be another row — but the demo offers two, which is enough to prove
bands work without adding a dimension the 2-minute pitch has to explain.
Each band is internally fungible (any 4-top is like any other 4-top), so each gets its own honest
curve. **This needs ZERO new math** — it is the existing model instantiated once per band. It is
also economically better: a 6-top on a Friday is genuinely scarcer than a 2-top and deserves its
own (steeper) curve.

**Pricing across bands:** p0 scales ≈ $20/head (the meal credit is per person), and k scales with
it. The premium is whatever that band's curve discovers.

**"A 4-top seats UP TO 4."** The token means *"a table seating up to N"*. A party of 3 books the
4-top band — the smallest band that fits. This is how restaurants already work and avoids any
per-headcount pricing. Booking a band LARGER than your party is disallowed (it lets someone corner
the scarcest inventory); allowing a book-up when every fitting band is sold out is a UI rule, not
a math change.

**"You can push tables together."** Deliberately NOT modelled at trade time. Combining two 2-tops
into a 4-top makes inventory elastic, and a fixed N is exactly what makes the solvency invariant
(`reserve = area under the curve`) provable — if N could change mid-window the reserve math goes
murky and we lose the cleanest claim in the pitch. Real restaurants solve this with a floor
manager, not a pricing engine. So: the restaurant decides its room configuration when it CREATES
the pools (setting n_max per band). Want to sell 8 four-tops by combining? Set the 4-top pool to
N=8 and the 2-top pool lower. The combining decision is a human judgment call at pool-creation
time, never a trade-time one.

**One table per diner per SERVICE WINDOW** (§7c-C) spans every band, so you cannot hold a 2-top
and a 4-top for the same night (that straddle is a cheap option on the night selling out, and it
withholds a table). Holding a 2-top on Friday and a 4-top on Saturday IS fine — different nights.
To switch party size for a night you already hold, sell that table back first.

**Demo guidance:** seed a few bands so the model visibly generalizes and label them in the UI
("Fri 7–9pm · table for 2"), but drive the §11 script on ONE band. Party size is a second
dimension to explain and the 2-minute pitch does not need it; have this section ready if a judge
asks.

## 5. Backend stack (locked), mapped to the math

Guiding principle: put TRUST-CRITICAL state on-chain, abstract the wallet away so accessibility
(the everyday-diner UX) survives.

- **On-chain layer — Solana** (cheap, fast; also hits MLH Solana track). Holds the parts that
  must be trustless: fungible token mint per pool, bonding-curve `buy()/sell()/redeem()`
  program, stablecoin reserve, fee routing, redemption/expiry. The curve functions in §4 ARE
  the smart contract. Solvency invariant enforced by the program holding the reserve.
- **Payment / accessibility layer — Unifold SDK** (genuine fit, not a bolt-on). Frictionless
  stablecoin deposits; embedded/email-login wallet; diner never touches Metamask/gas. This is
  the wallet-cliff remover that preserves the everyday-person UX.
- **Backend service (Node or Python)** — orchestration + speed. Venue onboarding + pool
  creation (mint new token type per service window). Runs an **event indexer** listening to
  on-chain buy/sell/redeem events → writes to Postgres. UI never hits an RPC node to render a
  price; the indexer is the fast cache + is what makes the demo feel real-time.
- **Postgres** — fast read-model (NOT authoritative over money; chain is). Holds venues,
  pools, current supply per pool, price-history time series (powers the live curve chart),
  user holdings, redemption/check-in status.
- **Frontend (React)** — where the project is won (design is a scored criterion; core is clean
  so polish differentiates). Hero screen = live bonding curve for a pool: price climbing as
  tables sell, big "buy this table" button at current spot price, "can't make it? sell it
  back" button showing current recover value. Price ticking up as slots sell during the demo
  is the flashy payoff, driven by the indexer feeding on-chain state.

## 6. Prize-track fit (stackable, none forced)

- **Unifold** — stablecoin settlement rail is central (depth-of-integration scores itself).
- **MLH Best Use of Solana** — the tokenization + AMM program.
- **MLH Best Use of Auth0** — email/identity login; justified because auth is needed anyway.
- **Base44** — framed as a launchable consumer product (execution-focused).

**On-chain arithmetic note:** θ is fractional and Solana programs use integer math. Represent
θ in fixed-point basis points (θ_bps ∈ [0, 10000]) and compute
`premium = k·n·θ_bps / 10000` with u64/u128 to avoid overflow. All money in USDC base units
(6 decimals). The contract agent must handle rounding direction consistently (round buy price
UP, sell payout DOWN — never let rounding make the reserve pay out more than it holds).

## 7. Hard constraints / coherence checks (do not violate)

- Single-curve math is honest ONLY because slots are fungible WITHIN a pool. No specific-table
  selection. One pool of interchangeable prime slots per demo.
- Demo one buzzy, sells-out venue; prime weekend slots. Never demo a sleepy Tuesday — the
  point is showing the curve MOVE under real scarcity.
- Chain is authoritative over money; Postgres is only a read cache.

## 7b. Theta-decay model (locked)

Two orthogonal forces on token value:
- **Scarcity** — `p(n)` rises with slots sold (how many remain).
- **Decay** — value bleeds toward the floor as SERVICE TIME approaches (how much time is
  left), independent of pool fullness.

**Only the premium decays, never the floor** (the meal credit is redeemable at face right up
to service). Decompose:
```
price   = floor + premium
premium = p(n) − floor = k·n
fair_value(n, t) = floor + k·n·θ(t)
```
θ(t) runs 1 (far out) → 0 (service time). At service, token = floor (just the meal credit).

**Shape of θ (LOCKED to piecewise, because decay is ON-CHAIN):** convex power-law is
impractical to compute inside a Solana program, so use the cheap piecewise form the program
can compute from block time:
```
θ(τ) = 1                     for τ ≥ Tc          (Tc = cliff, e.g. 24h before service)
θ(τ) = τ / Tc                for 0 ≤ τ < Tc      (linear bleed to 0 across final Tc)
θ(τ) = 0                     for τ ≤ 0           (service reached; trading halted)
```
τ = service_time − block_time. Program stores service_time and Tc per pool; computes θ per
trade. (Design note: piecewise still gives the "holds then collapses" story; the convex
power-law was a nicety, not a requirement. Keep this simple form on-chain.)

**Composition with the AMM (decay feeds back into contract prices):**
```
buy_price(n, t)  = floor + k·n·θ(t)
sell_price(n, t) = floor + k·(n−1)·θ(t)·(1 − φ)
```
The premium component of the whole curve scales down over time: full steep curve far out,
flattening toward a horizontal line at the floor near service. **Demo moment:** show the
bonding curve FLATTENING as the clock advances.

**Solvency under decay:** decay only ever REDUCES what sell-backs pay relative to what was
paid in, so the reserve stays over-collateralized — **decay makes the contract strictly more
solvent, never less.** The accumulated surplus (bought high on premium, sold back low after
decay) is effectively extra restaurant revenue.

**Trading disable:** trading halts at service time (θ→0 boundary); redemption/sweep as in §4.

## 7c. Resolved edge cases (LOCKED — both agents depend on these)

### (A) Stale-price / slippage on the async buy path
Problem: the buy flow is asynchronous (tap → deposit → webhook → on-chain `buy`), so the price
can move between the quote the diner saw and settlement (someone else buys first, or θ ticks).
The contract must not silently charge a different price than the diner agreed to.

Decision — **quote-lock with slippage bound, enforced on-chain:**
- When the diner taps buy, app-services calls `quote(pool_id)` and shows `buy_price`. It then
  calls `beginDeposit` for that exact amount and passes a **`max_price`** (= quoted buy_price)
  and an **expiry** (short, e.g. 90s) into the pending intent.
- On webhook settlement, app-services calls `chain-services.buy(pool_id, user_id, max_price)`.
  The program recomputes the CURRENT `buy_price` and:
  - if `current_buy_price <= max_price` → execute; if the diner deposited more than the current
    price (price fell), **refund the difference** to their balance (or credit it).
  - if `current_buy_price > max_price` (price rose past the bound) → **reject the buy**; the
    deposited USDC is returned via `payout` (a "failed buy" refund). Diner is told price moved;
    they can re-quote.
- `buy()` therefore takes `max_price` as a required arg (update §10.2 signature accordingly).
- On the mock/stub this is fully testable: chain-services mock honors `max_price` the same way.
> §10.5 real-docs note (contract/chain-services unaffected — informational): the on-chain
> `buy(max_price)` logic above is exactly right and does NOT change. Two seam-side details live
> only in app-services: (1) the deposited buy funds arrive as **Base USDC** (v1 Unifold settles to
> Base only), so a "failed buy" refund is a Treasury outbound transfer of the Base proceeds — the
> gateway's `payout` handles it; the program never sees Base. (2) The webhook that triggers
> `chain-services.buy(...)` is `payment_intent.succeeded`, and the "diner deposited more, price
> fell" refund-the-difference case is likewise an app-services `payout`, not an on-chain refund.
> See [UNIFOLD_INTEGRATION.md](UNIFOLD_INTEGRATION.md) §2, §4.
Rationale: never charge above what the diner agreed; the reserve solvency invariant is preserved
because the program only ever executes at the real current curve price.

### (B) Sweep accounting — consumed vs. forfeited vs. still-held
At/after service_time the pool freezes; `sweep` settles the reserve. Every outstanding token is
in exactly one terminal state; the reserve is partitioned accordingly:
- **CONSUMED** (diner checked in → `redeem` fired): their paid USDC stays in reserve and is
  swept to the restaurant, BUT the meal-credit floor (`p0`) is applied to their bill off-chain
  (the restaurant honors it at the table). Net to restaurant on-chain = full amount paid; net
  economic = amount paid − p0 credit given. (For the demo, on-chain sweep = amount paid; the
  p0 credit is a real-world settlement the dashboard displays as "credits to honor".)
- **FORFEITED** (no-show, never checked in, never sold back): token never redeemed; their paid
  USDC is swept to the restaurant in full (this is the no-show recovery — the whole point).
- **STILL-HELD but never used / never sold** collapses into FORFEITED at freeze (holding a
  token you didn't redeem = you paid and didn't show).
- **SOLD-BACK before freeze**: already settled at sell time (USDC left reserve to the seller,
  φ royalty retained). Not part of sweep.
Invariant to assert in `sweep`: `reserve_balance == Σ paid_by_currently_outstanding_tokens`
(everything sold-back already left). Sweep transfers that balance to `authority` and marks the
pool settled. The dashboard breaks it down as: consumed count, forfeited (recovered no-show)
count, total swept, and "meal credits to honor" (= p0 × consumed count).
Rationale: makes the no-show-recovery number explicit and honest, and keeps the p0 floor as a
real-world credit rather than pretending the chain refunds it.

### (C) One table per diner per SERVICE WINDOW (LOCKED)
`buy` MUST reject if the buyer already holds a token for **any pool sharing that (venue,
service_window)** — i.e. across every party-size band (§4a), not just the pool being bought.
Enforced ON-CHAIN (the authoritative layer; the program groups by `authority` + `service_time`),
mirrored in app-services (pre-checked BEFORE taking money — the buy path is async, so checking
only at settlement would mean the diner already paid) and in the UI.

Rationale, in two steps:
1. **Why any cap at all.** The φ spread already makes an instant round-trip unprofitable, so
   multi-buy is not free money by itself. The real exploit is **time-based**: buy several tables
   early while a night is half-empty, then sell into the sold-out premium later. Net of φ that is
   still a solid profit, and those tables were withheld from diners who wanted them — scalping,
   just against a curve.
2. **Why per-WINDOW and not per-pool.** A per-pool cap leaves the **cross-band straddle** open:
   hold a 2-top *and* a 4-top for the same night, then sell back whichever leg the curve favours.
   That is not arbitrage — the spread makes it a loss on average — but it is a **cheap option on
   the night selling out** (pay ~$10 of spread for a shot at ~$12+ if the band fills), and either
   way it withholds a table from a real diner. On the scarce band (the 4-top, N=8) one straddler
   removes an eighth of the inventory. Scaling it — one table in every band on every night —
   corners a slice of everything. So the rule is simply: **one table per person per night.**

Edge cases (all LOCKED):
- **Sell-back frees a rebuy** — the token went back to the curve; that is the liquidity feature
  working as intended. It is also how a diner legitimately SWITCHES party size: sell the 2-top,
  buy the 4-top.
- **Check-in does NOT free a rebuy** — once you have taken that night's table, that is your table.
  (So the check counts redeemed tokens too.)
- **Different nights are unrestricted** (legitimate demand), as are **different venues** in the
  same window.
- **Accepted cost:** a genuine party of 6 cannot book two 4-tops themselves — they should call the
  restaurant, which is what happens today. §4a already declines to model table-combining for the
  same reason.
- **Residual, not closed:** multiple accounts. That is the identity problem every ticketing system
  has; Auth0 email verification raises the cost, payment identity would raise it further.

## 7d. Suggested demo parameters (so the curve visibly MOVES on stage)
p0 = 40 USDC, k = 3 USDC, N = 20, φ = 500 bps (5%), Tc = 86400s (24h).
Seed the pool partway (e.g. n=6) so the first on-stage buy is already at a premium; do 2–3 live
buys to show price climbing, one sell-back to show it fall + royalty accrue, then fast-forward
the clock (mock block_time) toward service to show the curve flatten (θ decay). See §11 demo script.

---

# 8. Agent work split (FIVE streams)

All five agents coordinate through the interface contracts in §10. That shared section is the
source of truth — an agent changing any signature there must flag it, because others depend on it.

1. **contract** — Solana/Anchor program: pool state, `buy` / `sell` / `redeem` / `create_pool`
   / `check_in` / `sweep`, reserve PDA, fee routing, on-chain θ from block time. Owns §4 + §7b
   math. Deliverable: deployed program (devnet) + IDL, OR a spec-conformant mock (see §10.2).
2. **chain-services** — Solana client wrapper + **mock-chain adapter** (same interface, so
   others build before the program is ready) + **event indexer** (subscribes to program
   events → Postgres) + AMM read model (current n, spot price, price history). Owns §10.2, §10.3.
3. **app-services** — Auth0 (identity) + Unifold (money, PROVISIONAL — see §10.5) + the REST
   API the diner frontend calls (§10.4). Maps Auth0 `sub` → user's Unifold externalUserId →
   app-managed token holdings. Owns §10.4, §10.5.
4. **diner-frontend** — React consumer app: live bonding curve (hero), buy / sell-back / redeem
   flows, holdings view. Talks ONLY to app-services REST (never the chain directly). Owns §10.4 client.
5. **restaurant-frontend** — React issuer dashboard: create pool (set p0, k, N, φ, service_time,
   Tc, party_size — one pool per band, §4a), monitor pool fill + reserve, trigger check-in per
   diner, sweep reserve after service.
   Talks ONLY to app-services REST. Owns §10.4 issuer client.

Boundary rule (LOCKED): frontends never touch the chain; app-services never talks to the chain
directly (goes through chain-services); chain-services is the ONLY thing importing the Solana
client / mock adapter. This keeps money-authority on-chain and keeps seams clean.

## 8.1 Sequencing & wait-gates (READ THIS BEFORE STARTING ANY STREAM)

The build is designed so **four of five streams start at T0 in parallel** by building against
mocks/stubs, not against finished dependencies. The ONLY hard blocker in the system is the
Unifold API key (isolated to §10.5). Follow the phases below.

**PHASE 0 — shared scaffolding (do FIRST, once, before splitting).**
Stand up the shared types package that every stream imports: the §10.2 adapter interface, the
§10.3 event/table types, and the §10.4 REST request/response types. Freeze these signatures.
This is the contract that lets everyone build in parallel — until it exists, DO NOT split.

**PHASE 1 — parallel build against mocks (all five streams start here, T0):**

| Stream | Starts at T0 against… | Hard-waits on | Can fully finish? |
|---|---|---|---|
| contract | nothing — owns the math | — | YES (independent) |
| chain-services | its OWN mock adapter (§10.2) | — | YES — ship mock first, real Solana client second |
| app-services | chain-services mock + Unifold **StubGateway** (§10.5) | Unifold API key (ONLY for real gateway) | YES on everything except real payments |
| diner-frontend | app-services REST (mockable via §10.4 types) | — | YES (against mock REST) |
| restaurant-frontend | app-services REST (issuer routes) | — | YES (against mock REST) |

Key point for Claude Code: **the mock-chain adapter (§10.2) and StubGateway (§10.5) are
first-class deliverables, not throwaways.** chain-services builds the mock adapter BEFORE the
real Solana program is ready; app-services builds against StubGateway BEFORE the Unifold key
arrives. Nobody blocks.

**PHASE 2 — integration swaps (each is a local, isolated replacement):**
- SWAP A: chain-services replaces its mock adapter internals with the real Solana client + IDL
  once `contract` deploys to devnet. Callers (app-services) change NOTHING — same interface.
- SWAP B: app-services replaces StubGateway with the real Unifold impl once the API key + docs
  arrive. Callers (REST routes, frontends) change NOTHING — same PaymentGateway interface.
- These two swaps are INDEPENDENT and can happen in either order / by different agents.

**Wait-gate summary (the only real dependencies):**
1. Everyone waits on PHASE 0 shared types. (Minutes, do it first.)
2. app-services' REAL payment path waits on the Unifold API key. Everything else in
   app-services (auth, REST, chain calls, buy/sell orchestration against the stub) does NOT wait.
3. chain-services' REAL chain path waits on `contract` devnet deploy. The mock path does NOT wait.

Nothing else blocks. If a stream finds itself waiting on something not in this list, the
interface in §10 is underspecified — flag it rather than guessing.

---

# 10. Interface contracts (the coordination surface)

> LOCKED unless marked. **§10.5 (Unifold) is PROVISIONAL — rework at hackathon once real docs
> are available at docs.unifold.io.** Everything is written so the Unifold piece is swappable
> behind a stable internal interface (see §10.5) — the rest of the system should NOT need to
> change when the real Unifold API lands.

## 10.1 On-chain pool state (owned by `contract`)
```
Pool {
  authority:      Pubkey      // restaurant wallet (receives royalties, can check_in/sweep)
  mint:           Pubkey      // fungible SPL token for this pool
  reserve:        Pubkey      // PDA holding USDC reserve
  p0:             u64         // floor, USDC base units (e.g. 40_000000)
  k:              u64         // slope per slot, USDC base units (e.g. 3_000000)
  n_sold:         u64         // current supply outstanding (0..N)
  n_max:          u64         // N
  phi_bps:        u16         // royalty spread, basis points (e.g. 500 = 5%)
  service_time:   i64         // unix ts of service window
  tc_seconds:     i64         // decay cliff length (e.g. 86400)
  frozen:         bool        // true once service reached / trading halted
  party_size:     u8          // seats UP TO this many (§4a); pool = (venue, window, party_size)
}
```

## 10.2 Program instructions = mock-chain adapter interface (owned by `contract`; mirrored by `chain-services`)
`chain-services` MUST expose a TS interface with these exact methods so diner/app agents build
against the mock, then swap to the real program with no caller changes:
```
create_pool(authority, p0, k, n_max, phi_bps, service_time, tc_seconds, party_size) -> { pool_id, mint }
quote(pool_id) -> { n_sold, n_max, theta_bps, buy_price, sell_price, frozen }   // read-only
buy(pool_id, buyer_user_id, max_price)  -> { tx_sig, status:'filled'|'rejected_slippage', price_paid?, refund? }
                                          // n -> n+1 if current buy_price <= max_price; else reject+refund (§7c-A)
                                          // MUST also reject if buyer holds a token in ANY pool sharing
                                          // this (authority, service_time) — all bands (§7c-C)
sell(pool_id, seller_user_id)-> { tx_sig, payout }                              // n -> n-1
redeem(pool_id, user_id)     -> { tx_sig }              // burn on check-in; stablecoin stays in reserve
check_in(pool_id, user_id, restaurant_authority) -> { tx_sig }   // issuer marks diner arrived -> triggers redeem
sweep(pool_id, restaurant_authority) -> { tx_sig, amount_swept, consumed_count, forfeited_count, credits_to_honor }  // §7c-B
```
Pricing math (all agents assume this; contract enforces it):
```
theta_bps = 10000                       if τ >= Tc
          = floor(10000 * τ / Tc)        if 0 <= τ < Tc     (τ = service_time - now)
          = 0                            if τ <= 0
buy_price  = p0 + ceil(k * n_sold * theta_bps / 10000)
sell_price = p0 + floor(k * (n_sold-1) * theta_bps / 10000) ; payout = sell_price*(10000-phi_bps)/10000
```

## 10.3 Indexer event schema + Postgres (owned by `chain-services`)
Program emits events on each state change; indexer writes them. Postgres tables (read-model only):
```
venues(id, name, auth0_org, created_at)
pools(id, venue_id, mint, p0, k, n_max, phi_bps, service_time, tc_seconds, party_size, frozen, created_at)
pool_state(pool_id PK, n_sold, last_buy_price, last_sell_price, theta_bps, reserve_balance, updated_at)
price_history(id, pool_id, ts, n_sold, spot_price, theta_bps, event_type)   // powers the live chart
holdings(id, user_id, pool_id, token_amount, status[held|redeemed|sold], acquired_at)
events_raw(id, tx_sig, pool_id, kind[create|buy|sell|redeem|checkin|sweep], payload_json, block_time)
```

## 10.4 REST API (owned by `app-services`; consumed by both frontends)
Auth: Bearer JWT from Auth0 on every call; `restaurant-*` routes require issuer role.
```
GET  /pools                       -> [pool summary]   // incl. party_size; one entry per (night, band) §4a
GET  /pools/:id                   -> pool detail + current quote (proxies chain-services.quote)
GET  /pools/:id/history?since=    -> price_history rows (for the curve chart)
POST /pools/:id/buy               -> { deposit_intent_id, max_price, expires_at, checkout }   // §7c-A quote-lock; see §10.5 buy flow
                                  //   checkout = { client_secret, publishable_key } for beginCheckout() (real gateway),
                                  //   or { hosted_url } for the StubGateway mock deposit page. Diner-frontend uses whichever is present.
POST /pools/:id/sell              -> { payout_intent }    // see §10.5 sell flow (payout = Treasury outbound transfer)
GET  /me/holdings                 -> holdings for Auth0 user
POST /me/redeem  {pool_id}        -> triggers redeem (or restaurant-side check_in)

// issuer (restaurant-frontend):
POST /restaurant/pools            -> create_pool passthrough (one call per party-size band, §4a)
GET  /restaurant/pools/:id        -> fill %, reserve, holders, royalties accrued
POST /restaurant/pools/:id/checkin {user_id}
POST /restaurant/pools/:id/sweep
```

## 10.5 Unifold boundary — owned by `app-services`. **REWORKED FROM REAL DOCS → [UNIFOLD_INTEGRATION.md](UNIFOLD_INTEGRATION.md) is AUTHORITATIVE.** Real impl swaps in behind the stable `PaymentGateway` interface (unchanged).

> ⚠️ The prose below this line is the earlier provisional pass, kept for context. Where it
> disagrees with [UNIFOLD_INTEGRATION.md](UNIFOLD_INTEGRATION.md), that file wins. Corrections the
> real docs forced (all confined to this section + the app-services impl — no other stream's
> contract changes): **no `@unifold/node` SDK** (server = REST + `sk_` key); locked-quote is a
> two-step preview(`lqq_`, ~30s)→commit flow; **v1 settles to Base USDC only** (buy funds don't
> land on the Solana reserve — see UNIFOLD_INTEGRATION.md §2); buy collected via
> `beginCheckout({client_secret})` not `beginDeposit`; **payout = Treasury outbound transfer**
> (`Idempotency-Key` required, Solana destination allowed) not `beginWithdraw`; webhook events =
> `payment_intent.{processing,succeeded,expired,awaiting_refund,refunded,refund_failed}` +
> `treasury.outbound_transfer.{completed,failed}`; sig `unifold-signature: v1,<hex>` = HMAC-SHA256
> over `id.timestamp.rawBody`. The `PaymentGateway` interface and every §10.4 route are unchanged.

> IMPORTANT CORRECTION: the core primitive is **Payment Intents**, NOT `beginDeposit`. The
> marketing-page guess was wrong on naming. The concepts map cleanly though — see below. When
> `llms-full.txt` / `skill.md` arrive, fill in exact params/fields; the internal interface and
> everything outside this section stay put.

**Confirmed model from docs index:**
- **Payment Intent (the BUY primitive):** create a payment intent → it generates per-user deposit
  addresses → user deposits any supported crypto → auto-bridged to recipient on destination chain
  → intent marked **`succeeded`** when destination amount hits target. This IS our buy funding.
  Endpoints exist: create, get, list, cancel, refund. ~~Node server SDK `@unifold/node`~~ →
  CORRECTION: there is no `@unifold/node`; the server calls these REST endpoints directly with an
  `sk_` key. Also v1 settles to **Base USDC only** (see UNIFOLD_INTEGRATION.md §2).
- **Locked-quote Payment Intent (USE THIS — it natively implements our §7c-A quote-lock!):**
  "locks an exchange rate for a fixed window." Locked-quote intents are **not cancelable — they
  auto-expire and use the refund endpoint** if a deposit lands after the window. This aligns
  exactly with our slippage design: lock the quoted `buy_price` for a short window; if the deposit
  arrives in-window → execute; if it arrives after expiry → the refund endpoint returns funds.
  There are also locked-quote limits (min/max USD) and supported-source-tokens endpoints.
- **Payout primitive → CORRECTION: use Treasury outbound transfers, NOT `beginWithdraw`.**
  `beginWithdraw()` is a client-signed flow (the app holds keys) — wrong for our custodial model.
  Payout = `POST /v1/treasury/outbound_transfers` with required `Idempotency-Key`, delivering USDC
  to the diner's **Solana** address (`chain_type:"solana"`, `chain_id:"mainnet"`). (The "Points
  Balance Platform" / deposit-as-stablecoin recipes,
  deposit-as-stablecoin + withdraw-as-crypto, are almost exactly our pattern — READ THOSE FIRST.)
- **Webhooks (CONFIRMED, with signatures):** webhook endpoints have **signing secrets**; verify
  via the "Verify Webhook Signatures" guide + Node `Webhook Verification` helper. Relevant event
  groups: **payment-intent events** (buy settlement), **withdraw / treasury events** (payout).
- **Testnet mode CONFIRMED** ("Testnet Support" page) — resolves the devnet question. Use testnet.
- **User model CONFIRMED:** project users filterable by `external_user_id` → our Auth0 `sub` maps
  to Unifold `external_user_id` (seam holds). "List users" endpoint exists.
- **Frontend:** `@unifold/connect-react` — `UnifoldProvider`, Checkout flow (fixed-amount crypto
  payment = our buy UI), Withdraw flow, and a **headless** option (`useDeposit`, build-your-own UI)
  if we want the curve/checkout fully custom. Gas sponsorship referenced on marketing site (confirm
  flag vs automatic in full docs).

**Internal interface to code against NOW (stable; real impl maps onto Payment Intents / Withdraw):**
```
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
```
Mapping to real Unifold (fill exact fields from llms-full.txt):
- `beginDeposit` → create-locked-quote-payment-intent (amount = quoted buy_price, locked window).
- webhook `payment_intent.succeeded` → `DepositSettled{status:'succeeded'}` → call
  `chain-services.buy(pool_id, userId, maxPrice)`. Deposit after window → intent expires →
  refund endpoint → `DepositSettled{status:'expired'}` → tell diner price/window lapsed, re-quote.
- `payout` → withdraw flow (Solana callback) or treasury outbound transfer (with Idempotency-Key).

**StubGateway (BUILD THIS NOW — first-class deliverable; full demo runs before the key arrives):**
- `beginDeposit` returns a fake `deposit_intent_id` + `quote_expires_at` and a `hosted_url` to a
  local mock deposit page. Persist intent (id → userId, amountUsdc, maxPrice, expires_at, purpose).
- Mock deposit page "Confirm payment" button POSTs to `/webhooks/unifold` with the intent_id,
  simulating `payment_intent.succeeded`. Full buy flow demoable on the stub, including the
  in-window vs expired branch (let the mock page also simulate a late/expired deposit).
- `payout` logs + returns a fake `payout_id`, marks success.
- **Correlation = the load-bearing detail:** our `deposit_intent_id` is the correlation key. Real
  Unifold payment intents have their own IDs; store Unifold's intent id alongside ours in the
  pending-intent table and key the webhook off it. Either way ONLY this section changes.

**Buy flow (LOCKED except Unifold internals; real mapping → UNIFOLD_INTEGRATION.md §4):** diner taps
buy → app-services `quote()` → previews a locked quote (`lqq_`, ~30s) and commits it into a
locked-quote payment intent for `buy_price` → returns `client_secret` → diner-frontend runs
`beginCheckout({client_secret})` and deposits (gas sponsorship: confirm in Dashboard, not required
for demo) → `payment_intent.succeeded` webhook (signature-verified) → app-services calls
`chain-services.buy(pool_id, userId, maxPrice)` → token to app-managed holding → holdings updated.
Late deposit after expiry → `payment_intent.expired` → (deposit lands) `awaiting_refund` →
app-services calls the refund endpoint → `refunded` → diner re-quotes.
**Sell flow:** diner taps sell → app-services calls `chain-services.sell` → USDC returns to reserve
→ app-services `payout(userId, sell_price_net)` via **Treasury outbound transfer** (Solana USDC
destination, `Idempotency-Key`) → `treasury.outbound_transfer.completed` webhook → holdings updated.
**Auth0↔Unifold seam:** Auth0 `sub` = Unifold `external_user_id`. Map in app-services.

**RESOLVED from real docs** (`.claude/skills/unifold/{SKILL.md,llms-full.txt}`; details in
[UNIFOLD_INTEGRATION.md](UNIFOLD_INTEGRATION.md)): payment-intent & locked-quote request/response
fields ✅; webhook payload shape + exact event names ✅; payout on Solana = **Treasury outbound
transfer** (not withdraw) ✅; test mode via `*_test_` keys ✅; `external_user_id` = Auth0 `sub` ✅.
**Still decide-at-build (both fine, gateway hides it — do NOT block):** Base-USDC buy proceeds →
Solana reserve (treasury-float vs per-buy bridge); gas-sponsorship flag (Dashboard config); your
project's Base/Solana treasury addresses + Solana USDC mint.

## 10.6 Assumptions (override at build if wrong)
- Custodial / app-managed holdings (no diner Phantom wallet). CONFIRMED.
- Stablecoin = devnet USDC (6 decimals). Chain = devnet OR mock behind §10.2 adapter. CONFIRMED.
- One fungible token type per (venue, service_window, party_size). Pools independent. LOCKED (§4/§4a/§7).
- Party size handled as BANDS ("seats up to N"), one pool each; table-combining is a
  pool-creation decision, never trade-time. LOCKED (§4a).
- One table per diner per (venue, service_window) — across all bands — enforced on-chain.
  LOCKED (§7c-C).
- Check-in = restaurant staff action in dashboard (no geofencing). CONFIRMED.
- Auth beyond email login (Auth0) not required for demo. CONFIRMED.

---

# 11. Demo script (~2 min, runs on StubGateway + mock or devnet)

Pre-seed: one buzzy venue, pool "Fri 7–9pm, N=20", seeded to n=6 so the curve already shows a
premium. Two browser sessions: diner app + restaurant dashboard.

1. **(15s) Frame the problem.** "Hot restaurants lose money to no-shows; scarce Friday tables
   have no legit resale market. We tokenize the reservation and let an AMM price it — the
   restaurant earns on resales instead of fighting them."
2. **(25s) Buy live.** Diner logs in (Auth0, email — no wallet). Taps the pool: curve chart
   shows current price ~$58 (n=6). Buys. On the stub, the mock deposit page → Confirm → webhook
   → on-chain buy. Token appears in holdings; **curve ticks UP** on the dashboard in real time.
   Do it twice more (different sessions) — price visibly climbs.
3. **(20s) Sell-back / liquidity.** A holder can't make it → taps "sell it back." Curve is the
   counterparty (no waiting for a buyer). Price **drops** one step; restaurant dashboard shows
   **royalty accrued** from the spread. "Always liquid, and the restaurant just earned a fee."
4. **(25s) Decay.** Fast-forward the clock toward service (mock block_time). The whole curve
   **flattens toward the floor** — the scarcity premium decays (θ), meal-credit floor remains.
   "Resale value bleeds out as service approaches; you never lose the prepaid-dinner value."
5. **(20s) Service + sweep.** Restaurant checks in the diners who showed (redeem). Pool freezes;
   hit **Sweep**: dashboard breaks out consumed vs. **forfeited (recovered no-shows)**, total
   swept, and meal-credits-to-honor. "No-shows became revenue; the diner still gets their credit."
6. **(15s) Close on tracks.** "On-chain AMM + reserve on Solana; provably solvent by
   construction; gas-free stablecoin UX via Unifold; email login via Auth0. It's a real
   consumer product a restaurant could launch."

Talking points to keep ready: solvency invariant (reserve = area under curve; decay only makes
it MORE solvent); why fungible-within-a-pool (§7); why mid-tier not casual/tasting (§2).

# 12. TODO (remaining)
- [x] Fill §10.5 exact fields from Unifold docs — DONE. Reworked from `.claude/skills/unifold/`
      into [UNIFOLD_INTEGRATION.md](UNIFOLD_INTEGRATION.md) (authoritative): locked-quote
      preview→commit for buy, **Treasury outbound transfer** for payout, signed webhooks, test mode.
      §10.5 + the §10.4 buy response + the stack table were updated to match. Nothing outside the
      app-services impl moves — `PaymentGateway` interface unchanged.
- [ ] (app-services, at build) Implement `UnifoldGateway` per UNIFOLD_INTEGRATION.md §4 + §8
      checklist once the `sk_`/`pk_` keys are in hand; StubGateway already covers the demo.
- [ ] (app-services, decide-at-build) Base-USDC buy proceeds → Solana reserve: treasury-float
      (recommended) vs per-buy bridge (UNIFOLD_INTEGRATION.md §2).
- [ ] Swap chain-services mock → real Solana client after contract devnet deploy (isolated).
- [ ] (Optional) render bonding-curve + decay surface to sanity-check p0/k/φ/Tc before locking.
