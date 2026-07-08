// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import { createDay, createItineraryItem, createTrip, getItineraryItem, getTrip } from '../../db/repositories'
import { resetAutoSnapshotBackupForTests } from '../../lib/autoSnapshotBackup'
import {
  PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY,
  PROVIDER_PROXY_DEV_URL_STORAGE_KEY,
} from '../../lib/providerProxyClient'
import { SmartTripWorkspacePanel } from './SmartTripWorkspacePanel'
import type { Day, ItineraryItem, Trip } from '../../types'

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

describe('SmartTripWorkspacePanel', () => {
  it('confirms before provider calls, previews checkbox diffs, and applies checked writes', async () => {
    const seed = await seedTrip()
    const onApplied = vi.fn().mockResolvedValue(undefined)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      await delay()
      const body = JSON.parse(String(init?.body ?? '{}')) as { maxResults?: number; operation?: string; requestId?: string }
      if (body.operation === 'place_lookup') {
        expect(body.maxResults).toBe(3)
        return jsonResponse({
          ok: true,
          operation: 'place_lookup',
          retrievedAt: '2026-06-02T01:02:03.000Z',
          results: [
            {
              displayName: '西湖相似地点',
              formattedAddress: '杭州西湖相似地点',
              location: { lat: 30.2, lng: 120.1 },
              placeId: 'place-weak',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
            {
              displayName: '西湖风景名胜区',
              formattedAddress: '杭州西湖风景名胜区',
              googleMapsUri: 'https://maps.google.com/west-lake',
              location: { lat: 30.25, lng: 120.14 },
              placeId: 'place-west-lake',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
          ],
          source: 'mock',
        })
      }
      if (body.operation === 'route_order_suggestion') {
        return jsonResponse({
          ok: true,
          operation: 'route_order_suggestion',
          provider: 'mock',
          requestId: body.requestId,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          suggestedItemIds: [seed.item2.id, seed.item1.id],
          summary: '已生成模拟路线顺序建议。',
          unchangedItemIds: [],
          warnings: [],
        })
      }
      if (body.operation === 'travel_search') {
        return jsonResponse({
          ok: true,
          operation: 'travel_search',
          query: '西湖 开放时间',
          results: [
            {
              confidence: 'low',
              displayUrl: 'unknown.example/west-lake',
              domain: 'unknown.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '低质量搬运摘要。',
              sourceType: 'unknown',
              title: '西湖搬运摘要',
              url: 'https://unknown.example/west-lake',
            },
            {
              confidence: 'high',
              displayUrl: 'travel.example/west-lake',
              domain: 'travel.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '西湖开放时间和票价模拟来源摘要。',
              sourceType: 'official',
              title: '西湖开放时间模拟来源',
              url: 'https://travel.example/west-lake',
            },
          ],
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
        })
      }
      return jsonResponse({ code: 'unsupported', ok: false }, 400)
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root?.render(
        <SmartTripWorkspacePanel
          allItems={[seed.item1, seed.item2]}
          days={[seed.day1]}
          itemsByDay={{ [seed.day1.id]: [seed.item1, seed.item2] }}
          onApplied={onApplied}
          trip={seed.trip}
        />,
      )
    })

    expect(document.body.textContent).toContain('智能整理此行程')
    await clickButton('智能整理此行程')
    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(document.body.textContent).toContain('预计查询')

    await clickButton('确认整理')
    expect(document.body.textContent).toContain('正在整理行程预览')
    await waitForText('景点提示：西湖')

    expect(fetchMock).toHaveBeenCalled()
    expect(document.body.textContent).toContain('地点校准：西湖')
    expect(document.body.textContent).toContain('路线顺序：第一天')
    expect(document.body.textContent).toContain('景点提示：西湖')
    expect(document.body.textContent).toContain('每日提示')
    expect(document.body.textContent).toContain('官网')
    expect(document.body.textContent).toContain('可信度：高')
    expect(document.body.textContent).toContain('建议理由')
    expect(document.body.textContent).toContain('地点校准')
    await clickTestId('smart-trip-workspace-category-clear-place_calibration')
    expect(document.body.textContent).toContain('地点校准0/1')
    await clickTestId('smart-trip-workspace-category-select-place_calibration')
    expect(document.body.textContent).toContain('地点校准1/1')

    await clickButton('批量应用')
    await clickButton('确认应用')
    await waitForText('已应用')

    expect(onApplied).toHaveBeenCalled()
    expect((await getItineraryItem(seed.item1.id))?.locationName).toBe('西湖风景名胜区')
    expect((await getItineraryItem(seed.item1.id))?.sortOrder).toBe(2)
    expect((await getItineraryItem(seed.item2.id))?.sortOrder).toBe(1)
    expect((await getItineraryItem(seed.item1.id))?.notes).toContain('西湖开放时间和票价模拟来源摘要')
    expect((await getTrip(seed.trip.id))?.notes).toContain('智能整理每日提示')
  })

  it('keeps successful stage previews when route fails and regenerates only route later', async () => {
    const seed = await seedTrip()
    let placeRequests = 0
    let routeRequests = 0
    let searchRequests = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      await delay()
      const body = JSON.parse(String(init?.body ?? '{}')) as { operation?: string; requestId?: string }
      if (body.operation === 'place_lookup') {
        placeRequests += 1
        return jsonResponse({
          ok: true,
          operation: 'place_lookup',
          retrievedAt: '2026-06-02T01:02:03.000Z',
          results: [
            {
              displayName: '西湖风景名胜区',
              formattedAddress: '杭州西湖风景名胜区',
              googleMapsUri: 'https://maps.google.com/west-lake',
              location: { lat: 30.25, lng: 120.14 },
              placeId: 'place-west-lake',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
          ],
          source: 'mock',
        })
      }
      if (body.operation === 'route_order_suggestion') {
        routeRequests += 1
        if (routeRequests === 1 || routeRequests === 3) {
          return jsonResponse({
            code: 'provider_unavailable',
            ok: false,
            operation: 'route_order_suggestion',
          }, 503)
        }
        return jsonResponse({
          ok: true,
          operation: 'route_order_suggestion',
          provider: 'mock',
          requestId: body.requestId,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          suggestedItemIds: [seed.item2.id, seed.item1.id],
          summary: '已重新生成路线顺序建议。',
          unchangedItemIds: [],
          warnings: [],
        })
      }
      if (body.operation === 'travel_search') {
        searchRequests += 1
        return jsonResponse({
          ok: true,
          operation: 'travel_search',
          query: '西湖 开放时间',
          results: [
            {
              confidence: 'high',
              displayUrl: 'travel.example/west-lake',
              domain: 'travel.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '西湖开放时间和票价模拟来源摘要。',
              sourceType: 'official',
              title: '西湖开放时间模拟来源',
              url: 'https://travel.example/west-lake',
            },
          ],
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
        })
      }
      return jsonResponse({ code: 'unsupported', ok: false }, 400)
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root?.render(
        <SmartTripWorkspacePanel
          allItems={[seed.item1, seed.item2]}
          days={[seed.day1]}
          itemsByDay={{ [seed.day1.id]: [seed.item1, seed.item2] }}
          onApplied={vi.fn().mockResolvedValue(undefined)}
          trip={seed.trip}
        />,
      )
    })

    await clickButton('智能整理此行程')
    expect(fetchMock).toHaveBeenCalledTimes(0)
    await clickButton('确认整理')
    await waitForText('景点提示：西湖')

    expect(document.body.textContent).toContain('地点校准：西湖')
    expect(document.body.textContent).toContain('景点提示：西湖')
    expect(document.body.textContent).toContain('每日提示')
    expect(document.body.textContent).toContain('路线顺序建议失败')
    expect(document.body.textContent).toContain('失败 · 请求 1')
    expect(document.body.textContent).not.toContain('路线顺序：第一天')
    expect(placeRequests).toBe(1)
    expect(routeRequests).toBe(1)
    expect(searchRequests).toBe(2)

    await clickTestId('smart-trip-workspace-category-regenerate-route_order')
    expect(document.body.textContent).toContain('重新生成路线顺序')
    expect(routeRequests).toBe(1)
    await clickButton('确认重新生成')
    await waitForText('路线顺序：第一天')

    expect(routeRequests).toBe(2)
    expect(placeRequests).toBe(1)
    expect(searchRequests).toBe(2)
    expect(document.body.textContent).toContain('已完成 · 请求 1')

    await clickTestId('smart-trip-workspace-category-regenerate-route_order')
    await clickButton('确认重新生成')
    await waitForText('已保留上一版建议')

    expect(routeRequests).toBe(3)
    expect(document.body.textContent).toContain('路线顺序：第一天')
  })
})

async function seedTrip(): Promise<{ day1: Day; item1: ItineraryItem; item2: ItineraryItem; trip: Trip }> {
  const trip = await createTrip({
    destination: '杭州',
    endDate: '2026-07-10',
    startDate: '2026-07-10',
    title: '杭州一日',
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
  return { day1, item1, item2, trip }
}

async function clickButton(name: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(name))
  if (!button) {
    throw new Error(`Button not found: ${name}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function clickTestId(testId: string) {
  const element = document.body.querySelector(`[data-testid="${testId}"]`)
  if (!element) {
    throw new Error(`Element not found: ${testId}`)
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function waitForText(text: string) {
  for (let index = 0; index < 50; index += 1) {
    if (document.body.textContent?.includes(text)) {
      return
    }
    await act(async () => {
      await delay()
    })
  }
  throw new Error(`Text not found: ${text}`)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

function delay() {
  return new Promise((resolve) => window.setTimeout(resolve, 1))
}
