import { describe, expect, it } from 'vitest'
import {
  getRealtimeFactFreshness,
  selectRealtimeFact,
  validateRealtimeFactV1,
} from './realtimeFact'

function weatherFact(overrides: Record<string, unknown> = {}) {
  return {
    confidence: 'high',
    expiresAt: '2026-08-18T10:00:00.000Z',
    id: 'fact_weather_current',
    kind: 'weather_current',
    observedAt: '2026-08-18T09:00:00.000Z',
    rawRef: 'open_meteo:weather:2026-08-18T09',
    schemaVersion: 1,
    source: {
      label: 'Open-Meteo',
      provider: 'open_meteo',
      url: 'https://open-meteo.com/en/docs',
    },
    subject: { id: 'day_1', type: 'day' },
    tripId: 'trip_1',
    value: {
      condition: 'partly_cloudy',
      locationName: '伦敦',
      precipitationProbability: 20,
      temperatureCelsius: 17,
    },
    ...overrides,
  }
}

describe('RealtimeFactV1', () => {
  it('accepts a strict source-bearing weather fact', () => {
    const result = validateRealtimeFactV1(weatherFact())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.source.provider).toBe('open_meteo')
    expect(getRealtimeFactFreshness(result.value, '2026-08-18T09:30:00Z')).toBe('current')
    expect(getRealtimeFactFreshness(result.value, '2026-08-18T10:00:00Z')).toBe('stale')
  })

  it.each([
    ['unknown top-level field', { providerPayload: { token: 'secret' } }],
    ['missing source', { source: undefined }],
    ['unbounded TTL', { expiresAt: '2026-08-19T09:00:00.000Z' }],
    ['arbitrary source URL', { source: { label: 'Injected', provider: 'open_meteo', url: 'https://evil.example/weather' } }],
    ['secret raw reference', { rawRef: 'provider:token:secret' }],
    ['unknown value field', { value: { condition: 'clear', locationName: '伦敦', raw: {}, temperatureCelsius: 18 } }],
    ['stringified numeric value', { value: { condition: 'clear', locationName: '伦敦', temperatureCelsius: '18' } }],
  ])('rejects %s', (_label, patch) => {
    expect(validateRealtimeFactV1(weatherFact(patch)).ok).toBe(false)
  })

  it('validates every supported value shape', () => {
    const base = weatherFact()
    const values = [
      { kind: 'weather_forecast', value: { condition: 'showers', date: '2026-08-19', locationName: '伦敦', maxCelsius: 20, minCelsius: 14 } },
      { kind: 'place_opening_status', value: { closesAt: '18:00', status: 'open' } },
      { kind: 'route_eta', value: { distanceMeters: 1200, durationMinutes: 16, mode: 'walk', status: 'road' } },
      { kind: 'transport_status', value: { delayMinutes: 20, mode: 'flight', status: 'delayed' } },
      { kind: 'ticket_status', value: { entryTime: '09:00', serviceDate: '2026-08-19', status: 'ready' } },
    ]
    for (const [index, patch] of values.entries()) {
      const expiresAt = patch.kind === 'ticket_status'
        ? '2026-08-19T08:00:00.000Z'
        : patch.kind === 'weather_forecast'
          ? '2026-08-18T12:00:00.000Z'
          : patch.kind === 'place_opening_status'
            ? '2026-08-18T10:00:00.000Z'
            : '2026-08-18T09:10:00.000Z'
      expect(validateRealtimeFactV1({
        ...base,
        ...patch,
        expiresAt,
        id: `fact_${index}`,
        rawRef: `fixture:fact:${index}`,
        source: { label: '固定测试', provider: patch.kind === 'place_opening_status' ? 'fixture_places' : 'fixture_routes' },
      }).ok).toBe(true)
    }
  })

  it('selects current data first and exposes the latest expired fact only as stale', () => {
    const stale = validateRealtimeFactV1(weatherFact({
      expiresAt: '2026-08-18T09:30:00.000Z',
      id: 'fact_stale',
      observedAt: '2026-08-18T08:30:00.000Z',
    }))
    const current = validateRealtimeFactV1(weatherFact())
    expect(stale.ok && current.ok).toBe(true)
    if (!stale.ok || !current.ok) return
    expect(selectRealtimeFact([stale.value, current.value], {
      kind: 'weather_current',
      now: '2026-08-18T09:45:00.000Z',
      subjectId: 'day_1',
    })).toMatchObject({ fact: { id: 'fact_weather_current' }, state: 'current' })
    expect(selectRealtimeFact([stale.value], {
      kind: 'weather_current',
      now: '2026-08-18T09:45:00.000Z',
      subjectId: 'day_1',
    })).toMatchObject({ fact: { id: 'fact_stale' }, state: 'stale' })
  })
})
