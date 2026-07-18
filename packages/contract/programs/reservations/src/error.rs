use anchor_lang::prelude::*;

#[error_code]
pub enum ReservationError {
    #[msg("Invalid pool parameters")]
    InvalidParams,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Pool is frozen; trading has halted for this service window")]
    PoolFrozen,
    #[msg("Pool is sold out")]
    SoldOut,
    #[msg("Current price exceeds the buyer's locked max_price (§7c-A)")]
    SlippageExceeded,
    #[msg("You already hold a table for this service window (§7c-C)")]
    AlreadyHoldingThisWindow,
    #[msg("No held token for this diner")]
    NoHolding,
    #[msg("Token already redeemed")]
    AlreadyRedeemed,
    #[msg("Only the pool authority may perform this action")]
    NotAuthority,
    #[msg("Pool is not frozen yet; cannot sweep before service time")]
    NotYetFrozen,
    #[msg("Pool has already been swept")]
    AlreadySwept,
    #[msg("Reserve does not cover the payout — refusing to break the solvency invariant")]
    ReserveInsufficient,
}
