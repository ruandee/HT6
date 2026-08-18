/**
 * The write-up at `/writeup`: the Devpost text, rebuilt as a first-party page.
 *
 * It used to be an outbound link to devpost.com/software/hora. That project is gone, so the story
 * lives here instead — same words, set in the product's own type and glass rather than Devpost's
 * chrome, and reachable without leaving the origin.
 *
 * The equations are the reason this isn't just a Markdown dump. Every formula below is real LaTeX,
 * typeset to SVG at build time by scripts/render-writeup-math.mjs (the same rule the architecture
 * diagram follows) and imported as flat markup — so a long page of mathematics ships no KaTeX
 * bundle and no math webfont. See writeupMath.generated.ts.
 *
 * Motion is deliberately calmer than the landing page: this is a reading surface, so sections fade
 * in once on approach and nothing is welded to the scrollbar. Paragraphs never stagger in — text
 * that assembles itself word-block by word-block is an animation tax on the one thing here you came
 * to actually do, which is read.
 */
import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { fadeUp, group, reveal, inView, hoverLift, tapPress } from './motion';
import { MATH, type MathKey } from './writeupMath.generated';

/** The National Restaurant Association report cited in Inspiration. */
const NRA_URL =
  'https://restaurant.org/research-and-media/media/press-releases/access-denied-the-rise-of-black-market-reservations-disrupting-the-restaurant-dining-experience/';

/**
 * A build-time-typeset equation. The markup is trusted (it's our own generated SVG, never user
 * input), so dangerouslySetInnerHTML is the honest tool here rather than a risk. Inline math sizes
 * itself off the surrounding font; block math centres and, on a narrow screen, scrolls sideways
 * inside its own rail rather than forcing the page to.
 */
function Math({ name, block = false }: { name: MathKey; block?: boolean }) {
  const html = { __html: MATH[name] };
  return block ? (
    <div className="math math--block" role="math" dangerouslySetInnerHTML={html} />
  ) : (
    <span className="math math--inline" role="math" dangerouslySetInnerHTML={html} />
  );
}

/** Inline monospace for identifiers pulled out of the code — `grace_seconds`, `max_price`, … */
function Tok({ children }: { children: React.ReactNode }) {
  return <code className="tok">{children}</code>;
}

/** A fenced code block. `lang` is a quiet corner label, not syntax highlighting we don't have. */
function Code({ lang, children }: { lang?: string; children: string }) {
  return (
    <div className="code">
      {lang && <span className="code__lang">{lang}</span>}
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

/**
 * A transaction receipt, for the two real mainnet moves in "On Unifold". Rendered as an aligned
 * label/value card rather than a code fence because that's what it is — a record, and the emotional
 * peak of the whole write-up (the 19 cents that are the mechanism, paid for real).
 */
function Receipt({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="glass receipt">
      <div className="receipt__title">{title}</div>
      <dl className="receipt__rows">
        {rows.map(([k, v]) => (
          <div className="receipt__row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The stack, verbatim from "How I built it". */
const STACK: [string, React.ReactNode][] = [
  ['Contract', <>Rust, Anchor 0.30.1 (<Tok>anchor-lang</Tok>, <Tok>anchor-spl</Tok>), Solana</>],
  [
    'Chain client + indexer',
    <>
      TypeScript, <Tok>@solana/web3.js</Tok>, <Tok>@coral-xyz/anchor</Tok>,{' '}
      <Tok>@solana/spl-token</Tok>, Postgres via <Tok>pg</Tok>
    </>,
  ],
  [
    'Backend',
    <>
      Node, Express 4, plain <Tok>fetch</Tok> against Unifold's REST API, <Tok>node:crypto</Tok> for
      webhook HMAC
    </>,
  ],
  [
    'Five React clients',
    <>
      React 18, Vite 5, TypeScript 5.6, Framer Motion, Recharts, <Tok>@unifold/connect-react</Tok>
    </>,
  ],
  ['Payments', 'Unifold locked-quote payment intents and treasury transfers, USDC settling on Base'],
  [
    'Tests',
    <>
      <Tok>cargo test</Tok> for contract math, <Tok>node:test</Tok> for the gateway, Playwright for
      UI flows
    </>,
  ],
  ['Deploy', 'Vercel for the static clients, Google Cloud Run (Docker) for app-services'],
];

/** The four things "you can watch happen". */
const WATCH: [React.ReactNode, React.ReactNode][] = [
  [
    'The curve climbs',
    <>
      each buy moves <Math name="nToN1" />, next table costs <Math name="k" /> more.
    </>,
  ],
  ['It stays liquid', 'a sell-back pays out immediately, price steps down, royalty accrues.'],
  ['It flattens', 'advance the clock toward service and the premium decays onto the floor.'],
  [
    'The sweep',
    'after service, consumed vs. forfeited (the recovered no-shows), total swept, credits to honor.',
  ],
];

export default function Writeup({
  onHome,
  onDemo,
}: {
  onHome: (e: React.MouseEvent) => void;
  onDemo: (e: React.MouseEvent) => void;
}) {
  const reduce = Boolean(useReducedMotion());
  const enter = useMemo(() => fadeUp(reduce), [reduce]);
  const rv = useMemo(() => reveal(reduce), [reduce]);

  /** A major section: uppercase label + rule, a title, then its prose. Fades in once on approach. */
  const Section = ({
    label,
    title,
    children,
  }: {
    label: string;
    title: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <motion.section
      className="writeup__section"
      variants={rv}
      initial="hidden"
      whileInView="show"
      viewport={inView}
    >
      <div className="eyebrow">{label}</div>
      <h2 className="writeup__h2">{title}</h2>
      {children}
    </motion.section>
  );

  return (
    <div className="writeup">
      {/* ---- masthead ---- */}
      <motion.header
        className="writeup__head"
        variants={group(0.08)}
        initial="hidden"
        animate="show"
      >
        <motion.div className="topbar" variants={enter}>
          <a className="brand brand--link" href="/" onClick={onHome}>
            <span className="brand-dots">
              <i />
              <i />
            </span>
            hora
          </a>
          <div className="stat-label">Devpost write-up</div>
        </motion.div>

        <motion.div className="eyebrow" variants={enter}>
          Tokenized reservations
        </motion.div>
        <motion.h1 className="writeup__title" variants={enter}>
          Reservations, <span className="script">priced</span> by an automated market maker.
        </motion.h1>
        <motion.p className="writeup__tagline" variants={enter}>
          Tokenise your reservations — cut out the credit-card holds and the third-party reservation
          sites.
        </motion.p>
        <motion.a
          className="writeup__demo"
          href="/demo"
          onClick={onDemo}
          variants={enter}
          whileHover={reduce ? undefined : hoverLift}
          whileTap={reduce ? undefined : tapPress}
        >
          Explore the demo <span aria-hidden>&#8594;</span>
        </motion.a>
      </motion.header>

      <div className="writeup__body">
        {/* ---- Inspiration ---- */}
        <Section label="Inspiration" title="Two problems, one instrument.">
          <p>
            Restaurants lose real money to no-shows, and their answer is the credit-card hold. But it
            doesn't stop the grey market — where third-party services trade and charge diners for
            reservations. A report by the{' '}
            <a href={NRA_URL} target="_blank" rel="noreferrer">
              National Restaurant Association
            </a>{' '}
            found that ~70% of diners surveyed on full-service restaurants expressed concerns of how
            these reservation resale services harm restaurants financially (as they increase the
            no-show rate) and make these restaurants more out of reach to the average customer.
          </p>
          <p>
            Both problems are the same problem. A reservation is an option on a table, trading with
            no liquidity and no issuer participation. Indeed, make it a real instrument and put the
            restaurant in the middle, and the no-show stops being a loss (the table was prepaid) and
            the resale stops being extractive (the restaurant takes the cut).
          </p>
          <p className="callout">
            Fun fact: the name <em>hora</em> is derived from the Horai, the goddesses of natural
            portions of time 🕛💭
          </p>
        </Section>

        {/* ---- What it does ---- */}
        <Section label="What it does" title="Give the table a price.">
          <p>
            A restaurant creates a pool: one venue, one service window, one party-size band,{' '}
            <Math name="N" /> interchangeable tables.
          </p>
          <Code>{`Friday 7–9pm · table for 2  →  N = 20,  p0 = $40,  k = $3
Friday 7–9pm · table for 4  →  N = 8,   p0 = $80,  k = $6`}</Code>
          <p>
            Diners buy against a bonding curve; holders sell back to it. The contract is always the
            counterparty, so nobody waits for a buyer. Liquidity is guaranteed by the automated
            market maker (AMM).
          </p>
          <Math name="price" block />
          <p>
            The floor is a real $40 credit off your bill. Only the premium above it is market-priced,
            such that most of what a buyer pays is dinner, and the restaurant captures the rest
            instead of a scalper.
          </p>
          <p>Four things you can watch happen:</p>
          <ol className="writeup__list">
            {WATCH.map(([t, b], i) => (
              <li key={i}>
                <strong>{t}</strong>: {b}
              </li>
            ))}
          </ol>
        </Section>

        {/* ---- How I built it ---- */}
        <Section label="How I built it" title="The stack.">
          <div className="writeup__table">
            <table>
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>What it's built with</th>
                </tr>
              </thead>
              <tbody>
                {STACK.map(([layer, built]) => (
                  <tr key={layer}>
                    <th scope="row">{layer}</th>
                    <td>{built}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The clients are a diner website, a mobile app, an operator console for the restaurant
            floor, and a standalone lab that lets you drag time toward service and watch the premium
            decay. There is no server SDK for Unifold, so the backend talks to it over plain REST.
          </p>
          <p>
            Webhooks arrive signed and are verified against the raw body before anything is parsed.
          </p>

          <h3 className="writeup__h3">The invariant</h3>
          <p>
            With <Math name="pnDef" />, a buy pays exactly <Math name="pn" /> in and a sell-back pays
            exactly <Math name="pn1" /> out. So at all times:
          </p>
          <Math name="reserve" block />
          <p>
            The reserve is the area under the curve, and the royalty is the spread: buyers pay{' '}
            <Math name="pn" />, sellers get <Math name="pn1Payout" /> with <Math name="sEq" />. Every
            round trip leaves <Math name="s" /> behind, harvested by the restaurant.
          </p>

          <h3 className="writeup__h3">Time (theta) decay</h3>
          <p>
            A Friday table is worth a premium on Monday and worth exactly dinner at 6:59pm Friday. So
            the premium decays and the floor never does:
          </p>
          <Math name="thetaCases" block />
          <p>
            I wanted a convex power law, but took piecewise-linear because it has to compute inside a
            Solana program from block time. So the value of the contract holds steady and collapses
            as time to expiry goes to zero.
          </p>
          <p>
            Decay only ever reduces what a sell-back pays relative to what came in, so time makes the
            contract <em>more</em> over-collateralized, never less. The buyer purchases optionality
            through the premium.
          </p>

          <h3 className="writeup__h3">The grace window</h3>
          <p>
            <Math name="theta" /> hits 0 at service and trading freezes there, but a diner three
            minutes late is not a no-show. So a pool carries <Tok>grace_seconds</Tok>, and it moves
            exactly two deadlines, which are the same instant:
          </p>
          <Code lang="rust">{`/// This is the ONLY thing grace moves. θ and the freeze still key off \`service_time\`,
/// so pricing and the solvency invariant are untouched.
pub fn door_closes_at(service_time: i64, grace_seconds: i64) -> Result<i64> {
    require!(grace_seconds >= 0, ReservationError::InvalidParams);
    service_time
        .checked_add(grace_seconds)
        .ok_or(ReservationError::MathOverflow.into())
}

/// The shared deadline predicate keeps check-in and sweep mutually exclusive.
pub fn check_in_open(now: i64, door_closes: i64) -> bool {
    now < door_closes
}`}</Code>
          <p>
            A restaurant that could sweep at <Tok>service_time</Tok> would forfeit a diner who is
            still parking, and a negative grace would pull the check-in deadline <em>before</em>{' '}
            service, so creation rejects it. The constraint that keeps this a service policy is that
            inside the window <Math name="theta" /> is already 0: the table sits on the $40 floor and
            is off the market. Test below handles it:
          </p>
          <Code lang="rust">{`let inside = SERVICE + 60;
assert_eq!(theta_bps(SERVICE, inside, 86_400).unwrap(), 0);
assert_eq!(buy_price(P0, K, 6, 0).unwrap(), P0); // on the floor, not the curve
assert!(check_in_open(inside, closes));          // ...and check-in is still open`}</Code>
          <p>
            Both guards are mirrored in <Tok>MockChainAdapter</Tok>, so the boundary behaves
            identically in the demo and on-chain.
          </p>

          <h3 className="writeup__h3">Integer math</h3>
          <p>
            No floats on Solana, so <Math name="theta" /> is basis points and money is USDC base
            units. Rounding direction is load-bearing: <strong>buy rounds up, sell rounds down</strong>,
            i.e., the rounding favors the house. The test that guards it:
          </p>
          <Code lang="rust">{`#[test]
fn rounding_favors_house() {
    for n in 1..50u64 {
        for theta in [1u64, 3_333, 5_000, 9_999, 10_000] {
            let b = buy_price(P0, K, n - 1, theta).unwrap();
            let s = sell_price(P0, K, n, theta).unwrap();
            assert!(b >= s, "n={n} theta={theta}: buy {b} < sell {s}");
        }
    }
}`}</Code>

          <h3 className="writeup__h3">The seams</h3>
          <p>
            <Tok>MockChainAdapter</Tok> and <Tok>StubGateway</Tok> were built as real deliverables,
            not scaffolding, so that the stub fabricates the webhook and posts a real-shaped envelope
            into the real handler. So the whole demo runs end to end with no keys and no deployed
            contract, and swapping in real Solana or real Unifold touches one file each.
          </p>

          <h3 className="writeup__h3">On Unifold</h3>
          <p>
            <strong>How central is it.</strong> Unifold is the only path money takes in or out of the
            product. Every buy is a locked-quote payment intent, every sell-back a treasury outbound
            transfer, and both sit behind one PaymentGateway interface that is the app's single money
            seam. The buy needs no wallet at all: beginCheckout collects whatever the diner already
            has, and the table is minted from the signed <Tok>payment_intent.succeeded</Tok> webhook
            rather than the client callback. Sell-backs are the honest gap: they still need a Base
            USDC address on file for the diner, and the custodial wallet service that would supply it
            is the one piece we haven't built.
          </p>
          <p>
            <strong>What I built.</strong> On the server: two-step locked quotes committed inside a
            single request handler (the preview expires in ~30 seconds), payouts as treasury outbound
            transfers on Base with a deterministic idempotency key, and a webhook route that verifies
            the raw body, rejects anything older than five minutes, and dedupes on <Tok>unifold-id</Tok>.
            On the client, <Tok>UnifoldProvider</Tok> wraps the app and confirming a quote hands the
            intent's <Tok>client_secret</Tok> to <Tok>beginCheckout()</Tok>. That's the whole reason
            there's no wallet in the flow, as the diner pays with whatever they already have, and
            USDC comes out the other side.
          </p>
          <p>
            <strong>Paid is not booked.</strong> <Tok>onSuccess</Tok> does almost nothing: it moves
            the sheet into a "confirming" state and returns. A client callback isn't proof of
            settlement: the tab can close mid-flight, and a hostile client could just call it. So the
            table is minted only when the signed <Tok>payment_intent.succeeded</Tok> webhook lands,
            and the UI waits for the holding to appear in the read model.
          </p>
          <p>
            <strong>Error handling is most of the work.</strong> A buy fulfills only on{' '}
            <Tok>succeeded</Tok>, never on <Tok>processing</Tok>, because minting on a payment that
            can still fail hands someone a free reservation. A late deposit gets refunded and the
            diner is told to re-quote, a failed payout re-credits the holding, and <Tok>max_price</Tok>{' '}
            means a price that moved during settlement rejects the buy rather than quietly charging
            more.
          </p>
          <p>
            <strong>Why Unifold does not appear in the demo.</strong> The demo runs on{' '}
            <Tok>StubGateway</Tok>, which fakes the intent and posts a real-shaped envelope into the
            real webhook handler. There is simply no sandbox: Unifold's guidance is to avoid testnet
            and use mainnet with small amounts, so every end-to-end run moves real money. I built
            something that scales a live buy down to a few dollars while clearing the 3 USDC minimum,
            plus a hard warning at boot if the service is running live at full price.
          </p>
          <p>
            And then I ran it for real... I made a coinbase wallet and bought some ETH and USDC, which
            was a new experience for me. The details are below:
          </p>
          <Receipt
            title="Buy — payment intent"
            rows={[
              ['payment intent', 'pi_3GiD6FeHVmVGgoT2h91ruvlLX3P'],
              ['status', 'succeeded · livemode: true'],
              ['amount', '$3.58 USDC, settled on Base'],
              ['tx', '0xec3897e83b6d99b2bdb8f804e01bf20c62cfe3983c9e550a0f32c6144d39211c'],
            ]}
          />
          <p>
            Shortly after: <Tok>payment_intent.succeeded</Tok> reached my webhook, passed HMAC
            verification, and minted the table. Then I sold it back, for the round trip test:
          </p>
          <Receipt
            title="Sell-back — outbound transfer"
            rows={[
              ['outbound transfer', 'obt_3GiDqZudyIOuAcIr4VONzwuOxnr'],
              ['status', 'completed'],
              ['amount', '$3.40 USDC, treasury → diner, both on Base'],
              ['tx', '0x5b71a7da77d190448453cc683f2cd5ed31e497ecefe2ffabc3c359d5def2fe69'],
              ['idempotency key', 'sell:pool_64:alice:3404166'],
            ]}
          />
          <p>
            The wallet went <Tok>$10.38 → $10.19</Tok> on-chain. The whole round trip cost 19 cents,
            and those 19 cents are the 5% royalty: the mechanism the entire design rests on, paid by
            me, on mainnet. Two details there matter more than the money: <Tok>external_user_id: alice</Tok>{' '}
            is my app's user id carried into Unifold's user model, and that idempotency key is the
            deterministic one my gateway generates, so a retried payout returns the existing transfer
            instead of paying twice.
          </p>
          <p>
            Source: <strong>
              <Tok>/unifold/status</Tok>
            </strong>{' '}
            on the deployed service queries the Unifold API live on every load and lists both
            transactions; revoke the key and the page breaks, because nothing on it is stored.
          </p>
          <p>
            My concern is that the refund branch has never fired against a real late deposit, because
            provoking one means deliberately paying into an expired quote.
          </p>
        </Section>

        {/* ---- Challenges ---- */}
        <Section label="Challenges" title="Where it fought back.">
          <p>
            <strong>A 2-top isn't a 4-top.</strong> One curve can only price assets that are
            interchangeable, and per-table NFTs would mean a market of one per table. Instead, I chose
            to create one pool per party-size band, each internally fungible. I also gave up modeling
            when tables can be pushed together to form larger tables as elastic <Math name="N" /> makes
            the reserve invariant meaningless and that invariant is what everything else rests on.
          </p>
          <p>
            <strong>Discovered market inefficiency.</strong> "One table per person per pool" lets
            someone hold a 2-top and a 4-top for the same night, then sell back whichever way the
            curve moved. The 5% spread makes that lose money on average so it isn't arbitrage, but
            it's a cheap option on a night selling out, and on an 8-table band one person corners an
            eighth of the inventory. The cap became one table per diner per service window, enforced
            on-chain by a PDA that fails at account creation rather than in application code.
          </p>
          <p>
            <strong>Payment is asynchronous, so the price moves underneath it.</strong> Every buy
            carries a <Tok>max_price</Tok> and executes only at or under it, refunding the difference
            and rejecting outright if the price ran past. Then the real docs told me a locked quote
            expires in about 30 seconds, not the 90 we'd designed for, which collapsed preview and
            commit into a single request handler.
          </p>
          <p>
            <strong>There is no Unifold sandbox.</strong> Checkout is mainnet-only, so the choice was
            demo with real money or demo on a stub. I ended up building both: the stub fakes the
            counterparty but never the code path, it posts a real-shaped event at the real webhook
            route and skips exactly one <Tok>if</Tok>, the HMAC check.
          </p>
          <p>
            <strong>USDC you can't spend.</strong> My first few attempts to test on mainnet failed
            with "insufficient ETH for gas" on a wallet visibly holding $10: the USDC was on Base, the
            ETH had gone to L1 — a misclick during the transfer. A small thing, but it is precisely
            why this product hides wallets from diners.
          </p>
          <p>
            <strong>Building on ARM64.</strong> The dev machine is Windows on a Snapdragon X Elite,
            and Anza publishes no <Tok>aarch64</Tok> Solana toolchain. So every money-critical
            function went into <Tok>math.rs</Tok> as a pure function that <Tok>cargo test</Tok> could
            verify with no compiler and no validator; the contract was later built and deployed on an
            x86_64 Codespace.
          </p>
        </Section>

        {/* ---- What I learned ---- */}
        <Section label="What I learned" title="Cut losses. Nap.">
          <p>
            I'll update this after I sleep for 10 hours... Learned how to cut my losses and take a nap
            instead of working for 30h straight.
          </p>
        </Section>

        {/* ---- What's next ---- */}
        <Section label="What's next" title="Devnet, then real identity.">
          <p>
            Deploy to devnet and drop in the real Unifold gateway, and after that: secondary-market
            analytics for restaurants, since the AMM generates that data for free.
          </p>
          <p>
            <strong>Real authentication.</strong> Identity is an <Tok>x-user-id</Tok> header stub —
            the client asserts who it is and the server believes it. I chose this such that every rule
            I needed to test is a <em>per-user</em> rule (one table per user per pool, the straddle
            cap, holdings, sell-backs), and those needed a stable user identifier, not a trustworthy
            one. It does mean the deployed surfaces trust their caller. Anyone can send another user's
            id, and the restaurant dashboard's issuer routes, including sweeping a reserve, are
            reachable by anyone with the URL. For a judged demo on a link nobody has, that's an
            acceptable trade; it is not a trade you can carry into anything real. I believe the
            plumbing is already present for the fix: every diner route reads its caller through a
            single <Tok>userId(req)</Tok> helper, so swapping the header for a verified Auth0 claim is
            a one-function change. The issuer routes need slightly more: they don't read a caller at
            all today, they run against a hardcoded venue authority, so those get a real role check
            rather than a substitution.
          </p>
          <p>
            That work is also the prerequisite for the final TODO I wasn't able to finish, which was
            multiple accounts. Verified-email signup raises the cost, payment identity would raise it
            further, and no ticketing system has ever fully solved it. But given that identity is
            still self-asserted, I had no options on the time constraints.
          </p>
        </Section>

        {/* ---- close ---- */}
        <motion.footer
          className="writeup__end"
          variants={rv}
          initial="hidden"
          whileInView="show"
          viewport={inView}
        >
          <p className="footnote">
            hora · tokenized restaurant reservations on an automated market maker.
          </p>
          <div className="writeup__end-ctas">
            <motion.a
              className="cta cta--accent"
              href="/demo"
              onClick={onDemo}
              whileHover={reduce ? undefined : hoverLift}
              whileTap={reduce ? undefined : tapPress}
            >
              See the demo <span className="cta__arrow">&#8594;</span>
            </motion.a>
            <motion.a
              className="cta cta--ink"
              href="/"
              onClick={onHome}
              whileHover={reduce ? undefined : hoverLift}
              whileTap={reduce ? undefined : tapPress}
            >
              Back to the top <span className="cta__arrow">&#8593;</span>
            </motion.a>
          </div>
        </motion.footer>
      </div>
    </div>
  );
}
