# Building the contract on an ARM64 machine

**The problem:** this dev machine is Windows on ARM64 (Snapdragon X Elite). Anza ships no
`aarch64` Windows build of the Solana CLI, and the BPF/SBF toolchain that compiles Anchor programs
targets x86_64. So `anchor build` cannot run locally — not a config issue, an architecture one.

Two ways out. **Codespaces is the better one** if you want me to iterate on compile errors myself.

---

## Option A — GitHub Codespaces (recommended)

x86_64 Linux, nothing installed locally, and `.devcontainer/` provisions the whole toolchain on
first boot.

### What you need to do (one time)

The repo is currently local-only, so it has to reach GitHub first.

```powershell
winget install --id GitHub.cli        # if `gh` isn't installed
gh auth login                          # browser flow
```

Then from the repo root:

```powershell
gh repo create HT6 --private --source=. --remote=origin --push
gh codespace create --repo <your-user>/HT6 --machine standardLinux32gb
```

First boot runs `.devcontainer/setup.sh` (Rust, Solana CLI, Anchor 0.30.1 via avm, a dev wallet,
`npm install`) — allow ~5–10 minutes.

### Then, inside the Codespace

```bash
cd packages/contract
cargo test -p reservations    # fast: math.rs unit tests, no validator
anchor build                  # emits target/idl + target/types
anchor keys list              # -> paste the id into declare_id!() and Anchor.toml, rebuild
anchor test                   # local validator + tests/reservations.ts
solana airdrop 2
anchor deploy --provider.cluster devnet
```

I can drive all of that for you with `gh codespace ssh -c <name> -- '<cmd>'`, which means I can
fix compile errors directly instead of you relaying them.

### Cost
Free tier is 120 core-hours/month; a 4-core machine burns 4/hour. Ample for a hackathon.
**Stop it when idle:** `gh codespace stop -c <name>`.

---

## Option B — Docker x86_64 emulation (works right now, no GitHub)

Docker Desktop is already installed here. This runs an emulated x86_64 container, so it needs no
accounts — but emulated Rust builds are **slow** (expect 20–40 min for a first `anchor build`).
Good for a one-off compile check, painful for iteration.

```bash
docker run --rm -it --platform linux/amd64 \
  -v "/c/Users/deeru/source/repos/HT6:/work" -w /work/packages/contract \
  ubuntu:22.04 bash

# inside:
apt-get update && apt-get install -y curl build-essential pkg-config libssl-dev libudev-dev llvm libclang-dev protobuf-compiler
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && . "$HOME/.cargo/env"
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.30.1 && avm use 0.30.1
cargo test -p reservations && anchor build
```

Note the volume mount means `target/` lands in your working tree (it's gitignored).

---

## What to expect on the first build

The program is ~500 lines of Anchor written **without a compiler available**, so first-build errors
are likely and expected. Most probable sources:

- Anchor 0.30 account-constraint syntax (`init` + `seeds` + `bump` combinations)
- `ctx.bumps` field access (the API changed across Anchor versions)
- CPI signer-seed lifetimes in `buy`/`sell`/`sweep`
- `Pool::LEN` being off, which shows up as an account-size error at runtime rather than compile time

`cargo test -p reservations` is the fastest signal — it compiles `math.rs` and runs the pricing
tests without needing the BPF toolchain or a validator at all. Start there.

Paste any errors and I'll fix them.

---

## Toolchain constraints (resolved 2026-07-18)

`anchor build` now works in the Codespace. Three things had to be pinned down first; all of them
are recorded in the committed `Cargo.lock`, so a fresh clone just builds.

**1. Use `anchor build --no-idl`.** Anchor 0.30.1's IDL generator calls `proc_macro2::Span::source_file()`,
a nightly-only API that current `proc-macro2` no longer exposes. IDL generation is the *only* thing
that needs it; the program itself compiles fine. The TS client uses the checked-in types rather than
a freshly generated IDL, so nothing downstream depends on this.

**2. The lockfile must stay at `version = 3` and off edition2024.** Anchor 0.30.1's SBF toolchain
bundles cargo 1.75, which cannot parse `version = 4` lockfiles or any manifest declaring
`edition2024`. Newer patch releases of several transitive deps moved to edition2024, so they are
pinned below that boundary:

| crate | pinned | why |
|---|---|---|
| `blake3` | 1.8.2 | 1.8.3 wants `constant_time_eq ^0.4` (edition2024); 1.8.4+ wants `digest ^0.11` |
| `constant_time_eq` | 0.3.1 | 0.4.x is edition2024 |
| `borsh` | 1.5.7 | 1.8.0 pulls `hashbrown 0.17` |
| `indexmap` | 2.11.4 | 2.14 pulls `hashbrown 0.17` (edition2024) |
| `proc-macro-crate` | 3.3.0 | 3.5.0 pulls `toml_edit 0.25` / `toml_datetime 1.x` |
| `zeroize_derive` | 1.4.3 | 1.5.0 is edition2024 |
| `jobserver` | 0.1.34 | 0.1.35 requires rustc 1.85 |
| `unicode-segmentation` | 1.10.1 | 1.11+ requires rustc newer than 1.75 |

If a `cargo update` ever re-breaks the build, regenerate with the SBF cargo rather than the system
one — it can only select versions it is able to parse:

```bash
SBF=$HOME/.local/share/solana/install/active_release/bin/sdk/sbf/dependencies/platform-tools/rust/bin
$SBF/cargo generate-lockfile
```

**3. `CreatePool` accounts are `Box`ed.** Three `init` constraints in one struct overflowed the
4KB BPF stack by 432 bytes. Boxing moves them to the heap. Keep them boxed.

## Verified

```
cargo test -p reservations      # 7 passed (math.rs)
anchor build --no-idl           # target/deploy/reservations.so, 402512 bytes
solana program deploy           # deployed to a local validator; program id matches declare_id!
```

Program id: `65MujywnECN4smLLbtDoTW8ithgnPTfmHcwdx3Hvqbot`

**Devnet deploy is still pending.** The Codespace IP is rate-limited by the devnet faucet, so the
wallet could not be funded there. Fund `ACnFmyNBFopSpaDjVK3eH2vgTyfPGRYJo4EmQH2gGKcy` from a faucet
that works (or transfer SOL to it), then re-run:

```bash
solana program deploy --url devnet target/deploy/reservations.so
```
