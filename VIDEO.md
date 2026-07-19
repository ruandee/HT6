# hora — video script

For the **online judges**, watching without you in the room. Different job from `PITCH.md`: there
you defend engineering decisions live, here you make a stranger care inside fifteen seconds.
Promotional first, credible second — but credible, because the last beat is the one that wins the
Unifold track.

**Runtime 2:20–2:50.** VO is 370 words: 2:11 at a brisk 170wpm, 2:39 at a relaxed 140, plus ~10
seconds of deliberate silence. Devpost caps at 3:00, so at a slow read you are close to the ceiling
— time your own before building the edit around it.
**Voice: first person, present tense, plain.** You built this. Say "I".

**Never cut:** the cold open, the no-show beat, or the mainnet proof. Those three are the film.

---

## The shape

| # | Beat | Time | Job |
|---|---|---|---|
| 0 | The empty chair | 0:00–0:15 | Make them feel it before they know what this is |
| 1 | Reveal | 0:15–0:25 | Name it. One line. |
| 2 | A price that moves | 0:25–0:52 | The product, and why early is cheaper |
| 3 | Hand it back | 0:52–1:18 | The thing nobody else does |
| 4 | Nobody came | 1:18–1:42 | The money shot |
| 5 | This is real money | 1:42–2:08 | Kill the "nice mockup" reflex |
| 6 | Close | 2:08–2:20 | Wordmark, one line, out |

---

## Script

---

### 0 · The empty chair — 0:00–0:15

**ON SCREEN.** Title cards on the warm canvas. One line at a time. Slow. No product yet.

> A restaurant holds a table for you.
> You don't come.
> Nobody pays for the empty chair.

**VO**
> "Every night, restaurants give away something scarce for free. A reservation costs nothing to make, nothing to break, and nothing to hoard. So the good tables get resold in group chats, the quiet ones get abandoned at 7:58, and the restaurant eats both."

*Half a second of silence before the cut. Don't rush it.*

---

### 1 · Reveal — 0:15–0:25

**ON SCREEN.** The landing hero. Wordmark settles, the two dots land. Hold.

**VO**
> "So I gave it a price. This is hora — a restaurant table you can buy, and sell back, right up until the night it's for."

---

### 2 · A price that moves — 0:25–0:52

**ON SCREEN.** The website. Curve already up. Cursor to Claim, the sheet lifts with the price
locked and the ring depleting, confirm. The curve steps and the number rolls.

**VO**
> "Here's a Monday. Fifty-eight dollars for a table for two — and forty of that is credit against your bill, so most of what you're paying is just dinner, early."
>
> "Watch what happens when I take it."

*Let the price roll 58 → 61 with no narration. The motion is the line.*

> "Every table sold moves the price for the next one. Book early and you genuinely pay less. And there's no wallet here, no seed phrase, no gas — you pay however you already pay for things, and stablecoin comes out the other side."

---

### 3 · Hand it back — 0:52–1:18

**ON SCREEN.** Same screen. Sell-back. Payout lands. Price steps down. Cut to the Operator
Console; the royalty counter ticks.

**VO**
> "Plans change, the way they always do."
>
> "I hand the table back, and the money is there immediately. Not a refund request. Not a waitlist. Not begging the host. There's always a buyer, because the app itself is the buyer — and the maths guarantees it can always pay."

*Cut to the dashboard.*

> "That resale just paid the restaurant a cut. Which means for the first time, the restaurant wants people trading tables instead of fighting it."

---

### 4 · Nobody came — 1:18–1:42

**ON SCREEN.** Operator Console. Check a diner in. Advance to service. Sweep. Land on the settled
panel: the big number, **no-shows recovered**, the breakdown tiles.

**VO**
> "Then service ends, and here's the part I actually built this for."
>
> "The people who came, ate. The people who didn't — already paid. That money goes to the restaurant tonight, automatically. No card holds, no penalty emails, no chasing anyone."

*Hold on the number. Silence.*

> "The empty chair stops being a loss."

---

### 5 · This is real money — 1:42–2:08

**ON SCREEN.** Fast cuts, ~3s each: the mobile app curve → `math.rs` on the rounding test → then
settle on **`/unifold/status`** in a browser, scrolled so the succeeded payment intent and the
completed transfer are both visible. Let that page sit for a full four seconds.

**VO**
> "And this isn't a mockup. There's a Solana program holding the money, an indexer feeding the read model, and four real clients — a website, a phone, an operator console, and a lab for the pricing itself."
>
> "The payments are real too. I ran a full round trip on mainnet through Unifold: bought a table, sold it back, real stablecoin both directions. It cost me nineteen cents — and the nineteen cents was the restaurant's royalty."

*Beat.*

> "That page is live. You can check the transactions yourself."

---

### 6 · Close — 2:08–2:20

**ON SCREEN.** Back to the landing hero. Wordmark. Hold two seconds, buttons resolve underneath.

**VO**
> "Reservations have been free and worthless for fifty years. This one's worth something."
>
> "hora."

*Cut to black on the wordmark. No outro sting, no credits crawl.*

---

## Why beat 5 is shaped that way

Most hackathon videos claim "fully functional" over a screen recording that proves nothing. You can
do better, because you have a receipt: a real mainnet payment intent, a real treasury transfer, and
a status page that queries Unifold's live API on every load.

So don't narrate the architecture — **show the evidence and get out of the way.** Four seconds on
that page does more than twenty seconds of explaining. The nineteen cents is the strongest line in
the film, because it's your whole economic thesis reduced to a number a stranger can verify.

If you're overrunning, cut the `math.rs` shot before you cut the status page.

---

## Production

| Thing | Use | Notes |
|---|---|---|
| OBS Studio | Capture | Free. 1920×1080, 60fps, capture a **window**, not the display |
| A quiet room | VO | Phone earbuds beat a laptop mic. Always record VO separately |
| Any editor | Cutting | CapCut, Resolve, Premiere — you're only cutting and laying audio |

**Before you record**

1. Restart the backend so the seed is clean: `npm run dev --workspace @ttr/app-services`.
   Demo pool should read Mon 7–9pm, n=6, $58. Verify before every take.
2. Confirm `PAYMENT_GATEWAY=stub`. The demo must be the free path — you already have the real
   transaction on record, and you don't want a live payment modal in the footage.
3. Hide the noise: fullscreen (F11), no bookmarks bar, no tabs, notifications off, Slack and
   Discord closed rather than muted.
4. Zoom the browser to 110–125%. Comfortable on your monitor is unreadable in a compressed upload.
5. Move the cursor slowly and deliberately, or hide it on beats where it isn't clicking. A darting
   cursor is the biggest tell of an amateur recording.

**Record video first, silent, in pieces. Then write VO to the footage you actually got.** Trying to
perform both at once is how takes reach number twenty.

1. Landing: hero load, then a slow scroll through the page. Two takes.
2. Website buy: the full sequence, unbroken. Three times, keep the smoothest.
3. Sell-back, plus the Operator Console royalty tick.
4. Sweep: check in, advance, sweep, hold on the settled panel.
5. B-roll: mobile app, `math.rs` on the rounding test, and `/unifold/status` with both transactions
   visible.

Start recording two seconds before you touch anything and stop two seconds after the motion
settles. Those handles are what let you cut on the beat.

**Cutting**

- Cut on motion, not on silence — land each cut as the previous animation finishes settling.
- Never cut mid-animation. Entrances are ~400ms. Let them finish or don't show them.
- Silence is a tool. Three places to shut up entirely: the price rolling 58 → 61, the settled
  no-show number, and the status page.
- Music: one quiet bed around -22dB under the voice, or none. If you can't mix it, don't use it.
- Burn in captions. A meaningful share of judges watch the first pass muted.

**The one thing that will sink it**

Recording at native resolution and letting the upload compress it. Your whole design language is
thin hairlines, soft shadows and subtle gradients — exactly what compression destroys first. Record
at 1080p or higher, export at a high bitrate, and check the *uploaded* version on a phone before you
call it done.
