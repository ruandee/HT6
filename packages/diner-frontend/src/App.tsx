import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { api, errText, splitUsdc, usdc, type Holding, type PoolSummary, type Quote } from './api';
import { CurveChart } from './CurveChart';
import { BuySheet } from './BuySheet';
import { Calendar } from './Calendar';
import { SellSheet, Wallet, WalletPill } from './Wallet';
import { PartySize, bandFor } from './PartySize';
import { ease, fadeUp, group, hoverLift, tapPress } from './motion';
import { venueState } from './venue';
import { UnifoldCheckout } from './UnifoldCheckout';
import { assertKeyMatch, unifoldEnabled } from './unifold';

// p0/k per band, mirroring the server's BANDS table (§4a). Used to draw the curve.
const BAND_PARAMS: Record<number, { p0: string; k: string }> = {
  2: { p0: '40000000', k: '3000000' },
  4: { p0: '80000000', k: '6000000' },
};

export default function App() {
  const [poolId, setPoolId] = useState('');
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [guests, setGuests] = useState(2);
  const [q, setQ] = useState<Quote | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [sheet, setSheet] = useState<null | {
    intentId: string;
    price: string;
    expires: string;
    /** present only on the real Unifold path — StubGateway returns a hosted_url instead. */
    clientSecret?: string;
  }>(null);
  /** Non-null while the Unifold checkout modal is open for this intent. */
  const [checkout, setCheckout] = useState<null | { intentId: string; clientSecret: string }>(null);
  /**
   * The diner paid, but the token is minted by the `payment_intent.succeeded` WEBHOOK, not by the
   * modal's onSuccess. This holds the UI in a "confirming" state until the poll below sees the
   * holding actually appear — so we never claim a table the chain hasn't granted yet.
   */
  const [settling, setSettling] = useState(false);
  /** the holding the diner is about to sell back, held while the confirm sheet is up */
  const [sellFor, setSellFor] = useState<Holding | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const prevN = useRef(0);

  const refresh = useCallback(async (id: string) => {
    const [quote, hs, ps] = await Promise.all([api.quote(id), api.holdings(), api.pools()]);
    setQ(quote);
    setHoldings(hs);
    setPools(ps);
    return quote;
  }, []);

  useEffect(() => {
    api.demoPoolId().then(({ pool_id }) => {
      setPoolId(pool_id);
      refresh(pool_id);
    });
  }, [refresh]);

  function selectPool(id: string) {
    setPoolId(id);
    setQ(null); // avoid showing the previous night's curve while the new one loads
    refresh(id);
  }

  const currentPool = pools.find((p) => p.pool_id === poolId);
  // all bands offered on the selected night, and the dates available in the chosen band
  const bandsTonight = currentPool
    ? pools.filter((p) => p.date_iso === currentPool.date_iso)
    : [];

  /** Changing party size keeps the date and swaps to the band that fits. */
  function selectGuests(n: number) {
    setGuests(n);
    const target = bandFor(bandsTonight, n);
    if (target && target.pool_id !== poolId) selectPool(target.pool_id);
  }

  // poll so the curve moves when other sessions buy (the §11 "ticks up" moment)
  useEffect(() => {
    if (!poolId) return;
    const t = setInterval(() => refresh(poolId), 2500);
    return () => clearInterval(t);
  }, [poolId, refresh]);

  useEffect(() => {
    if (q && q.n_sold !== prevN.current) prevN.current = q.n_sold;
  }, [q]);

  async function startBuy() {
    try {
      const r = await api.buy(poolId);
      // Real gateway returns { client_secret, publishable_key }; StubGateway returns { hosted_url }.
      assertKeyMatch(r.checkout?.publishable_key);
      setSheet({
        intentId: r.deposit_intent_id,
        price: r.max_price,
        expires: r.expires_at,
        clientSecret: r.checkout?.client_secret,
      });
    } catch (e) {
      setFlash(errText(e));
      setTimeout(() => setFlash(null), 4200);
    }
  }

  /**
   * The purchase moment. Two paths behind one button (UNIFOLD_INTEGRATION.md §6):
   *
   *  - REAL: hand the locked-quote intent's `client_secret` to Unifold's checkout modal, which
   *    collects the payment in whatever token the diner holds. We mint NOTHING here — app-services
   *    mints when Unifold delivers `payment_intent.succeeded` to its webhook.
   *  - STUB: post the same event shape straight at /webhooks/unifold, so the identical server-side
   *    handler runs with no Unifold account required.
   */
  async function confirmBuy(intentId: string, clientSecret?: string) {
    if (unifoldEnabled && clientSecret) {
      setCheckout({ intentId, clientSecret });
      return;
    }
    // Without this catch a rejected settle became an unhandled promise rejection: the button reset
    // and NOTHING appeared on screen. A payment step that fails silently is worse than one that
    // fails loudly, so every branch that can throw now surfaces its reason.
    try {
      await api.stubSettle(intentId, 'succeeded');
      setSheet(null);
      const label = currentPool?.label;
      await refresh(poolId);
      setFlash(label ? `You're in. See you ${label}.` : "You're in.");
    } catch (e) {
      setFlash(errText(e, "That didn't go through. Try again."));
    }
    setTimeout(() => setFlash(null), 4200);
  }

  /** Sells the holding the wallet card names, NOT the pool on screen — they're often different. */
  async function sellBack(h: Holding) {
    setSellFor(null);
    try {
      const r = await api.sell(h.pool_id);
      await refresh(poolId);
      setFlash(`${usdc(r.payout_amount)} back in your account.`);
    } catch (e) {
      setFlash(errText(e, "Couldn't sell that back. Try again."));
    }
    setTimeout(() => setFlash(null), 4200);
  }

  // §7c-C is per SERVICE WINDOW, so holding any band tonight blocks buying another.
  const windowPoolIds = new Set(bandsTonight.map((b) => b.pool_id));
  const heldThisWindow = holdings.filter(
    (h) => h.status === 'held' && windowPoolIds.has(h.pool_id),
  );
  const heldOtherBand = heldThisWindow.filter((h) => h.pool_id !== poolId);
  /** everything the diner holds, any night — what the wallet section below is made of */
  const allHeld = holdings.filter((h) => h.status === 'held');
  /**
   * Settlement lands out-of-band: Unifold posts `payment_intent.succeeded` to app-services, which
   * mints the token. The 2.5s poll above is what surfaces it, so we watch for the holding to appear
   * rather than trusting the modal's onSuccess callback.
   */
  useEffect(() => {
    if (!settling || heldThisWindow.length === 0) return;
    setSettling(false);
    setSheet(null);
    setFlash(currentPool?.label ? `You're in. See you ${currentPool.label}.` : "You're in.");
    const t = setTimeout(() => setFlash(null), 4200);
    return () => clearTimeout(t);
  }, [settling, heldThisWindow.length, currentPool?.label]);

  const venue = venueState(bandsTonight);
  const price = q ? splitUsdc(q.buy_price) : { dollars: '—', cents: '00' };
  const left = q ? q.n_max - q.n_sold : 0;
  const floorP0 = currentPool
    ? (BAND_PARAMS[currentPool.party_size]?.p0 ?? '40000000')
    : '40000000';

  return (
    <MotionConfig reducedMotion="user">
      <div className="orbs">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <motion.div className="shell" variants={group(0.07)} initial="hidden" animate="show">
        <motion.header className="topbar" variants={fadeUp}>
          <div className="brand">
            <span className="brand-dots">
              <i />
              <i />
            </span>
            hora
          </div>
          <WalletPill holdings={allHeld} />
        </motion.header>

        {/* Names the room and reports what it's doing, in the same shape the phone uses. The
            fill word is derived (see venue.ts), so it stays true as the night sells. */}
        <motion.h1 className="headline" variants={fadeUp}>
          {venue.name} is
          <br />
          <span className="script">{venue.fill}</span>.
        </motion.h1>
        {/* "all sizes" because the curve panel below counts one band (6 of 20) while this counts
            the whole night (9 of 28); without it the two numbers look like a bug */}
        <motion.p className="muted" variants={fadeUp} style={{ maxWidth: 380, marginTop: 20 }}>
          {currentPool ? `${currentPool.label} · ` : ''}
          {venue.cap > 0
            ? `${venue.sold} of ${venue.cap} tables gone, all sizes`
            : 'Loading tonight'}
        </motion.p>

        {/* ---- main grid ----
            Calendar first and unglazed, so the night you're pricing is settled before anything
            asks you to pay for it. The two glass panels to its right are the consequence. */}
        <motion.div className="grid" variants={group(0.08)}>
          <motion.div variants={fadeUp}>
            <Calendar pools={pools} selected={poolId} guests={guests} onSelect={selectPool} />
          </motion.div>

          {/* curve panel */}
          <motion.section className="glass" variants={fadeUp} style={{ padding: 26 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 18,
                gap: 16,
              }}
            >
              <div className="eyebrow" style={{ flex: 1 }}>
                Tonight&apos;s pricing
              </div>
            </div>
            {q && currentPool ? (
              <CurveChart
                p0={BAND_PARAMS[currentPool.party_size]?.p0 ?? '40000000'}
                k={BAND_PARAMS[currentPool.party_size]?.k ?? '3000000'}
                nMax={q.n_max}
                nSold={q.n_sold}
                thetaBps={q.theta_bps}
                phiBps={500}
              />
            ) : (
              <div style={{ height: 260 }} />
            )}
            <div style={{ marginTop: 20 }}>
              <div className="stat-label" style={{ marginBottom: 9 }}>
                {q ? `${q.n_sold} of ${q.n_max} taken` : ' '}
              </div>
              <div className="pips">
                {q &&
                  Array.from({ length: q.n_max }, (_, i) => (
                    <span key={i} className={`pip ${i < q.n_sold ? 'pip--sold' : ''}`} />
                  ))}
              </div>
            </div>
          </motion.section>

          {/* buy panel */}
          <motion.section
            className="glass glass--strong"
            variants={fadeUp}
            style={{ padding: 30 }}
          >
            <PartySize bands={bandsTonight} guests={guests} onGuests={selectGuests} />

            <div
              style={{ height: 1, background: 'var(--hairline)', margin: '24px 0 22px' }}
            />

            <div className="eyebrow" style={{ marginBottom: 16 }}>
              Right now
            </div>
            {/* the §11 "curve ticks up" moment: when another session buys, the poll brings a new
                price and it rolls over instead of snapping */}
            <div className="price price--hero">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={q?.buy_price ?? 'pending'}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={ease(0.26)}
                  style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}
                >
                  <span>${price.dollars}</span>
                  <span className="price__cents">.{price.cents}</span>
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>
              {usdc(floorP0)} comes off your bill.
              {left > 0 && left <= 5 && (
                <>
                  {' '}
                  <strong style={{ color: 'var(--coral-deep)' }}>
                    {left} left.
                  </strong>
                </>
              )}
            </div>

            <motion.button
              className="btn btn--primary"
              whileHover={hoverLift}
          whileTap={tapPress}
              style={{ width: '100%', marginTop: 26 }}
              onClick={startBuy}
              disabled={!q || q.frozen || left === 0 || heldThisWindow.length > 0}
            >
              {heldThisWindow.length > 0
                ? "You're booked"
                : left === 0
                  ? 'Sold out'
                  : 'Claim this table'}
            </motion.button>
            {heldOtherBand.length > 0 && (
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink-45)',
                  textAlign: 'center',
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                You have the table for{' '}
                {bandsTonight.find((b) => b.pool_id === heldOtherBand[0]!.pool_id)?.party_size ??
                  ''}{' '}
                this night. Sell it back below to switch sizes.
              </div>
            )}
          </motion.section>
        </motion.div>

        {/* Selling used to live in the buy panel, which meant the panel changed shape depending
            on what you held and could only ever offer back the night you happened to be looking
            at. It's the wallet's job, and the wallet holds every night at once. */}
        <motion.div variants={fadeUp}>
          <Wallet
            holdings={allHeld}
            pools={pools}
            viewingPoolId={poolId}
            onSell={setSellFor}
          />
        </motion.div>
      </motion.div>

      {/* AnimatePresence so the sheet can animate OUT on cancel/confirm, not just in */}
      <AnimatePresence>
        {sheet && (
          <BuySheet
            key="sheet"
            price={sheet.price}
            floor={floorP0}
            partySize={currentPool?.party_size ?? 2}
            expiresAt={sheet.expires}
            settling={settling}
            onConfirm={() => confirmBuy(sheet.intentId, sheet.clientSecret)}
            onExpire={async () => {
              // Don't fake an expiry while the diner is mid-payment in the Unifold modal — on the
              // real path expiry is Unifold's call, delivered as `payment_intent.expired`.
              if (settling || checkout) return;
              if (!unifoldEnabled || !sheet.clientSecret) {
                await api.stubSettle(sheet.intentId, 'expired');
              }
              setSheet(null);
              setFlash('That price expired. Have another look.');
              setTimeout(() => setFlash(null), 4200);
            }}
            onClose={() => setSheet(null)}
          />
        )}

        {sellFor && (
          <SellSheet
            key="sell"
            holding={sellFor}
            label={pools.find((p) => p.pool_id === sellFor.pool_id)?.label ?? 'your'}
            onConfirm={() => sellBack(sellFor)}
            onClose={() => setSellFor(null)}
          />
        )}
      </AnimatePresence>

      {/* Real Unifold checkout. Mounting opens the modal; it renders nothing itself. Present only
          when a publishable key is configured, so the stub demo is untouched. */}
      {checkout && (
        <UnifoldCheckout
          clientSecret={checkout.clientSecret}
          onSubmitted={() => {
            // Paid — but NOT booked until the webhook mints. Hold the sheet in its confirming state.
            setCheckout(null);
            setSettling(true);
            refresh(poolId);
          }}
          onFailed={(msg) => {
            setCheckout(null);
            setSettling(false);
            setFlash(msg);
            setTimeout(() => setFlash(null), 4200);
          }}
          onDismissed={() => setCheckout(null)}
        />
      )}

      <AnimatePresence>
        {flash && (
          <motion.div
            className="glass"
            /* x holds -50% across every state, because motion writes `transform` wholesale and the
               usual translateX(-50%) centering would be clobbered */
            initial={{ opacity: 0, x: '-50%', y: 10, scale: 0.98 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: 6, scale: 0.98 }}
            transition={ease(0.26)}
            style={{
              position: 'fixed',
              bottom: 26,
              left: '50%',
              padding: '15px 26px',
              zIndex: 30,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {flash}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
