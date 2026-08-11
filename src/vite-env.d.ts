/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemDirectoryHandle {
  queryPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
}

interface Window {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}

declare const __APP_VERSION__: string
declare const __APP_COMMIT_SHA__: string
declare const __TRIPMAP_E2E__: boolean
declare const __TRIPMAP_UNIT_TEST__: boolean

interface ImportMetaEnv {
  readonly VITE_ACCOUNT_CLOUD_V2_ACCOUNT_HASHES?: string
  readonly VITE_ACCOUNT_CLOUD_V2_MODE?: 'disabled' | 'enabled' | 'shadow'
  readonly VITE_ACCOUNT_CLOUD_V2_MIGRATION?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  readonly VITE_ROUTE_PROXY_URL?: string
  readonly VITE_ROUTE_PROXY_PROVIDER?: string
  readonly VITE_E2E_AUTH_BYPASS?: string
  readonly VITE_E2E_USE_LIVE_MAP?: string
}
