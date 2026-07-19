/**
 * Unifold client-SDK configuration (UNIFOLD_INTEGRATION.md §6).
 *
 * The publishable key (`pk_`) is the ONLY Unifold credential that may reach the browser — it can
 * launch checkout modals but cannot create intents or move treasury funds. The secret key (`sk_`)
 * stays in app-services and is never bundled here.
 *
 * The provider needs this key at mount time, before any buy has happened, so it comes from a
 * build-time env var rather than from the `POST /pools/:id/buy` response. The server echoes its own
 * `publishable_key` on that response; `assertKeyMatch` cross-checks the two so a frontend built
 * against a different Unifold project fails loudly instead of opening a modal that can never settle.
 */

/** Set = real Unifold checkout. Unset = StubGateway mock flow, and the whole demo still runs. */
export const UNIFOLD_PUBLISHABLE_KEY = (
  import.meta.env.VITE_UNIFOLD_PUBLISHABLE_KEY ?? ''
).trim();

/** Whether to mount UnifoldProvider / launch real checkout modals at all. */
export const unifoldEnabled = UNIFOLD_PUBLISHABLE_KEY.startsWith('pk_');

if (UNIFOLD_PUBLISHABLE_KEY && !unifoldEnabled) {
  console.warn(
    `[unifold] VITE_UNIFOLD_PUBLISHABLE_KEY is set but does not start with "pk_" — ignoring it ` +
      `and falling back to the stub flow. Secret "sk_" keys must never be used in the browser.`,
  );
}

/**
 * Guard against a frontend and backend pointed at different Unifold projects: the client_secret
 * would be unrecognized by the modal and the buy would silently never settle.
 */
export function assertKeyMatch(serverKey: string | undefined): void {
  if (!serverKey || !unifoldEnabled) return;
  if (serverKey !== UNIFOLD_PUBLISHABLE_KEY) {
    console.error(
      `[unifold] publishable key mismatch: app-services issued this intent under "${serverKey.slice(0, 12)}…" ` +
        `but this build mounted "${UNIFOLD_PUBLISHABLE_KEY.slice(0, 12)}…". The checkout modal will not ` +
        `recognize the client_secret. Rebuild with VITE_UNIFOLD_PUBLISHABLE_KEY matching the server.`,
    );
  }
}
