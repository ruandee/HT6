use anchor_lang::prelude::*;

pub const BPS_DENOM: u64 = 10_000;

/// §10.1 on-chain pool state. A pool is (venue, service_window, party_size) — §4/§4a.
#[account]
pub struct Pool {
    /// restaurant wallet: receives royalties, may check_in / sweep
    pub authority: Pubkey,
    /// fungible SPL mint for this pool
    pub mint: Pubkey,
    /// PDA token account holding the USDC reserve
    pub reserve: Pubkey,
    /// USDC mint this pool settles in
    pub usdc_mint: Pubkey,
    /// floor / meal credit, USDC base units (6dp)
    pub p0: u64,
    /// slope per slot, USDC base units
    pub k: u64,
    /// current supply outstanding (0..=n_max)
    pub n_sold: u64,
    /// N
    pub n_max: u64,
    /// royalty spread, basis points (e.g. 500 = 5%)
    pub phi_bps: u16,
    /// seats UP TO this many (§4a)
    pub party_size: u8,
    /// unix ts of the service window
    pub service_time: i64,
    /// decay cliff length in seconds (e.g. 86400)
    pub tc_seconds: i64,
    /// true once service reached — trading halted
    pub frozen: bool,
    /// true once `sweep` has run; makes settlement strictly one-shot (a zero-balance pool must
    /// not be sweepable twice, so this is a flag rather than a balance check)
    pub swept: bool,
    /// running total of royalties retained from sell-backs (for the issuer dashboard)
    pub royalties: u64,
    /// sum of USDC paid in by currently-outstanding tokens (the solvency invariant, §4)
    pub reserve_paid_in: u64,
    /// diners who have checked in (consumed) — counted at sweep (§7c-B)
    pub consumed_count: u64,
    /// unique seed for PDA derivation
    pub pool_seed: [u8; 32],
    pub bump: u8,
    pub reserve_bump: u8,
}

impl Pool {
    pub const LEN: usize = 8  // discriminator
        + 32 * 4              // authority, mint, reserve, usdc_mint
        + 8 * 4               // p0, k, n_sold, n_max
        + 2 + 1               // phi_bps, party_size
        + 8 * 2               // service_time, tc_seconds
        + 1 + 1               // frozen, swept
        + 8 * 3               // royalties, reserve_paid_in, consumed_count
        + 32 + 1 + 1;         // pool_seed, bump, reserve_bump
}

/// One per (pool, diner). Enforces §7c-C and records what they paid for §7c-B sweep accounting.
///
/// NOTE on §7c-C scope: the canonical rule is one table per (venue, service_window) across ALL
/// party-size bands. On-chain we enforce one per (pool, diner) here; the cross-band half is
/// enforced by the `WindowTicket` PDA below, which is keyed by (authority, service_time, diner)
/// and is therefore shared by every band that night.
#[account]
pub struct Holding {
    pub pool: Pubkey,
    pub diner: Pubkey,
    /// USDC paid for this token — swept to the restaurant at settle (§7c-B)
    pub paid: u64,
    /// true once checked in (consumed); still blocks a rebuy (§7c-C)
    pub redeemed: bool,
    pub bump: u8,
}

impl Holding {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 1;
}

/// §7c-C cross-band guard. Keyed by (authority, service_time, diner) so it is SHARED by every
/// party-size band that night — existence means "this diner already has a table for this
/// service window". Closed on sell-back (which is how a diner switches party size).
#[account]
pub struct WindowTicket {
    pub authority: Pubkey,
    pub service_time: i64,
    pub diner: Pubkey,
    /// which band they actually hold, for diagnostics
    pub pool: Pubkey,
    pub bump: u8,
}

impl WindowTicket {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 32 + 1;
}
