import { describe, expect, it } from 'vitest'
import {
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  PROVIDER_PROXY_MAX_COORDINATES,
  validateProviderProxyRoutePreviewRequest,
  validateProviderProxyAiTripDraftRequest,
  validateProviderProxyAiTripDraftRepairRequest,
  validateProviderProxyTravelSearchRequest,
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

describe('provider proxy ai_trip_draft_repair contract', () => {
  it('accepts a valid repair request', () => {
    const result = validateProviderProxyAiTripDraftRepairRequest(validRepairRequest())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.draft.title).toBe('东京之旅')
      expect(result.request.qualityFindings).toHaveLength(1)
    }
  })

  it('rejects missing draft', () => {
    const req = validRepairRequest()
    delete (req as Record<string, unknown>).draft
    const result = validateProviderProxyAiTripDraftRepairRequest(req)
    expect(result.ok).toBe(false)
  })

  it('rejects invalid draft', () => {
    const result = validateProviderProxyAiTripDraftRepairRequest({
      ...validRepairRequest(),
      draft: { title: '', startDate: 'bad', endDate: '2025-04-05', days: [] },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects missing qualityFindings', () => {
    const req = validRepairRequest()
    delete (req as Record<string, unknown>).qualityFindings
    const result = validateProviderProxyAiTripDraftRepairRequest(req)
    expect(result.ok).toBe(false)
  })

  it('rejects oversized repairInstruction', () => {
    const result = validateProviderProxyAiTripDraftRepairRequest({
      ...validRepairRequest(),
      repairInstruction: 'x'.repeat(1001),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects invalid reasoningMode', () => {
    const result = validateProviderProxyAiTripDraftRepairRequest({
      ...validRepairRequest(),
      reasoningMode: 'extreme',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown operation', () => {
    const result = validateProviderProxyAiTripDraftRepairRequest({
      ...validRepairRequest(),
      operation: 'unknown',
    })
    expect(result.ok).toBe(false)
  })

  it('returns non-empty error message for repair operation', () => {
    const message = defaultProviderProxyErrorMessage('invalid_response', 'ai_trip_draft_repair')
    expect(message.length).toBeGreaterThan(0)
    expect(message).toContain('修复')
  })
})

function validRepairRequest() {
  return {
    operation: 'ai_trip_draft_repair',
    requestId: 'repair-1',
    draft: {
      title: '东京之旅',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-05',
      days: [
        {
          date: '2025-04-01',
          items: [
            { title: '浅草寺', locationName: '浅草寺', startTime: '09:00', endTime: '11:00' },
          ],
        },
      ],
    },
    qualityFindings: [
      { ruleId: 'dense_day', severity: 'warning', title: '行程偏密', message: '当天行程偏密。', dayDate: '2025-04-01' },
    ],
  }
}

describe('provider proxy travel_search contract', () => {
  it('accepts a valid minimal travel_search request and applies defaults', () => {
    const result = validateProviderProxyTravelSearchRequest({
      operation: 'travel_search',
      query: '杭州 西湖 营业时间',
      requestId: 'search-1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request).toMatchObject({
        maxResults: 5,
        operation: 'travel_search',
        query: '杭州 西湖 营业时间',
        requestId: 'search-1',
        searchType: 'general',
      })
    }
  })

  it('accepts optional locale region searchType and maxResults', () => {
    const result = validateProviderProxyTravelSearchRequest({
      locale: 'zh-CN',
      maxResults: 10,
      operation: 'travel_search',
      query: '杭州博物馆',
      region: 'CN',
      searchType: 'opening_hours',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.locale).toBe('zh-CN')
      expect(result.request.region).toBe('CN')
      expect(result.request.searchType).toBe('opening_hours')
      expect(result.request.maxResults).toBe(10)
    }
  })

  it('rejects invalid travel_search inputs', () => {
    expect(validateProviderProxyTravelSearchRequest(null).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ operation: 'travel_search', query: '' }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ operation: 'travel_search', query: 'x'.repeat(301) }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), locale: 'fr-FR' }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), region: 'x'.repeat(81) }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), searchType: 'weather' }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: 0 }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: 11 }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: 2.5 }).ok).toBe(false)
  })

  it('rejects forbidden sensitive fields instead of ignoring them', () => {
    for (const field of ['apiKey', 'providerKey', 'token', 'cloudToken', 'ticketBlobs', 'ticketMetas', 'routeCache', 'localDb', 'fullTrip', 'Authorization', 'headers']) {
      const result = validateProviderProxyTravelSearchRequest({
        ...validTravelSearchRequest(),
        [field]: 'secret',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_request')
      }
    }
  })

  it('returns non-empty error message for travel_search operation', () => {
    const message = defaultProviderProxyErrorMessage('provider_unavailable', 'travel_search')
    expect(message).toContain('搜索')
  })
})

function validTravelSearchRequest() {
  return {
    operation: 'travel_search',
    query: '杭州博物馆',
  }
}
