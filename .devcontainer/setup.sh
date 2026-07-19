#!/usr/bin/env bash
# Installs the Solana + Anchor toolchain. Rust and Node come from the devcontainer image.
#
# WHY THIS EXISTS: the dev machine is Windows on ARM64 (Snapdragon X Elite). Anza publishes no
# aarch64-windows build and the BPF toolchain expects x86_64 glibc, so the contract cannot be
# compiled locally. This container is x86_64 Debian, where the toolchain is supported.
set -eux

ANCHOR_VERSION="${ANCHOR_VERSION:-0.30.1}"   # must match programs/reservations/Cargo.toml

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential pkg-config libssl-dev libudev-dev llvm libclang-dev protobuf-compiler

# ---- Solana CLI ----
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q 'solana/install/active_release' "$HOME/.bashrc" 2>/dev/null || \
  echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"

# ---- Anchor (pinned via avm) ----
# `avm use` prompts when the version isn't present, which deadlocks a non-interactive
# provision, so install first and only then select.
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install "$ANCHOR_VERSION"
avm use "$ANCHOR_VERSION"

# ---- dev wallet on devnet ----
solana config set --url devnet
[ -f "$HOME/.config/solana/id.json" ] || \
  solana-keygen new --no-bip39-passphrase -s -o "$HOME/.config/solana/id.json"

# ---- JS workspaces ----
npm install || true

echo "=== versions ==="
rustc --version
solana --version
anchor --version

# ---- build the program ----
# --no-idl is required: Anchor 0.30.1's IDL generator calls a nightly-only proc-macro2 API
# that no longer exists. The program itself compiles fine. See packages/contract/BUILDING.md.
# Cargo.lock is committed and pins the graph below the edition2024 boundary that the SBF
# toolchain's cargo 1.75 cannot parse -- do not regenerate it with the system cargo.
(cd packages/contract && anchor build --no-idl) || \
  echo "WARN: anchor build failed; see packages/contract/BUILDING.md"
