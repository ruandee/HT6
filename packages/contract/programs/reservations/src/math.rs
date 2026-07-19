//! §4 / §7b pricing math. MUST match packages/shared-types/src/pricing.ts bit-for-bit — the mock
//! adapter and the UI compute prices with that TS implementation, and any divergence would let a
//! diner be charged a different price than they were quoted.
//!
//! Integer/fixed-point only (Solana has no floats). Intermediate products use u128 to avoid
//! overflow; rounding directions are LOCKED: buy rounds UP, sell rounds DOWN, so rounding can
//! never make the reserve pay out more than it took in (§6).

use crate::error::ReservationError;
use crate::state::BPS_DENOM;
use anchor_lang::prelude::*;

/// θ in basis points from remaining time (§7b piecewise form):
///   θ = 10000            if τ >= Tc
///   θ = floor(10000τ/Tc) if 0 <= τ < Tc
///   θ = 0                if τ <= 0
pub fn theta_bps(service_time: i64, now: i64, tc_seconds: i64) -> Result<u64> {
    require!(tc_seconds > 0, ReservationError::InvalidParams);
    let tau = service_time.saturating_sub(now);
    if tau <= 0 {
        return Ok(0);
    }
    if tau >= tc_seconds {
        return Ok(BPS_DENOM);
    }
    // 0 < tau < tc_seconds, both positive — safe as u128
    let v = (BPS_DENOM as u128)
        .checked_mul(tau as u128)
        .ok_or(ReservationError::MathOverflow)?
        / (tc_seconds as u128);
    Ok(v as u64)
}

/// premium = k · n · θ / 10000, rounded per `round_up`.
fn premium(k: u64, n: u64, theta: u64, round_up: bool) -> Result<u64> {
    let num = (k as u128)
        .checked_mul(n as u128)
        .ok_or(ReservationError::MathOverflow)?
        .checked_mul(theta as u128)
        .ok_or(ReservationError::MathOverflow)?;
    let den = BPS_DENOM as u128;
    let v = if round_up {
        num.checked_add(den - 1)
            .ok_or(ReservationError::MathOverflow)?
            / den
    } else {
        num / den
    };
    u64::try_from(v).map_err(|_| ReservationError::MathOverflow.into())
}

/// buy_price = p0 + ceil(k · n_sold · θ / 10000)
pub fn buy_price(p0: u64, k: u64, n_sold: u64, theta: u64) -> Result<u64> {
    p0.checked_add(premium(k, n_sold, theta, true)?)
        .ok_or(ReservationError::MathOverflow.into())
}

/// sell_price = p0 + floor(k · (n_sold − 1) · θ / 10000). Zero premium when n_sold == 0.
pub fn sell_price(p0: u64, k: u64, n_sold: u64, theta: u64) -> Result<u64> {
    let n = n_sold.saturating_sub(1);
    p0.checked_add(premium(k, n, theta, false)?)
        .ok_or(ReservationError::MathOverflow.into())
}

/// payout = sell_price · (10000 − φ) / 10000, rounded DOWN so the reserve never over-pays.
pub fn sell_payout(sell_price: u64, phi_bps: u16) -> Result<u64> {
    require!((phi_bps as u64) <= BPS_DENOM, ReservationError::InvalidParams);
    let net = (sell_price as u128)
        .checked_mul((BPS_DENOM - phi_bps as u64) as u128)
        .ok_or(ReservationError::MathOverflow)?
        / (BPS_DENOM as u128);
    u64::try_from(net).map_err(|_| ReservationError::MathOverflow.into())
}

/// The instant the check-in door closes = `service_time + grace_seconds`.
///
/// This is the ONLY thing grace moves. θ and the freeze still key off `service_time`, so pricing
/// and the solvency invariant are untouched (§7b/§4). `check_in` is valid before this instant;
/// `sweep` is legal from this instant on, so the two actions never overlap.
pub fn door_closes_at(service_time: i64, grace_seconds: i64) -> Result<i64> {
    require!(grace_seconds >= 0, ReservationError::InvalidParams);
    service_time
        .checked_add(grace_seconds)
        .ok_or(ReservationError::MathOverflow.into())
}

/// The shared deadline predicate keeps check-in and sweep mutually exclusive.
pub fn check_in_open(now: i64, door_closes: i64) -> bool {
    now < door_closes
}

#[cfg(test)]
mod tests {
    use super::*;

    // §7d demo params
    const P0: u64 = 40_000_000;
    const K: u64 = 3_000_000;
    const FULL: u64 = 10_000;

    #[test]
    fn matches_ts_reference_at_full_theta() {
        // n=6 -> $58.00, n=7 -> $61.00 (verified against the TS implementation)
        assert_eq!(buy_price(P0, K, 6, FULL).unwrap(), 58_000_000);
        assert_eq!(buy_price(P0, K, 7, FULL).unwrap(), 61_000_000);
        // sell at n=7 quotes the n-1 rung
        assert_eq!(sell_price(P0, K, 7, FULL).unwrap(), 58_000_000);
        // net of 5% royalty -> $55.10
        assert_eq!(sell_payout(58_000_000, 500).unwrap(), 55_100_000);
    }

    #[test]
    fn theta_piecewise() {
        // far out -> full
        assert_eq!(theta_bps(1_000_000, 0, 86_400).unwrap(), FULL);
        // exactly at the cliff -> full
        assert_eq!(theta_bps(86_400, 0, 86_400).unwrap(), FULL);
        // halfway through the cliff -> half
        assert_eq!(theta_bps(43_200, 0, 86_400).unwrap(), 5_000);
        // at/after service -> zero
        assert_eq!(theta_bps(0, 0, 86_400).unwrap(), 0);
        assert_eq!(theta_bps(-10, 0, 86_400).unwrap(), 0);
    }

    #[test]
    fn decay_collapses_to_floor() {
        // θ=0 => price is exactly the meal-credit floor, never below (§7b)
        assert_eq!(buy_price(P0, K, 19, 0).unwrap(), P0);
        assert_eq!(sell_price(P0, K, 19, 0).unwrap(), P0);
    }

    #[test]
    fn rounding_never_favours_the_seller() {
        // buy rounds UP, sell rounds DOWN, so buy >= sell at the same rung — the reserve can
        // never be drained by rounding (§6).
        for n in 1..50u64 {
            for theta in [1u64, 3_333, 5_000, 9_999, 10_000] {
                let b = buy_price(P0, K, n - 1, theta).unwrap();
                let s = sell_price(P0, K, n, theta).unwrap();
                assert!(b >= s, "n={n} theta={theta}: buy {b} < sell {s}");
            }
        }
    }

    #[test]
    fn solvency_reserve_covers_sellbacks() {
        // Buy up the curve accumulating the reserve, then sell all the way back down and assert
        // the reserve is never overdrawn — the §4 invariant, at full θ (the worst case, since
        // decay only reduces payouts).
        let mut reserve: u64 = 0;
        let mut n: u64 = 0;
        for _ in 0..20 {
            reserve += buy_price(P0, K, n, FULL).unwrap();
            n += 1;
        }
        while n > 0 {
            let sp = sell_price(P0, K, n, FULL).unwrap();
            let payout = sell_payout(sp, 500).unwrap();
            assert!(payout <= reserve, "insolvent at n={n}");
            reserve -= payout;
            n -= 1;
        }
        // φ retained on every round trip leaves a surplus
        assert!(reserve > 0);
    }

    #[test]
    fn no_overflow_at_extremes() {
        assert!(buy_price(u64::MAX, 1, 1, FULL).is_err());
        assert!(premium(u64::MAX, u64::MAX, FULL, true).is_err());
    }

    #[test]
    fn grace_moves_only_the_door_not_the_curve() {
        const SERVICE: i64 = 1_000_000;
        const GRACE: i64 = 15 * 60; // 15 minutes

        // the door closes after service, by exactly the grace
        let closes = door_closes_at(SERVICE, GRACE).unwrap();
        assert_eq!(closes, SERVICE + 900);
        assert!(check_in_open(closes - 1, closes));
        assert!(!check_in_open(closes, closes));
        // zero grace = door closes at service (the old behaviour)
        assert_eq!(door_closes_at(SERVICE, 0).unwrap(), SERVICE);
        // negative grace would let sweep run before service; refuse it
        assert!(door_closes_at(SERVICE, -1).is_err());
        assert!(door_closes_at(i64::MAX, 1).is_err());

        // THE POINT: inside the grace window θ is already 0 and trading is frozen, but the diner
        // can still walk in. Grace must not resurrect the premium.
        let inside = SERVICE + 60;
        assert_eq!(theta_bps(SERVICE, inside, 86_400).unwrap(), 0);
        assert_eq!(buy_price(P0, K, 6, 0).unwrap(), P0); // price sits on the floor, not the curve
        assert!(check_in_open(inside, closes)); // ...and check-in is still open
    }
}
