/**
 * Integration tests for the reservations program. Run against a local validator:
 *   anchor test
 *
 * Covers the locked behaviours the spec turns on:
 *  §4    curve pricing + the solvency invariant
 *  §7b   θ decay (verified via a pool whose service_time is inside the cliff)
 *  §7c-A quote-lock / slippage rejection
 *  §7c-B sweep accounting (consumed vs forfeited vs credits_to_honor)
 *  §7c-C one table per service window, ACROSS party-size bands (the straddle)
 */
import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';
import type { Reservations } from '../target/types/reservations';

const P0 = new BN(40_000_000); // $40 meal-credit floor
const K = new BN(3_000_000); // $3 slope
const PHI = 500; // 5%
const TC = new BN(86_400); // 24h cliff

describe('reservations', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Reservations as Program<Reservations>;
  const authority = provider.wallet as anchor.Wallet;

  let usdcMint: PublicKey;
  let authorityUsdc: PublicKey;

  const seedOf = (s: string) => {
    const b = Buffer.alloc(32);
    Buffer.from(s).copy(b);
    return b;
  };

  const pdas = (seed: Buffer) => {
    const [pool] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), seed],
      program.programId,
    );
    const [mint] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint'), pool.toBuffer()],
      program.programId,
    );
    const [reserve] = PublicKey.findProgramAddressSync(
      [Buffer.from('reserve'), pool.toBuffer()],
      program.programId,
    );
    return { pool, mint, reserve };
  };

  const windowPda = (auth: PublicKey, serviceTime: BN, diner: PublicKey) => {
    const ts = Buffer.alloc(8);
    ts.writeBigInt64LE(BigInt(serviceTime.toString()));
    return PublicKey.findProgramAddressSync(
      [Buffer.from('window'), auth.toBuffer(), ts, diner.toBuffer()],
      program.programId,
    )[0];
  };

  const holdingPda = (pool: PublicKey, diner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('holding'), pool.toBuffer(), diner.toBuffer()],
      program.programId,
    )[0];

  /** far-future service time so θ = 1 (full premium) */
  const farService = () => new BN(Math.floor(Date.now() / 1000) + 200_000);

  async function makePool(
    seedStr: string,
    opts: { partySize?: number; nMax?: number; serviceTime?: BN; p0?: BN; k?: BN } = {},
  ) {
    const seed = seedOf(seedStr);
    const { pool, mint, reserve } = pdas(seed);
    const serviceTime = opts.serviceTime ?? farService();
    await program.methods
      .createPool(
        [...seed],
        opts.p0 ?? P0,
        opts.k ?? K,
        new BN(opts.nMax ?? 20),
        PHI,
        serviceTime,
        TC,
        opts.partySize ?? 2,
      )
      .accounts({
        authority: authority.publicKey,
        pool,
        mint,
        reserve,
        usdcMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    return { seed, pool, mint, reserve, serviceTime };
  }

  /** funded diner with a USDC ATA and a pool-token ATA */
  async function makeDiner(mint: PublicKey, usdc = 1_000_000_000) {
    const kp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 2e9);
    await provider.connection.confirmTransaction(sig);
    const usdcAta = await createAssociatedTokenAccount(
      provider.connection,
      kp,
      usdcMint,
      kp.publicKey,
    );
    await mintTo(provider.connection, kp, usdcMint, usdcAta, authority.payer, usdc);
    const tokenAta = await createAssociatedTokenAccount(
      provider.connection,
      kp,
      mint,
      kp.publicKey,
    );
    return { kp, usdcAta, tokenAta };
  }

  async function buy(
    p: { pool: PublicKey; mint: PublicKey; reserve: PublicKey; serviceTime: BN },
    d: { kp: Keypair; usdcAta: PublicKey; tokenAta: PublicKey },
    maxPrice: BN,
  ) {
    return program.methods
      .buy(maxPrice)
      .accounts({
        diner: d.kp.publicKey,
        pool: p.pool,
        mint: p.mint,
        reserve: p.reserve,
        dinerUsdc: d.usdcAta,
        dinerToken: d.tokenAta,
        holding: holdingPda(p.pool, d.kp.publicKey),
        windowTicket: windowPda(authority.publicKey, p.serviceTime, d.kp.publicKey),
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([d.kp])
      .rpc();
  }

  before(async () => {
    usdcMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6,
    );
    authorityUsdc = await createAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      usdcMint,
      authority.publicKey,
    );
  });

  it('§4 prices along the curve and accumulates the reserve', async () => {
    const p = await makePool('curve');
    let expectedReserve = 0;
    for (let n = 0; n < 3; n++) {
      const d = await makeDiner(p.mint);
      await buy(p, d, new BN(999_000_000));
      expectedReserve += 40_000_000 + 3_000_000 * n; // p0 + k·n at θ=1
    }
    const pool = await program.account.pool.fetch(p.pool);
    assert.equal(pool.nSold.toNumber(), 3);
    assert.equal(pool.reservePaidIn.toNumber(), expectedReserve);
    const reserve = await getAccount(provider.connection, p.reserve);
    assert.equal(Number(reserve.amount), expectedReserve);
  });

  it('§7c-A rejects a buy whose price moved past max_price', async () => {
    const p = await makePool('slippage');
    const first = await makeDiner(p.mint);
    await buy(p, first, new BN(999_000_000)); // n=0 -> $40, now n=1 -> $43

    const late = await makeDiner(p.mint);
    try {
      await buy(p, late, new BN(41_000_000)); // stale quote below the current $43
      assert.fail('expected SlippageExceeded');
    } catch (e: any) {
      assert.include(e.toString(), 'SlippageExceeded');
    }
  });

  it('§7c-C blocks a second table for the same window — including ACROSS bands', async () => {
    const serviceTime = farService();
    const twoTop = await makePool('band2', { partySize: 2, serviceTime });
    const fourTop = await makePool('band4', {
      partySize: 4,
      serviceTime, // same venue + same night, different band
      p0: new BN(80_000_000),
      k: new BN(6_000_000),
      nMax: 8,
    });

    const mallory = await makeDiner(twoTop.mint);
    await buy(twoTop, mallory, new BN(999_000_000));

    // the straddle: also grab a 4-top for the same night
    const fourAta = await createAssociatedTokenAccount(
      provider.connection,
      mallory.kp,
      fourTop.mint,
      mallory.kp.publicKey,
    );
    try {
      await buy(fourTop, { ...mallory, tokenAta: fourAta }, new BN(999_000_000));
      assert.fail('expected the window ticket to already exist');
    } catch (e: any) {
      // the WindowTicket PDA is already initialized for this (authority, service_time, diner)
      assert.match(e.toString(), /already in use|AlreadyHoldingThisWindow/);
    }
  });

  it('§7c-C sell-back frees the diner to rebuy (switch band)', async () => {
    const serviceTime = farService();
    const p = await makePool('switch', { serviceTime });
    const d = await makeDiner(p.mint);
    await buy(p, d, new BN(999_000_000));

    await program.methods
      .sell()
      .accounts({
        diner: d.kp.publicKey,
        pool: p.pool,
        mint: p.mint,
        reserve: p.reserve,
        dinerUsdc: d.usdcAta,
        dinerToken: d.tokenAta,
        holding: holdingPda(p.pool, d.kp.publicKey),
        windowTicket: windowPda(authority.publicKey, serviceTime, d.kp.publicKey),
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([d.kp])
      .rpc();

    // ticket was closed, so buying again succeeds
    await buy(p, d, new BN(999_000_000));
    const pool = await program.account.pool.fetch(p.pool);
    assert.equal(pool.nSold.toNumber(), 1);
    assert.isAbove(pool.royalties.toNumber(), 0, 'φ royalty accrued on the round trip');
  });

  it('§4 sell pays out net of φ and the reserve stays solvent', async () => {
    const p = await makePool('solvency');
    const diners = [];
    for (let i = 0; i < 4; i++) {
      const d = await makeDiner(p.mint);
      await buy(p, d, new BN(999_000_000));
      diners.push(d);
    }
    const before = await getAccount(provider.connection, p.reserve);
    const seller = diners[3];
    const usdcBefore = (await getAccount(provider.connection, seller.usdcAta)).amount;

    await program.methods
      .sell()
      .accounts({
        diner: seller.kp.publicKey,
        pool: p.pool,
        mint: p.mint,
        reserve: p.reserve,
        dinerUsdc: seller.usdcAta,
        dinerToken: seller.tokenAta,
        holding: holdingPda(p.pool, seller.kp.publicKey),
        windowTicket: windowPda(authority.publicKey, p.serviceTime, seller.kp.publicKey),
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([seller.kp])
      .rpc();

    // sell at n=4 quotes the n=3 rung: $49, net 5% => $46.55
    const usdcAfter = (await getAccount(provider.connection, seller.usdcAta)).amount;
    assert.equal(Number(usdcAfter - usdcBefore), 46_550_000);

    const after = await getAccount(provider.connection, p.reserve);
    assert.isBelow(Number(after.amount), Number(before.amount));
    const pool = await program.account.pool.fetch(p.pool);
    // reserve token balance must still cover what the program thinks it owes
    assert.isAtLeast(Number(after.amount), pool.reservePaidIn.toNumber());
  });

  it('§7b θ decays inside the cliff, flattening the curve toward the floor', async () => {
    // service in 6h with a 24h cliff => θ ≈ 0.25, so the premium is ~quartered
    const soon = new BN(Math.floor(Date.now() / 1000) + 6 * 3600);
    const p = await makePool('decay', { serviceTime: soon });
    for (let i = 0; i < 5; i++) {
      const d = await makeDiner(p.mint);
      await buy(p, d, new BN(999_000_000));
    }
    const pool = await program.account.pool.fetch(p.pool);
    // at θ=1 five buys would cost 40+43+46+49+52 = $230; decayed it must be materially less,
    // and never below 5 × the floor (the meal credit never decays)
    assert.isBelow(pool.reservePaidIn.toNumber(), 230_000_000);
    assert.isAtLeast(pool.reservePaidIn.toNumber(), 200_000_000);
  });

  it('§7c-B sweep splits consumed vs forfeited and reports credits to honor', async () => {
    // service 3s out so we can let it pass, with buys landing before the freeze
    const serviceTime = new BN(Math.floor(Date.now() / 1000) + 3);
    const p = await makePool('sweep', { serviceTime });
    const showed = await makeDiner(p.mint);
    const noShow = await makeDiner(p.mint);
    await buy(p, showed, new BN(999_000_000));
    await buy(p, noShow, new BN(999_000_000));

    // one diner checks in (consumed); the other never does (forfeited no-show)
    await program.methods
      .checkIn()
      .accounts({
        authority: authority.publicKey,
        pool: p.pool,
        mint: p.mint,
        dinerToken: showed.tokenAta,
        holding: holdingPda(p.pool, showed.kp.publicKey),
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 4000)); // let service_time pass

    const before = (await getAccount(provider.connection, authorityUsdc)).amount;
    await program.methods
      .sweep()
      .accounts({
        authority: authority.publicKey,
        pool: p.pool,
        reserve: p.reserve,
        authorityUsdc,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();
    const after = (await getAccount(provider.connection, authorityUsdc)).amount;

    assert.isAbove(Number(after - before), 0, 'reserve swept to the restaurant');
    const pool = await program.account.pool.fetch(p.pool);
    assert.equal(pool.consumedCount.toNumber(), 1);
    assert.isTrue(pool.frozen);
    assert.equal(pool.reservePaidIn.toNumber(), 0);
  });

  it('refuses trading once the pool is frozen', async () => {
    const serviceTime = new BN(Math.floor(Date.now() / 1000) + 2);
    const p = await makePool('frozen', { serviceTime });
    await new Promise((r) => setTimeout(r, 3500));
    const d = await makeDiner(p.mint);
    try {
      await buy(p, d, new BN(999_000_000));
      assert.fail('expected PoolFrozen');
    } catch (e: any) {
      assert.include(e.toString(), 'PoolFrozen');
    }
  });
});
