//! Tokenized restaurant reservations — AMM bonding curve with θ decay.
//!
//! Implements BUILD_SPEC §4 (curve), §7b (θ decay), §7c-A (quote-lock/slippage),
//! §7c-B (sweep accounting), §7c-C (one table per service window), §10.1/§10.2.
//!
//! MONEY AUTHORITY: this program is the single source of truth for funds. Postgres is only a
//! read cache. The reserve is a PDA-owned USDC token account; the solvency invariant
//! (`reserve = Σ p(i) for i<n`) holds by construction because every buy adds exactly the current
//! buy_price and every sell removes at most the current sell_price (which is ≤ buy_price at the
//! same rung, and θ decay only ever reduces payouts further).
//!
//! The instruction set mirrors the frozen §10.2 ChainAdapter so chain-services can swap its mock
//! for this program with no caller changes (§8.1 SWAP A).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Approve, Mint, Token, TokenAccount, Transfer};

pub mod error;
pub mod math;
pub mod state;

use error::ReservationError;
use math::{buy_price, check_in_open, door_closes_at, sell_payout, sell_price, theta_bps};
use state::{Holding, Pool, WindowTicket};

declare_id!("Res1111111111111111111111111111111111111111");

#[program]
pub mod reservations {
    use super::*;

    /// §10.2 create_pool. One pool per (venue, service_window, party_size) — §4a.
    pub fn create_pool(
        ctx: Context<CreatePool>,
        pool_seed: [u8; 32],
        p0: u64,
        k: u64,
        n_max: u64,
        phi_bps: u16,
        service_time: i64,
        tc_seconds: i64,
        party_size: u8,
        grace_seconds: i64,
    ) -> Result<()> {
        require!(n_max > 0, ReservationError::InvalidParams);
        require!(tc_seconds > 0, ReservationError::InvalidParams);
        require!((phi_bps as u64) < state::BPS_DENOM, ReservationError::InvalidParams);
        require!(party_size > 0, ReservationError::InvalidParams);
        require!(p0 > 0, ReservationError::InvalidParams);
        // A negative grace would pull the check-in deadline BEFORE service and let sweep run early,
        // stranding diners who arrived on time. Zero (no grace) is valid.
        require!(grace_seconds >= 0, ReservationError::InvalidParams);

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.mint = ctx.accounts.mint.key();
        pool.reserve = ctx.accounts.reserve.key();
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.p0 = p0;
        pool.k = k;
        pool.n_sold = 0;
        pool.n_max = n_max;
        pool.phi_bps = phi_bps;
        pool.party_size = party_size;
        pool.service_time = service_time;
        pool.tc_seconds = tc_seconds;
        pool.grace_seconds = grace_seconds;
        pool.frozen = false;
        pool.swept = false;
        pool.royalties = 0;
        pool.reserve_paid_in = 0;
        pool.consumed_count = 0;
        pool.pool_seed = pool_seed;
        pool.bump = ctx.bumps.pool;
        pool.reserve_bump = ctx.bumps.reserve;

        emit!(PoolCreated {
            pool: pool.key(),
            authority: pool.authority,
            mint: pool.mint,
            p0,
            k,
            n_max,
            phi_bps,
            service_time,
            tc_seconds,
            party_size,
            grace_seconds,
        });
        Ok(())
    }

    /// §10.2 buy. n -> n+1 if current buy_price <= max_price (§7c-A), and the diner does not
    /// already hold a table for this service window (§7c-C).
    ///
    /// The diner's USDC moves into the reserve PDA; one pool token is minted to them. The
    /// `max_price` bound is enforced HERE, on-chain, so a diner can never be charged more than
    /// they were quoted — app-services passing a stale quote cannot overcharge.
    pub fn buy(ctx: Context<Buy>, max_price: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;

        // freeze on reaching service time (§7b: θ→0 boundary, trading halts)
        if now >= pool.service_time {
            pool.frozen = true;
        }
        require!(!pool.frozen, ReservationError::PoolFrozen);
        require!(pool.n_sold < pool.n_max, ReservationError::SoldOut);

        let theta = theta_bps(pool.service_time, now, pool.tc_seconds)?;
        let price = buy_price(pool.p0, pool.k, pool.n_sold, theta)?;

        // §7c-A quote-lock: reject if the curve moved past what the diner agreed to.
        require!(price <= max_price, ReservationError::SlippageExceeded);

        // §7c-C is enforced structurally: `window_ticket` is init (not init_if_needed) and is
        // keyed by (authority, service_time, diner), so a second buy for ANY band that night
        // fails at account creation — the PDA already exists.
        let ticket = &mut ctx.accounts.window_ticket;
        ticket.authority = pool.authority;
        ticket.service_time = pool.service_time;
        ticket.diner = ctx.accounts.diner.key();
        ticket.pool = pool.key();
        ticket.bump = ctx.bumps.window_ticket;

        // move USDC diner -> reserve
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.diner_usdc.to_account_info(),
                    to: ctx.accounts.reserve.to_account_info(),
                    authority: ctx.accounts.diner.to_account_info(),
                },
            ),
            price,
        )?;

        // mint the pool token to the diner (fungible within the band, §4)
        //
        // Copy the seed material out before building the CpiContext: `pool` is a &mut borrow, and
        // the signer seeds must outlive the CPI call, so they cannot borrow from it.
        let pool_seed = pool.pool_seed;
        let pool_bump = pool.bump;
        let pool_ai = pool.to_account_info();
        let seeds: &[&[u8]] = &[b"pool", pool_seed.as_ref(), &[pool_bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.diner_token.to_account_info(),
                    authority: pool_ai.clone(),
                },
                &[seeds],
            ),
            1,
        )?;

        // `check_in` is initiated by the restaurant, so let the pool PDA burn this one token as
        // the diner's SPL delegate. Mint authority alone cannot burn from a diner-owned account.
        token::approve(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Approve {
                    to: ctx.accounts.diner_token.to_account_info(),
                    delegate: pool_ai,
                    authority: ctx.accounts.diner.to_account_info(),
                },
            ),
            1,
        )?;

        let holding = &mut ctx.accounts.holding;
        holding.pool = pool.key();
        holding.diner = ctx.accounts.diner.key();
        holding.paid = price;
        holding.redeemed = false;
        holding.bump = ctx.bumps.holding;

        pool.n_sold = pool.n_sold.checked_add(1).ok_or(ReservationError::MathOverflow)?;
        pool.reserve_paid_in = pool
            .reserve_paid_in
            .checked_add(price)
            .ok_or(ReservationError::MathOverflow)?;

        emit!(Bought {
            pool: pool.key(),
            diner: ctx.accounts.diner.key(),
            price_paid: price,
            n_sold: pool.n_sold,
            theta_bps: theta,
        });
        Ok(())
    }

    /// §10.2 sell. n -> n-1; the curve is the counterparty, so this always succeeds while the
    /// pool is open. Payout = sell_price·(1−φ); the φ remainder stays as restaurant royalty.
    pub fn sell(ctx: Context<Sell>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;

        if now >= pool.service_time {
            pool.frozen = true;
        }
        require!(!pool.frozen, ReservationError::PoolFrozen);
        require!(!ctx.accounts.holding.redeemed, ReservationError::AlreadyRedeemed);
        require!(pool.n_sold > 0, ReservationError::NoHolding);

        let theta = theta_bps(pool.service_time, now, pool.tc_seconds)?;
        let gross = sell_price(pool.p0, pool.k, pool.n_sold, theta)?;
        let payout = sell_payout(gross, pool.phi_bps)?;
        let royalty = gross.saturating_sub(payout);

        // Defensive: never pay out more than the reserve holds. Should be unreachable given the
        // §4 invariant, but the reserve is real money — assert rather than trust.
        require!(gross <= pool.reserve_paid_in, ReservationError::ReserveInsufficient);

        // burn the diner's token
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.diner_token.to_account_info(),
                    authority: ctx.accounts.diner.to_account_info(),
                },
            ),
            1,
        )?;

        // reserve -> diner (seed material copied out; see the note in `buy`)
        let pool_seed = pool.pool_seed;
        let pool_bump = pool.bump;
        let pool_ai = pool.to_account_info();
        let seeds: &[&[u8]] = &[b"pool", pool_seed.as_ref(), &[pool_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve.to_account_info(),
                    to: ctx.accounts.diner_usdc.to_account_info(),
                    authority: pool_ai,
                },
                &[seeds],
            ),
            payout,
        )?;

        pool.n_sold = pool.n_sold.checked_sub(1).ok_or(ReservationError::MathOverflow)?;
        pool.reserve_paid_in = pool
            .reserve_paid_in
            .checked_sub(gross)
            .ok_or(ReservationError::MathOverflow)?;
        pool.royalties = pool
            .royalties
            .checked_add(royalty)
            .ok_or(ReservationError::MathOverflow)?;

        emit!(Sold {
            pool: pool.key(),
            diner: ctx.accounts.diner.key(),
            payout,
            gross,
            royalty,
            n_sold: pool.n_sold,
            theta_bps: theta,
        });
        // `holding` and `window_ticket` are closed by the `close` attributes — selling back frees
        // the diner to rebuy (which is how they legitimately switch party size, §7c-C).
        Ok(())
    }

    /// §10.2 check_in — issuer marks the diner arrived, which redeems (burns) their token. Their
    /// USDC stays in the reserve and is swept after service; the p0 meal credit is honored
    /// off-chain at the table (§7c-B).
    ///
    /// Note the `window_ticket` is NOT closed here: once you have taken the night's table you do
    /// not get to buy another for that window (§7c-C).
    pub fn check_in(ctx: Context<CheckIn>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(
            ctx.accounts.authority.key() == pool.authority,
            ReservationError::NotAuthority
        );
        require!(!pool.swept, ReservationError::AlreadySwept);
        require!(!ctx.accounts.holding.redeemed, ReservationError::AlreadyRedeemed);
        // The door closes at service_time + grace. Past that the diner is a no-show, their table
        // forfeits, and `sweep` becomes legal (see below). The strict check makes that boundary
        // mutually exclusive: at the closing instant only sweep is legal.
        let door_closes = door_closes_at(pool.service_time, pool.grace_seconds)?;
        require!(check_in_open(now, door_closes), ReservationError::GraceExpired);
        require_keys_eq!(
            ctx.accounts.diner_token.owner,
            ctx.accounts.holding.diner,
            ReservationError::NoHolding
        );

        // Burn with the pool PDA as the one-token delegate granted during `buy`. Seed material is
        // copied out first so the signer seeds don't borrow from `pool` across the CPI.
        let pool_seed = pool.pool_seed;
        let pool_bump = pool.bump;
        let pool_ai = pool.to_account_info();
        let seeds: &[&[u8]] = &[b"pool", pool_seed.as_ref(), &[pool_bump]];
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.diner_token.to_account_info(),
                    authority: pool_ai,
                },
                &[seeds],
            ),
            1,
        )?;

        let holding = &mut ctx.accounts.holding;
        holding.redeemed = true;
        let paid = holding.paid;
        let diner = holding.diner;
        let pool = &mut ctx.accounts.pool;
        pool.consumed_count = pool
            .consumed_count
            .checked_add(1)
            .ok_or(ReservationError::MathOverflow)?;

        emit!(CheckedIn { pool: pool.key(), diner, paid });
        Ok(())
    }

    /// §10.2 sweep + §7c-B accounting. After service_time the pool freezes and the whole reserve
    /// (every outstanding token's USDC, consumed or forfeited, plus accrued royalties) transfers
    /// to the restaurant.
    ///
    /// `forfeited_count` = outstanding tokens that never checked in = the recovered no-shows,
    /// which is the number the pitch turns on. `credits_to_honor` = p0 × consumed_count is the
    /// off-chain meal credit the restaurant owes at the table.
    pub fn sweep(ctx: Context<Sweep>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(
            ctx.accounts.authority.key() == pool.authority,
            ReservationError::NotAuthority
        );
        // Settlement waits for the grace window to close. Sweeping at service_time would forfeit a
        // diner who is still inside the window the restaurant promised them, which would make the
        // whole setting cosmetic. Trading, separately, still froze back at service_time.
        let settle_at = door_closes_at(pool.service_time, pool.grace_seconds)?;
        require!(!check_in_open(now, settle_at), ReservationError::NotYetFrozen);
        require!(!pool.swept, ReservationError::AlreadySwept);
        pool.frozen = true;
        pool.swept = true;

        let amount = pool
            .reserve_paid_in
            .checked_add(pool.royalties)
            .ok_or(ReservationError::MathOverflow)?;

        if amount > 0 {
            // seed material copied out; see the note in `buy`
            let pool_seed = pool.pool_seed;
            let pool_bump = pool.bump;
            let pool_ai = pool.to_account_info();
            let seeds: &[&[u8]] = &[b"pool", pool_seed.as_ref(), &[pool_bump]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.reserve.to_account_info(),
                        to: ctx.accounts.authority_usdc.to_account_info(),
                        authority: pool_ai,
                    },
                    &[seeds],
                ),
                amount,
            )?;
        }

        let consumed = pool.consumed_count;
        let forfeited = pool.n_sold.saturating_sub(consumed);
        let credits_to_honor = (pool.p0 as u128)
            .checked_mul(consumed as u128)
            .ok_or(ReservationError::MathOverflow)?;
        let credits_to_honor =
            u64::try_from(credits_to_honor).map_err(|_| ReservationError::MathOverflow)?;

        pool.reserve_paid_in = 0;
        pool.royalties = 0;

        emit!(Swept {
            pool: pool.key(),
            amount_swept: amount,
            consumed_count: consumed,
            forfeited_count: forfeited,
            credits_to_honor,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
#[instruction(pool_seed: [u8; 32])]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Pool::LEN,
        seeds = [b"pool", pool_seed.as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,
    /// pool token mint, authority = pool PDA
    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = pool,
        seeds = [b"mint", pool.key().as_ref()],
        bump
    )]
    pub mint: Box<Account<'info, Mint>>,
    /// USDC reserve, owned by the pool PDA
    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = pool,
        seeds = [b"reserve", pool.key().as_ref()],
        bump
    )]
    pub reserve: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub diner: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.pool_seed.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"mint", pool.key().as_ref()], bump)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"reserve", pool.key().as_ref()], bump = pool.reserve_bump)]
    pub reserve: Account<'info, TokenAccount>,
    #[account(mut, constraint = diner_usdc.owner == diner.key())]
    pub diner_usdc: Account<'info, TokenAccount>,
    #[account(mut, constraint = diner_token.owner == diner.key())]
    pub diner_token: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = diner,
        space = Holding::LEN,
        seeds = [b"holding", pool.key().as_ref(), diner.key().as_ref()],
        bump
    )]
    pub holding: Account<'info, Holding>,
    /// §7c-C: `init` (not init_if_needed) keyed by (authority, service_time, diner) — shared by
    /// every party-size band that night, so a second buy for the window fails here.
    #[account(
        init,
        payer = diner,
        space = WindowTicket::LEN,
        seeds = [
            b"window",
            pool.authority.as_ref(),
            &pool.service_time.to_le_bytes(),
            diner.key().as_ref()
        ],
        bump
    )]
    pub window_ticket: Account<'info, WindowTicket>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub diner: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.pool_seed.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"mint", pool.key().as_ref()], bump)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"reserve", pool.key().as_ref()], bump = pool.reserve_bump)]
    pub reserve: Account<'info, TokenAccount>,
    #[account(mut, constraint = diner_usdc.owner == diner.key())]
    pub diner_usdc: Account<'info, TokenAccount>,
    #[account(mut, constraint = diner_token.owner == diner.key())]
    pub diner_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        close = diner,
        seeds = [b"holding", pool.key().as_ref(), diner.key().as_ref()],
        bump = holding.bump,
        constraint = holding.diner == diner.key() @ ReservationError::NoHolding
    )]
    pub holding: Account<'info, Holding>,
    /// closed on sell-back, freeing the diner to rebuy / switch band (§7c-C)
    #[account(
        mut,
        close = diner,
        seeds = [
            b"window",
            pool.authority.as_ref(),
            &pool.service_time.to_le_bytes(),
            diner.key().as_ref()
        ],
        bump = window_ticket.bump
    )]
    pub window_ticket: Account<'info, WindowTicket>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CheckIn<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.pool_seed.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"mint", pool.key().as_ref()], bump)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub diner_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"holding", pool.key().as_ref(), holding.diner.as_ref()],
        bump = holding.bump
    )]
    pub holding: Account<'info, Holding>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.pool_seed.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"reserve", pool.key().as_ref()], bump = pool.reserve_bump)]
    pub reserve: Account<'info, TokenAccount>,
    #[account(mut, constraint = authority_usdc.owner == authority.key())]
    pub authority_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------- events
// The indexer (§10.3) subscribes to these to build the Postgres read model.

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub p0: u64,
    pub k: u64,
    pub n_max: u64,
    pub phi_bps: u16,
    pub service_time: i64,
    pub tc_seconds: i64,
    pub party_size: u8,
    pub grace_seconds: i64,
}

#[event]
pub struct Bought {
    pub pool: Pubkey,
    pub diner: Pubkey,
    pub price_paid: u64,
    pub n_sold: u64,
    pub theta_bps: u64,
}

#[event]
pub struct Sold {
    pub pool: Pubkey,
    pub diner: Pubkey,
    pub payout: u64,
    pub gross: u64,
    pub royalty: u64,
    pub n_sold: u64,
    pub theta_bps: u64,
}

#[event]
pub struct CheckedIn {
    pub pool: Pubkey,
    pub diner: Pubkey,
    pub paid: u64,
}

#[event]
pub struct Swept {
    pub pool: Pubkey,
    pub amount_swept: u64,
    pub consumed_count: u64,
    pub forfeited_count: u64,
    pub credits_to_honor: u64,
}
