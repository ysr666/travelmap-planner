import { describe, expect, it } from 'vitest'
import {
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  PROVIDER_PROXY_MAX_COORDINATES,
  validateProviderProxyRoutePreviewRequest,
  validateProviderProxyAiTripDraftRequest,
} from './providerProxyContract'

describe('provider proxy route preview contract', () => {
  it('accepts a minimal route preview request', () => {
    const result = validateProviderProxyRoutePreviewRequest(validRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.provider).toBe('openrouteservice')
      expect(result.request.coordinates).toEqual([[139.1, 35.1], [139.2, 35.2]])
    }
  })

  it('rejects bad coordinates', () => {
    const result = validateProviderProxyRoutePreviewRequest({
      ...validRequest(),
      coordinates: [[139.1, 35.1], [200, 35.2]],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_request')
    }
  })

  it('rejects requests above the coordinate cap', () => {
    const coordinates = Array.from({ length: PROVIDER_PROXY_MAX_COORDINATES + 1 }, (_, index) => [139 + index / 1000, 35] as [number, number])
    const result = validateProviderProxyRoutePreviewRequest({
      ...validRequest(),
      coordinates,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain(String(PROVIDER_PROXY_MAX_COORDINATES))
    }
  })

  it('rejects unsupported providers and route modes', () => {
    expect(validateProviderProxyRoutePreviewRequest({
      ...validRequest(),
      provider: 'proxy',
    }).ok).toBe(false)
    expect(validateProviderProxyRoutePreviewRequest({
      ...validRequest(),
      segments: [{ ...validRequest().segments[0], mode: 'hoverboard' }],
    }).ok).toBe(false)
  })
})

function validRequest() {
  return {
    coordinates: [[139.1, 35.1], [139.2, 35.2]],
    dayId: 'day',
    operation: 'route_preview',
    provider: 'openrouteservice',
    requestId: 'request-1',
    segments: [
      {
        fromCoordinateIndex: 0,
        fromItemId: 'a',
        mode: 'car',
        profile: 'driving-car',
        segmentIndex: 0,
        toCoordinateIndex: 1,
        toItemId: 'b',
      },
    ],
    tripId: 'trip',
  }
}

describe('provider proxy ai_trip_draft contract', () => {
  it('accepts a valid ai_trip_draft request', () => {
    const result = validateProviderProxyAiTripDraftRequest(validAiDraftRequest())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.destination).toBe('东京')
      expect(result.request.startDate).toBe('2025-04-01')
      expect(result.request.endDate).toBe('2025-04-05')
    }
  })

  it('rejects empty destination', () => {
    const result = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), destination: '' })
    expect(result.ok).toBe(false)
  })

  it('rejects non-padded date', () => {
    const result = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), startDate: '2025-4-1' })
    expect(result.ok).toBe(false)
  })

  it('rejects full ISO datetime', () => {
    const result = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), startDate: '2025-04-01T00:00:00Z' })
    expect(result.ok).toBe(false)
  })

  it('rejects end before start', () => {
    const result = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), startDate: '2025-04-10', endDate: '2025-04-01' })
    expect(result.ok).toBe(false)
  })

  it('rejects free text too long', () => {
    const result = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), freeTextRequirement: 'x'.repeat(2001) })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown operation', () => {
    const result = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), operation: 'unknown' })
    expect(result.ok).toBe(false)
  })
})

function validAiDraftRequest() {
  return {
    destination: '东京',
    endDate: '2025-04-05',
    operation: 'ai_trip_draft',
    requestId: 'req-1',
    startDate: '2025-04-01',
  }
}

describe('invalid_response error code', () => {
  it('returns a non-empty message for ai_trip_draft', () => {
    const message = defaultProviderProxyErrorMessage('invalid_response', 'ai_trip_draft')
    expect(message.length).toBeGreaterThan(0)
    expect(message).toContain('解析')
  })

  it('returns a non-empty message for general branch', () => {
    const message = defaultProviderProxyErrorMessage('invalid_response')
    expect(message.length).toBeGreaterThan(0)
  })

  it('builds a valid error response', () => {
    const response = buildProviderProxyErrorResponse({ code: 'invalid_response' })
    expect(response.ok).toBe(false)
    expect(response.code).toBe('invalid_response')
    expect(response.message.length).toBeGreaterThan(0)
  })
})
