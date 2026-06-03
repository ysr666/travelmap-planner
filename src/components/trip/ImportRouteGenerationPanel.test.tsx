// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportRouteGenerationPanel } from './ImportRouteGenerationPanel'
import type { Day, ItineraryItem } from '../../types'

const mocks = vi.hoisted(() => ({
  generateRoutePreviewsForTrip: vi.fn(),
  getPersistentRouteProvider: vi.fn((): 'openrouteservice' | null => 'openrouteservice'),
  getRoutingConfig: vi.fn(() => ({ provider: 'openrouteservice', routeProxyUrl: '/api/provider-proxy' })),
  listDaysByTrip: vi.fn(),
  listItemsByDay: vi.fn(),
  loadTripRoutePreparation: vi.fn(),
}))

vi.mock('../../db', () => ({
  listDaysByTrip: mocks.listDaysByTrip,
  listItemsByDay: mocks.listItemsByDay,
}))

vi.mock('../../lib/dates', () => ({
  formatDate: vi.fn((date: string) => date),
}))

vi.mock('../../lib/routeCache', () => ({
  ROUTE_CACHE_CHANGED_EVENT: 'tripmap:route-cache-changed',
}))

vi.mock('../../lib/routeGeneration', () => ({
  generateRoutePreviewsForTrip: mocks.generateRoutePreviewsForTrip,
}))

vi.mock('../../lib/routePreparation', () => ({
  getPersistentRouteProvider: mocks.getPersistentRouteProvider,
  loadTripRoutePreparation: mocks.loadTripRoutePreparation,
}))

vi.mock('../../lib/routing', () => ({
  getRoutingConfig: mocks.getRoutingConfig,
  ROUTING_CONFIG_CHANGED_EVENT: 'tripmap:routing-config-changed',
}))

const day: Day = {
  date: '2026-04-10',
  id: 'day_1',
  sortOrder: 0,
  title: '抵达与涩谷',
  tripId: 'trip_1',
}

const noRouteDay: Day = {
  date: '2026-04-11',
  id: 'day_2',
  sortOrder: 1,
  title: '坐标不足日',
  tripId: 'trip_1',
}

const item1: ItineraryItem = {
  createdAt: 100,
  dayId: day.id,
  id: 'item_1',
  lat: 35.72918,
  lng: 139.71092,
  previousTransportMode: 'walk',
  sortOrder: 0,
  ticketIds: [],
  title: 'Hotel Metropolitan Tokyo 入住',
  tripId: day.tripId,
  updatedAt: 100,
}

const item2: ItineraryItem = {
  createdAt: 100,
  dayId: day.id,
  id: 'item_2',
  lat: 35.65858,
  lng: 139.70204,
  previousTransportMode: 'train',
  sortOrder: 1,
  ticketIds: [],
  title: 'Shibuya Sky',
  tripId: day.tripId,
  updatedAt: 100,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.getPersistentRouteProvider.mockReturnValue('openrouteservice')
  mocks.getRoutingConfig.mockReturnValue({ provider: 'openrouteservice', routeProxyUrl: '/api/provider-proxy' })
  mocks.listDaysByTrip.mockResolvedValue([day, noRouteDay])
  mocks.listItemsByDay.mockImplementation(async (dayId: string) => (dayId === day.id ? [item1, item2] : []))
  mocks.loadTripRoutePreparation.mockResolvedValue(buildPreparation({ providerConfigured: true }))
  mocks.generateRoutePreviewsForTrip.mockResolvedValue({
    failedCount: 0,
    generatedCount: 1,
    outcomes: [],
    previewCacheSaved: true,
    provider: 'openrouteservice',
    skippedCount: 0,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  vi.unstubAllGlobals()
  container?.remove()
  container = null
  root = null
})

describe('ImportRouteGenerationPanel', () => {
  it('lists import route candidates and does not generate before confirmation', async () => {
    await renderPanel()

    await waitForText('已找到 1 天')
    expect(document.body.textContent).toContain('Day 1 · 抵达与涩谷')
    expect(document.body.textContent).toContain('可生成')
    expect(document.body.textContent).toContain('交通方式：步行、火车')
    expect(getByTestId('import-route-generation-day-list').textContent).not.toContain('坐标不足日')
    expect(mocks.generateRoutePreviewsForTrip).toHaveBeenCalledTimes(0)

    await clickTestId('import-route-generate-button')
    expect(getByTestId('import-route-generation-confirm-dialog').textContent).toContain('点击确认后才会调用路线服务')
    expect(mocks.generateRoutePreviewsForTrip).toHaveBeenCalledTimes(0)

    await clickButton('暂不生成')
    await waitForNoTestId('import-route-generation-confirm-dialog')
    expect(mocks.generateRoutePreviewsForTrip).toHaveBeenCalledTimes(0)

    await clickTestId('import-route-generate-button')
    await clickButton('确认生成')

    await waitForText('已生成 1 天路线预览')
    expect(mocks.generateRoutePreviewsForTrip).toHaveBeenCalledTimes(1)
    expect(mocks.generateRoutePreviewsForTrip).toHaveBeenCalledWith(expect.objectContaining({
      days: [day, noRouteDay],
      itemsByDay: { [day.id]: [item1, item2], [noRouteDay.id]: [] },
      tripId: 'trip_1',
    }))
  })

  it('shows provider unavailable state without enabling generation', async () => {
    mocks.getPersistentRouteProvider.mockReturnValue(null)
    mocks.loadTripRoutePreparation.mockResolvedValue(buildPreparation({
      provider: null,
      providerConfigured: false,
      targetDayIds: [],
    }))

    await renderPanel()

    await waitForText('当前路线服务不可用')
    expect(document.body.textContent).toContain('配置路线服务后可批量生成')
    expect(document.body.querySelector('[data-testid="import-route-generation-day-list"]')).toBeNull()
    expect((getByTestId('import-route-generate-button') as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.generateRoutePreviewsForTrip).toHaveBeenCalledTimes(0)
  })
})

async function renderPanel() {
  await act(async () => {
    root?.render(<ImportRouteGenerationPanel tripId="trip_1" />)
  })
}

function getByTestId(testId: string) {
  const element = document.body.querySelector(`[data-testid="${testId}"]`)
  if (!element) {
    throw new Error(`Element not found: ${testId}`)
  }
  return element
}

async function clickTestId(testId: string) {
  const element = getByTestId(testId)
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
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

async function waitForNoTestId(testId: string) {
  for (let index = 0; index < 50; index += 1) {
    if (!document.body.querySelector(`[data-testid="${testId}"]`)) {
      return
    }
    await act(async () => {
      await delay()
    })
  }
  throw new Error(`Element still present: ${testId}`)
}

function delay() {
  return new Promise((resolve) => window.setTimeout(resolve, 1))
}

function buildPreparation({
  provider = 'openrouteservice',
  providerConfigured,
  targetDayIds = [day.id],
}: {
  provider?: 'openrouteservice' | null
  providerConfigured: boolean
  targetDayIds?: string[]
}) {
  return {
    cachedDayCount: 0,
    canGenerate: providerConfigured && targetDayIds.length > 0,
    days: [{
      cacheEntry: null,
      coordinateCount: 2,
      day,
      eligible: true,
      identity: null,
      provider,
      staleCacheEntries: [],
      status: 'ready_to_generate',
    }, {
      cacheEntry: null,
      coordinateCount: 0,
      day: noRouteDay,
      eligible: false,
      identity: null,
      provider,
      staleCacheEntries: [],
      status: 'no_coordinates',
    }],
    eligibleDayCount: 1,
    noCoordinateDayCount: 0,
    notEnoughPointDayCount: 0,
    provider,
    providerConfigured,
    readyDayCount: providerConfigured ? 1 : 0,
    staleDayCount: 0,
    targetDayIds,
  }
}
