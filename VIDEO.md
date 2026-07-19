# hora — video script

For the **online judges**, watching without you in the room. Different job from `PITCH.md`: there
you defend engineering decisions live, here you make a stranger care inside ten seconds.
Promotional first, credible second — but credible, because the last beat is what wins the Unifold
track.

**Runtime ~1:30.** VO is 226 words: 1:25 at 160wpm, plus a few seconds of deliberate silence.
Short is the point — a judge watching thirty entries will finish this one.
**Voice: first person, present tense, plain.** You built this. Say "I".

**Never cut:** the cold open, the no-show beat, or the mainnet proof.

---

## The shape

| # | Beat | Time | Job |
|---|---|---|---|
| 0 | The empty chair | 0:00–0:13 | Make them feel it before they know what this is |
| 1 | Reveal | 0:13–0:21 | Name it. One line. |
| 2 | A price that moves | 0:21–0:44 | The product, and why early is cheaper |
| 3 | Hand it back | 0:44–1:00 | The thing nobody else does |
| 4 | Nobody came | 1:00–1:14 | The money shot |
| 5 | This is real money | 1:14–1:30 | Kill the "nice mockup" reflex |
| 6 | Close | 1:30–1:35 | Wordmark, out |

---

## Script

---

### 0 · The empty chair — 0:00–0:13

**ON SCREEN.** Title cards on the warm canvas. One line at a time. No product yet.

> A restaurant holds a table for you.
> You don't come.
> Nobody pays for the empty chair.

**VO**
> "Restaurants give away something scarce for free every night. A reservation costs nothing to make and nothing to break — so good tables get resold in group chats, quiet ones sit empty, and the restaurant eats both."

*Half a second of silence before the cut.*

---

### 1 · Reveal — 0:13–0:21

**ON SCREEN.** The landing hero. Wordmark settles, the two dots land.

**VO**
> "So I gave it a price. This is hora — a table you can buy, and sell back, until the night it's for."

---

### 2 · A price that moves — 0:21–0:44

**ON SCREEN.** The website, curve already up. Cursor to Claim, the sheet lifts with the price
locked and the ring depleting, confirm. The curve steps and the number rolls.

**VO**
> "Fifty-eight dollars for a Monday table for two — forty of it credit against your bill, so most of what you're paying is dinner."
>
> "Watch when I take it."

*Let the price roll 58 → 61 with no narration. The motion is the line.*

> "Every table sold moves the price for the next one. And there's no wallet, no seed phrase, no gas — you pay how you already pay."

---

### 3 · Hand it back — 0:44–1:00

**ON SCREEN.** Sell-back. Payout lands, price steps down. Cut to the Operator Console as the
royalty counter ticks.

**VO**
> "Plans change. I hand it back and the money is there immediately. There's always a buyer, because the app itself is the buyer."

*Cut to the dashboard.*

> "That resale just paid the restaurant a cut."

---

### 4 · Nobody came — 1:00–1:14

**ON SCREEN.** Operator Console. Check a diner in, advance to service, sweep. Land on the settled
panel: the big number and **no-shows recovered**.

**VO**
> "Service ends. The people who came, ate. The people who didn't already paid — and that money goes to the restaurant tonight."

*Hold on the number. Silence.*

> "The empty chair stops being a loss."

---

### 5 · This is real money — 1:14–1:30

**ON SCREEN.** Quick cut through the mobile app, then settle on **`/unifold/status`** in a browser,
scrolled so the succeeded payment intent and the completed transfer are both visible. Let it sit
for four full seconds.

**VO**
> "This isn't a mockup. I ran a full round trip on mainnet through Unifold — bought a table, sold it back, real stablecoin both ways. It cost nineteen cents, and that nineteen cents was the royalty."
>
> "That page is live. Check it yourself."

---

### 6 · Close — 1:30–1:35

**ON SCREEN.** Back to the landing hero. Wordmark. Hold, buttons resolve underneath.

**VO**
> "A reservation you can actually trade. That's hora."

*Cut to black on the wordmark.*

---

## Why beat 5 is shaped that way

Most hackathon videos claim "fully functional" over a screen recording that proves nothing. You can
do better, because you have a receipt: a real mainnet payment intent, a real treasury transfer, and
a status page that queries Unifold's live API on every load.

So don't narrate the architecture — **show the evidence and get out of the way.** Four seconds on
that page beats twenty seconds of explaining. The nineteen cents is the strongest line in the film,
because it's your whole economic thesis reduced to a number a stranger can verify.

At this length there is nothing spare. If you overrun, take it out of the cold open, not beat 5.

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

**Record video first, silent, in pieces. Then lay VO over the footage you actually got.** Trying to
perform both at once is how takes reach number twenty.

1. Landing: hero load, then a slow scroll. Two takes.
2. Website buy: the full sequence, unbroken. Three times, keep the smoothest.
3. Sell-back, plus the Operator Console royalty tick.
4. Sweep: check in, advance, sweep, hold on the settled panel.
5. B-roll: mobile app, and `/unifold/status` with both transactions visible.

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
