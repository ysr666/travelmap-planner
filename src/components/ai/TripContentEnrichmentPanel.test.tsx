// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import { createDay, createItineraryItem, createTrip, getItineraryItem } from '../../db/repositories'
import { resetAutoSnapshotBackupForTests } from '../../lib/autoSnapshotBackup'
import {
  PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY,
  PROVIDER_PROXY_DEV_URL_STORAGE_KEY,
} from '../../lib/providerProxyClient'
import type { ItemContentEnrichment } from '../../types'
import { ItemContentEnrichmentCard, TripContentEnrichmentPanel } from './TripContentEnrichmentPanel'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  resetAutoSnapshotBackupForTests()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(PROVIDER_PROXY_DEV_URL_STORAGE_KEY, 'https://proxy.example/provider')
  localStorage.setItem(PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY, 'google')
  await db.delete()
  await db.open()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
  container?.remove()
  container = null
  root = null
})

describe('TripContentEnrichmentPanel', () => {
  it('confirms before provider calls, previews source-backed enrichment, and applies checked content', async () => {
    const seed = await seedTrip()
    const fetchMock = createSuccessfulEnrichmentFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root?.render(<TripContentEnrichmentPanel allItems={[seed.item]} days={[seed.day]} onApplied={vi.fn()} trip={seed.trip} />)
    })

    await clickButton('补充景点内容')
    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(document.body.textContent).toContain('预计最多')

    await clickButton('确认补充')
    await waitForText('内容预览')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(document.body.textContent).toContain('西湖是杭州代表性湖泊景观')
    expect(document.body.textContent).toContain('Google Places')
    expect(document.body.textContent).toContain('购票来源')
    expect(document.body.textContent).toContain('AI 估算')

    await clickButton('应用内容')
    await clickButton('暂不应用')
    expect((await getItineraryItem(seed.item.id))?.contentEnrichment).toBeUndefined()

    await clickButton('应用内容')
    await clickButton('确认应用')
    await waitForText('已补充')
    const updated = await getItineraryItem(seed.item.id)
    expect(updated?.contentEnrichment?.introduction?.text).toContain('西湖')
    expect(updated?.contentEnrichment?.recommendedStay?.basis).toBe('ai_estimate')
  })

  it('supports item detail re-enrichment after preview confirmation', async () => {
    const seed = await seedTrip()
    await db.itineraryItems.update(seed.item.id, { contentEnrichment: existingEnrichment() })
    const item = await getItineraryItem(seed.item.id)
    const fetchMock = createSuccessfulEnrichmentFetchMock()
    const onApplied = vi.fn(async () => {})
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root?.render(<ItemContentEnrichmentCard day={seed.day} item={item ?? seed.item} onApplied={onApplied} trip={seed.trip} />)
    })

    expect(document.body.textContent).toContain('旧介绍')
    await clickButton('重新补充')
    expect(fetchMock).toHaveBeenCalledTimes(0)
    await clickButton('确认补充')
    await waitForText('待应用预览')
    expect(fetchMock).toHaveBeenCalledTimes(4)

    await clickButton('应用到此行程点')
    await clickButton('确认应用')
    await waitForText('已写入内容补充')

    expect(onApplied).toHaveBeenCalledTimes(1)
    const updated = await getItineraryItem(seed.item.id)
    expect(updated?.contentEnrichment?.introduction?.text).toContain('西湖是杭州代表性湖泊景观')
    expect(updated?.contentEnrichment?.matchedPlace?.placeId).toBe('place-west-lake')
  })

  it('refreshes item detail source blocks only after preview confirmation', async () => {
    const seed = await seedTrip()
    await db.itineraryItems.update(seed.item.id, { contentEnrichment: existingEnrichment() })
    const item = await getItineraryItem(seed.item.id)
    const fetchMock = createSuccessfulSourceRefreshFetchMock()
    const onApplied = vi.fn(async () => {})
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root?.render(<ItemContentEnrichmentCard day={seed.day} item={item ?? seed.item} onApplied={onApplied} trip={seed.trip} />)
    })

    expect(document.body.textContent).toContain('开放时间')
    expect(document.body.textContent).toContain('旧开放时间')
    expect(document.body.textContent).toContain('票价')
    expect(document.body.textContent).toContain('旧票价')
    expect(document.body.textContent).toContain('官网来源')
    expect(document.body.textContent).toContain('westlake.example/old')

    await clickButton('刷新来源')
    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(document.body.textContent).toContain('0 次 AI')
    await clickButton('暂不刷新')
    expect(fetchMock).toHaveBeenCalledTimes(0)

    await clickButton('刷新来源')
    await clickButton('确认刷新')
    await waitForText('来源更新预览')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('当前')
    expect(document.body.textContent).toContain('新来源')
    expect(document.body.textContent).toContain('周一至周日 08:00-18:00')
    expect(document.body.textContent).toContain('主景区免费')
    expect(document.body.textContent).toContain('westlake.example/new')

    await clickButton('更新来源')
    await clickButton('暂不更新')
    expect((await getItineraryItem(seed.item.id))?.contentEnrichment?.openingHours?.text).toBe('旧开放时间')

    await clickButton('更新来源')
    await clickButton('确认更新')
    await waitForText('已更新开放时间、票价和官网来源')

    expect(onApplied).toHaveBeenCalledTimes(1)
    const updated = await getItineraryItem(seed.item.id)
    expect(updated?.contentEnrichment?.openingHours?.text).toContain('08:00-18:00')
    expect(updated?.contentEnrichment?.ticketPrice?.text).toContain('主景区免费')
    expect(updated?.contentEnrichment?.matchedPlace?.websiteUri).toBe('https://westlake.example/new')
    expect(updated?.contentEnrichment?.introduction?.text).toBe('旧介绍')
    expect(updated?.contentEnrichment?.notices[0]?.text).toBe('旧注意事项')
    expect(updated?.contentEnrichment?.recommendedStay?.text).toBe('建议停留约 1 小时')
  })
})

async function seedTrip() {
  const trip = await createTrip({
    destination: '杭州',
    endDate: '2026-06-02',
    startDate: '2026-06-01',
    title: '杭州周末',
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

async function clickButton(name: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(name)) as HTMLButtonElement | undefined
  if (!button) throw new Error(`Button not found: ${name}`)
  await act(async () => {
    button.click()
    await delay()
  })
}

async function waitForText(text: string) {
  for (let index = 0; index < 60; index += 1) {
    if (document.body.textContent?.includes(text)) return
    await act(async () => {
      await delay()
    })
  }
  throw new Error(`Text not found: ${text}`)
}

function delay() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

function createSuccessfulEnrichmentFetchMock() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { operation?: string; items?: Array<{ itemId: string; sources: Array<{ id: string; sourceType: string }> }>; searchType?: string }
    if (body.operation === 'place_lookup') {
      return jsonResponse({
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
      })
    }
    if (body.operation === 'place_details') {
      return jsonResponse({
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
      })
    }
    if (body.operation === 'travel_search') {
      expect(body.searchType).toBe('ticket_price')
      return jsonResponse({
        ok: true,
        operation: 'travel_search',
        query: '西湖 票价',
        results: [{
          confidence: 'high',
          displayUrl: 'tickets.example/west-lake',
          domain: 'tickets.example',
          retrievedAt: '2026-06-01T00:00:00.000Z',
          snippet: '主景区免费，部分项目另行收费。',
          sourceType: 'ticketing',
          title: '西湖票价来源',
          url: 'https://tickets.example/west-lake',
        }],
        retrievedAt: '2026-06-01T00:00:00.000Z',
        source: 'mock',
      })
    }
    if (body.operation === 'trip_content_enrichment') {
      const item = body.items?.[0]
      const placeSource = item?.sources.find((source) => source.sourceType === 'google_places')
      const ticketSource = item?.sources.find((source) => source.sourceType === 'ticketing')
      return jsonResponse({
        items: [{
          introduction: { sourceIds: [placeSource?.id], text: '西湖是杭州代表性湖泊景观。' },
          itemId: item?.itemId,
          openingHours: { sourceIds: [placeSource?.id], text: '周一至周日全天开放。' },
          recommendedStay: { basis: 'ai_estimate', durationMinutes: 120, reason: '湖区范围较大，适合慢游。', text: '建议停留约 2 小时' },
          ticketPrice: { kind: 'admission', sourceIds: [ticketSource?.id], text: '主景区免费，部分项目另行收费。' },
        }],
        ok: true,
        operation: 'trip_content_enrichment',
        source: 'mock',
      })
    }
    return jsonResponse({ code: 'unsupported', ok: false }, 400)
  })
}

function existingEnrichment(): ItemContentEnrichment {
  return {
    baselineFingerprint: 'old-baseline',
    generatedAt: '2026-05-31T00:00:00.000Z',
    introduction: {
      sourceIds: ['old-source'],
      text: '旧介绍',
    },
    matchedPlace: {
      name: '西湖',
      placeId: 'place-west-lake',
      retrievedAt: '2026-05-31T00:00:00.000Z',
      websiteUri: 'https://westlake.example/old',
    },
    notices: [{
      sourceIds: ['old-source'],
      text: '旧注意事项',
    }],
    openingHours: {
      sourceIds: ['old-opening'],
      text: '旧开放时间',
    },
    recommendedStay: {
      basis: 'ai_estimate',
      durationMinutes: 60,
      reason: '旧估算',
      text: '建议停留约 1 小时',
    },
    schemaVersion: 1,
    sources: [{
      confidence: 'high',
      id: 'old-source',
      label: '官网',
      retrievedAt: '2026-05-31T00:00:00.000Z',
      sourceType: 'official',
      title: '旧来源',
      url: 'https://westlake.example/old',
    }, {
      confidence: 'high',
      id: 'old-opening',
      label: '官网',
      retrievedAt: '2026-05-31T00:00:00.000Z',
      sourceType: 'official',
      title: '旧开放时间',
      url: 'https://westlake.example/old-hours',
    }, {
      confidence: 'high',
      id: 'old-ticket',
      label: '购票来源',
      retrievedAt: '2026-05-31T00:00:00.000Z',
      sourceType: 'ticketing',
      title: '旧票价',
      url: 'https://tickets.example/old',
    }],
    ticketPrice: {
      kind: 'admission',
      sourceIds: ['old-ticket'],
      text: '旧票价',
    },
    warnings: [],
  }
}

function createSuccessfulSourceRefreshFetchMock() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { operation?: string; searchType?: string }
    if (body.operation === 'place_lookup' || body.operation === 'trip_content_enrichment') {
      return jsonResponse({ code: 'unexpected_operation', ok: false }, 500)
    }
    if (body.operation === 'place_details') {
      return jsonResponse({
        details: {
          displayName: '西湖风景名胜区',
          formattedAddress: '杭州西湖',
          googleMapsUri: 'https://maps.google.com/west-lake',
          location: { lat: 30.25, lng: 120.14 },
          placeId: 'place-west-lake',
          provider: 'google_places',
          regularOpeningHours: { weekdayDescriptions: ['周一至周日 08:00-18:00'] },
          retrievedAt: '2026-06-02T00:00:00.000Z',
          websiteUri: 'https://westlake.example/new',
        },
        ok: true,
        operation: 'place_details',
        retrievedAt: '2026-06-02T00:00:00.000Z',
        source: 'mock',
      })
    }
    if (body.operation === 'travel_search') {
      expect(body.searchType).toBe('ticket_price')
      return jsonResponse({
        ok: true,
        operation: 'travel_search',
        query: '西湖 票价',
        results: [{
          confidence: 'high',
          displayUrl: 'tickets.example/west-lake',
          domain: 'tickets.example',
          retrievedAt: '2026-06-02T00:00:00.000Z',
          snippet: '主景区免费，部分项目另行收费。',
          sourceType: 'ticketing',
          title: '西湖票价来源',
          url: 'https://tickets.example/west-lake',
        }],
        retrievedAt: '2026-06-02T00:00:00.000Z',
        source: 'mock',
      })
    }
    return jsonResponse({ code: 'unsupported', ok: false }, 400)
  })
}
