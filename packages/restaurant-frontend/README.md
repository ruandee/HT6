# Operator Console (stream 5 — `restaurant-frontend`)

The restaurant-side business app. React issuer dashboard: create pool (p0, k, N, φ, service_time,
Tc); monitor fill % + reserve + royalties; trigger check-in per diner; sweep reserve after service
(shows consumed vs. forfeited / recovered no-shows, total swept, meal-credits-to-honor; §7c-B).

**Boundary (LOCKED §8):** talks ONLY to app-services REST issuer routes (`/restaurant/*`), typed by
`@ttr/shared-types` §10.4. NEVER touches the chain.

**Wait-gate:** none. Build against a mock REST server (§8.1). Scaffold with Vite + React when you
start.
