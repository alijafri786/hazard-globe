/// <reference types="vite/client" />

declare const CESIUM_BASE_URL: string

interface ImportMetaEnv {
  /** Optional. Enables Cesium World Terrain + Bing imagery. Each deployer brings their own token. */
  readonly VITE_CESIUM_ION_TOKEN?: string
  /** Optional. Defaults to same-origin /api (proxied to the server in dev). */
  readonly VITE_API_BASE?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
