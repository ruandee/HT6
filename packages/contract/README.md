# contract (stream 1)

Solana/Anchor program: pool state, `create_pool` / `buy` / `sell` / `redeem` / `check_in` /
`sweep`, reserve PDA, fee routing, on-chain θ decay. Owns BUILD_SPEC.md §4 + §7b math.

**Deliverable:** deployed devnet program + IDL, OR a spec-conformant mock (§10.2).
**Wait-gate:** none — starts at T0, owns the math (§8.1). Needs Rust + Anchor + Solana CLI
installed (see SETUP.md — not required by any other stream to start).

The TS-facing shape it must satisfy is `ChainAdapter` in `@ttr/shared-types` (§10.2). Match the
pricing in `pricing.ts` bit-for-bit (buy rounds up, sell rounds down).
