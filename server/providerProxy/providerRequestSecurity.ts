import type { ProviderProxyQuotaHasher, ProviderProxyQuotaStorage } from './quotaGuard'
import { consumeProviderProxyFixedQuota } from './quotaGuard'
import type { ProviderRuntimeEnvironment } from './providerOperationsGuard'
import { isStrictProviderEnvironment } from './providerOperationsGuard'

export type ProviderProxyAuthVerifier = (input: {
  accessToken: string
  env: Record<string, unknown>
  fetcher: typeof fetch
}) => Promise<{ ok: true; userId: string } | { ok: false }>

export const PROVIDER_PROXY_MAX_BODY_BYTES = 256 * 1024
export const PROVIDER_PROXY_EDGE_IP_REQUESTS_PER_MINUTE = 120

const PRODUCTION_ORIGIN = 'https://travelmap-planner.pages.dev'
const PREVIEW_ORIGIN_PATTERN = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,62})\.travelmap-planner\.pages\.dev$/

export function evaluateProviderOrigin(
  request: Request,
  env: Record<string, unknown>,
  environment: ProviderRuntimeEnvironment,
) {
  const origin = request.headers.get('Origin')?.trim()
  const strict = isStrictProviderEnvironment(environment)
  if (!origin) {
    return { allowed: !strict, corsHeaders: {} as Record<string, string> }
  }
  const configured = new Set(readString(env.TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS)?.split(',').map((value) => value.trim()).filter(Boolean) ?? [])
  const trustedProjectOrigin = origin === PRODUCTION_ORIGIN || PREVIEW_ORIGIN_PATTERN.test(origin)
  const allowed = trustedProjectOrigin || configured.has(origin) || (!strict && configured.has('*')) || (!strict && configured.size === 0)
  return {
    allowed,
    corsHeaders: allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {},
  }
}

export function extractBearerToken(request: Request) {
  const authorization = request.headers.get('Authorization')?.trim()
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1] && match[1].length <= 8192 ? match[1] : undefined
}

export function shouldRequireProviderAuth(env: Record<string, unknown>, environment: ProviderRuntimeEnvironment) {
  const configured = readString(env.TRIPMAP_PROVIDER_PROXY_REQUIRE_AUTH)?.toLowerCase()
  return configured === '1' || configured === 'true' || isStrictProviderEnvironment(environment)
}

export async function verifyProviderAccessToken(input: {
  accessToken: string
  env: Record<string, unknown>
  fetcher: typeof fetch
}): Promise<{ ok: true; userId: string } | { ok: false }> {
  const supabaseUrl = readString(input.env.TRIPMAP_SUPABASE_URL) ?? readString(input.env.VITE_SUPABASE_URL)
  const anonKey = readString(input.env.TRIPMAP_SUPABASE_ANON_KEY) ?? readString(input.env.VITE_SUPABASE_ANON_KEY)
  if (!supabaseUrl || !anonKey) return { ok: false }
  let endpoint: URL
  try {
    endpoint = new URL('/auth/v1/user', supabaseUrl)
  } catch {
    return { ok: false }
  }
  try {
    const response = await input.fetcher(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${input.accessToken}`,
      },
      method: 'GET',
    })
    if (!response.ok) return { ok: false }
    const body = await response.json() as { id?: unknown }
    return typeof body.id === 'string' && body.id.trim()
      ? { ok: true, userId: body.id.trim() }
      : { ok: false }
  } catch {
    return { ok: false }
  }
}

export async function readProviderRequestBody(request: Request) {
  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > PROVIDER_PROXY_MAX_BODY_BYTES) {
    return { ok: false as const }
  }
  if (!request.body) return { ok: true as const, text: '' }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > PROVIDER_PROXY_MAX_BODY_BYTES) {
        await reader.cancel()
        return { ok: false as const }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false as const }
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true as const, text: new TextDecoder().decode(body) }
}

export async function consumeProviderEdgeIpLimit(input: {
  hasher?: ProviderProxyQuotaHasher
  ip: string
  nowMs: number
  storage: ProviderProxyQuotaStorage
}) {
  return consumeProviderProxyFixedQuota({
    bucket: 'edge_ip|',
    hasher: input.hasher,
    identity: { ip: input.ip },
    maxRequests: PROVIDER_PROXY_EDGE_IP_REQUESTS_PER_MINUTE,
    nowMs: input.nowMs,
    storage: input.storage,
    windowMs: 60_000,
  })
}

export function getProviderRequestIp(request: Request) {
  return request.headers.get('CF-Connecting-IP')?.trim()
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || undefined
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
