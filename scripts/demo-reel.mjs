/**
 * Deterministic demo footage for VIDEO.md beats 2, 3 and 4.
 *
 *   node scripts/demo-reel.mjs --list
 *   node scripts/demo-reel.mjs buy
 *   node scripts/demo-reel.mjs sellback
 *   node scripts/demo-reel.mjs royalty
 *   node scripts/demo-reel.mjs sweep
 *   node scripts/demo-reel.mjs all
 *
 * You hit record in OBS, run one of these, and it performs. The point is that take 9 is frame
 * for frame the same as take 1: the cursor glides at a fixed px/sec, every click lands on a
 * scheduled millisecond, and the clock advances on cue rather than whenever you got to it.
 *
 * Three things make that actually true rather than aspirational:
 *
 *   1. A SCHEDULE, not a sequence. Each beat is a list of {at, do} marks measured from the take
 *      start, and the runner sleeps to each mark. Anything slow (element lookups, first paint)
 *      is resolved during the 2s lead-in handle so it cannot push the choreography around. If a
 *      mark still overruns, the run prints the drift instead of quietly producing a bad take.
 *
 *   2. STATE RESET BEFORE ROLLING. The reel is only repeatable if the app starts each take in
 *      the same place, so every beat repairs its own preconditions over the REST API first,
 *      off camera. Buying pushes the pool from n=6 to n=7 and the price off $58, so `buy` sells
 *      any held table back before it rolls; `sellback` buys one for the same reason.
 *
 *   3. A DRAWN CURSOR. Playwright's mouse is real to the page but invisible to a screen
 *      recorder, so beats filmed straight would show buttons depressing with no pointer. An
 *      overlay is injected into every document and moved in lockstep with the real mouse.
 *
 * Every beat opens with a 2s hold and closes with another, the handles VIDEO.md asks for, so
 * there is something to cut on either side of the motion.
 */
import { chromium } from 'playwright';

const API = process.env.REEL_API ?? 'http://localhost:8080';
const DINER = process.env.REEL_DINER ?? 'http://localhost:5173';
const RESTAURANT = process.env.REEL_RESTAURANT ?? 'http://localhost:5174';

const DINER_USER = 'alice';
const ISSUER_USER = 'rest_wallet';

/** px/sec. Slow enough to read as deliberate, fast enough not to pad the runtime. */
const CURSOR_SPEED = 900;
const HANDLE = 2000;

const VIEWPORT = { width: 1920, height: 1080 };

// ---- REST helpers ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body, user = DINER_USER } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-user-id': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  const json = txt ? JSON.parse(txt) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${txt}`);
  return json;
}

const usd = (base) => `$${(Number(base) / 1e6).toFixed(2)}`;

// ---- the drawn cursor -----------------------------------------------------------------------
/**
 * Injected into every document. Playwright's real mouse drives the page; this only draws where
 * it is, so a recording has something to follow. `transition: none` is deliberate — the glide
 * below moves it every frame, and a CSS transition on top would fight that and lag the pointer
 * behind the click it is supposed to be making.
 */
const CURSOR_SCRIPT = `
(() => {
  if (window.__reelCursorReady) return;
  window.__reelCursorReady = true;
  const mount = () => {
    if (document.getElementById('__reel_cursor')) return;
    const el = document.createElement('div');
    el.id = '__reel_cursor';
    el.style.cssText = [
      'position:fixed','left:0','top:0','width:26px','height:26px','margin:-13px 0 0 -13px',
      'border-radius:50%','pointer-events:none','z-index:2147483647','transition:none',
      'background:radial-gradient(circle at 50% 50%, rgba(242,84,45,0.95) 0 4.5px, rgba(242,84,45,0) 5px)',
      'box-shadow:0 0 0 1.5px rgba(242,84,45,0.55), 0 4px 14px -3px rgba(242,84,45,0.5)',
      'opacity:0',
    ].join(';');
    document.documentElement.appendChild(el);
    const ripple = document.createElement('div');
    ripple.id = '__reel_ripple';
    ripple.style.cssText = [
      'position:fixed','left:0','top:0','width:26px','height:26px','margin:-13px 0 0 -13px',
      'border-radius:50%','pointer-events:none','z-index:2147483646','opacity:0',
      'border:2px solid rgba(242,84,45,0.8)',
    ].join(';');
    document.documentElement.appendChild(ripple);
    window.__reelMove = (x, y) => {
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      el.style.opacity = '1';
      ripple.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(1)';
    };
    // The overlay rides the page's own mousemove rather than a second driver call per frame.
    // Playwright's mouse dispatches these anyway, so this halves the round-trips per glide step
    // and keeps the drawn cursor exactly on the real one instead of a frame behind it.
    document.addEventListener('mousemove', (e) => window.__reelMove(e.clientX, e.clientY), true);
    window.__reelHide = () => { el.style.opacity = '0'; };
    window.__reelClick = () => {
      el.animate(
        [{ transform: el.style.transform + ' scale(1)' }, { transform: el.style.transform + ' scale(0.72)' }, { transform: el.style.transform + ' scale(1)' }],
        { duration: 220, easing: 'cubic-bezier(0.16,1,0.3,1)' },
      );
      ripple.animate(
        [{ transform: ripple.style.transform + ' scale(1)', opacity: 0.85 }, { transform: ripple.style.transform + ' scale(2.6)', opacity: 0 }],
        { duration: 480, easing: 'cubic-bezier(0.16,1,0.3,1)' },
      );
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

// ---- motion ----------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Glide time between two known points, for laying out a schedule before the cursor gets there. */
const costBetween = (a, b) => (Math.hypot(b.x - a.x, b.y - a.y) / CURSOR_SPEED) * 1000;

class Pointer {
  constructor(page) {
    this.page = page;
    this.x = VIEWPORT.width - 90;
    this.y = VIEWPORT.height - 90;
  }

  async draw() {
    await this.page.evaluate(([x, y]) => window.__reelMove?.(x, y), [this.x, this.y]).catch(() => {});
  }

  async park() {
    await this.page.mouse.move(this.x, this.y);
    await this.draw();
  }

  /**
   * Constant speed, not constant duration: a long move takes longer, which is what reads as real.
   *
   * Driven off the wall clock rather than a fixed sleep per step. Each mouse.move is a CDP
   * round-trip costing 10-25ms on top of any delay, so a "16ms per frame" loop actually ran at
   * ~40ms and overshot its mark by nearly a second — which then pushed every later beat late.
   * Sampling elapsed time instead means the glide lands on `dur` whatever the round-trip costs.
   */
  async glideTo(x, y) {
    const dist = Math.hypot(x - this.x, y - this.y);
    if (dist < 1) return 0;
    const dur = (dist / CURSOR_SPEED) * 1000;
    const [x0, y0] = [this.x, this.y];
    const t0 = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - t0) / dur);
      // ease-in-out so it departs and arrives softly instead of teleporting into the button
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.x = x0 + (x - x0) * e;
      this.y = y0 + (y - y0) * e;
      await this.page.mouse.move(this.x, this.y);
      if (t >= 1) break;
    }
    return dur;
  }

  /** How long a glide to (x, y) will take, so a schedule can be laid out before rolling. */
  glideCost(x, y) {
    return costBetween(this, { x, y });
  }

  async click() {
    await this.page.evaluate(() => window.__reelClick?.()).catch(() => {});
    await this.page.mouse.click(this.x, this.y);
  }
}

/**
 * Centre of an element, resolved up front so the schedule never waits on a lookup.
 *
 * On timeout it reports whatever the app is showing instead of just the selector. Most failures
 * here are a rejected API call surfacing as a flash message, and the flash says exactly why.
 */
async function centreOf(page, selector, { timeout = 12000 } = {}) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: 'visible', timeout });
  } catch {
    const flash = await page
      .locator('.flash, [class*="flash"]')
      .first()
      .textContent({ timeout: 500 })
      .catch(() => null);
    throw new Error(
      `never saw ${selector}` + (flash ? `\n  the app is showing: "${flash.trim()}"` : ''),
    );
  }
  await page.waitForTimeout(120); // let any entrance animation settle before measuring
  const box = await el.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ---- the schedule -----------------------------------------------------------------------------
/**
 * Runs marks at absolute offsets from the take start. Drift is reported rather than absorbed,
 * because a take that silently ran 400ms long is a take you will cut wrong.
 */
class Timeline {
  constructor(name) {
    this.name = name;
    this.t0 = 0;
    this.mark = 0; // last scheduled mark, so beats can chain relative to it
    this.worst = 0;
  }

  start() {
    this.t0 = Date.now();
    this.mark = 0;
    console.log(`\n  ROLLING  ${this.name}`);
  }

  get elapsed() {
    return Date.now() - this.t0;
  }

  async at(ms, label, fn) {
    this.mark = ms;
    const late = this.elapsed - ms;
    if (late > 60) {
      this.worst = Math.max(this.worst, late);
      console.log(`    ${String(Math.round(ms)).padStart(6)}ms  ${label}   (late by ${Math.round(late)}ms)`);
    } else {
      await sleep(ms - this.elapsed);
      console.log(`    ${String(Math.round(ms)).padStart(6)}ms  ${label}`);
    }
    if (fn) await fn();
  }

  /**
   * Schedule `delta` after the previous mark. Glide durations depend on how far the cursor has
   * to travel, which depends on layout, so hard-coding absolute marks for anything downstream of
   * a glide bakes in an assumption that breaks the moment a button moves.
   */
  async after(delta, label, fn) {
    return this.at(this.mark + delta, label, fn);
  }

  done(endDelta = 0) {
    const endMs = this.mark + endDelta;
    console.log(
      `    ${String(Math.round(endMs)).padStart(6)}ms  cut\n` +
        `  DONE     ${this.name} in ${((this.elapsed + endDelta) / 1000).toFixed(2)}s` +
        (this.worst > 60 ? `  — worst mark drift ${Math.round(this.worst)}ms` : '  — on schedule'),
    );
  }
}

// ---- demo state -------------------------------------------------------------------------------
async function demoPool() {
  const { pool_id } = await api('/demo/pool-id');
  const pools = await api('/pools');
  const self = pools.find((p) => p.pool_id === pool_id);
  if (!self) throw new Error(`demo pool ${pool_id} missing from /pools`);
  return self;
}

/** Every pool sharing this night, i.e. the other party-size bands. One table per guest spans them. */
async function siblings(pool) {
  const pools = await api('/pools');
  return pools.filter((p) => p.date_iso === pool.date_iso && p.service_time === pool.service_time);
}

async function heldInWindow(pool) {
  const ids = new Set((await siblings(pool)).map((p) => p.pool_id));
  const holdings = await api('/me/holdings');
  return holdings.filter((h) => h.status === 'held' && ids.has(h.pool_id));
}

/**
 * Buys as `user` exactly the way the UI does: take a quote-locked intent, then drive the stub
 * webhook that mints the token. The token is minted on `payment_intent.succeeded`, so skipping
 * the second call leaves an intent that never becomes a holding.
 */
async function buyAs(user, poolId) {
  const r = await api(`/pools/${poolId}/buy`, { method: 'POST', user });
  await fetch(`${API}/webhooks/unifold`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-stub': '1' },
    body: JSON.stringify({
      id: `evt_reel_${Date.now()}`,
      type: 'payment_intent.succeeded',
      data: { object: { id: r.deposit_intent_id, status: 'succeeded' } },
    }),
  });
  return r;
}

/**
 * Puts the headline pool back to the state VIDEO.md quotes: n=6, $58.
 *
 * Verified rather than assumed. One table per guest per night is enforced server-side, so a
 * holding left over from an earlier take makes the next buy fail with a flash instead of opening
 * the sheet — which looks, from the script's side, exactly like a button that never appeared.
 * Checking here turns that into one clear line instead of a locator timeout.
 */
async function resetToHeadline(pool) {
  await api('/demo/clock', { method: 'POST', body: { reset: true } });

  // A frozen headline pool cannot be traded, so beats 2 and 3 would fail on a rejected buy with
  // nothing on screen to explain it. Freezing is also not reversible from here: the demo freeze
  // rewrites service_time into the past, which is exactly what the clock reset above refuses to
  // undo. Only a restart clears it, so say so rather than letting the beat die on a 400.
  const q0 = await api(`/pools/${pool.pool_id}`);
  if (q0.frozen) {
    throw new Error(
      `the headline pool (${pool.pool_id}) is frozen, so it cannot be traded.\n` +
        `  Restart app-services for a clean seed:\n` +
        `      npm run dev --workspace @ttr/app-services`,
    );
  }

  for (const h of await heldInWindow(pool)) {
    await api(`/pools/${h.pool_id}/sell`, { method: 'POST' });
  }

  const still = await heldInWindow(pool);
  if (still.length) {
    throw new Error(
      `${DINER_USER} still holds ${still.length} table(s) this night after sell-back ` +
        `(${still.map((h) => h.pool_id).join(', ')}). The buy would be rejected. ` +
        `Restart app-services for a clean seed.`,
    );
  }
  return api(`/pools/${pool.pool_id}`);
}

// ---- preflight ---------------------------------------------------------------------------------
async function preflight(needs) {
  const targets = [['app-services', `${API}/pools`]];
  if (needs.includes('diner')) targets.push(['diner-frontend', DINER]);
  if (needs.includes('restaurant')) targets.push(['restaurant-frontend', RESTAURANT]);

  for (const [name, url] of targets) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(String(r.status));
    } catch (e) {
      console.error(`\n  ${name} is not answering at ${url}\n`);
      console.error('  Start what you need, then run again:');
      console.error('    npm run dev --workspace @ttr/app-services');
      console.error('    npm run dev --workspace @ttr/diner-frontend');
      console.error('    npm run dev --workspace @ttr/restaurant-frontend\n');
      process.exit(1);
    }
  }
}

async function openPage(browser, url) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}

// ---- beat 2: buy ---------------------------------------------------------------------------------
async function beatBuy(browser) {
  const pool = await demoPool();
  const before = await resetToHeadline(pool);
  console.log(`  pool ${pool.pool_id} · ${pool.label} · ${pool.party_size}-top`);
  console.log(`  n=${before.n_sold}/${before.n_max}  buy ${usd(before.buy_price)}`);
  if (before.buy_price !== '58000000') {
    console.log(`  NOTE  VIDEO.md quotes $58.00 here. Restart app-services if that matters:`);
    console.log(`        npm run dev --workspace @ttr/app-services`);
  }

  const page = await openPage(browser, DINER);
  const ptr = new Pointer(page);
  await ptr.park();

  // resolved during the lead-in so the schedule never waits on a lookup
  const claim = await centreOf(page, 'button:has-text("Claim this table")');

  const gClaim = ptr.glideCost(claim.x, claim.y);

  const tl = new Timeline('beat 2 · buy');
  tl.start();
  await tl.at(0, 'lead-in (handle)');
  await tl.at(HANDLE, 'glide to Claim', () => ptr.glideTo(claim.x, claim.y));
  await tl.after(gClaim + 400, 'hover, settle');
  await tl.after(400, 'click Claim', () => ptr.click());
  await tl.after(900, 'sheet open, price locked');

  const confirm = await centreOf(page, 'button:has-text("Confirm & pay")');
  const gConfirm = ptr.glideCost(confirm.x, confirm.y);
  await tl.after(1200, 'glide to Confirm', () => ptr.glideTo(confirm.x, confirm.y));
  await tl.after(gConfirm + 350, 'click Confirm', () => ptr.click());
  // the curve steps and the number rolls here: no cursor over it, per VIDEO.md
  await tl.after(250, 'hide cursor for the price roll', () =>
    page.evaluate(() => window.__reelHide?.()),
  );
  await tl.after(3600, 'tail (handle)');
  tl.done(HANDLE);
  await sleep(HANDLE);

  const after = await api(`/pools/${pool.pool_id}`);
  console.log(`  after: n=${after.n_sold}  buy ${usd(after.buy_price)}`);
  return page;
}

// ---- beat 3a: sell back ---------------------------------------------------------------------------
async function beatSellback(browser) {
  const pool = await demoPool();
  await resetToHeadline(pool);
  await buyAs(DINER_USER, pool.pool_id); // off camera: the beat opens holding a table
  const q = await api(`/pools/${pool.pool_id}`);
  console.log(`  pool ${pool.pool_id} · holding one table · n=${q.n_sold} · ${usd(q.buy_price)}`);

  const page = await openPage(browser, DINER);
  const ptr = new Pointer(page);
  await ptr.park();

  const sell = await centreOf(page, 'button:has-text("Sell it back")');

  const gSell = ptr.glideCost(sell.x, sell.y);

  const tl = new Timeline('beat 3a · sell back');
  tl.start();
  await tl.at(0, 'lead-in (handle)');
  await tl.at(HANDLE, 'glide to sell-back', () => ptr.glideTo(sell.x, sell.y));
  await tl.after(gSell + 450, 'hover, settle');
  await tl.after(400, 'click sell-back', () => ptr.click());
  await tl.after(250, 'hide cursor for the payout', () => page.evaluate(() => window.__reelHide?.()));
  await tl.after(3800, 'tail (handle)');
  tl.done(HANDLE);
  await sleep(HANDLE);
  return page;
}

// ---- beat 3b: the royalty tick --------------------------------------------------------------------
/**
 * The counter has to move ON CAMERA, so the sell that drives it fires mid-shot.
 *
 * The seller is the diner user, bought in during setup and sold back on cue. Using one of the
 * seeded holders instead looks equivalent and is not: they already hold a table that night, so
 * the setup buy is rejected, and selling one off permanently drains the pool from n=6 — the shot
 * would be un-repeatable and drift further from VIDEO.md's numbers on every take. Round-tripping
 * the diner leaves the pool exactly where it started.
 */
async function beatRoyalty(browser) {
  const pool = await demoPool();
  await resetToHeadline(pool);
  const seller = DINER_USER;
  await buyAs(seller, pool.pool_id);

  const page = await openPage(browser, RESTAURANT);
  const ptr = new Pointer(page);
  await ptr.park();
  await page.locator(`[data-pool-id="${pool.pool_id}"]`).first().click();
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__reelHide?.());

  const before = await api(`/restaurant/pools/${pool.pool_id}`, { user: ISSUER_USER });
  console.log(`  royalties before ${usd(before.royalties_accrued)}`);

  const tl = new Timeline('beat 3b · royalty tick');
  tl.start();
  await tl.at(0, 'lead-in (handle), console on the pool');
  // the dashboard polls every 2.5s, so the sell fires early enough to land inside the shot
  await tl.at(HANDLE, 'a diner sells back (off screen)', () =>
    api(`/pools/${pool.pool_id}/sell`, { method: 'POST', user: seller }),
  );
  await tl.after(4500, 'counter has ticked, hold');
  await tl.after(1500, 'tail (handle)');
  tl.done(HANDLE);
  await sleep(HANDLE);

  const after = await api(`/restaurant/pools/${pool.pool_id}`, { user: ISSUER_USER });
  const delta = Number(after.royalties_accrued) - Number(before.royalties_accrued);
  console.log(`  royalties after  ${usd(after.royalties_accrued)}  (+${usd(delta)})`);
  // A still counter is a dead shot, and the sell failing quietly is the only way that happens.
  if (delta <= 0) {
    throw new Error('royalties did not move — nothing ticked on camera, do not keep this take');
  }
  return page;
}

// ---- beat 4: check in, advance, sweep -------------------------------------------------------------
/**
 * Always builds a throwaway pool rather than sweeping the headline one.
 *
 * Both halves of that matter. A sweep is one-way, so a second take against the same pool opens
 * on an already-settled panel — and worse, sweeping freezes the pool, which silently takes the
 * $58 Monday used by beats 2 and 3 out of service until app-services restarts. Filming beat 4
 * on the demo pool costs you the other two beats. A fresh pool per take keeps every beat
 * re-runnable in any order, for the price of some extra cards in the Floor grid.
 */
async function sweepTarget() {
  const pool = await demoPool();
  console.log('  building a throwaway pool (the headline pool stays tradeable)');
  const service = Math.floor(Date.now() / 1000) + 3 * 3600;
  const created = await api('/restaurant/pools', {
    method: 'POST',
    user: ISSUER_USER,
    body: {
      venue_id: 'aurelia',
      label: pool.label,
      party_size: 2,
      p0: '40000000',
      k: '3000000',
      n_max: 20,
      phi_bps: 500,
      service_time: service,
      tc_seconds: 86400,
      grace_seconds: 900,
    },
  });
  // Distinct names, because one table per guest per night is enforced and a repeat would be
  // rejected. Six is enough for a settled panel that reads as a real service.
  const buyers = [
    'Maya Fontaine',
    'Daniel Okafor',
    'Priya Raman',
    'Tom Whitaker',
    'Marcus Bell',
    'Sofia Marchetti',
  ];
  let seated = 0;
  for (const b of buyers) {
    try {
      await buyAs(b, created.pool_id);
      seated++;
    } catch (e) {
      console.log(`    could not seat ${b}: ${e.message.split('\n')[0]}`);
    }
  }
  // An empty pool sweeps to nothing, which is the one shot this beat exists to get.
  if (seated < 3) throw new Error(`only seated ${seated} diners — the settled panel would be bare`);
  console.log(`  seated ${seated} diners`);
  return { pool_id: created.pool_id, label: pool.label };
}

async function beatSweep(browser) {
  const target = await sweepTarget();
  console.log(`  pool ${target.pool_id}`);

  const page = await openPage(browser, RESTAURANT);
  const ptr = new Pointer(page);
  await ptr.park();

  await page.locator(`[data-pool-id="${target.pool_id}"]`).first().click();
  await page.waitForTimeout(800);

  const checkin = await centreOf(page, 'button:has-text("Check in")');
  const settleTab = await centreOf(page, '.tabs button:has-text("Settle")');

  const gCheckin = ptr.glideCost(checkin.x, checkin.y);
  // Costed from the check-in button, not from where the cursor is now: by the time this glide
  // runs the pointer is parked on Check in. Measuring it from the start position made the mark
  // 600ms short and clicked the Settle tab while the cursor was still travelling to it.
  const gSettle = costBetween(checkin, settleTab);

  const tl = new Timeline('beat 4 · the no-show');
  tl.start();
  await tl.at(0, 'lead-in (handle), floor view');
  await tl.at(HANDLE, 'glide to Check in', () => ptr.glideTo(checkin.x, checkin.y));
  await tl.after(gCheckin + 400, 'click Check in', () => ptr.click());
  await tl.after(1300, 'glide to the Settle tab', () => ptr.glideTo(settleTab.x, settleTab.y));
  await tl.after(gSettle + 400, 'click Settle', () => ptr.click());
  await tl.after(1000, 'settle panel in');

  const advance = await centreOf(page, 'button:has-text("Advance to service time")');
  const gAdv = ptr.glideCost(advance.x, advance.y);
  await tl.after(300, 'glide to Advance', () => ptr.glideTo(advance.x, advance.y));
  await tl.after(gAdv + 400, 'click Advance (the clock moves on cue)', () => ptr.click());
  await tl.after(1400, 'frozen, ready to sweep');

  const sweep = await centreOf(page, 'button:has-text("Sweep reserve")');
  const gSweep = ptr.glideCost(sweep.x, sweep.y);
  await tl.after(300, 'glide to Sweep', () => ptr.glideTo(sweep.x, sweep.y));
  await tl.after(gSweep + 400, 'click Sweep', () => ptr.click());
  await tl.after(300, 'hide cursor, hold on the settled number', () =>
    page.evaluate(() => window.__reelHide?.()),
  );
  await tl.after(4500, 'tail (handle)');
  tl.done(HANDLE);
  await sleep(HANDLE);

  const view = await api(`/restaurant/pools/${target.pool_id}`, { user: ISSUER_USER });
  console.log(`  swept · reserve now ${usd(view.reserve_balance)}`);
  return page;
}

// ---- runner ---------------------------------------------------------------------------------------
const BEATS = {
  buy: { fn: beatBuy, needs: ['diner'], desc: 'beat 2 — claim a table, price steps up' },
  sellback: { fn: beatSellback, needs: ['diner'], desc: 'beat 3a — hand it back, payout lands' },
  royalty: { fn: beatRoyalty, needs: ['restaurant'], desc: 'beat 3b — the royalty counter ticks' },
  sweep: { fn: beatSweep, needs: ['restaurant'], desc: 'beat 4 — check in, advance, sweep' },
};

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const keepOpen = process.argv.includes('--keep-open');

  if (process.argv.includes('--list') || args[0] === 'list') {
    console.log('\n  hora demo reel\n');
    for (const [k, b] of Object.entries(BEATS)) console.log(`    ${k.padEnd(10)} ${b.desc}`);
    console.log(`    ${'all'.padEnd(10)} every beat in order, one browser\n`);
    console.log('  Record the window, not the display. Each beat opens and closes on a 2s handle.\n');
    return;
  }

  const wanted = !args.length || args[0] === 'all' ? Object.keys(BEATS) : args;
  for (const w of wanted) {
    if (!BEATS[w]) {
      console.error(`unknown beat "${w}". Try --list.`);
      process.exit(1);
    }
  }

  await preflight([...new Set(wanted.flatMap((w) => BEATS[w].needs))]);

  const browser = await chromium.launch({
    headless: process.env.CI === '1',
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`, '--hide-scrollbars'],
  });

  console.log('\n  Capture the browser WINDOW in OBS, then let each beat run start to finish.');
  console.log('  Cut inside the 2s handles at each end.\n');

  const open = [];
  for (const w of wanted) {
    const page = await BEATS[w].fn(browser);
    if (keepOpen) open.push(page);
    else await page.context().close();
  }

  if (keepOpen) {
    console.log('\n  --keep-open: windows left up. Ctrl-C when you are done.\n');
    await new Promise(() => {});
  }
  await browser.close();
  console.log('');
}

main().catch((e) => {
  console.error(`\n  reel failed: ${e.message}\n`);
  process.exit(1);
});
