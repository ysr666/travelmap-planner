import { describe, expect, it } from 'vitest'
import {
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  PROVIDER_PROXY_MAX_COORDINATES,
  PROVIDER_PROXY_MAX_ROUTE_ORDER_ITEMS,
  validateProviderProxyRouteOrderSuggestionRequest,
  validateProviderProxyRoutePreviewRequest,
  validateProviderProxyAiTripDraftRequest,
  validateProviderProxyAiTripDraftRepairRequest,
  validateProviderProxyAiTripDraftRefineRequest,
  buildMockAiTripDraftRefineProxyResponse,
  validateProviderProxyAiTripEditPlanRequest,
  validateProviderProxyPlaceLookupRequest,
  validateProviderProxyPlaceDetailsRequest,
  validateProviderProxyTripContentEnrichmentRequest,
  validateProviderProxyTripDailyTipRequest,
  validateProviderProxyTripOperationsSummaryRequest,
  validateProviderProxyAssistantAnswerRequest,
  validateProviderProxyAssistantAnswerSuccessResponse,
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

describe('provider proxy route_order_suggestion contract', () => {
  it('accepts a valid route_order_suggestion request', () => {
    const result = validateProviderProxyRouteOrderSuggestionRequest(validRouteOrderRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.provider).toBe('auto')
      expect(result.request.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
      expect(result.request.items[0].coordinate).toEqual({ lat: 35.1, lng: 139.1 })
    }
  })

  it('rejects duplicate ids invalid coordinates and too few routable items', () => {
    expect(validateProviderProxyRouteOrderSuggestionRequest({
      ...validRouteOrderRequest(),
      items: [
        { id: 'a', title: 'A', coordinate: { lat: 35.1, lng: 139.1 } },
        { id: 'a', title: 'B', coordinate: { lat: 35.2, lng: 139.2 } },
      ],
    }).ok).toBe(false)
    expect(validateProviderProxyRouteOrderSuggestionRequest({
      ...validRouteOrderRequest(),
      items: [
        { id: 'a', title: 'A', coordinate: { lat: 91, lng: 139.1 } },
        { id: 'b', title: 'B', coordinate: { lat: 35.2, lng: 139.2 } },
      ],
    }).ok).toBe(false)
    expect(validateProviderProxyRouteOrderSuggestionRequest({
      ...validRouteOrderRequest(),
      items: [
        { id: 'a', title: 'A', coordinate: { lat: 35.1, lng: 139.1 } },
        { id: 'b', title: 'B' },
      ],
    }).ok).toBe(false)
  })

  it('rejects oversized and sensitive route_order_suggestion fields', () => {
    expect(validateProviderProxyRouteOrderSuggestionRequest({
      ...validRouteOrderRequest(),
      items: Array.from({ length: PROVIDER_PROXY_MAX_ROUTE_ORDER_ITEMS + 1 }, (_, index) => ({
        coordinate: { lat: 35 + index / 1000, lng: 139 },
        id: `item-${index}`,
        title: `Item ${index}`,
      })),
    }).ok).toBe(false)
    expect(validateProviderProxyRouteOrderSuggestionRequest({
      ...validRouteOrderRequest(),
      notes: 'do not send notes',
    }).ok).toBe(false)
    expect(validateProviderProxyRouteOrderSuggestionRequest({
      ...validRouteOrderRequest(),
      items: [
        { id: 'a', title: 'A', coordinate: { lat: 35.1, lng: 139.1 }, ticketIds: ['ticket'] },
        { id: 'b', title: 'B', coordinate: { lat: 35.2, lng: 139.2 } },
      ],
    }).ok).toBe(false)
  })
})

describe('provider proxy assistant_answer contract', () => {
  it('accepts redacted assistant answer requests and success responses', () => {
    const request = validateProviderProxyAssistantAnswerRequest(validAssistantAnswerRequest())
    expect(request.ok).toBe(true)
    if (request.ok) {
      expect(request.request.operation).toBe('assistant_answer')
      expect(request.request.context.scopeLabel).toBe('全部旅行')
      expect(request.request.context.summaries[0]).toMatchObject({ key: 'trip_count' })
    }

    const response = validateProviderProxyAssistantAnswerSuccessResponse({
      answer: '可以，我只基于脱敏摘要回答。',
      caveats: ['不会写入。'],
      ok: true,
      operation: 'assistant_answer',
      source: 'future_ai',
      sourceCards: [{ id: 'local', kind: 'local_context', title: '本地摘要' }],
    })
    expect(response).toMatchObject({ ok: true, operation: 'assistant_answer', source: 'future_ai' })
  })

  it('rejects sensitive assistant answer payload fields', () => {
    const result = validateProviderProxyAssistantAnswerRequest({
      ...validAssistantAnswerRequest(),
      context: {
        ...validAssistantAnswerRequest().context,
        rawPayload: { Authorization: 'Bearer secret', pnr: 'AB12CD' },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('敏感字段')
      expect(JSON.stringify(result.error)).not.toContain('secret')
    }
  })
})

describe('provider proxy place_details contract', () => {
  it('accepts a safe place_details request', () => {
    const result = validateProviderProxyPlaceDetailsRequest({
      locale: 'zh-CN',
      operation: 'place_details',
      placeId: 'place-west-lake',
      region: 'cn',
      requestId: 'details-1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.region).toBe('CN')
      expect(result.request.placeId).toBe('place-west-lake')
    }
  })

  it('rejects sensitive place_details fields', () => {
    const result = validateProviderProxyPlaceDetailsRequest({
      operation: 'place_details',
      placeId: 'place-west-lake',
      ticketIds: ['ticket'],
    })
    expect(result.ok).toBe(false)
  })
})

describe('provider proxy trip_content_enrichment contract', () => {
  it('accepts sanitized source-backed enrichment requests', () => {
    const result = validateProviderProxyTripContentEnrichmentRequest(validContentEnrichmentRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.items[0].sources[0]).toMatchObject({
        confidence: 'high',
        id: 'place:west-lake',
        sourceType: 'google_places',
      })
      expect(JSON.stringify(result.request)).not.toContain('ticketIds')
      expect(JSON.stringify(result.request)).not.toContain('routeCache')
    }
  })

  it('rejects full trip, notes, coordinates, tickets, and unsafe urls', () => {
    for (const patch of [
      { trip: { id: 'trip' } },
      { notes: 'private notes' },
      { routeCache: {} },
      { items: [{ ...validContentEnrichmentRequest().items[0], lat: 30.2 }] },
      { items: [{ ...validContentEnrichmentRequest().items[0], ticketIds: ['ticket'] }] },
      { items: [{ ...validContentEnrichmentRequest().items[0], sources: [{ ...validContentEnrichmentRequest().items[0].sources[0], url: 'javascript:alert(1)' }] }] },
    ]) {
      const result = validateProviderProxyTripContentEnrichmentRequest({
        ...validContentEnrichmentRequest(),
        ...patch,
      })
      expect(result.ok).toBe(false)
    }
  })
})

describe('provider proxy trip_daily_tip contract', () => {
  it('accepts sanitized source-backed daily tip requests', () => {
    const result = validateProviderProxyTripDailyTipRequest(validDailyTipRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.sources[0].sourceType).toBe('official')
      expect(result.request.localSections[0].items[0].sourceIds).toEqual(['daily-source-1'])
      expect(JSON.stringify(result.request)).not.toContain('ticketIds')
      expect(JSON.stringify(result.request)).not.toContain('routeCache')
      expect(JSON.stringify(result.request)).not.toContain('private notes')
    }
  })

  it('rejects sensitive daily tip fields and invalid source references', () => {
    for (const patch of [
      { notes: 'private notes' },
      { routeCache: {} },
      { cloud: { status: 'dirty' } },
      { tickets: [{ id: 'ticket' }] },
      { sources: [{ ...validDailyTipRequest().sources[0], url: 'javascript:alert(1)' }] },
      { localSections: [{ ...validDailyTipRequest().localSections[0], items: [{ title: '开放时间', text: '无来源事实', sourceIds: ['missing'] }] }] },
    ]) {
      const result = validateProviderProxyTripDailyTipRequest({
        ...validDailyTipRequest(),
        ...patch,
      })
      expect(result.ok).toBe(false)
    }
  })

  it('returns non-empty error message for trip_daily_tip operation', () => {
    const message = defaultProviderProxyErrorMessage('provider_unavailable', 'trip_daily_tip')
    expect(message).toContain('今日旅行提示')
  })
})

describe('provider proxy trip_operations_summary contract', () => {
  it('accepts sanitized recommendation summaries', () => {
    const result = validateProviderProxyTripOperationsSummaryRequest(validTripOperationsSummaryRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.phase).toBe('traveling')
      expect(result.request.recommendations[0]).toMatchObject({
        actionKind: 'generate_routes',
        severity: 'low',
        title: '2 天缺路线',
      })
      expect(JSON.stringify(result.request)).not.toContain('ticketIds')
      expect(JSON.stringify(result.request)).not.toContain('routeCache')
      expect(JSON.stringify(result.request)).not.toContain('private notes')
    }
  })

  it('rejects sensitive fields and oversized recommendation batches', () => {
    expect(validateProviderProxyTripOperationsSummaryRequest({
      ...validTripOperationsSummaryRequest(),
      notes: 'private notes',
    }).ok).toBe(false)
    expect(validateProviderProxyTripOperationsSummaryRequest({
      ...validTripOperationsSummaryRequest(),
      recommendations: [{
        ...validTripOperationsSummaryRequest().recommendations[0],
        ticketIds: ['ticket'],
      }],
    }).ok).toBe(false)
    expect(validateProviderProxyTripOperationsSummaryRequest({
      ...validTripOperationsSummaryRequest(),
      recommendations: Array.from({ length: 6 }, (_, index) => ({
        ...validTripOperationsSummaryRequest().recommendations[0],
        title: `建议 ${index}`,
      })),
    }).ok).toBe(false)
  })

  it('returns non-empty error message for trip_operations_summary operation', () => {
    const message = defaultProviderProxyErrorMessage('provider_unavailable', 'trip_operations_summary')
    expect(message).toContain('执行建议摘要')
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

function validTripOperationsSummaryRequest() {
  return {
    destination: '杭州',
    generatedAt: '2026-06-12T00:00:00.000Z',
    operation: 'trip_operations_summary',
    phase: 'traveling',
    recommendations: [{
      actionKind: 'generate_routes',
      actionLabel: '生成路线',
      message: '明天 2 个地点缺路线。',
      severity: 'low',
      title: '2 天缺路线',
      type: 'missing_route',
    }],
    requestId: 'ops-summary-1',
    tripTitle: '杭州三日',
  }
}

function validRouteOrderRequest() {
  return {
    dayId: 'day',
    items: [
      { id: 'a', title: 'A', coordinate: { lat: 35.1, lng: 139.1 } },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C', coordinate: { lat: 35.2, lng: 139.2 } },
    ],
    operation: 'route_order_suggestion',
    provider: 'auto',
    requestId: 'route-order-1',
    tripId: 'trip',
  }
}

function validContentEnrichmentRequest() {
  return {
    items: [
      {
        address: '杭州西湖',
        destination: '杭州',
        itemId: 'item-west-lake',
        place: {
          displayName: '西湖风景名胜区',
          editorialSummary: '西湖是杭州代表性湖泊景观。',
          placeId: 'place-west-lake',
          regularOpeningHours: { weekdayDescriptions: ['周一至周日 全天开放'] },
          retrievedAt: '2026-06-01T00:00:00.000Z',
          websiteUri: 'https://westlake.example',
        },
        sources: [
          {
            confidence: 'high',
            id: 'place:west-lake',
            label: 'Google Places',
            retrievedAt: '2026-06-01T00:00:00.000Z',
            sourceType: 'google_places',
            title: '西湖风景名胜区',
            url: 'https://maps.google.com/west-lake',
          },
        ],
        title: '西湖',
      },
    ],
    locale: 'zh-CN',
    operation: 'trip_content_enrichment',
  }
}

function validDailyTipRequest() {
  return {
    dayTitle: '第一天',
    destination: '杭州',
    generatedAt: '2026-06-05T08:00:00.000Z',
    items: [
      {
        itemId: 'item-west-lake',
        locationName: '西湖',
        startTime: '09:00',
        title: '西湖',
      },
    ],
    localSections: [
      {
        items: [
          {
            sourceIds: ['daily-source-1'],
            text: '开放时间以官网为准。',
            title: '西湖',
          },
        ],
        key: 'opening_hours',
        title: '开放时间',
      },
    ],
    mode: 'today',
    operation: 'trip_daily_tip',
    routeStatus: 'ready_to_generate',
    sources: [
      {
        confidence: 'high',
        id: 'daily-source-1',
        label: '官网',
        retrievedAt: '2026-06-05T08:00:00.000Z',
        sourceType: 'official',
        title: '西湖官网',
        url: 'https://example.com/west-lake',
      },
    ],
    targetDate: '2026-06-05',
    tripTitle: '杭州旅行',
  }
}

describe('provider proxy ai_trip_draft contract', () => {
  it('accepts a valid ai_trip_draft request', () => {
    const result = validateProviderProxyAiTripDraftRequest({
      ...validAiDraftRequest(),
      dayCount: '5',
      interestTags: ['美食', '博物馆', '美食'],
      interestText: '咖啡馆和建筑',
      partySize: '3',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.destination).toBe('东京')
      expect(result.request.startDate).toBe('2025-04-01')
      expect(result.request.endDate).toBe('2025-04-05')
      expect(result.request.dayCount).toBe(5)
      expect(result.request.partySize).toBe(3)
      expect(result.request.interestTags).toEqual(['美食', '博物馆'])
      expect(result.request.interestText).toBe('咖啡馆和建筑')
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

  it('rejects mismatched day count and invalid party size', () => {
    const dayCountResult = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), dayCount: 4 })
    expect(dayCountResult.ok).toBe(false)

    const partySizeResult = validateProviderProxyAiTripDraftRequest({ ...validAiDraftRequest(), partySize: 100 })
    expect(partySizeResult.ok).toBe(false)
  })

  it('rejects invalid interest values', () => {
    const nonStringTag = validateProviderProxyAiTripDraftRequest({
      ...validAiDraftRequest(),
      interestTags: ['美食', 123],
    })
    expect(nonStringTag.ok).toBe(false)

    const tooManyTags = validateProviderProxyAiTripDraftRequest({
      ...validAiDraftRequest(),
      interestTags: Array.from({ length: 13 }, (_, index) => `tag-${index}`),
    })
    expect(tooManyTags.ok).toBe(false)

    const longInterestText = validateProviderProxyAiTripDraftRequest({
      ...validAiDraftRequest(),
      interestText: 'x'.repeat(2001),
    })
    expect(longInterestText.ok).toBe(false)
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

describe('provider proxy ai_trip_draft_refine contract', () => {
  it('accepts a valid single-day refine request', () => {
    const result = validateProviderProxyAiTripDraftRefineRequest(validRefineRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.scope).toEqual({ date: '2025-04-02', kind: 'day' })
      expect(result.request.preferences?.partySize).toBe(3)
      expect(result.request.preferences?.interestTags).toEqual(['美食', '博物馆'])
      expect(result.request.guidance).toBe('更轻松一点')
    }
  })

  it('accepts a valid date-range refine request', () => {
    const result = validateProviderProxyAiTripDraftRefineRequest({
      ...validRefineRequest(),
      scope: { kind: 'date_range', startDate: '2025-04-01', endDate: '2025-04-02' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.scope).toEqual({ endDate: '2025-04-02', kind: 'date_range', startDate: '2025-04-01' })
    }
  })

  it('rejects scopes outside the draft and invalid preferences', () => {
    expect(validateProviderProxyAiTripDraftRefineRequest({
      ...validRefineRequest(),
      scope: { kind: 'day', date: '2025-04-04' },
    }).ok).toBe(false)

    expect(validateProviderProxyAiTripDraftRefineRequest({
      ...validRefineRequest(),
      preferences: { partySize: 0 },
    }).ok).toBe(false)

    expect(validateProviderProxyAiTripDraftRefineRequest({
      ...validRefineRequest(),
      preferences: { Authorization: 'Bearer secret' },
    }).ok).toBe(false)
  })

  it('builds a mock refine response without leaking secrets or changing root metadata', () => {
    const validation = validateProviderProxyAiTripDraftRefineRequest(validRefineRequest())
    expect(validation.ok).toBe(true)
    if (!validation.ok) return

    const response = buildMockAiTripDraftRefineProxyResponse(validation.request)
    expect(response.ok).toBe(true)
    expect(response.operation).toBe('ai_trip_draft_refine')
    expect(response.draft.title).toBe(validation.request.draft.title)
    expect(response.draft.startDate).toBe(validation.request.draft.startDate)
    expect(response.draft.endDate).toBe(validation.request.draft.endDate)
    expect(response.draft.days[0]).toEqual(validation.request.draft.days[0])
    expect(JSON.stringify(response)).not.toContain('Bearer')
    expect(JSON.stringify(response)).not.toContain('secret')
    expect(JSON.stringify(response)).not.toContain('apiKey')
  })

  it('returns non-empty error message for refine operation', () => {
    const message = defaultProviderProxyErrorMessage('invalid_response', 'ai_trip_draft_refine')
    expect(message.length).toBeGreaterThan(0)
    expect(message).toContain('优化')
  })
})

function validRefineRequest() {
  return {
    operation: 'ai_trip_draft_refine',
    requestId: 'refine-1',
    draft: {
      title: '东京之旅',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-03',
      days: [
        {
          date: '2025-04-01',
          title: '抵达',
          items: [{ title: '浅草寺', locationName: '浅草寺', startTime: '09:00', endTime: '11:00' }],
        },
        {
          date: '2025-04-02',
          title: '文化',
          items: [{ title: '上野公园', locationName: '上野公园', startTime: '10:00', endTime: '12:00' }],
        },
        {
          date: '2025-04-03',
          title: '购物',
          items: [{ title: '银座', locationName: '银座', startTime: '14:00', endTime: '16:00' }],
        },
      ],
    },
    guidance: '更轻松一点',
    preferences: {
      interestTags: ['美食', '博物馆', '美食'],
      interestText: '咖啡馆',
      partySize: '3',
      pace: 'relaxed',
      preferTransport: 'walking',
    },
    scope: { kind: 'day', date: '2025-04-02' },
  }
}

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

describe('provider proxy place_lookup contract', () => {
  it('accepts a valid minimal place_lookup request and applies defaults', () => {
    const result = validateProviderProxyPlaceLookupRequest({
      operation: 'place_lookup',
      query: '杭州博物馆',
      requestId: 'place-1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request).toMatchObject({
        maxResults: 5,
        operation: 'place_lookup',
        query: '杭州博物馆',
        requestId: 'place-1',
      })
    }
  })

  it('accepts optional locale region and maxResults', () => {
    const result = validateProviderProxyPlaceLookupRequest({
      locale: 'zh-CN',
      maxResults: 3,
      operation: 'place_lookup',
      query: 'Louvre Museum',
      region: 'fr',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.locale).toBe('zh-CN')
      expect(result.request.region).toBe('FR')
      expect(result.request.maxResults).toBe(3)
    }
  })

  it('defaults and caps place_lookup maxResults explicitly', () => {
    const missing = validateProviderProxyPlaceLookupRequest(validPlaceLookupRequest())
    const accepted = validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), maxResults: 5 })
    const capped = validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), maxResults: 99 })

    expect(missing.ok).toBe(true)
    expect(accepted.ok).toBe(true)
    expect(capped.ok).toBe(true)
    if (missing.ok) expect(missing.request.maxResults).toBe(5)
    if (accepted.ok) expect(accepted.request.maxResults).toBe(5)
    if (capped.ok) expect(capped.request.maxResults).toBe(5)
  })

  it('rejects invalid place_lookup inputs', () => {
    expect(validateProviderProxyPlaceLookupRequest(null).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ operation: 'place_lookup', query: '' }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ operation: 'place_lookup', query: 'x'.repeat(201) }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), locale: 'fr-FR' }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), region: 'USA' }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), region: '1A' }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), maxResults: 0 }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), maxResults: -1 }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), maxResults: 2.5 }).ok).toBe(false)
    expect(validateProviderProxyPlaceLookupRequest({ ...validPlaceLookupRequest(), maxResults: '5' }).ok).toBe(false)
  })

  it('rejects forbidden sensitive fields recursively instead of ignoring them', () => {
    for (const field of ['apiKey', 'providerKey', 'token', 'cloudToken', 'ticketBlobs', 'ticketFiles', 'ticketIds', 'routeCache', 'localDb', 'fullTrip', 'notes', 'authorization', 'headers', 'coordinates', 'lat', 'lng', 'items', 'itineraryItems', 'days', 'trip']) {
      const result = validateProviderProxyPlaceLookupRequest({
        ...validPlaceLookupRequest(),
        nested: { [field]: 'secret' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_request')
      }
    }
  })

  it('does not reject sensitive words inside the query text', () => {
    const result = validateProviderProxyPlaceLookupRequest({
      ...validPlaceLookupRequest(),
      query: 'apiKey coordinates ticket files 这些词只是地点查询文本',
    })

    expect(result.ok).toBe(true)
  })

  it('returns non-empty error message for place_lookup operation', () => {
    const message = defaultProviderProxyErrorMessage('provider_unavailable', 'place_lookup')
    expect(message).toContain('地点查询')
  })
})

function validPlaceLookupRequest() {
  return {
    operation: 'place_lookup',
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

function validAssistantAnswerRequest() {
  return {
    context: {
      scopeLabel: '全部旅行',
      sourceCards: [{ id: 'account', kind: 'local_context', title: '账户摘要', detail: '2 个旅行' }],
      summaries: [
        { key: 'trip_count', label: '旅行数量', value: '2 个旅行' },
        { key: 'inbox', label: '材料输入', value: '1 条待分配材料' },
      ],
    },
    locale: 'zh-CN',
    operation: 'assistant_answer',
    question: '你能做什么？',
    requestId: 'assistant-1',
  }
}
