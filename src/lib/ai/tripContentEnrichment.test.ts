import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import { createDay, createItineraryItem, createTrip, getItineraryItem, updateItineraryItem } from '../../db/repositories'
import { listDirtyAutoSnapshotTrips, resetAutoSnapshotBackupForTests } from '../autoSnapshotBackup'
import {
  applyTripContentEnrichmentPreviewsToDb,
  applyTripContentSourceRefreshPreviewToDb,
  buildTripContentEnrichmentPlaceLookupQuery,
  estimateTripContentSourceRefreshRequestCounts,
  generateTripContentEnrichmentPreview,
  generateTripContentSourceRefreshPreview,
  getTripContentEnrichmentTargets,
} from './tripContentEnrichment'
import type {
  ProviderProxyPlaceDetailsSuccessResponse,
  ProviderProxyPlaceLookupSuccessResponse,
  ProviderProxyTravelSearchSuccessResponse,
  ProviderProxyTripContentEnrichmentRequest,
  ProviderProxyTripContentEnrichmentSuccessResponse,
} from './providerProxyContract'

beforeEach(async () => {
  resetAutoSnapshotBackupForTests()
  await db.delete()
  await db.open()
})

describe('tripContentEnrichment', () => {
  it('uses Places details first and only searches missing ticket facts when Places has opening and website', async () => {
    const seed = await seedTrip()
    const operations: string[] = []
    const aiRequest: { current?: ProviderProxyTripContentEnrichmentRequest } = {}

    const preview = await generateTripContentEnrichmentPreview({
      clients: {
        placeLookup: vi.fn(async () => {
          operations.push('place_lookup')
          return {
            ok: true,
            operation: 'place_lookup',
            results: [{
              displayName: '西湖风景名胜区',
              formattedAddress: '杭州西湖',
              location: { lat: 30.25, lng: 120.14 },
              placeId: 'place-west-lake',
              provider: 'google_places',
              retrievedAt: '2026-06-01T00:00:00.000Z',
            }],
            retrievedAt: '2026-06-01T00:00:00.000Z',
            source: 'mock',
          } satisfies ProviderProxyPlaceLookupSuccessResponse
        }),
        placeDetails: vi.fn(async () => {
          operations.push('place_details')
          return {
            details: {
              displayName: '西湖风景名胜区',
              editorialSummary: '西湖是杭州代表性湖泊景观。',
              formattedAddress: '杭州西湖',
              googleMapsUri: 'https://maps.google.com/west-lake',
              location: { lat: 30.25, lng: 120.14 },
              placeId: 'place-west-lake',
              provider: 'google_places',
              regularOpeningHours: { weekdayDescriptions: ['周一至周日 全天开放'] },
              retrievedAt: '2026-06-01T00:00:00.000Z',
              websiteUri: 'https://westlake.example',
            },
            ok: true,
            operation: 'place_details',
            retrievedAt: '2026-06-01T00:00:00.000Z',
            source: 'mock',
          } satisfies ProviderProxyPlaceDetailsSuccessResponse
        }),
        travelSearch: vi.fn(async (request) => {
          operations.push(`travel_search:${request.searchType}`)
          expect(request.searchType).toBe('ticket_price')
          return {
            ok: true,
            operation: 'travel_search',
            query: request.query,
            results: [{
              confidence: 'high',
              displayUrl: 'tickets.example/west-lake',
              domain: 'tickets.example',
              retrievedAt: '2026-06-01T00:00:00.000Z',
              snippet: '西湖主景区免费，部分展馆或游船另行收费。',
              sourceType: 'ticketing',
              title: '西湖票价信息',
              url: 'https://tickets.example/west-lake',
            }],
            retrievedAt: '2026-06-01T00:00:00.000Z',
            source: 'mock',
          } satisfies ProviderProxyTravelSearchSuccessResponse
        }),
        contentEnrichment: vi.fn(async (request: ProviderProxyTripContentEnrichmentRequest) => {
          operations.push('trip_content_enrichment')
          aiRequest.current = request
          const item = request.items[0]
          const placeSource = item.sources.find((source) => source.sourceType === 'google_places')!
          const ticketSource = item.sources.find((source) => source.sourceType === 'ticketing')!
          return {
            items: [{
              introduction: { sourceIds: [placeSource.id], text: '西湖是杭州代表性湖泊景观。' },
              itemId: item.itemId,
              openingHours: { sourceIds: [placeSource.id], text: '周一至周日全天开放。' },
              recommendedStay: { basis: 'ai_estimate', durationMinutes: 120, reason: '湖区范围较大，适合慢游。', text: '建议停留约 2 小时' },
              ticketPrice: { kind: 'admission', sourceIds: [ticketSource.id], text: '主景区免费，部分项目另行收费。' },
            }],
            ok: true,
            operation: 'trip_content_enrichment',
            source: 'mock',
          } satisfies ProviderProxyTripContentEnrichmentSuccessResponse
        }),
      },
      days: [seed.day],
      items: [seed.item],
      proxyUrl: '/api/provider-proxy',
      trip: seed.trip,
    })

    expect(operations).toEqual(['place_lookup', 'place_details', 'travel_search:ticket_price', 'trip_content_enrichment'])
    expect(aiRequest.current?.items[0].sources.some((source) => source.sourceType === 'google_places')).toBe(true)
    expect(aiRequest.current?.items[0].sources.some((source) => source.sourceType === 'ticketing')).toBe(true)
    expect(JSON.stringify(aiRequest.current)).not.toContain('ticketIds')
    expect(JSON.stringify(aiRequest.current)).not.toContain('routeCache')
    expect(preview.items[0].enrichment.introduction?.text).toContain('西湖')
    expect(preview.items[0].enrichment.openingHours?.sourceIds).toHaveLength(1)
    expect(preview.items[0].enrichment.ticketPrice?.kind).toBe('admission')
    expect(preview.items[0].enrichment.recommendedStay?.basis).toBe('ai_estimate')
  })

  it('does not write factual sections when AI omits valid sources', async () => {
    const seed = await seedTrip()
    const preview = await generateTripContentEnrichmentPreview({
      clients: {
        placeLookup: async () => ({
          ok: true,
          operation: 'place_lookup',
          results: [{ displayName: '西湖', formattedAddress: '杭州', placeId: 'place-west-lake', provider: 'google_places', retrievedAt: '2026-06-01T00:00:00.000Z' }],
          retrievedAt: '2026-06-01T00:00:00.000Z',
          source: 'mock',
        } satisfies ProviderProxyPlaceLookupSuccessResponse),
        placeDetails: async () => ({
          details: { displayName: '西湖', placeId: 'place-west-lake', provider: 'google_places', retrievedAt: '2026-06-01T00:00:00.000Z' },
          ok: true,
          operation: 'place_details',
          retrievedAt: '2026-06-01T00:00:00.000Z',
          source: 'mock',
        } satisfies ProviderProxyPlaceDetailsSuccessResponse),
        travelSearch: async () => ({
          ok: true,
          operation: 'travel_search',
          query: 'x',
          results: [{
            confidence: 'medium',
            displayUrl: 'travel.example/west-lake',
            domain: 'travel.example',
            retrievedAt: '2026-06-01T00:00:00.000Z',
            snippet: '来源摘要',
            sourceType: 'official',
            title: '来源',
            url: 'https://travel.example/west-lake',
          }],
          retrievedAt: '2026-06-01T00:00:00.000Z',
          source: 'mock',
        } satisfies ProviderProxyTravelSearchSuccessResponse),
        contentEnrichment: async (request) => ({
          items: [{
            introduction: { sourceIds: [], text: '没有来源的事实不应写入。' },
            itemId: request.items[0].itemId,
            recommendedStay: { basis: 'ai_estimate', durationMinutes: 90, reason: '按景点粒度估算。', text: '建议停留约 1.5 小时' },
          }],
          ok: true,
          operation: 'trip_content_enrichment',
          source: 'mock',
        } satisfies ProviderProxyTripContentEnrichmentSuccessResponse),
      },
      days: [seed.day],
      items: [seed.item],
      proxyUrl: '/api/provider-proxy',
      trip: seed.trip,
    })

    expect(preview.items[0].enrichment.introduction).toBeUndefined()
    expect(preview.items[0].enrichment.recommendedStay?.basis).toBe('ai_estimate')
  })

  it('applies only checked previews and rejects stale baseline', async () => {
    const seed = await seedTrip()
    const unchecked = await createItineraryItem({
      dayId: seed.day.id,
      ticketIds: [],
      title: '灵隐寺',
      tripId: seed.trip.id,
      sortOrder: 2,
    })
    const preview = await generatePreviewWithOneItem(seed, [seed.item, unchecked])
    const secondPreview = {
      ...preview.items[0],
      id: `content:${unchecked.id}`,
      itemId: unchecked.id,
      itemTitle: unchecked.title,
    }

    const applied = await applyTripContentEnrichmentPreviewsToDb(seed.trip.id, [preview.items[0], secondPreview], [preview.items[0].id], {
      expectedBaselineFingerprint: preview.baselineFingerprint,
      now: 100,
    })

    expect(applied.ok).toBe(true)
    expect((await getItineraryItem(seed.item.id))?.contentEnrichment?.introduction?.text).toContain('西湖')
    expect((await getItineraryItem(unchecked.id))?.contentEnrichment).toBeUndefined()
    expect(listDirtyAutoSnapshotTrips()).toEqual([
      expect.objectContaining({
        reason: 'trip-content-enrichment-applied',
        status: 'dirty',
        tripId: seed.trip.id,
      }),
    ])

    const stalePreview = await generatePreviewWithOneItem(seed)
    await updateItineraryItem(seed.item.id, { title: '西湖新标题' })
    const stale = await applyTripContentEnrichmentPreviewsToDb(seed.trip.id, stalePreview.items, stalePreview.checkedIds, {
      expectedBaselineFingerprint: stalePreview.baselineFingerprint,
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.errors.join('')).toContain('请重新生成')
    }
  })

  it('builds compact lookup queries and target stale detection', async () => {
    const seed = await seedTrip()
    expect(buildTripContentEnrichmentPlaceLookupQuery(seed.item, seed.trip)).toContain('西湖')
    expect(getTripContentEnrichmentTargets([seed.item], seed.trip)).toHaveLength(1)
    const preview = await generatePreviewWithOneItem(seed)
    await applyTripContentEnrichmentPreviewsToDb(seed.trip.id, preview.items, preview.checkedIds, {
      expectedBaselineFingerprint: preview.baselineFingerprint,
    })
    const updated = await getItineraryItem(seed.item.id)
    expect(updated).toBeTruthy()
    expect(getTripContentEnrichmentTargets([updated!], seed.trip)).toHaveLength(0)
  })

  it('refreshes source blocks from an existing matched place without lookup or AI', async () => {
    const seed = await seedTrip()
    await updateItineraryItem(seed.item.id, { contentEnrichment: existingEnrichment() })
    const item = await getItineraryItem(seed.item.id)
    expect(item).toBeTruthy()
    const operations: string[] = []
    const estimate = estimateTripContentSourceRefreshRequestCounts(item!)
    expect(estimate.placeLookup).toBe(0)
    expect(estimate.aiSynthesis).toBe(0)

    const preview = await generateTripContentSourceRefreshPreview({
      clients: {
        placeLookup: vi.fn(async () => {
          operations.push('place_lookup')
          throw new Error('lookup should be skipped')
        }),
        placeDetails: vi.fn(async () => {
          operations.push('place_details')
          return placeDetailsResponse({
            regularOpeningHours: { weekdayDescriptions: ['周一至周日 08:00-18:00'] },
            websiteUri: 'https://westlake.example/new',
          })
        }),
        travelSearch: vi.fn(async (request) => {
          operations.push(`travel_search:${request.searchType}`)
          expect(request.searchType).toBe('ticket_price')
          return searchResponse(request.searchType, [{
            confidence: 'high',
            displayUrl: 'tickets.example/west-lake',
            domain: 'tickets.example',
            retrievedAt: '2026-06-02T00:00:00.000Z',
            snippet: '主景区免费，游船另行收费。',
            sourceType: 'ticketing',
            title: '西湖票价',
            url: 'https://tickets.example/west-lake',
          }])
        }),
      },
      item: item!,
      proxyUrl: '/api/provider-proxy',
      trip: seed.trip,
    })

    expect(operations).toEqual(['place_details', 'travel_search:ticket_price'])
    expect(preview.sections.filter((section) => section.changed).map((section) => section.key)).toEqual(['openingHours', 'ticketPrice', 'officialWebsite'])
    expect(preview.enrichment.openingHours?.text).toContain('08:00-18:00')
    expect(preview.enrichment.ticketPrice?.text).toContain('主景区免费')
    expect(preview.enrichment.matchedPlace?.websiteUri).toBe('https://westlake.example/new')
    expect(preview.enrichment.introduction?.text).toBe('旧介绍')
    expect(preview.enrichment.notices[0]?.text).toBe('旧注意事项')
    expect(preview.enrichment.recommendedStay?.text).toBe('建议停留约 1 小时')

    const applied = await applyTripContentSourceRefreshPreviewToDb(seed.trip.id, preview, {
      expectedBaselineFingerprint: preview.baselineFingerprint,
      now: 200,
    })
    expect(applied.ok).toBe(true)
    const updated = await getItineraryItem(seed.item.id)
    expect(updated?.contentEnrichment?.openingHours?.text).toContain('08:00-18:00')
    expect(updated?.contentEnrichment?.ticketPrice?.text).toContain('主景区免费')
    expect(updated?.contentEnrichment?.introduction?.text).toBe('旧介绍')
    expect(listDirtyAutoSnapshotTrips()).toEqual([
      expect.objectContaining({
        reason: 'trip-content-source-refresh-applied',
        status: 'dirty',
        tripId: seed.trip.id,
      }),
    ])
  })

  it('looks up missing place ids and searches missing opening ticket and official sources', async () => {
    const seed = await seedTrip()
    const operations: string[] = []
    const preview = await generateTripContentSourceRefreshPreview({
      clients: {
        placeLookup: vi.fn(async () => {
          operations.push('place_lookup')
          return {
            ok: true,
            operation: 'place_lookup',
            results: [{ displayName: '西湖', formattedAddress: '杭州', placeId: 'place-west-lake', provider: 'google_places', retrievedAt: '2026-06-02T00:00:00.000Z' }],
            retrievedAt: '2026-06-02T00:00:00.000Z',
            source: 'mock',
          } satisfies ProviderProxyPlaceLookupSuccessResponse
        }),
        placeDetails: vi.fn(async () => {
          operations.push('place_details')
          return placeDetailsResponse({})
        }),
        travelSearch: vi.fn(async (request) => {
          operations.push(`travel_search:${request.searchType}`)
          if (request.searchType === 'ticket_price') {
            return searchResponse(request.searchType, [{
              confidence: 'high',
              displayUrl: 'tickets.example/west-lake',
              domain: 'tickets.example',
              retrievedAt: '2026-06-02T00:00:00.000Z',
              snippet: '成人票 0 元。',
              sourceType: 'ticketing',
              title: '票价',
              url: 'https://tickets.example/west-lake',
            }])
          }
          if (request.searchType === 'opening_hours') {
            return searchResponse(request.searchType, [{
              confidence: 'high',
              displayUrl: 'westlake.example/hours',
              domain: 'westlake.example',
              retrievedAt: '2026-06-02T00:00:00.000Z',
              snippet: '每日全天开放。',
              sourceType: 'official',
              title: '开放时间',
              url: 'https://westlake.example/hours',
            }])
          }
          return searchResponse(request.searchType, [{
            confidence: 'high',
            displayUrl: 'westlake.example',
            domain: 'westlake.example',
            retrievedAt: '2026-06-02T00:00:00.000Z',
            snippet: '官方网站。',
            sourceType: 'official',
            title: '官网',
            url: 'https://westlake.example',
          }])
        }),
      },
      item: seed.item,
      proxyUrl: '/api/provider-proxy',
      trip: seed.trip,
    })

    expect(operations).toEqual(['place_lookup', 'place_details', 'travel_search:ticket_price', 'travel_search:opening_hours', 'travel_search:official_site'])
    expect(preview.enrichment.openingHours?.text).toBe('每日全天开放。')
    expect(preview.enrichment.ticketPrice?.text).toBe('成人票 0 元。')
    expect(preview.enrichment.matchedPlace?.websiteUri).toBe('https://westlake.example')
  })

  it('keeps old source facts when refresh has no sourced replacement and rejects stale source baseline', async () => {
    const seed = await seedTrip()
    await updateItineraryItem(seed.item.id, { contentEnrichment: existingEnrichment() })
    const item = await getItineraryItem(seed.item.id)
    expect(item).toBeTruthy()
    const preview = await generateTripContentSourceRefreshPreview({
      clients: {
        placeDetails: async () => placeDetailsResponse({}),
        travelSearch: async (request) => searchResponse(request.searchType ?? 'general', []),
      },
      item: item!,
      proxyUrl: '/api/provider-proxy',
      trip: seed.trip,
    })

    expect(preview.enrichment.openingHours?.text).toBe('旧开放时间')
    expect(preview.enrichment.ticketPrice?.text).toBe('旧票价')
    expect(preview.enrichment.matchedPlace?.websiteUri).toBe('https://westlake.example/old')
    expect(preview.warnings.join('')).toContain('已保留原内容')

    await updateItineraryItem(seed.item.id, { title: '西湖已变化' })
    const stale = await applyTripContentSourceRefreshPreviewToDb(seed.trip.id, preview, {
      expectedBaselineFingerprint: preview.baselineFingerprint,
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.errors.join('')).toContain('重新刷新来源')
    }
  })
})

async function generatePreviewWithOneItem(seed: Awaited<ReturnType<typeof seedTrip>>, allItems = [seed.item]) {
  return generateTripContentEnrichmentPreview({
    clients: {
      placeLookup: async () => ({
        ok: true,
        operation: 'place_lookup',
        results: [{ displayName: '西湖', formattedAddress: '杭州', placeId: 'place-west-lake', provider: 'google_places', retrievedAt: '2026-06-01T00:00:00.000Z' }],
        retrievedAt: '2026-06-01T00:00:00.000Z',
        source: 'mock',
      } satisfies ProviderProxyPlaceLookupSuccessResponse),
      placeDetails: async () => ({
        details: { displayName: '西湖', editorialSummary: '西湖是杭州代表性湖泊景观。', placeId: 'place-west-lake', provider: 'google_places', retrievedAt: '2026-06-01T00:00:00.000Z' },
        ok: true,
        operation: 'place_details',
        retrievedAt: '2026-06-01T00:00:00.000Z',
        source: 'mock',
      } satisfies ProviderProxyPlaceDetailsSuccessResponse),
      travelSearch: async () => ({
        ok: true,
        operation: 'travel_search',
        query: 'x',
        results: [{
          confidence: 'high',
          displayUrl: 'travel.example/west-lake',
          domain: 'travel.example',
          retrievedAt: '2026-06-01T00:00:00.000Z',
          snippet: '西湖来源摘要',
          sourceType: 'official',
          title: '西湖来源',
          url: 'https://travel.example/west-lake',
        }],
        retrievedAt: '2026-06-01T00:00:00.000Z',
        source: 'mock',
      } satisfies ProviderProxyTravelSearchSuccessResponse),
      contentEnrichment: async (request) => ({
        items: [{
          introduction: { sourceIds: [request.items[0].sources[0].id], text: '西湖是杭州代表性湖泊景观。' },
          itemId: request.items[0].itemId,
          recommendedStay: { basis: 'ai_estimate', durationMinutes: 90, reason: '按景点粒度估算。', text: '建议停留约 1.5 小时' },
        }],
        ok: true,
        operation: 'trip_content_enrichment',
        source: 'mock',
      } satisfies ProviderProxyTripContentEnrichmentSuccessResponse),
    },
    days: [seed.day],
    items: allItems,
    proxyUrl: '/api/provider-proxy',
    trip: seed.trip,
  })
}

async function seedTrip() {
  const trip = await createTrip({
    destination: '杭州',
    endDate: '2026-06-03',
    startDate: '2026-06-01',
    title: '杭州三日游',
  })
  const day = await createDay({
    date: '2026-06-01',
    sortOrder: 1,
    title: '第一天',
    tripId: trip.id,
  })
  const item = await createItineraryItem({
    dayId: day.id,
    locationName: '西湖',
    ticketIds: [],
    title: '西湖',
    tripId: trip.id,
    sortOrder: 1,
  })
  return { day, item, trip }
}

function existingEnrichment() {
  return {
    baselineFingerprint: 'old-baseline',
    generatedAt: '2026-06-01T00:00:00.000Z',
    introduction: { sourceIds: ['intro-source'], text: '旧介绍' },
    matchedPlace: {
      name: '西湖',
      placeId: 'place-west-lake',
      retrievedAt: '2026-06-01T00:00:00.000Z',
      websiteUri: 'https://westlake.example/old',
    },
    notices: [{ sourceIds: ['intro-source'], text: '旧注意事项' }],
    openingHours: { sourceIds: ['old-opening'], text: '旧开放时间' },
    recommendedStay: { basis: 'ai_estimate' as const, durationMinutes: 60, reason: '旧估算', text: '建议停留约 1 小时' },
    schemaVersion: 1 as const,
    sources: [
      { confidence: 'high' as const, id: 'intro-source', label: '官网', retrievedAt: '2026-06-01T00:00:00.000Z', sourceType: 'official' as const, title: '介绍来源', url: 'https://westlake.example/intro' },
      { confidence: 'high' as const, id: 'old-opening', label: '官网', retrievedAt: '2026-06-01T00:00:00.000Z', sourceType: 'official' as const, title: '旧开放时间', url: 'https://westlake.example/old-hours' },
      { confidence: 'high' as const, id: 'old-ticket', label: '购票来源', retrievedAt: '2026-06-01T00:00:00.000Z', sourceType: 'ticketing' as const, title: '旧票价', url: 'https://tickets.example/old' },
      { confidence: 'high' as const, id: 'old-official', label: '官网', retrievedAt: '2026-06-01T00:00:00.000Z', sourceType: 'official' as const, title: '旧官网', url: 'https://westlake.example/old' },
    ],
    ticketPrice: { kind: 'admission' as const, sourceIds: ['old-ticket'], text: '旧票价' },
    warnings: [],
  }
}

function placeDetailsResponse(overrides: Partial<ProviderProxyPlaceDetailsSuccessResponse['details']>): ProviderProxyPlaceDetailsSuccessResponse {
  return {
    details: {
      displayName: '西湖',
      formattedAddress: '杭州西湖',
      googleMapsUri: 'https://maps.google.com/west-lake',
      placeId: 'place-west-lake',
      provider: 'google_places',
      retrievedAt: '2026-06-02T00:00:00.000Z',
      ...overrides,
    },
    ok: true,
    operation: 'place_details',
    retrievedAt: '2026-06-02T00:00:00.000Z',
    source: 'mock',
  }
}

function searchResponse(
  searchType: string,
  results: ProviderProxyTravelSearchSuccessResponse['results'],
): ProviderProxyTravelSearchSuccessResponse {
  return {
    ok: true,
    operation: 'travel_search',
    query: searchType,
    results,
    retrievedAt: '2026-06-02T00:00:00.000Z',
    source: 'mock',
  }
}
