# Deploy checklist — Vercel

What to check before putting this on Vercel, and why. Written against the repo as it stands.

**Two audiences, two setups.** Present the live demo from **localhost** (§10) — on stage,
unfailability beats everything, and it needs no changes. Deploy so that a judge or a Devpost
visitor has a **link** to click later; free tiers are fine for that.

**The shape of the deploy:** the four Vite apps (launcher, diner, mobile, restaurant) are static
builds and go to Vercel cleanly. **app-services does not**, and cannot without a rewrite — see §1.

```
Vercel (static, free)                    Cloud Run (scale-to-zero, max-instances=1)
  launcher      ──┐
  diner-frontend  ├──  VITE_API_URL  ──▶   app-services (Express)
  mobile-diner    │                          └── MockChainAdapter + StubGateway, all in memory
  restaurant    ──┘
```

---

## 1. Why app-services can't be a Vercel serverless function

Not a config problem — a state problem. Every piece of demo state lives in process memory:

| State | Where |
|---|---|
| pools, `n_sold`, θ, frozen | `pools` Map — [mock-adapter.ts:46](packages/chain-services/src/mock-adapter.ts#L46) |
| holdings, pending buys, dedupe | [orchestrator.ts:51-53](packages/app-services/src/orchestrator.ts#L51-L53) |
| reserve, royalties, holders | `IssuerService` |
| seeded pools + demo clock offset | `POOLS` / `seed()` in [server.ts](packages/app-services/src/server.ts) |

Vercel functions are ephemeral and horizontally scaled, so each invocation may hit a different
instance with a different (or freshly re-seeded) copy. That breaks the demo specifically: §11
depends on two browsers sharing one curve — the phone buys, the laptop's 2.5s poll
([diner App.tsx:69](packages/diner-frontend/src/App.tsx#L69)) sees the price tick up. With
per-instance state the laptop polls a different world. `/demo/clock` fast-forward has the same
problem.

**Two ways out:**

- **Recommended — host app-services on a long-running box.** `npm start` already does
  `node dist/server.js`. No code changes. One process = one shared world = the demo works.
- Back the state with Postgres (the §10.3 read model was always the plan) and adapt Express to a
  serverless handler. Correct long-term, not a pre-demo task.

---

## 2. Already fixed in this repo

- [x] **Frontends now honour `VITE_API_URL`.** All three clients previously used bare relative
      paths (`fetch('/pools')`) that only worked via the Vite dev proxy; deployed, they would hit
      the SPA rewrite and return `index.html` as a JSON parse error. Empty default = relative =
      dev unchanged.
- [x] **CORS on app-services** — hand-rolled middleware mounted first, so preflights are answered
      for every route including the raw-body webhook. Allowlist via `CORS_ORIGINS`.
- [x] **`vercel.json` for each frontend** (SPA rewrite, `dist`, Vite framework preset).
- [x] `VITE_API_URL` typed in each app's `vite-env.d.ts`.
- [x] `diner-frontend` gained a `typecheck` script — the root `npm run typecheck` was silently
      skipping it.

Verified: `npm run build` and `npm run typecheck` pass at the root; CORS preflight returns the
allow-origin header for an allowlisted origin and omits it for one that isn't.

---

## 3. Vercel project setup — one project per app

Four projects off the same repo. For each:

- [ ] **Root Directory** = `packages/<app>`, with **"Include files outside root directory"**
      ENABLED. `@ttr/shared-types` is a workspace dependency; install has to happen at the repo
      root or resolution fails.
- [ ] Confirm the build resolves the shared-types project reference. `packages/*/dist` is
      untracked, so Vercel builds everything from scratch — it will not inherit your local `dist`.
- [ ] Each app's `vercel.json` is committed (SPA rewrite is required or deep links 404).

**Environment variables:**

| Project | Var | Value |
|---|---|---|
| diner, mobile, restaurant | `VITE_API_URL` | deployed app-services origin, no trailing slash |
| launcher | `VITE_DINER_URL`, `VITE_MOBILE_URL`, `VITE_RESTAURANT_URL`, `VITE_LAB_URL` | the deployed app URLs |

- [ ] Remember Vite **inlines `VITE_*` at build time** — changing one in the dashboard does
      nothing until you **redeploy**.
- [ ] The launcher's `/up/*` liveness probes are dev-proxy-only and already guarded by
      `if (!import.meta.env.DEV) return` ([Roles.tsx:47](packages/launcher/src/Roles.tsx#L47)) —
      nothing to do, just don't be surprised the cards don't probe in production.

---

## 4. app-services host

- [ ] `CORS_ORIGINS` = the deployed client origins, comma-separated. Unset falls back to `*`,
      which is tolerable **only** while auth is the `x-user-id` stub and nothing uses cookies. The
      moment a real identity provider lands, set the allowlist — `*` is illegal with credentials.
- [ ] `APP_BASE_URL` = the public origin. It builds the StubGateway mock deposit `hosted_url`;
      left at localhost, the "Confirm payment" button on the mock page is dead and the demo buy
      never settles.
- [ ] Serve over **HTTPS**. Vercel frontends are HTTPS, and a page there cannot call an HTTP API —
      mixed content is blocked outright.
- [ ] `PAYMENT_GATEWAY=stub` unless the real keys are in hand. `UnifoldGateway` throws immediately
      on any missing key ([server.ts:30](packages/app-services/src/server.ts#L30)), so a
      half-filled env takes the whole service down at boot.

---

## 5. Secrets

- [ ] `.env` is gitignored and only `.env.example` is tracked — verified clean, nothing leaked.
- [ ] **Never prefix a secret with `VITE_`.** Vite inlines those into the public bundle. Anyone
      can read it with View Source. `UNIFOLD_SECRET_KEY` and `UNIFOLD_WEBHOOK_SECRET` are
      server-side only and belong on the app-services host, never in a Vercel client project.
- [ ] `UNIFOLD_PUBLISHABLE_KEY` (`pk_`) is the only Unifold key that may reach the browser.

---

## 6. If/when the real Unifold gateway goes on (SWAP B)

- [ ] Register the webhook endpoint at `https://<app-services>/webhooks/unifold`, not localhost.
- [ ] **Raw body must survive to the handler.** [server.ts](packages/app-services/src/server.ts)
      mounts `express.raw()` before `express.json()` because the signature is HMAC-SHA256 over
      `id.timestamp.rawBody`. Any host or proxy that re-parses or re-serializes the body silently
      breaks verification. Test with a real webhook, not just a stub POST.
- [ ] Confirm `x-stub` cannot bypass verification in production — it's a demo affordance and the
      deployed apps are publicly reachable.

---

## 7. Pre-flight

- [ ] **Commit the working tree.** ~45 files are modified and Vercel builds from the pushed
      branch, not your disk. This is the single most common way a deploy "doesn't pick up my fix".
- [ ] `npm run build` and `npm run typecheck` clean at the root.
- [ ] Decide about **public access**: auth is still the `x-user-id` header stub, so a deployed
      restaurant dashboard lets anyone sweep a reserve. Fine for a judged demo on a URL nobody
      knows; not fine if the link circulates. Vercel password protection is the cheap fix.
- [ ] Smoke the deployed stack in the actual §11 order: load diner → buy → confirm on the mock
      page → curve ticks up → restaurant dashboard shows the fill. If `VITE_API_URL` is wrong you
      will see it immediately as a JSON parse error in the console.

---

## 8. Hosting app-services on Cloud Run

[Dockerfile](Dockerfile) + [.dockerignore](.dockerignore) at the repo root. Built and run locally
before ever reaching Cloud Build: image is 553MB, boots, serves, and completes a full buy.

### The one flag that must not be wrong

```
--max-instances=1
```

**All state is in memory (§1).** Cloud Run autoscales by default, and a second instance is a second
world: the phone buys against instance A while the laptop polls instance B and never sees the curve
move. That is the same defect that rules out Vercel functions, and it reappears here unless you
pin the ceiling to one instance. `--concurrency` stays at its default 80, which is plenty — the
constraint is one *instance*, not one request.

`--min-instances=0` keeps it free and lets it scale to zero. Cold start is ~2s (vs ~50s on a Render
free instance), and on boot `seed()` rebuilds the pools from *relative* dates (`inHours: 6`,
`inDays: 2` — see `SEED_PLAN`), so a cold service always wakes up as a valid, correctly-dated demo.
You lose tables bought earlier, not correctness.

### Deploy

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy ttr-app-services \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --max-instances=1 \
  --min-instances=0 \
  --set-env-vars PAYMENT_GATEWAY=stub
```

Then, using the URL it prints:

```bash
gcloud run services update ttr-app-services --region us-central1 \
  --update-env-vars APP_BASE_URL=https://<service-url>
```

- [x] **Port**: Cloud Run injects `PORT` and health-checks that exact port.
      [config.ts](packages/app-services/src/config.ts) reads `PORT` first, falling back to
      `APP_SERVICES_PORT` for local dev. Verified in the container.
- [ ] **`APP_BASE_URL`** must be set after the first deploy — it builds the StubGateway mock
      deposit link, and left unset it points at localhost, so "Confirm payment" is dead and no buy
      ever settles. Verified: the container returns
      `hosted_url: http://localhost:8080/mock/deposit` without it.
- [ ] **`tsconfig.base.json` must be in the image.** Every package extends `../../tsconfig.base.json`;
      without it tsc silently falls back to target ES5 with no ES2022 lib and the build fails on
      Map iteration and `Error.cause`. The Dockerfile copies it explicitly — this bit once already.
- [ ] Cloud Run serves HTTPS by default, which the Vercel frontends require.

---

## 9. Order of operations — localhost to live

The ordering is forced: **Vite inlines `VITE_API_URL` at build time**, so the frontends cannot be
built until app-services has a public URL.

1. **Commit and push.** Both hosts build from GitHub, not your disk. Anything uncommitted is
   invisible to them — see §7.
2. **Deploy app-services to Cloud Run** (§8). Leave `CORS_ORIGINS` unset for now; it falls back to
   `*`, which breaks the chicken-and-egg where CORS needs URLs that don't exist yet.
3. **Verify it directly** before touching the frontends:
   `curl https://<service-url>/demo/pool-id` → `{"pool_id":"pool_25"}`.
   If this fails, no frontend will work and you'll waste time debugging the wrong layer.
4. **Set `APP_BASE_URL`** to that URL (§8).
5. **Deploy the three frontends to Vercel** (§3), each with `VITE_API_URL=https://<service-url>`
   (no trailing slash). Note the URLs Vercel assigns.
6. **Deploy the launcher** with `VITE_DINER_URL` / `VITE_MOBILE_URL` / `VITE_RESTAURANT_URL` /
   `VITE_LAB_URL` pointing at those. The launcher is the demo's front door, so it goes last.
7. **Tighten CORS** to the comma-separated Vercel origins, then re-test one buy — get this wrong
   and the browser blocks the call, leaving the app looking dead with only a console error:
   ```bash
   gcloud run services update ttr-app-services --region us-central1 \
     --update-env-vars CORS_ORIGINS=https://a.vercel.app,https://b.vercel.app
   ```
8. **Custom domain** (optional): Vercel → Project → Settings → Domains. Add the apex to the
   launcher and subdomains to the rest. Changing an app's domain means updating the launcher's
   `VITE_*` and **redeploying it** — inlined at build time, so a dashboard edit alone does nothing.
9. **Smoke the §11 script end to end** on the real URLs, in order, including a buy from the phone
   while the laptop watches the curve. That single test exercises every seam this checklist covers.

---

## 10. Running the LIVE demo on localhost (recommended)

**Deploy for the share link; present from localhost.** On stage the only property that matters is
that it cannot fail, and local has no cold start, no venue Wi-Fi, no CORS, no DNS, and no free-tier
spin-down. Everything in this checklist is backwards-compatible — `VITE_API_URL` unset means
relative paths, which is exactly the dev-proxy setup that already works — so **the local demo needs
no changes at all.**

You do not need a second device. [PhoneFrame.tsx](packages/mobile-diner/src/PhoneFrame.tsx) is an
on-screen device shell "for demoing on a laptop projected to a room"; the mobile app is just a
browser window that renders inside a phone-shaped frame, and the frame drops away on a real narrow
viewport. Same build, both roles.

Five terminals (or your existing setup):

```
npm run dev --workspace @ttr/app-services        # :8080  — the one shared world
npm run dev --workspace @ttr/launcher            # :5170  — front door / role picker
npm run dev --workspace @ttr/diner-frontend      # :5173
npm run dev --workspace @ttr/restaurant-frontend # :5174
npm run dev --workspace @ttr/mobile-diner        # :5175
```

- [ ] Open the launcher at `http://localhost:5170` and use its three cards to open the surfaces —
      the liveness dots confirm every dev server is actually up before you present
      ([Roles.tsx:43](packages/launcher/src/Roles.tsx#L43), dev-only by design).
- [ ] Arrange windows before you start: mobile (:5175) and restaurant (:5174) side by side is the
      §11 money shot — buy on the phone, watch the curve tick up on the dashboard 2.5s later.
- [ ] **Restart app-services to reset between rehearsals.** State is in memory, so a restart
      re-seeds a clean pool at n=6 — this is a feature, not a limitation. Rehearse as often as you
      like.
- [ ] Disable OS notifications and screen sleep. This is the failure mode that actually bites
      people demoing locally.
- [ ] Optional: if you *do* want a real phone on stage, run
      `npm run dev --workspace @ttr/mobile-diner -- --host`, connect the phone to the same Wi-Fi,
      and open `http://<laptop-LAN-IP>:5175`. Test it at the venue first — conference networks
      commonly enable client isolation, which blocks this silently. The PhoneFrame path needs no
      network at all, which is why it is the default recommendation.
