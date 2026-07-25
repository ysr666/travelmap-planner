import {
  defaultProviderProxyErrorMessage,
  isProviderProxyConcreteProvider,
  type ProviderProxyConcreteProvider,
  type ProviderProxyErrorCode,
  type ProviderProxyErrorResponse,
} from './ai/providerProxyContract'

export type ProviderProxyRuntimeConfig = {
  configured: boolean
  provider: ProviderProxyConcreteProvider | null
  proxyUrl: string | null
  source: 'proxy' | 'none'
}

export type ProviderProxyClientOptions = {
  accessToken?: string | null
  accessTokenProvider?: () => Promise<string | null>
  fetcher?: typeof fetch
  signal?: AbortSignal
  storage?: Storage | null
}

export const PROVIDER_PROXY_SESSION_STORAGE_KEY = 'tripmap:provider-proxy:session-id'
export const PROVIDER_PROXY_DEV_URL_STORAGE_KEY = 'tripmap:dev:route-proxy-url'
export const PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY = 'tripmap:dev:route-proxy-provider'

let memoryProviderProxySessionId: string | null = null

export function getProviderProxyConfig(
  options: {
    env?: Partial<ImportMetaEnv>
    storage?: Storage | null
  } = {},
): ProviderProxyRuntimeConfig {
  const env = options.env ?? readProviderProxyEnv()
  const storage = options.storage ?? getProviderProxyBrowserStorage()
  const proxyUrl = normalizeProxyUrl(
    readStorageValue(storage, PROVIDER_PROXY_DEV_URL_STORAGE_KEY)
      ?? env.VITE_ROUTE_PROXY_URL
      ?? inferSameOriginProviderProxyUrl(),
  )
  const provider = normalizeProxyProvider(
    readStorageValue(storage, PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY)
      ?? env.VITE_ROUTE_PROXY_PROVIDER
      ?? inferDefaultProxyProvider(proxyUrl),
  )

  return {
    configured: Boolean(proxyUrl && provider),
    provider,
    proxyUrl,
    source: proxyUrl && provider ? 'proxy' : 'none',
  }
}

export function getProviderProxySessionId(storage = getProviderProxyBrowserStorage()) {
  const existing = readStorageValue(storage, PROVIDER_PROXY_SESSION_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const next = createSessionId()
  memoryProviderProxySessionId = next
  try {
    storage?.setItem(PROVIDER_PROXY_SESSION_STORAGE_KEY, next)
  } catch {
    // In private or restricted storage contexts, keep an in-memory session id.
  }
  return next
}

export class ProviderProxyClientError extends Error {
  readonly code: ProviderProxyErrorCode
  readonly details?: string
  readonly provider?: ProviderProxyConcreteProvider
  readonly status?: number

  constructor(error: ProviderProxyErrorResponse, status?: number) {
    super(getProviderProxyClientErrorMessage(error, status))
    this.name = 'ProviderProxyClientError'
    this.code = error.code
    this.details = error.details
    this.provider = error.provider
    this.status = status
  }
}

export function getProviderProxyBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readProviderProxyEnv(): Pick<ImportMetaEnv, 'VITE_ROUTE_PROXY_PROVIDER' | 'VITE_ROUTE_PROXY_URL'> {
  return {
    VITE_ROUTE_PROXY_PROVIDER: import.meta.env.VITE_ROUTE_PROXY_PROVIDER,
    VITE_ROUTE_PROXY_URL: import.meta.env.VITE_ROUTE_PROXY_URL,
  }
}

function getProviderProxyClientErrorMessage(error: ProviderProxyErrorResponse, status?: number) {
  if (
    error.code === 'invalid_request'
    && (
      status === 401
      || status === 403
      || /auth|authentication|登录|云端账号/i.test(error.message ?? '')
    )
  ) {
    return '请先登录或刷新云端账号后再使用 AI / 地点服务。'
  }
  return error.message || defaultProviderProxyErrorMessage(error.code, error.operation)
}

function normalizeProxyProvider(value?: string | null): ProviderProxyConcreteProvider | null {
  return isProviderProxyConcreteProvider(value) ? value : null
}

function normalizeProxyUrl(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

function inferSameOriginProviderProxyUrl() {
  if (typeof window === 'undefined') return null
  const hostname = window.location.hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return null
  return '/api/provider-proxy'
}

function inferDefaultProxyProvider(proxyUrl: string | null) {
  return proxyUrl ? 'openrouteservice' : null
}

function readStorageValue(storage: Storage | null | undefined, key: string) {
  try {
    const value = storage?.getItem(key)?.trim()
    return value || null
  } catch {
    return null
  }
}

function createSessionId() {
  if (memoryProviderProxySessionId) {
    return memoryProviderProxySessionId
  }

  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `pp_${randomId}`
}
