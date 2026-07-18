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
