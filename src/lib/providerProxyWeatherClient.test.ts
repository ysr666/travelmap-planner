import { describe, expect, it, vi } from 'vitest'
import { fetchProviderProxyWeatherForecast } from './providerProxyClient'

const OBSERVED_AT = '2026-08-09T08:00:00.000Z'

function request() {
  return {
    date: '2026-08-09',
    includeCurrent: false,
    latitude: 51.5074,
    locationName: '伦敦',
    longitude: -0.1278,
    operation: 'weather_forecast' as const,
    requestId: 'weather-request-1',
    subject: { id: 'item_london_1', type: 'item' as const },
    timeZone: 'Europe/London',
    tripId: 'trip_uk_2026',
  }
}

function forecastFact(overrides: Record<string, unknown> = {}) {
  return {
    confidence: 'high',
    expiresAt: '2026-08-09T11:00:00.000Z',
    id: 'fact_weather_forecast_item_london_1',
    kind: 'weather_forecast',
    observedAt: OBSERVED_AT,
    rawRef: 'open_meteo:forecast:item_london_1:2026-08-09',
    schemaVersion: 1,
    source: { label: 'Open-Meteo', provider: 'open_meteo', url: 'https://open-meteo.com/en/docs' },
    subject: { id: 'item_london_1', type: 'item' },
    tripId: 'trip_uk_2026',
    value: {
      condition: 'partly_cloudy',
      date: '2026-08-09',
      locationName: '伦敦',
      maxCelsius: 22,
      minCelsius: 16,
      precipitationProbability: 20,
    },
    ...overrides,
  }
}

function success(overrides: Record<string, unknown> = {}) {
  return {
    facts: [forecastFact()],
    ok: true,
    operation: 'weather_forecast',
    requestId: 'weather-request-1',
    retrievedAt: OBSERVED_AT,
    source: 'open_meteo',
    warnings: [],
    ...overrides,
  }
}

describe('provider proxy weather client', () => {
  it('sends only the validated weather contract with session and auth headers', async () => {
    const storage = memoryStorage()
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        date: '2026-08-09',
        operation: 'weather_forecast',
        quotaSessionId: expect.stringMatching(/^pp_/),
        subject: { id: 'item_london_1', type: 'item' },
        tripId: 'trip_uk_2026',
      })
      expect(Object.keys(body).sort()).toEqual([
        'date',
        'includeCurrent',
        'latitude',
        'locationName',
        'longitude',
        'operation',
        'quotaSessionId',
        'requestId',
        'subject',
        'timeZone',
        'tripId',
      ])
      expect(JSON.stringify(body)).not.toMatch(/access-token|api[_-]?key|authorization|database|blob/i)
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      })
      return new Response(JSON.stringify(success()), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyWeatherForecast(request(), '/api/provider-proxy', {
      accessToken: 'test-access-token',
      fetcher,
      storage,
    })

    expect(result).toMatchObject({ facts: [{ kind: 'weather_forecast' }], source: 'open_meteo' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    [success({ databaseRows: [] }), 'unknown response field'],
    [success({ facts: [forecastFact({ source: { label: 'Mock', provider: 'mock_weather' } })] }), 'source mismatch'],
    [success({ facts: [forecastFact({ subject: { id: 'item_other', type: 'item' } })] }), 'subject mismatch'],
    [success({ facts: [forecastFact({ token: 'private-token' })] }), 'private fact field'],
  ])('rejects a provider response with %s (%s)', async (body) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

    await expect(fetchProviderProxyWeatherForecast(request(), '/api/provider-proxy', { fetcher }))
      .rejects.toMatchObject({ code: 'invalid_response', status: 200 })
  })
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}
