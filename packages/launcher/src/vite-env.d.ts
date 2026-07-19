/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed origin of the desktop diner app. Falls back to the local dev port. */
  readonly VITE_DINER_URL?: string;
  /** Deployed origin of the mobile diner app. */
  readonly VITE_MOBILE_URL?: string;
  /** Deployed origin of the restaurant dashboard. */
  readonly VITE_RESTAURANT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
