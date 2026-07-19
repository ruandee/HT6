/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of app-services (§10.4). Unset = relative paths, which the dev proxy in
   * vite.config.ts sends to :8080. Required for a deployed build, where there is no proxy.
   */
  readonly VITE_API_URL?: string;
  /**
   * Unifold publishable key (`pk_test_…` / `pk_live_…`). Set = the real Unifold checkout modal
   * collects the buy; unset = the StubGateway mock flow. NEVER put an `sk_` key here — Vite inlines
   * VITE_* vars into the client bundle. See src/unifold.ts.
   */
  readonly VITE_UNIFOLD_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
