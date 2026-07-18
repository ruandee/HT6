#!/usr/bin/env bash
# Provisions the Solana/Anchor toolchain in the Codespace.
#
# WHY THIS EXISTS: the dev machine is Windows on ARM64 (Snapdragon X Elite). Anza publishes no
# aarch64-windows build and the BPF toolchain expects x86_64, so the contract cannot be compiled
# locally. This container is x86_64 Linux, where the toolchain is fully supported.
set -euxo pipefail

SOLANA_VERSION="${SOLANA_VERSION:-stable}"
ANCHOR_VERSION="${ANCHOR_VERSION:-0.30.1}"   # must match programs/reservations/Cargo.toml

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential pkg-config libssl-dev libudev-dev llvm libclang-dev protobuf-compiler

# ---- Solana CLI ----
sh -c "$(curl -sSfL https://release.anza.xyz/${SOLANA_VERSION}/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"

# ---- Anchor (pinned via avm) ----
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install "$ANCHOR_VERSION"
avm use "$ANCHOR_VERSION"

# ---- dev wallet + devnet ----
solana config set --url devnet
[ -f "$HOME/.config/solana/id.json" ] || solana-keygen new --no-bip39-passphrase -s -o "$HOME/.config/solana/id.json"

# ---- JS workspaces ----
npm install

echo "=== versions ==="
rustc --version
solana --version
anchor --version
node --version
