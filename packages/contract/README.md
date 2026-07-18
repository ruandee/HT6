# contract (stream 1) — Solana/Anchor program

Implements the money-authority layer: BUILD_SPEC §4 (bonding curve), §7b (θ decay),
§7c-A (quote-lock/slippage), §7c-B (sweep accounting), §7c-C (one table per service window),
§10.1 (pool state), §10.2 (instruction set).

The instruction set mirrors the frozen `ChainAdapter` (§10.2) so `chain-services` can swap its
mock for this program with no caller changes (§8.1 SWAP A).

```
programs/reservations/src/
  lib.rs      instructions, accounts, events
  math.rs     §4/§7b pricing — mirrors shared-types/src/pricing.ts bit-for-bit, + unit tests
  state.rs    Pool, Holding, WindowTicket
  error.rs    typed errors
tests/reservations.ts   integration tests (anchor test)
```

## Design notes worth knowing

**The reserve is a PDA-owned USDC token account.** Every buy transfers exactly `buy_price` in;
every sell transfers at most `sell_price·(1−φ)` out. Since `buy_price ≥ sell_price` at the same
rung and θ decay only reduces payouts further, the §4 solvency invariant holds by construction.
`sell` additionally asserts `gross <= reserve_paid_in` — unreachable in theory, but this is real
money, so it asserts rather than trusts.

**`WindowTicket` is how §7c-C is enforced on-chain.** It is a PDA keyed by
`(authority, service_time, diner)` — deliberately NOT including the pool — so it is *shared by
every party-size band that night*. `buy` uses `init` (not `init_if_needed`), so a second buy for
any band in that window fails at account creation. `sell` closes it (freeing a rebuy, which is
how a diner switches band); `check_in` does not (once you have taken the night's table, that is
your table).

**Rounding is asymmetric on purpose.** Buy rounds up, sell rounds down (§6), so rounding can
never drain the reserve. `overflow-checks = true` is set in release: silent u64 wraparound in
pricing would be a fund-loss bug, so it panics instead.

**θ is computed from `Clock::get()`**, i.e. real block time. Tests that need decay use a
service_time a few hours out; tests that need a frozen pool use one a few seconds out and wait.

## Prerequisites (NOT yet installed on this machine)

Windows note: the Solana/Anchor toolchain is much smoother under **WSL2 (Ubuntu)** than native
Windows. `wsl --install -d Ubuntu`, then run everything below inside that shell, working from
`/mnt/c/Users/deeru/source/repos/HT6/packages/contract`.

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Anchor via avm (pin 0.30.1 to match Cargo.toml)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

# a dev wallet + devnet SOL
solana-keygen new
solana config set --url devnet
solana airdrop 2
```

## Build / test / deploy

```bash
cargo test -p reservations      # fast: the math.rs unit tests, no validator needed
anchor build                    # produces target/idl/reservations.json + target/types
anchor test                     # spins a local validator and runs tests/reservations.ts
anchor deploy --provider.cluster devnet
```

After the first `anchor build`, replace the placeholder program id: run
`anchor keys list`, then paste the real id into `declare_id!()` in `lib.rs` and into
`Anchor.toml` (both `[programs.localnet]` and `[programs.devnet]`), and rebuild.

## Handing off to chain-services (SWAP A)

`anchor build` emits the IDL at `target/idl/reservations.json` and TS types at
`target/types/reservations.ts`. chain-services builds a `SolanaChainAdapter` against those,
implementing the same frozen `ChainAdapter` interface the mock implements. Callers change
nothing.

Mapping is 1:1 except where the chain needs accounts the TS interface hides:
| ChainAdapter (§10.2) | program instruction |
|---|---|
| `create_pool` | `create_pool(pool_seed, p0, k, n_max, phi_bps, service_time, tc_seconds, party_size)` |
| `quote` | read the `Pool` account + compute `math.rs` client-side (no tx) |
| `buy(pool, user, max_price)` | `buy(max_price)` |
| `sell(pool, user)` | `sell()` |
| `redeem` / `check_in` | `check_in()` |
| `sweep` | `sweep()` |

`quote` is read-only: fetch the `Pool` account and run the same formulas — that is exactly why
`math.rs` must stay in lockstep with `pricing.ts`.
