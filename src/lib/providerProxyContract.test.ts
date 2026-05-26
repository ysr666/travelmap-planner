import { describe, expect, it } from 'vitest'
import {
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  PROVIDER_PROXY_MAX_COORDINATES,
  validateProviderProxyRoutePreviewRequest,
  validateProviderProxyAiTripDraftRequest,
  validateProviderProxyAiTripDraftRepairRequest,
  validateProviderProxyAiTripEditPlanRequest,
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
      maxResults: 3,
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
      expect(result.request.maxResults).toBe(3)
    }
  })

  it('accepts only canonical travel_search search types', () => {
    for (const searchType of ['general', 'opening_hours', 'ticket_price', 'official_site', 'transport', 'nearby_food']) {
      expect(validateProviderProxyTravelSearchRequest({
        ...validTravelSearchRequest(),
        searchType,
      }).ok).toBe(true)
    }
  })

  it('rejects legacy travel_search search type aliases', () => {
    for (const searchType of ['place', 'tickets', 'reviews']) {
      expect(validateProviderProxyTravelSearchRequest({
        ...validTravelSearchRequest(),
        searchType,
      }).ok).toBe(false)
    }
  })

  it('defaults and caps travel_search maxResults explicitly', () => {
    const missing = validateProviderProxyTravelSearchRequest(validTravelSearchRequest())
    const accepted = validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: 5 })
    const capped = validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: 99 })

    expect(missing.ok).toBe(true)
    expect(accepted.ok).toBe(true)
    expect(capped.ok).toBe(true)
    if (missing.ok) expect(missing.request.maxResults).toBe(5)
    if (accepted.ok) expect(accepted.request.maxResults).toBe(5)
    if (capped.ok) expect(capped.request.maxResults).toBe(5)
  })

  it('rejects invalid travel_search inputs', () => {
    expect(validateProviderProxyTravelSearchRequest(null).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ operation: 'travel_search', query: '' }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ operation: 'travel_search', query: 'x'.repeat(301) }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), locale: 'fr-FR' }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), region: 'x'.repeat(81) }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), searchType: 'weather' }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: 0 }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: -1 }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: 2.5 }).ok).toBe(false)
    expect(validateProviderProxyTravelSearchRequest({ ...validTravelSearchRequest(), maxResults: '5' }).ok).toBe(false)
  })

  it('rejects forbidden sensitive fields recursively instead of ignoring them', () => {
    for (const field of ['apiKey', 'providerKey', 'token', 'cloudToken', 'ticketBlobs', 'ticketMetas', 'ticketIds', 'routeCache', 'localDb', 'fullTrip', 'authorization', 'headers', 'coordinates', 'items', 'itineraryItems', 'days', 'trip']) {
      const result = validateProviderProxyTravelSearchRequest({
        ...validTravelSearchRequest(),
        nested: { [field]: 'secret' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_request')
      }
    }
  })

  it('does not reject sensitive words inside the query text', () => {
    const result = validateProviderProxyTravelSearchRequest({
      ...validTravelSearchRequest(),
      query: 'apiKey authorization routeCache 这些词只是搜索文本',
    })

    expect(result.ok).toBe(true)
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

describe('provider proxy ai_trip_edit_plan contract', () => {
  it('accepts a valid edit plan request', () => {
    const result = validateProviderProxyAiTripEditPlanRequest(validEditPlanRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.command).toBe('第二天太满了，帮我放松一点')
      expect(result.request.context.days[0].items[0].id).toBe('item_1')
    }
  })

  it('accepts safe source-bearing search results for edit plan requests', () => {
    const result = validateProviderProxyAiTripEditPlanRequest({
      ...validEditPlanRequest(),
      searchResults: validEditSearchResults(),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.searchResults?.results[0]).toMatchObject({
        domain: 'travel.example',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        sourceType: 'official',
        title: '西湖官网',
      })
    }
  })

  it('rejects malformed or unsafe edit search results', () => {
    expect(validateProviderProxyAiTripEditPlanRequest({
      ...validEditPlanRequest(),
      searchResults: { ...validEditSearchResults(), rawProviderBody: { secret: true } },
    }).ok).toBe(false)
    expect(validateProviderProxyAiTripEditPlanRequest({
      ...validEditPlanRequest(),
      searchResults: {
        ...validEditSearchResults(),
        results: [{ ...validEditSearchResults().results[0], url: 'javascript:alert(1)' }],
      },
    }).ok).toBe(false)
    expect(validateProviderProxyAiTripEditPlanRequest({
      ...validEditPlanRequest(),
      searchResults: {
        ...validEditSearchResults(),
        results: [{ ...validEditSearchResults().results[0], providerMetadata: 'raw' }],
      },
    }).ok).toBe(false)
  })

  it('rejects invalid command and context', () => {
    expect(validateProviderProxyAiTripEditPlanRequest({ ...validEditPlanRequest(), command: '' }).ok).toBe(false)
    expect(validateProviderProxyAiTripEditPlanRequest({ ...validEditPlanRequest(), command: 'x'.repeat(1001) }).ok).toBe(false)
    expect(validateProviderProxyAiTripEditPlanRequest({ ...validEditPlanRequest(), context: { days: [] } }).ok).toBe(false)
  })

  it('rejects forbidden sensitive fields recursively', () => {
    const result = validateProviderProxyAiTripEditPlanRequest({
      ...validEditPlanRequest(),
      context: {
        ...validEditPlanRequest().context,
        ticketMetas: [{ fileName: 'secret.pdf' }],
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_request')
    }
  })

  it('returns non-empty error message for edit plan operation', () => {
    const message = defaultProviderProxyErrorMessage('invalid_response', 'ai_trip_edit_plan')
    expect(message).toContain('修改建议')
  })
})

function validEditPlanRequest() {
  return {
    command: '第二天太满了，帮我放松一点',
    context: {
      days: [
        {
          date: '2026-07-10',
          id: 'day_1',
          items: [
            {
              dayId: 'day_1',
              id: 'item_1',
              startTime: '09:00',
              title: '西湖',
            },
          ],
          title: '第一天',
        },
      ],
      trip: {
        destination: '杭州',
        endDate: '2026-07-11',
        id: 'trip_1',
        startDate: '2026-07-10',
        title: '杭州两日',
      },
    },
    operation: 'ai_trip_edit_plan',
    requestId: 'edit-1',
  }
}

function validEditSearchResults() {
  return {
    query: '杭州 西湖 官网',
    results: [
      {
        confidence: 'medium',
        displayUrl: 'travel.example/search/west-lake',
        domain: 'travel.example',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        snippet: '模拟来源片段，不代表实时信息。',
        sourceType: 'official',
        title: '西湖官网',
        url: 'https://travel.example/search/west-lake',
      },
    ],
    retrievedAt: '2026-01-01T00:00:00.000Z',
    source: 'mock',
  }
}
