tokenise your reservations - cut out the credit card holds and third party reservation sites

# hora

_Tokenized restaurant reservations, priced by an automated market maker_  |  [Explore the demo](https://ttr-launcher.vercel.app/demo)

---

## Inspiration

Restaurants lose real money to no-shows, and their answer is the credit-card hold. But it doesn't stop the grey market- where third-party services trade and charge diners for reservations. A report by the [National Restaurant Association](https://restaurant.org/research-and-media/media/press-releases/access-denied-the-rise-of-black-market-reservations-disrupting-the-restaurant-dining-experience/)  found that ~70% of diners surveyed on full-service restaurants expressed concerns of how these reservation resale services harm restaurants financially (as they increase the no-show rate) and make these restaurants more out of reach to the average customer. 

Both problems are the same problem. A reservation is an option on a table, trading with no liquidity and no issuer participation. Indeed, make it a real instrument and put the restaurant in the middle, and the no-show stops being a loss (the table was prepaid) and the resale stops being extractive (the restaurant takes the cut.

Fun fact: the name 'hora' is derived from the Horai, the goddesses of natural portions of time 🕛💭


## What it does

A restaurant creates a pool: one venue, one service window, one party-size band, \\(N\\) interchangeable tables.

```
Friday 7–9pm · table for 2  →  N = 20,  p0 = $40,  k = $3
Friday 7–9pm · table for 4  →  N = 8,   p0 = $80,  k = $6
```

Diners buy against a bonding curve; holders sell back to it. The contract is always the counterparty, so nobody waits for a buyer. Liquidity is guaranteed by the automated market maker (AMM).

$$\text{price} = \underbrace{p\_0}\_{\text{prepaid meal credit}} + \underbrace{k \cdot n \cdot \theta(t)}\_{\text{scarcity premium}}$$

The floor is a real $40 credit off your bill. Only the premium above it is market-priced, such that most of what a buyer pays is dinner, and the restaurant captures the rest instead of a scalper.

Four things you can watch happen:

1. **The curve climbs**: each buy moves \\(n \to n+1\\), next table costs \\(k\\) more.
2. **It stays liquid**: a sell-back pays out immediately, price steps down, royalty accrues.
3. **It flattens**: advance the clock toward service and the premium decays onto the floor.
4. **The sweep**: after service, consumed vs. forfeited (the recovered no-shows), total swept, credits to honor.


## How I built it

| Layer | What it's built with |
|---|---|
| **Contract** | Rust, Anchor 0.30.1 (`anchor-lang`, `anchor-spl`), Solana |
| **Chain client + indexer** | TypeScript, `@solana/web3.js`, `@coral-xyz/anchor`, `@solana/spl-token`, Postgres via `pg` |
| **Backend** | Node, Express 4, plain `fetch` against Unifold's REST API, `node:crypto` for webhook HMAC |
| **Five React clients** | React 18, Vite 5, TypeScript 5.6, Framer Motion, Recharts, `@unifold/connect-react` |
| **Payments** | Unifold locked-quote payment intents and treasury transfers, USDC settling on Base |
| **Tests** | `cargo test` for contract math, `node:test` for the gateway, Playwright for UI flows |
| **Deploy** | Vercel for the static clients, Google Cloud Run (Docker) for app-services |

The clients are a diner website, a mobile app, an operator console for the restaurant floor, and a standalone lab that lets you drag time toward service and watch the premium decay. There is no server SDK for Unifold, so the backend talks to it over plain REST.

Webhooks arrive signed and are verified against the raw body before anything is parsed.


### The invariant

With \\(p(n) = p\_0 + kn\\), a buy pays exactly \\(p(n)\\) in and a sell-back pays exactly \\(p(n-1)\\) out. So at all times:

$$\text{Reserve} = \sum_{i=0}^{n-1} p(i) = n p_0 + k\frac{n(n-1)}{2}$$

The reserve is the area under the curve, and the royalty is the spread: buyers pay \\(p(n)\\), sellers get \\(p(n-1)(1-s)\\) with \\(s = 5\%\\). Every round trip leaves s behind, harvested by the restaurant.


### Time (theta) Decay

A Friday table is worth a premium on Monday and worth exactly dinner at 6:59pm Friday. So the premium decays and the floor never does:

$$\theta(\tau) = \begin{cases} 1 & \tau \geq T_c \\\\ \tau / T_c & 0 \leq \tau < T_c \\\\ 0 & \tau \leq 0 \end{cases} \qquad \tau = t_{\text{service}} - t_{\text{now}}$$

I wanted a convex power law, but took piecewise-linear because it has to compute inside a Solana program from block time. So the value of the contract holds steady and collapses as time to expiry goes to zero.

Decay only ever reduces what a sell-back pays relative to what came in, so time makes the contract *more* over-collateralized, never less. The buyer purchases optionality through the premium.


### The grace window

θ hits 0 at service and trading freezes there, but a diner three minutes late is not a no-show. So a pool carries `grace_seconds`, and it moves exactly two deadlines, which are the same instant:

```rust
/// This is the ONLY thing grace moves. θ and the freeze still key off `service_time`,
/// so pricing and the solvency invariant are untouched.
pub fn door_closes_at(service_time: i64, grace_seconds: i64) -> Result<i64> {
    require!(grace_seconds >= 0, ReservationError::InvalidParams);
    service_time
        .checked_add(grace_seconds)
        .ok_or(ReservationError::MathOverflow.into())
}

/// The shared deadline predicate keeps check-in and sweep mutually exclusive.
pub fn check_in_open(now: i64, door_closes: i64) -> bool {
    now < door_closes
}
```

A restaurant that could sweep at `service_time` would forfeit a diner who is still parking, and a negative grace would pull the check-in deadline *before* service, so creation rejects it. The constraint that keeps this a service policy is that inside the window θ is already 0: the table sits on the $40 floor and is off the market. Test below handles it:

```rust
let inside = SERVICE + 60;
assert_eq!(theta_bps(SERVICE, inside, 86_400).unwrap(), 0);
assert_eq!(buy_price(P0, K, 6, 0).unwrap(), P0); // on the floor, not the curve
assert!(check_in_open(inside, closes));          // ...and check-in is still open
```

Both guards are mirrored in `MockChainAdapter`, so the boundary behaves identically in the demo and on-chain.


### Integer math

No floats on Solana, so \\(\theta\\) is basis points and money is USDC base units. Rounding direction is load-bearing: **buy rounds up, sell rounds down**, i.e., the rounding favors the house. The test that guards it:

```rust
#[test]
fn rounding_favors_house() {
    for n in 1..50u64 {
        for theta in [1u64, 3_333, 5_000, 9_999, 10_000] {
            let b = buy_price(P0, K, n - 1, theta).unwrap();
            let s = sell_price(P0, K, n, theta).unwrap();
            assert!(b >= s, "n={n} theta={theta}: buy {b} < sell {s}");
        }
    }
}
```


### The seams

`MockChainAdapter` and `StubGateway` were built as real deliverables, not scaffolding, so that the stub fabricates the webhook and posts a real-shaped envelope into the real handler. So the whole demo runs end to end with no keys and no deployed contract, and swapping in real Solana or real Unifold touches one file each.


### On Unifold

**How central is it.** Unifold is the only path money takes in or out of the product. Every buy is a locked-quote payment intent, every sell-back a treasury outbound transfer, and both sit behind one PaymentGateway interface that is the app's single money seam. The buy needs no wallet at all: beginCheckout collects whatever the diner already has, and the table is minted from the signed payment_intent.succeeded webhook rather than the client callback. Sell-backs are the honest gap: they still need a Base USDC address on file for the diner, and the custodial wallet service that would supply it is the one piece we haven't built.

**What I built.** On the server: two-step locked quotes committed inside a single request handler (the preview expires in ~30 seconds), payouts as treasury outbound transfers on Base with a deterministic idempotency key, and a webhook route that verifies the raw body, rejects anything older than five minutes, and dedupes on `unifold-id`. On the client, `UnifoldProvider` wraps the app and confirming a quote hands the intent's `client_secret` to `beginCheckout()`. That's the whole reason there's no wallet in the flow, as the diner pays with whatever they already have, and USDC comes out the other side.

**Paid is not booked.** `onSuccess` does almost nothing: it moves the sheet into a "confirming" state and returns. A client callback isn't proof of settlement: the tab can close mid-flight, and a hostile client could just call it. So the table is minted only when the signed `payment_intent.succeeded` webhook lands, and the UI waits for the holding to appear in the read model.

**Error handling is most of the work.** A buy fulfills only on `succeeded`, never on `processing`, because minting on a payment that can still fail hands someone a free reservation. A late deposit gets refunded and the diner is told to re-quote, a failed payout re-credits the holding, and `max_price` means a price that moved during settlement rejects the buy rather than quietly charging more.

**Why Unifold does not appear in the demo** The demo runs on `StubGateway`, which fakes the intent and posts a real-shaped envelope into the real webhook handler. There is simply no sandbox: Unifold's guidance is to avoid testnet and use mainnet with small amounts, so every end-to-end run moves real money. I built something that scales a live buy down to a few dollars while clearing the 3 USDC minimum, plus a hard warning at boot if the service is running live at full price.

And then I ran it for real... I made a coinbase wallet and bought some ETH and USDC, which was a new experience for me. The details are below:

```
payment intent   pi_3GiD6FeHVmVGgoT2h91ruvlLX3P
status           succeeded          livemode: true
amount           $3.58 USDC, settled on Base
tx               0xec3897e83b6d99b2bdb8f804e01bf20c62cfe3983c9e550a0f32c6144d39211c
```

Shortly after: `payment_intent.succeeded` reached my webhook, passed HMAC verification, and minted the table. Then I sold it back, for the round trip test:

```
outbound transfer  obt_3GiDqZudyIOuAcIr4VONzwuOxnr
status             completed
amount             $3.40 USDC, treasury -> diner, both on Base
tx                 0x5b71a7da77d190448453cc683f2cd5ed31e497ecefe2ffabc3c359d5def2fe69
idempotency key    sell:pool_64:alice:3404166
```

The wallet went `$10.38 -> $10.19` on-chain. The whole round trip cost 19 cents, and those 19 cents are the 5% royalty: the mechanism the entire design rests on, paid by me, on mainnet. Two details there matter more than the money: `external_user_id: alice` is my app's user id carried into Unifold's user model, and that idempotency key is the deterministic one my gateway generates, so a retried payout returns the existing transfer instead of paying twice.

Source: **`/unifold/status`** on the deployed service queries the Unifold API live on every load and lists both transactions; revoke the key and the page breaks, because nothing on it is stored.

My concern is that the refund branch has never fired against a real late deposit, because provoking one means deliberately paying into an expired quote.


## Challenges

**A 2-top isn't a 4-top.** One curve can only price assets that are interchangeable, and per-table NFTs would mean a market of one per table. Instead, I chose to create one pool per party-size band, each internally fungible. I also gave up modeling when tables can be pushed together to form larger tables as elastic \\(N\\) makes the reserve invariant meaningless and that invariant is what everything else rests on.

**Discovered market inefficiency.** "One table per person per pool" lets someone hold a 2-top and a 4-top for the same night, then sell back whichever way the curve moved. The 5% spread makes that lose money on average so it isn't arbitrage, but it's a cheap option on a night selling out, and on an 8-table band one person corners an eighth of the inventory. The cap became one table per diner per service window, enforced on-chain by a PDA that fails at account creation rather than in application code.

**Payment is asynchronous, so the price moves underneath it.** Every buy carries a `max_price` and executes only at or under it, refunding the difference and rejecting outright if the price ran past. Then the real docs told me a locked quote expires in about 30 seconds, not the 90 we'd designed for, which collapsed preview and commit into a single request handler.

**There is no Unifold sandbox.** Checkout is mainnet-only, so the choice was demo with real money or demo on a stub. I ended up building both: the stub fakes the counterparty but never the code path, it posts a real-shaped event at the real webhook route and skips exactly one `if`, the HMAC check.

**USDC you can't spend.** My first few attempts to test on mainnet failed with "insufficient ETH for gas" on a wallet visibly holding $10: the USDC was on Base, the ETH had gone to L1- a misclick during the transfer. A small thing, but it is precisely why this product hides wallets from diners.

**Building on ARM64.** The dev machine is Windows on a Snapdragon X Elite, and Anza publishes no `aarch64` Solana toolchain. So every money-critical function went into `math.rs` as a pure function that `cargo test` could verify with no compiler and no validator; the contract was later built and deployed on an x86_64 Codespace.


## What I learned
I'll update this after I sleep for 10 hours... Learned how to cut my losses and take a nap instead of working for 30h straight.


## What's next

Deploy to devnet and drop in the real Unifold gateway, and after that: secondary-market analytics for restaurants, since the AMM generates that data for free.

**Real authentication.** Identity is an `x-user-id` header stub- the client asserts who it is and the server believes it. I chose this such that every rule I needed to test is a *per-user* rule (one table per user per pool, the straddle cap, holdings, sell-backs), and those needed a stable user identifier, not a trustworthy one. It does mean the deployed surfaces trust their caller. Anyone can send another user's id, and the restaurant dashboard's issuer routes, including sweeping a reserve, are reachable by anyone with the URL. For a judged demo on a link nobody has, that's an acceptable trade; it is not a trade you can carry into anything real. I believe the plumbing is already present for the fix: every diner route reads its caller through a single `userId(req)` helper, so swapping the header for a verified Auth0 claim is a one-function change. The issuer routes need slightly more: they don't read a caller at all today, they run against a hardcoded venue authority, so those get a real role check rather than a substitution.

That work is also the prerequisite for the final TODO I wasn't able to finish, which was multiple accounts. Verified-email signup raises the cost, payment identity would raise it further, and no ticketing system has ever fully solved it. But given that identity is still self-asserted, I had no options on the time constraints.
