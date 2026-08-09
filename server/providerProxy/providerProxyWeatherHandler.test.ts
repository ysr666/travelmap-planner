import { describe, expect, it, vi } from 'vitest'
import { createProviderOperationsMemoryStorage } from './providerOperationsGuard'
import { handleProviderProxyRequest } from './providerProxyHandler'
import { createProviderProxyMemoryQuotaStorage } from './quotaGuard'

const NOW_MS = Date.parse('2026-08-09T08:00:00.000Z')

function validWeatherRequest() {
  return {
    date: '2026-08-09',
    includeCurrent: true,
    latitude: 51.5074,
    locationName: '伦敦',
    longitude: -0.1278,
    operation: 'weather_forecast',
    quotaSessionId: 'weather-session-1',
    requestId: 'weather-request-1',
    subject: { id: 'item_london_1', type: 'item' },
    timeZone: 'Europe/London',
    tripId: 'trip_uk_2026',
  }
}

function jsonRequest(body: unknown, overrides: Record<string, string> = {}) {
  return new Request('https://travelmap-planner.pages.dev/api/provider-proxy', {
    body: JSON.stringify(body),
    headers: {
      Authorization: 'Bearer test-token',
      'CF-Connecting-IP': '203.0.113.21',
      'Content-Type': 'application/json',
      Origin: 'https://travelmap-planner.pages.dev',
      ...overrides,
    },
    method: 'POST',
  })
}

function openMeteoFetcher() {
  return vi.fn(async () => new Response(JSON.stringify({
    current: { temperature_2m: 17, weather_code: 2 },
    daily: {
      precipitation_probability_max: [20],
      temperature_2m_max: [22],
      temperature_2m_min: [16],
      time: ['2026-08-09'],
      weather_code: [2],
    },
  }), { status: 200 })) as unknown as typeof fetch
}

describe('provider proxy weather_forecast handler', () => {
  it('enforces production origin and auth before an upstream weather call', async () => {
    const fetcher = openMeteoFetcher()
    const authVerifier = vi.fn(async () => ({ ok: false as const }))
    const common = {
      authVerifier,
      env: {
        TRIPMAP_PROVIDER_PROXY_ENV: 'production',
        TRIPMAP_WEATHER_PROVIDER: 'open_meteo',
      },
      fetcher,
      nowMs: NOW_MS,
      operationsStorage: createProviderOperationsMemoryStorage(),
      quotaStorage: createProviderProxyMemoryQuotaStorage(),
    }

    const badOrigin = await handleProviderProxyRequest({
      ...common,
      request: jsonRequest(validWeatherRequest(), { Origin: 'https://evil.example' }),
    })
    expect(badOrigin.status).toBe(403)
    expect(authVerifier).not.toHaveBeenCalled()

    const badAuth = await handleProviderProxyRequest({
      ...common,
      request: jsonRequest(validWeatherRequest()),
    })
    expect(badAuth.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns only strict mock facts after the shared controls pass', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      nowMs: NOW_MS,
      request: jsonRequest(validWeatherRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body).toMatchObject({
      ok: true,
      operation: 'weather_forecast',
      requestId: 'weather-request-1',
      source: 'mock',
      warnings: ['当前为模拟天气，不代表真实预报。'],
    })
    expect(JSON.stringify(body)).not.toMatch(/authorization|bearer|token|database|blob/i)
  })

  it('rejects unknown and sensitive fields before provider execution', async () => {
    const fetcher = openMeteoFetcher()
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_WEATHER_PROVIDER: 'open_meteo' },
      fetcher,
      nowMs: NOW_MS,
      request: jsonRequest({ ...validWeatherRequest(), apiKey: 'client-secret' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_request', operation: 'weather_forecast' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('applies the isolated weather request window before provider execution', async () => {
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const common = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      nowMs: NOW_MS,
      quotaLimits: { maxWeatherRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }
    const first = await handleProviderProxyRequest({ ...common, request: jsonRequest(validWeatherRequest()) })
    const second = await handleProviderProxyRequest({ ...common, request: jsonRequest(validWeatherRequest()) })

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(await second.json()).toMatchObject({ code: 'quota_exceeded', operation: 'weather_forecast' })
  })

  it('honors the weather kill switch before quota and provider execution', async () => {
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const consume = vi.spyOn(quotaStorage, 'consume')
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_PROVIDER_PROXY_KILL_SWITCH: 'weather',
        TRIPMAP_WEATHER_PROVIDER: 'open_meteo',
      },
      nowMs: NOW_MS,
      quotaStorage,
      request: jsonRequest(validWeatherRequest()),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'provider_unavailable', operation: 'weather_forecast' })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({ key: expect.stringMatching(/^edge_ip\|/) }))
  })

  it('enforces account daily budget before the upstream request', async () => {
    const fetcher = openMeteoFetcher()
    const operationsStorage = createProviderOperationsMemoryStorage()
    vi.spyOn(operationsStorage, 'consumeDaily').mockResolvedValue({ allowed: false, reason: 'budget_exceeded' })
    const response = await handleProviderProxyRequest({
      authVerifier: vi.fn(async () => ({ ok: true as const, userId: 'verified-user' })),
      env: {
        TRIPMAP_PROVIDER_PROXY_ENV: 'production',
        TRIPMAP_WEATHER_PROVIDER: 'open_meteo',
      },
      fetcher,
      nowMs: NOW_MS,
      operationsStorage,
      quotaStorage: createProviderProxyMemoryQuotaStorage(),
      request: jsonRequest(validWeatherRequest()),
    })

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'quota_exceeded', operation: 'weather_forecast' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
