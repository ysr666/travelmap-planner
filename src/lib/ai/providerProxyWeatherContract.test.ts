import { describe, expect, it } from 'vitest'
import {
  validateProviderProxyWeatherForecastRequest,
  validateProviderProxyWeatherForecastSuccessResponse,
  type ProviderProxyValidatedWeatherForecastRequest,
} from './providerProxyContract'

const OBSERVED_AT = '2026-08-09T08:00:00.000Z'

function validRequest(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

function validatedRequest(overrides: Record<string, unknown> = {}): ProviderProxyValidatedWeatherForecastRequest {
  const validation = validateProviderProxyWeatherForecastRequest(validRequest(overrides))
  if (!validation.ok) throw new Error(validation.error.message)
  return validation.request
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
    source: {
      label: 'Open-Meteo',
      provider: 'open_meteo',
      url: 'https://open-meteo.com/en/docs',
    },
    subject: { id: 'item_london_1', type: 'item' },
    tripId: 'trip_uk_2026',
    value: {
      condition: 'rain',
      date: '2026-08-09',
      locationName: '伦敦',
      maxCelsius: 21,
      minCelsius: 15,
      precipitationProbability: 70,
      shortAdvice: '随身带雨具',
    },
    ...overrides,
  }
}

function currentFact(overrides: Record<string, unknown> = {}) {
  return {
    confidence: 'high',
    expiresAt: '2026-08-09T08:30:00.000Z',
    id: 'fact_weather_current_item_london_1',
    kind: 'weather_current',
    observedAt: OBSERVED_AT,
    rawRef: 'open_meteo:current:item_london_1:2026-08-09T08',
    schemaVersion: 1,
    source: {
      label: 'Open-Meteo',
      provider: 'open_meteo',
      url: 'https://open-meteo.com/en/docs',
    },
    subject: { id: 'item_london_1', type: 'item' },
    tripId: 'trip_uk_2026',
    value: {
      condition: 'rain',
      locationName: '伦敦',
      precipitationProbability: 65,
      temperatureCelsius: 17,
      windKph: 12,
    },
    ...overrides,
  }
}

function successResponse(facts: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    facts,
    ok: true,
    operation: 'weather_forecast',
    requestId: 'weather-request-1',
    retrievedAt: OBSERVED_AT,
    source: 'open_meteo',
    warnings: [],
    ...overrides,
  }
}

describe('provider proxy weather contract', () => {
  it('normalizes a bounded request without adding provider-controlled fields', () => {
    const validation = validateProviderProxyWeatherForecastRequest(validRequest({
      includeCurrent: undefined,
      locationName: '  伦敦  ',
    }))

    expect(validation.ok).toBe(true)
    if (validation.ok) {
      expect(validation.request).toEqual({
        date: '2026-08-09',
        includeCurrent: false,
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
    }
  })

  const invalidRequests: Array<[Record<string, unknown>, string]> = [
    [{ apiKey: 'client-secret' }, 'unknown top-level field'],
    [{ provider: 'https://evil.example/function' }, 'provider selection'],
    [{ latitude: '51.5074' }, 'string coordinate'],
    [{ longitude: 181 }, 'out-of-range coordinate'],
    [{ date: '09/08/2026' }, 'non-plain date'],
    [{ timeZone: 'Server/Secret' }, 'invalid timezone'],
    [{ locationName: `伦${'敦'.repeat(160)}` }, 'oversized location'],
    [{ requestId: '' }, 'blank request id'],
    [{ subject: { id: 'item_london_1', type: 'item', databaseId: 'private-row' } }, 'nested private field'],
  ]

  it.each(invalidRequests)('rejects %s (%s)', (overrides) => {
    expect(validateProviderProxyWeatherForecastRequest(validRequest(overrides))).toMatchObject({
      error: { code: 'invalid_request', operation: 'weather_forecast' },
      ok: false,
    })
  })

  it('accepts only request-bound, source-bound realtime facts', () => {
    const request = validatedRequest()
    const response = validateProviderProxyWeatherForecastSuccessResponse(
      successResponse([currentFact(), forecastFact()]),
      request,
    )

    expect(response).toMatchObject({
      facts: [{ kind: 'weather_current' }, { kind: 'weather_forecast' }],
      source: 'open_meteo',
    })
  })

  it.each([
    [() => successResponse([forecastFact({ tripId: 'trip_other' })]), 'other trip'],
    [() => successResponse([forecastFact({ subject: { id: 'item_other', type: 'item' } })]), 'other subject'],
    [() => successResponse([forecastFact({ value: { ...forecastFact().value as object, locationName: '巴黎' } })]), 'other location'],
    [() => successResponse([forecastFact({ source: { label: 'Mock', provider: 'mock_weather' } })]), 'mismatched source'],
    [() => successResponse([forecastFact({ value: { ...forecastFact().value as object, date: '2026-08-10' } })]), 'other date'],
    [() => successResponse([forecastFact({ expiresAt: '2026-08-10T08:00:00.000Z' })]), 'unbounded ttl'],
    [() => successResponse([forecastFact({ token: 'private-token' })]), 'unknown fact field'],
    [() => successResponse([forecastFact(), forecastFact({ id: 'fact_weather_forecast_duplicate' })]), 'duplicate fact kind'],
    [() => successResponse([forecastFact()], { databaseRows: [] }), 'unknown response field'],
  ])('rejects a response containing %s (%s)', (build) => {
    expect(validateProviderProxyWeatherForecastSuccessResponse(build(), validatedRequest())).toBeNull()
  })

  it('rejects current conditions when the caller did not request them', () => {
    const request = validatedRequest({ includeCurrent: false })
    expect(validateProviderProxyWeatherForecastSuccessResponse(
      successResponse([currentFact(), forecastFact()]),
      request,
    )).toBeNull()
  })
})
