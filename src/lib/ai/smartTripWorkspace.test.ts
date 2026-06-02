import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import {
  createDay,
  createItineraryItem,
  createTrip,
  getItineraryItem,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  updateItineraryItem,
} from '../../db/repositories'
import { getTripAutoSnapshotStatus, resetAutoSnapshotBackupForTests } from '../autoSnapshotBackup'
import { buildAiTripEditLocalStateFingerprint } from './aiTripEditApply'
import {
  applySmartTripWorkspaceDiffsToDb,
  buildSmartTripWorkspaceItemNoteDiff,
  buildSmartTripWorkspacePlaceDiff,
  buildSmartTripWorkspaceRouteOrderDiff,
  buildSmartTripWorkspaceRouteOrderRequestItems,
  buildSmartTripWorkspaceTripNoteDiff,
  getSmartTripWorkspaceDefaultCheckedIds,
  type SmartTripWorkspaceDiffItem,
} from './smartTripWorkspace'
import type {
  ProviderProxyPlaceLookupResult,
  ProviderProxyRouteOrderSuggestionSuccessResponse,
  ProviderProxyTravelSearchResult,
} from './providerProxyContract'

beforeEach(async () => {
  resetAutoSnapshotBackupForTests()
  await db.delete()
  await db.open()
})

describe('smartTripWorkspace diff builders', () => {
  it('builds place calibration and route order diffs with virtual coordinates', async () => {
    const seed = await seedTrip()
    const placeDiff = buildSmartTripWorkspacePlaceDiff({
      day: seed.day1,
      item: seed.item1,
      result: placeResult('西湖风景名胜区', 30.25, 120.14),
    })
    expect(placeDiff).toBeTruthy()
    if (!placeDiff) return

    const requestItems = buildSmartTripWorkspaceRouteOrderRequestItems([seed.item1, seed.item2, seed.item3], [placeDiff])
    expect(requestItems.find((item) => item.id === seed.item1.id)?.coordinate).toEqual({ lat: 30.25, lng: 120.14 })

    const routeDiff = buildSmartTripWorkspaceRouteOrderDiff({
      day: seed.day1,
      items: [seed.item1, seed.item2, seed.item3],
      placeDiffs: [placeDiff],
      result: routeResult(seed.day1.id, [seed.item1.id, seed.item3.id, seed.item2.id]),
    })
    expect(routeDiff?.patches).toEqual([
      { id: seed.item3.id, sortOrder: 2 },
      { id: seed.item2.id, sortOrder: 3 },
    ])
    expect(routeDiff?.warnings?.join('\n')).toContain('待确认的地点校准坐标')
  })

  it('creates source-backed item notes and skips no-source factual notes', async () => {
    const seed = await seedTrip()
    expect(buildSmartTripWorkspaceItemNoteDiff({
      item: seed.item1,
      retrievedAt: '2026-06-02T01:02:03.000Z',
      searchResults: [],
    })).toBeNull()

    const diff = buildSmartTripWorkspaceItemNoteDiff({
      day: seed.day1,
      item: seed.item1,
      retrievedAt: '2026-06-02T01:02:03.000Z',
      searchResults: [searchResult('西湖开放时间', '官方开放时间摘要')],
    })
    expect(diff?.noteText).toContain('搜索来源摘要')
    expect(diff?.noteText).toContain('官方开放时间摘要')
    expect(diff?.sources[0].domain).toBe('travel.example')
  })
})

describe('applySmartTripWorkspaceDiffsToDb', () => {
  it('applies checked coordinate, route, item-note, and trip-note diffs transactionally', async () => {
    const seed = await seedTrip()
    const baseline = await fingerprint(seed.trip.id)
    const placeDiff = buildSmartTripWorkspacePlaceDiff({
      day: seed.day1,
      item: seed.item1,
      result: placeResult('西湖风景名胜区', 30.25, 120.14),
    })
    expect(placeDiff).toBeTruthy()
    if (!placeDiff) return
    const routeDiff = buildSmartTripWorkspaceRouteOrderDiff({
      day: seed.day1,
      items: [seed.item1, seed.item2, seed.item3],
      placeDiffs: [placeDiff],
      result: routeResult(seed.day1.id, [seed.item1.id, seed.item3.id, seed.item2.id]),
    })
    const itemNoteDiff = buildSmartTripWorkspaceItemNoteDiff({
      day: seed.day1,
      item: seed.item1,
      retrievedAt: '2026-06-02T01:02:03.000Z',
      searchResults: [searchResult('西湖票价', '西湖景区门票信息摘要')],
    })
    const tripNoteDiff = buildSmartTripWorkspaceTripNoteDiff({
      days: [seed.day1],
      itemsByDay: { [seed.day1.id]: [seed.item1, seed.item2, seed.item3] },
      retrievedAt: '2026-06-02T01:02:03.000Z',
      trip: seed.trip,
    })
    const diffs = [placeDiff, routeDiff, itemNoteDiff, tripNoteDiff].filter(Boolean) as SmartTripWorkspaceDiffItem[]

    const result = await applySmartTripWorkspaceDiffsToDb(seed.trip.id, diffs, getSmartTripWorkspaceDefaultCheckedIds(diffs), {
      expectedBaselineFingerprint: baseline,
      now: 12345,
    })

    expect(result.ok).toBe(true)
    expect((await getItineraryItem(seed.item1.id))?.locationName).toBe('西湖风景名胜区')
    expect((await getItineraryItem(seed.item1.id))?.lat).toBe(30.25)
    expect((await getItineraryItem(seed.item2.id))?.sortOrder).toBe(3)
    expect((await getItineraryItem(seed.item3.id))?.sortOrder).toBe(2)
    expect((await getItineraryItem(seed.item1.id))?.notes).toContain('西湖景区门票信息摘要')
    expect((await getTrip(seed.trip.id))?.notes).toContain('智能整理每日提示')
    expect(getTripAutoSnapshotStatus(seed.trip.id)?.reason).toBe('smart-trip-workspace-applied')
  })

  it('applies only checked diffs', async () => {
    const seed = await seedTrip()
    const placeDiff = buildSmartTripWorkspacePlaceDiff({
      item: seed.item1,
      result: placeResult('西湖风景名胜区', 30.25, 120.14),
    })
    const tripNoteDiff = buildSmartTripWorkspaceTripNoteDiff({
      days: [seed.day1],
      itemsByDay: { [seed.day1.id]: [seed.item1] },
      retrievedAt: '2026-06-02T01:02:03.000Z',
      trip: seed.trip,
    })
    const diffs = [placeDiff, tripNoteDiff].filter(Boolean) as SmartTripWorkspaceDiffItem[]

    const result = await applySmartTripWorkspaceDiffsToDb(seed.trip.id, diffs, ['trip-note:daily-tips'], { now: 12345 })

    expect(result.ok).toBe(true)
    expect((await getItineraryItem(seed.item1.id))?.lat).toBeUndefined()
    expect((await getTrip(seed.trip.id))?.notes).toContain('智能整理每日提示')
  })

  it('rejects stale previews with the regenerate message', async () => {
    const seed = await seedTrip()
    const baseline = await fingerprint(seed.trip.id)
    await updateItineraryItem(seed.item1.id, { title: '用户已改名' })
    const placeDiff = buildSmartTripWorkspacePlaceDiff({
      item: seed.item1,
      result: placeResult('西湖风景名胜区', 30.25, 120.14),
    })
    expect(placeDiff).toBeTruthy()
    if (!placeDiff) return

    const result = await applySmartTripWorkspaceDiffsToDb(seed.trip.id, [placeDiff], [placeDiff.id], {
      expectedBaselineFingerprint: baseline,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('请重新生成')
    }
    expect((await getItineraryItem(seed.item1.id))?.lat).toBeUndefined()
  })

  it('leaves earlier diffs unwritten when a later diff is invalid', async () => {
    const seed = await seedTrip()
    const placeDiff = buildSmartTripWorkspacePlaceDiff({
      item: seed.item1,
      result: placeResult('西湖风景名胜区', 30.25, 120.14),
    })
    expect(placeDiff).toBeTruthy()
    if (!placeDiff) return
    const invalidRouteDiff: SmartTripWorkspaceDiffItem = {
      affectedDayIds: [seed.day1.id],
      affectedItemIds: ['missing'],
      checkedByDefault: true,
      dayId: seed.day1.id,
      detailLines: ['bad'],
      hasWrite: true,
      id: 'route:bad',
      orderedItemIds: ['missing'],
      patches: [{ id: 'missing', sortOrder: 1 }],
      provider: 'mock',
      retrievedAt: '2026-06-02T01:02:03.000Z',
      summary: 'bad',
      title: 'bad',
      type: 'route_order',
    }

    const result = await applySmartTripWorkspaceDiffsToDb(seed.trip.id, [placeDiff, invalidRouteDiff], [placeDiff.id, invalidRouteDiff.id])

    expect(result.ok).toBe(false)
    expect((await getItineraryItem(seed.item1.id))?.lat).toBeUndefined()
  })
})

async function fingerprint(tripId: string) {
  const trip = await getTrip(tripId)
  if (!trip) throw new Error('missing trip')
  return buildAiTripEditLocalStateFingerprint({
    days: await listDaysByTrip(tripId),
    items: await listItemsByTrip(tripId),
    trip,
  })
}

async function seedTrip() {
  const trip = await createTrip({
    destination: '杭州',
    endDate: '2026-07-11',
    notes: '原备注',
    startDate: '2026-07-10',
    title: '杭州两日',
  })
  const day1 = await createDay({ date: '2026-07-10', sortOrder: 1, title: '第一天', tripId: trip.id })
  const item1 = await createItineraryItem({ dayId: day1.id, sortOrder: 1, ticketIds: [], title: '西湖', tripId: trip.id })
  const item2 = await createItineraryItem({
    dayId: day1.id,
    lat: 30.24,
    lng: 120.16,
    sortOrder: 2,
    ticketIds: [],
    title: '灵隐寺',
    tripId: trip.id,
  })
  const item3 = await createItineraryItem({
    dayId: day1.id,
    lat: 30.26,
    lng: 120.18,
    sortOrder: 3,
    ticketIds: [],
    title: '河坊街',
    tripId: trip.id,
  })
  return { day1, item1, item2, item3, trip }
}

function placeResult(displayName: string, lat: number, lng: number): ProviderProxyPlaceLookupResult {
  return {
    displayName,
    formattedAddress: `${displayName} 地址`,
    googleMapsUri: 'https://maps.google.com/example',
    location: { lat, lng },
    placeId: `place-${displayName}`,
    provider: 'google_places',
    retrievedAt: '2026-06-02T01:02:03.000Z',
  }
}

function routeResult(dayId: string, suggestedItemIds: string[]): ProviderProxyRouteOrderSuggestionSuccessResponse {
  return {
    ok: true,
    operation: 'route_order_suggestion',
    provider: 'mock',
    requestId: `route-${dayId}`,
    retrievedAt: '2026-06-02T01:02:03.000Z',
    suggestedItemIds,
    summary: '已生成模拟路线顺序建议。',
    unchangedItemIds: [],
    warnings: [],
  }
}

function searchResult(title: string, snippet: string): ProviderProxyTravelSearchResult {
  return {
    confidence: 'high',
    displayUrl: 'travel.example/source',
    domain: 'travel.example',
    retrievedAt: '2026-06-02T01:02:03.000Z',
    snippet,
    sourceType: 'official',
    title,
    url: 'https://travel.example/source',
  }
}
