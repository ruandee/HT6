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
