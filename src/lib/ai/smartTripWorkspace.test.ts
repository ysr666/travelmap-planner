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
  getSmartTripWorkspaceCheckedPlaceDiffs,
  getSmartTripWorkspaceDefaultCheckedIds,
  replaceSmartTripWorkspaceCategoryDiffs,
  selectBestSmartTripWorkspacePlaceResult,
  sortSmartTripWorkspaceTravelSearchResults,
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
    expect(diff?.sourceMeta.label).toBe('官网')
    expect(diff?.sourceMeta.reason).toContain('无来源结果不会写入事实性提示')
  })

  it('prioritizes official and high-confidence sources before low-quality sources', async () => {
    const seed = await seedTrip()
    const lowQuality = searchResult('低质量搬运摘要', '低可信摘要', {
      confidence: 'low',
      domain: 'unknown.example',
      sourceType: 'unknown',
      url: 'https://unknown.example/source',
    })
    const official = searchResult('西湖官网开放时间', '官网开放时间摘要', {
      confidence: 'high',
      domain: 'westlake.hangzhou.gov.cn',
      sourceType: 'official',
      url: 'https://westlake.hangzhou.gov.cn/opening-hours',
    })
    const map = searchResult('西湖地图资料', '地图来源摘要', {
      confidence: 'medium',
      domain: 'maps.example',
      sourceType: 'map',
      url: 'https://maps.example/west-lake',
    })

    expect(sortSmartTripWorkspaceTravelSearchResults([lowQuality, map, official]).map((result) => result.title)).toEqual([
      '西湖官网开放时间',
      '西湖地图资料',
      '低质量搬运摘要',
    ])

    const diff = buildSmartTripWorkspaceItemNoteDiff({
      day: seed.day1,
      item: seed.item1,
      retrievedAt: '2026-06-02T01:02:03.000Z',
      searchResults: [lowQuality, map, official],
    })
    expect(diff?.sources.map((source) => source.title)).toEqual([
      '西湖官网开放时间',
      '西湖地图资料',
      '低质量搬运摘要',
    ])
    expect(diff?.detailLines[1]).toContain('官网 · 高可信')
    expect(diff?.sourceMeta).toMatchObject({ confidence: 'high', label: '官网' })
  })

  it('selects the best source-prioritized place lookup candidate', async () => {
    const seed = await seedTrip()
    const weakCandidate = placeResult('相似地点', 30.2, 120.1, { googleMapsUri: null })
    const officialCandidate = placeResult('西湖风景名胜区', 30.25, 120.14, {
      googleMapsUri: 'https://maps.google.com/west-lake',
    })

    expect(selectBestSmartTripWorkspacePlaceResult([weakCandidate, officialCandidate], seed.item1)).toEqual(officialCandidate)
  })

  it('replaces one preview category while preserving other diffs and checked state', async () => {
    const seed = await seedTrip()
    const oldPlaceDiff = buildSmartTripWorkspacePlaceDiff({
      day: seed.day1,
      item: seed.item1,
      result: placeResult('旧西湖地点', 30.25, 120.14),
    })
    const routeDiff = buildSmartTripWorkspaceRouteOrderDiff({
      day: seed.day1,
      items: [seed.item1, seed.item2, seed.item3],
      placeDiffs: oldPlaceDiff ? [oldPlaceDiff] : [],
      result: routeResult(seed.day1.id, [seed.item1.id, seed.item3.id, seed.item2.id]),
    })
    const newPlaceDiff = buildSmartTripWorkspacePlaceDiff({
      day: seed.day1,
      item: seed.item1,
      result: placeResult('新西湖地点', 30.26, 120.15),
    })
    const diffs = [oldPlaceDiff, routeDiff].filter(Boolean) as SmartTripWorkspaceDiffItem[]
    expect(newPlaceDiff).toBeTruthy()
    if (!newPlaceDiff) return

    const result = replaceSmartTripWorkspaceCategoryDiffs({
      currentCheckedDiffIds: routeDiff ? [routeDiff.id] : [],
      currentDiffs: diffs,
      nextDiffs: [newPlaceDiff],
      type: 'place_calibration',
    })

    expect(result.diffs.map((diff) => diff.id)).toEqual([newPlaceDiff.id, routeDiff?.id])
    expect(result.diffs.find((diff) => diff.type === 'place_calibration')?.summary).toContain('新西湖地点')
    expect(result.checkedDiffIds).toContain(newPlaceDiff.id)
    expect(result.checkedDiffIds).toContain(routeDiff?.id)
  })

  it('uses only checked place calibration diffs as virtual route coordinates', async () => {
    const seed = await seedTrip()
    const checkedPlaceDiff = buildSmartTripWorkspacePlaceDiff({
      item: seed.item1,
      result: placeResult('已勾选西湖地点', 30.25, 120.14),
    })
    const uncheckedPlaceDiff = buildSmartTripWorkspacePlaceDiff({
      item: seed.item2,
      result: placeResult('未勾选灵隐寺地点', 30.3, 120.2),
    })
    expect(checkedPlaceDiff).toBeTruthy()
    expect(uncheckedPlaceDiff).toBeTruthy()
    if (!checkedPlaceDiff || !uncheckedPlaceDiff) return

    const placeDiffs = getSmartTripWorkspaceCheckedPlaceDiffs(
      [checkedPlaceDiff, uncheckedPlaceDiff],
      [checkedPlaceDiff.id],
    )
    const requestItems = buildSmartTripWorkspaceRouteOrderRequestItems([seed.item1, seed.item2], placeDiffs)

    expect(requestItems.find((item) => item.id === seed.item1.id)?.coordinate).toEqual({ lat: 30.25, lng: 120.14 })
    expect(requestItems.find((item) => item.id === seed.item2.id)?.coordinate).toEqual({ lat: 30.24, lng: 120.16 })
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
      sourceMeta: {
        confidence: 'medium',
        label: '路线建议',
        reason: 'bad',
        retrievedAt: '2026-06-02T01:02:03.000Z',
        sourceType: 'provider_route',
      },
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

function placeResult(
  displayName: string,
  lat: number,
  lng: number,
  options: { googleMapsUri?: string | null } = {},
): ProviderProxyPlaceLookupResult {
  const googleMapsUri = options.googleMapsUri === undefined
    ? 'https://maps.google.com/example'
    : options.googleMapsUri ?? undefined
  return {
    displayName,
    formattedAddress: `${displayName} 地址`,
    googleMapsUri,
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

function searchResult(
  title: string,
  snippet: string,
  options: {
    confidence?: ProviderProxyTravelSearchResult['confidence']
    domain?: string
    sourceType?: ProviderProxyTravelSearchResult['sourceType']
    url?: string
  } = {},
): ProviderProxyTravelSearchResult {
  const url = options.url ?? 'https://travel.example/source'
  return {
    confidence: options.confidence ?? 'high',
    displayUrl: url.replace(/^https?:\/\//, ''),
    domain: options.domain ?? 'travel.example',
    retrievedAt: '2026-06-02T01:02:03.000Z',
    snippet,
    sourceType: options.sourceType ?? 'official',
    title,
    url,
  }
}
