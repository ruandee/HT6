/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of app-services (§10.4). Unset = relative paths, which the dev proxy in
   * vite.config.ts sends to :8080. Required for a deployed build, where there is no proxy.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
