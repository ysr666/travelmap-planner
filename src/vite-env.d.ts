/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_ROUTING_PROVIDER?: string
  readonly VITE_OPENROUTESERVICE_API_KEY?: string
}
