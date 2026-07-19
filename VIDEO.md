# hora — video demo script + production guide

For the **online judges**, who watch without you in the room. Different job from `PITCH.md`:
in person you're defending engineering decisions in real time, here you're making someone who
has never heard of this care within fifteen seconds. Promotional first, credible second.

**Runtime: 2:25–2:55.** The VO is ~391 spoken words, which is 2:18 at a brisk 170wpm and 2:47 at a
relaxed 140, plus about 8 seconds of deliberate silence. Devpost caps at 3:00, so at a relaxed pace
you are close to the ceiling — time your own read before you build the edit around it, and take
option 1 below if you land past 2:50.
**Voice: first person, present tense, plain.** You built this, so say "I".

**If you need it shorter,** cut in this order and stop when you're happy:
1. "Book early and you genuinely pay less" in beat 2, keeping the payment sentence after it, ~6s
2. The `math.rs` line in beat 5, keeping the "always able to pay you" line, ~10s
3. The first line of beat 6, going straight to the wordmark, ~7s

Do not cut the cold open or the no-show beat. Those are the two that make someone care.

Do not cut the payment sentences in beats 2 and 5 either. They are short, and they are the only
places the video says out loud that a stablecoin rail is what makes the no-wallet experience
possible — which is the entire Unifold-track argument.

---

## The shape

| # | Beat | Time | Job |
|---|---|---|---|
| 0 | Cold open | 0:00–0:14 | Make them feel the problem before they know the product |
| 1 | Reveal | 0:14–0:26 | Name it, show it, one sentence |
| 2 | Buy | 0:26–0:52 | The price is alive |
| 3 | Sell back | 0:52–1:16 | The thing nobody else does |
| 4 | The no-show | 1:16–1:42 | The money shot, literally |
| 5 | Real, not a mockup | 1:42–2:00 | Credibility, fast |
| 6 | Close | 2:00–2:10 | Wordmark, one line, out |

---

## Script

Each beat: **ON SCREEN** is what you record. **VO** is what you say over it. The VO is written
to be *spoken*, so read it out loud once and cut anything your mouth trips on.

---

### 0 · Cold open (0:00–0:14)

**ON SCREEN**
Title cards on the warm canvas, one line at a time, no product yet. Slow. Let each line sit.

> A restaurant holds a table for you.
> You don't come.
> Nobody pays for the empty chair.

**VO**
> "Every night, restaurants give away something scarce for free. A reservation costs nothing to make, nothing to break, and nothing to hoard. So the good tables get resold in group chats, the quiet ones get abandoned at 7:58, and the restaurant eats both."

*Beat. Half a second of silence before the reveal. Don't rush this.*

---

### 1 · Reveal (0:14–0:26)

**ON SCREEN**
Cut to the landing page hero. The wordmark settles, the two dots land. Hold on it.

**VO**
> "So I priced it. This is hora. A restaurant table you can buy, and sell back, right up until the night it's for."

---

### 2 · Buy (0:26–0:52)

**ON SCREEN**
The website, full screen. The curve is already up. Cursor moves to Claim, the sheet opens with
the price locked, confirm. The curve steps up and the number rolls.

**VO**
> "Here's a Monday. Fifty-eight dollars for a table for two. Forty of that is a credit off your bill, so most of what you're paying is just dinner, early. The rest is what the room thinks Monday is worth."
>
> "Watch what happens when I take it."

*Let the price tick 58 to 61 with no narration over it. The motion is the line.*

> "Every table sold moves the price for the next one. Book early and you genuinely pay less. And there's no wallet here, no seed phrase, no gas. You pay the way you already pay for things — card, exchange, whatever token you happen to hold — and Unifold turns it into stablecoin on the way in. You'd never know this settles on-chain, which is the point."

---

### 3 · Sell back (0:52–1:16)

**ON SCREEN**
Same screen. Tap sell-back. Payout lands instantly. Price steps back down. Then cut to the
Operator Console and let the royalty counter tick up.

**VO**
> "Now plans change, the way they always do."
>
> "I hand the table back and the money comes back immediately. Not a refund request, not a waitlist, not begging the host. There's always a buyer, because the app itself is the buyer, and the maths guarantees it can always pay."

*Cut to dashboard.*

> "And that resale just paid the restaurant a cut. Which means for the first time the restaurant wants people reselling tables, instead of fighting it."

---

### 4 · The no-show (1:16–1:42)

**ON SCREEN**
Operator Console. Check a diner in. Advance to service time. Sweep. Land on the settled panel:
the big number, **no-shows recovered**, and the breakdown tiles.

**VO**
> "Then service ends, and here's the part I actually built this for."
>
> "The people who came, ate. The people who didn't, already paid. That money goes to the restaurant tonight, automatically. No card holds, no penalty emails, no chasing anybody."

*Hold on the settled number. Silence for a beat.*

> "The empty chair stops being a loss."

---

### 5 · Real, not a mockup (1:42–2:00)

**ON SCREEN**
Fast cuts, roughly 3 seconds each: the mobile app curve → the Operator Console floor view filling →
`math.rs` in the editor on the rounding test → `unifold-gateway.ts` scrolled to the webhook event
switch → the three surfaces side by side.

**VO**
> "This is a running system, not a prototype. A Solana program holding the money, a stablecoin rail through Unifold moving it in and out, an indexer feeding the read model, and three real clients: a website, a mobile app, and an operator console for the restaurant floor."
>
> "The contract only ever takes in what it needs to buy every table back later, so it can always pay you. That's arithmetic, not a promise, and there's a test that proves rounding can never drain it."

---

### 6 · Close (2:00–2:10)

**ON SCREEN**
Back to the landing hero. Wordmark. Hold two seconds, then the two buttons resolve underneath.

**VO**
> "Reservations have been free and worthless for fifty years. This one's worth something."
>
> "hora."

*Cut to black on the wordmark. No outro music sting, no credits crawl.*

---

## Production guide

### What you need

| Thing | Use | Notes |
|---|---|---|
| OBS Studio | Screen capture | Free. Set canvas 1920×1080, 60fps, capture a **window**, not the display |
| A quiet room | Voiceover | Phone earbuds beat a laptop mic. Record VO separately from video, always |
| Any editor | Cutting | CapCut, Resolve, Premiere. You are only cutting and laying audio |

### Before you record

1. **Restart the backend** so the seed is clean:
   `npm run dev --workspace @ttr/app-services`
   Demo pool should read Mon 7–9pm, n=6, $58. Verify before every take.
2. **Hide the noise.** Browser fullscreen (F11), no bookmarks bar, no tabs, no notifications.
   Windows: Focus Assist on. Close Slack and Discord entirely, don't just mute them.
3. **Zoom the browser to 110–125%.** Text that's comfortable on your monitor is unreadable in a
   compressed 1080p upload that a judge watches in a small window.
4. **Cursor.** Move it slowly and deliberately, or hide it entirely on beats where it isn't clicking.
   A darting cursor is the single biggest tell of an amateur screen recording.

### Record in this order

Record **video first, silent, in pieces.** Then write VO to the footage you actually got. Trying to
perform both at once is how takes get to number twenty.

1. Landing page: hero load, and a slow scroll through the whole page. Two takes.
2. Website buy: full sequence, unbroken. Do it three times, keep the smoothest.
3. Sell back plus the Operator Console royalty tick.
4. Operator Console sweep: check in, advance, sweep, hold on the settled panel.
5. B-roll: mobile app, Operator Console floor view, `math.rs` scrolled to the rounding test.

Every clip: start recording **two seconds before** you touch anything and stop **two seconds after**
the motion settles. Those handles are what let you cut on the beat instead of on the frame you
happened to stop on.

### Cutting

- **Cut on motion, not on silence.** Land each cut as the previous animation finishes settling.
- **Never cut mid-animation.** Your entrances are ~400ms. Let them finish or don't show them.
- **Silence is a tool.** The two places to shut up entirely: the price ticking 58 to 61, and the
  settled no-show number. Both are more persuasive without narration on top.
- **Music:** one quiet bed at roughly -22dB under the voice, or none. If you can't mix it, don't use it.
- **Captions:** burn them in. A meaningful share of judges watch muted on a first pass.

### The one thing that will sink it

Recording at native resolution and letting the upload compress it. Your whole design language is
thin hairlines, soft shadows, and subtle gradients, and those are exactly what compression destroys
first. Record at 1080p or higher, export at a high bitrate, and check the *uploaded* version on a
phone before you call it done.

---

## Deterministic footage (optional, ask me to build it)

Every click in beats 2 through 4 can be driven by a Playwright script on a fixed timeline instead
of by hand: cursor glides at a constant speed, clicks land on the exact beat, the clock advances on
cue, and it's identical on every take. You hit record, run it, and it performs. That removes the
fumbling that costs most hackathon videos their polish, and it means a retake is free.
