import { describe, expect, it, vi } from 'vitest'
import { validateProviderProxyWeatherForecastRequest } from '../../src/lib/ai/providerProxyContract'
import {
  OPEN_METEO_FORECAST_ENDPOINT,
  OPEN_METEO_SOURCE_URL,
  createMockWeatherProvider,
  createOpenMeteoWeatherProvider,
} from './weatherProvider'

const NOW = '2026-08-09T08:00:00.000Z'

function validRequest(includeCurrent = true) {
  const validation = validateProviderProxyWeatherForecastRequest({
    date: '2026-08-09',
    includeCurrent,
    latitude: 51.5074,
    locationName: '伦敦',
    longitude: -0.1278,
    operation: 'weather_forecast',
    quotaSessionId: 'weather-session-1',
    requestId: 'weather-request-1',
    subject: { id: 'item_london_1', type: 'item' },
    timeZone: 'Europe/London',
    tripId: 'trip_uk_2026',
  })
  if (!validation.ok) throw new Error(validation.error.message)
  return validation.request
}

function openMeteoPayload(overrides: Record<string, unknown> = {}) {
  return {
    current: {
      apparent_temperature: 16.5,
      precipitation_probability: 60,
      temperature_2m: 17.2,
      weather_code: 61,
      wind_speed_10m: 14,
    },
    daily: {
      precipitation_probability_max: [72],
      temperature_2m_max: [20.8],
      temperature_2m_min: [14.9],
      time: ['2026-08-09'],
      weather_code: [61],
    },
    ...overrides,
  }
}

describe('weather provider', () => {
  it('returns deterministic, low-confidence mock facts with explicit mock provenance', async () => {
    const result = await createMockWeatherProvider({ now: NOW }).getForecast(validRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response).toMatchObject({
        retrievedAt: NOW,
        source: 'mock',
        warnings: ['当前为模拟天气，不代表真实预报。'],
      })
      expect(result.response.facts).toHaveLength(2)
      expect(result.response.facts.every((fact) => fact.confidence === 'low')).toBe(true)
      expect(result.response.facts.every((fact) => fact.source.provider === 'mock_weather')).toBe(true)
      expect(result.response.facts.every((fact) => fact.rawRef.startsWith('mock_weather:'))).toBe(true)
    }
  })

  it('uses the fixed Open-Meteo endpoint and normalizes only bounded forecast fields', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(openMeteoPayload()), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })) as unknown as typeof fetch
    const result = await createOpenMeteoWeatherProvider(fetcher, { now: NOW }).getForecast(validRequest())

    expect(result.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [input, init] = vi.mocked(fetcher).mock.calls[0]
    const url = new URL(String(input))
    expect(`${url.origin}${url.pathname}`).toBe(OPEN_METEO_FORECAST_ENDPOINT)
    expect(url.searchParams.get('latitude')).toBe('51.507400')
    expect(url.searchParams.get('longitude')).toBe('-0.127800')
    expect(url.searchParams.get('timezone')).toBe('Europe/London')
    expect(url.searchParams.get('start_date')).toBe('2026-08-09')
    expect(url.searchParams.get('end_date')).toBe('2026-08-09')
    expect(url.searchParams.get('daily')).toBe('weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
    expect(url.searchParams.get('current')).toContain('temperature_2m')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(JSON.stringify({ init, url: String(url) })).not.toMatch(/api[_-]?key|authorization|bearer|token/i)
    if (result.ok) {
      expect(result.response.facts).toMatchObject([
        {
          kind: 'weather_current',
          rawRef: expect.stringMatching(/^open_meteo:/),
          source: { provider: 'open_meteo', url: OPEN_METEO_SOURCE_URL },
          value: { condition: 'rain', temperatureCelsius: 17.2 },
        },
        {
          kind: 'weather_forecast',
          source: { provider: 'open_meteo', url: OPEN_METEO_SOURCE_URL },
          value: { condition: 'rain', maxCelsius: 20.8, minCelsius: 14.9, shortAdvice: '随身带雨具' },
        },
      ])
    }
  })

  it('omits current query and fact when current conditions were not requested', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(openMeteoPayload()), { status: 200 })) as unknown as typeof fetch
    const result = await createOpenMeteoWeatherProvider(fetcher, { now: NOW }).getForecast(validRequest(false))

    expect(result.ok).toBe(true)
    const [input] = vi.mocked(fetcher).mock.calls[0]
    expect(new URL(String(input)).searchParams.has('current')).toBe(false)
    if (result.ok) expect(result.response.facts.map((fact) => fact.kind)).toEqual(['weather_forecast'])
  })

  it.each([
    [new Response('{bad json', { status: 200 }), 'invalid_response'],
    [new Response(JSON.stringify(openMeteoPayload({ current: { temperature_2m: '17', weather_code: 1 } })), { status: 200 }), 'invalid_response'],
    [new Response('{}', { headers: { 'Content-Length': String(600 * 1024) }, status: 200 }), 'invalid_response'],
    [new Response('{}', { status: 429 }), 'quota_exceeded'],
    [new Response('{}', { status: 503 }), 'provider_unavailable'],
  ])('normalizes malformed or failed upstream responses without returning provider bodies', async (upstream, code) => {
    const fetcher = vi.fn(async () => upstream.clone()) as unknown as typeof fetch
    const result = await createOpenMeteoWeatherProvider(fetcher, { now: NOW }).getForecast(validRequest())

    expect(result).toMatchObject({ errorCode: code, ok: false })
    expect(JSON.stringify(result)).not.toContain('{bad json')
    expect(JSON.stringify(result)).not.toContain('temperature_2m')
  })

  it('returns sanitized network and out-of-window errors without executing arbitrary URLs', async () => {
    const fetcher = vi.fn(async () => { throw new Error('Authorization Bearer private-token stack') }) as unknown as typeof fetch
    const provider = createOpenMeteoWeatherProvider(fetcher, { now: NOW })
    const network = await provider.getForecast(validRequest())
    const outside = await provider.getForecast({ ...validRequest(), date: '2026-09-01' })

    expect(network).toEqual({ errorCode: 'network_error', message: 'Weather provider request failed.', ok: false })
    expect(outside).toMatchObject({ errorCode: 'unsupported', ok: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(network)).not.toMatch(/authorization|bearer|private-token|stack/i)
  })
})
