// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripOperationsPanel } from './TripOperationsPanel'
import type { TripDailyTravelTipModel } from '../../lib/ai/tripDailyTravelTip'
import type { TripReadinessModel } from '../../lib/tripReadiness'
import type { TripOperationsModel } from '../../lib/tripOperationsAgent'
import type { Day, ItineraryItem, Trip } from '../../types'

const mocks = vi.hoisted(() => ({
  applyContent: vi.fn(),
  clearCache: vi.fn(),
  executeRepair: vi.fn(),
  fetchSummary: vi.fn(),
  navigateTo: vi.fn(),
  saveDailyTip: vi.fn(),
}))

vi.mock('../../lib/ai/tripContentEnrichment', () => ({
  TRIP_CONTENT_ENRICHMENT_MAX_ITEMS: 6,
  applyTripContentEnrichmentPreviewsToDb: mocks.applyContent,
  estimateTripContentEnrichmentRequestCounts: vi.fn((targets: unknown[]) => ({
    aiSynthesis: targets.length > 0 ? 1 : 0,
    placeDetails: targets.length,
    placeLookup: targets.length,
    total: targets.length,
    travelSearch: targets.length,
  })),
}))

vi.mock('../../lib/ai/tripDailyTravelTip', () => ({
  saveTripDailyTravelTipPreviewToNotes: mocks.saveDailyTip,
}))

vi.mock('../../lib/cloudObjectSync', () => ({
  clearSyncedTicketBlobCache: mocks.clearCache,
}))

vi.mock('../../lib/providerProxyClient', () => ({
  fetchProviderProxyTripOperationsSummary: mocks.fetchSummary,
  getProviderProxyConfig: vi.fn(() => ({
    configured: true,
    provider: 'google',
    proxyUrl: '/api/provider-proxy',
    source: 'proxy',
  })),
}))

vi.mock('../../lib/tripReadinessRepair', () => ({
  executeTripReadinessRepairPreview: mocks.executeRepair,
}))

vi.mock('../../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  vi.clearAllMocks()
  mocks.executeRepair.mockResolvedValue({
    contentPreview: null,
    dailyTipPreview: null,
    messages: ['已处理 1 天路线缓存。'],
    ticketErrors: [],
    ticketRetryCount: 0,
  })
  mocks.clearCache.mockResolvedValue(undefined)
  mocks.fetchSummary.mockResolvedValue({
    highlights: ['先生成路线'],
    ok: true,
    operation: 'trip_operations_summary',
    source: 'mock',
    summary: '先生成路线，再检查票据。',
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('TripOperationsPanel', () => {
  it('renders recommendations and does not call provider on load', async () => {
    await renderPanel()

    expect(getByTestId('trip-operations-panel').textContent).toContain('现在建议做什么')
    expect(document.body.querySelectorAll('[data-testid="trip-operations-recommendation"]')).toHaveLength(3)
    expect(mocks.fetchSummary).toHaveBeenCalledTimes(0)
  })

  it('confirms before running low risk batch work and excludes high risk recommendations', async () => {
    const onChanged = vi.fn(async () => {})
    await renderPanel(onChanged)

    await clickButton(/批量处理/)
    expect(getByTestId('trip-operations-confirm-dialog').textContent).toContain('确认处理')
    expect(mocks.executeRepair).toHaveBeenCalledTimes(0)
    expect(mocks.clearCache).toHaveBeenCalledTimes(0)

    await clickButton('确认处理')
    await waitForText('已处理 1 天路线缓存')

    expect(mocks.executeRepair).toHaveBeenCalledWith(expect.objectContaining({
      preview: expect.objectContaining({ routeDayIds: ['day_1'] }),
      trip,
    }))
    expect(mocks.clearCache).toHaveBeenCalledWith('ticket_cached')
    expect(onChanged).toHaveBeenCalledWith({ refreshTripData: false })
  })

  it('requires explicit enablement before generating an AI summary', async () => {
    await renderPanel()

    const generateButton = getButton('生成摘要')
    expect(generateButton.disabled).toBe(true)
    expect(mocks.fetchSummary).toHaveBeenCalledTimes(0)

    await clickButton('AI 摘要')
    await clickButton('生成摘要')
    await waitForText('先生成路线，再检查票据')

    expect(mocks.fetchSummary).toHaveBeenCalledTimes(1)
    expect(mocks.fetchSummary).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'trip_operations_summary',
      recommendations: expect.arrayContaining([
        expect.objectContaining({
          actionKind: 'generate_routes',
          title: '缺少路线预览',
        }),
      ]),
    }), '/api/provider-proxy')
  })

  it('navigates manual actions without confirmation', async () => {
    await renderPanel()

    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="trip-operations-action"]')]
    await act(async () => {
      buttons.find((button) => button.textContent?.includes('检查当天'))?.click()
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('day', { dayId: 'day_1', tripId: trip.id, view: 'schedule' })
  })
})

async function renderPanel(onChanged = vi.fn(async () => {})) {
  await act(async () => {
    root?.render(
      <TripOperationsPanel
        allItems={[item]}
        dailyTipModel={dailyTipModel}
        days={[day]}
        itemsByDay={{ [day.id]: [item] }}
        model={model}
        onChanged={onChanged}
        readinessModel={readinessModel}
        trip={trip}
      />,
    )
  })
}

const trip: Trip = {
  createdAt: 1,
  destination: '杭州',
  endDate: '2026-06-11',
  id: 'trip_1',
  startDate: '2026-06-10',
  title: '杭州两日',
  updatedAt: 1,
}

const day: Day = {
  date: '2026-06-10',
  id: 'day_1',
  sortOrder: 1,
  title: '第一天',
  tripId: trip.id,
}

const item: ItineraryItem = {
  createdAt: 1,
  dayId: day.id,
  id: 'item_1',
  sortOrder: 1,
  ticketIds: [],
  title: '西湖',
  tripId: trip.id,
  updatedAt: 1,
}

const dailyTipModel: TripDailyTravelTipModel = {
  localSourceSummaries: [],
  mode: 'today',
  searchTargets: [],
  sections: [],
  subtitle: '第一天',
  targetDate: day.date,
  targetDay: day,
  targetItems: [item],
  title: '今日提示',
  warnings: [],
}

const readinessModel: TripReadinessModel = {
  issues: [
    {
      actionKind: 'generate_routes',
      actionLabel: '生成路线',
      canBatchFix: true,
      dayId: day.id,
      defaultSelected: true,
      evidence: ['第一天可生成路线。'],
      id: 'issue-route',
      message: '这一天还没有路线缓存。',
      requiresPreview: true,
      severity: 'low',
      title: '缺少路线预览',
      type: 'missing_route',
    },
    {
      actionKind: 'navigate_item',
      actionLabel: '检查路线顺序',
      canBatchFix: false,
      dayId: day.id,
      defaultSelected: false,
      evidence: ['距离过远。'],
      id: 'issue-risk',
      itemId: item.id,
      message: '路线距离很远。',
      requiresPreview: true,
      severity: 'high',
      title: '路线距离高风险',
      type: 'route_long_distance',
    },
  ],
  summary: {
    fixableCount: 1,
    highRiskCount: 1,
    message: '',
    selectedCount: 1,
    status: 'high_risk',
    statusLabel: '有风险',
    totalCount: 2,
  },
}

const model: TripOperationsModel = {
  allRecommendations: [],
  batchableCount: 2,
  phase: 'traveling',
  phaseLabel: '旅行中',
  recommendations: [
    {
      actionKind: 'generate_routes',
      actionLabel: '生成路线',
      canBatch: true,
      dayId: day.id,
      detail: '第一天可生成路线。',
      evidence: ['第一天可生成路线。'],
      id: 'ops-route',
      message: '这一天还没有路线缓存。',
      phaseWeight: 35,
      priority: 135,
      readinessIssueIds: ['issue-route'],
      requiresConfirm: true,
      requiresPreview: true,
      severity: 'low',
      ticketIds: [],
      title: '缺少路线预览',
      type: 'missing_route',
    },
    {
      actionKind: 'clear_ticket_cache',
      actionLabel: '清理缓存',
      canBatch: true,
      detail: '门票',
      evidence: ['已同步。'],
      id: 'ops-cache',
      message: '只删除此设备缓存。',
      phaseWeight: 10,
      priority: 110,
      readinessIssueIds: [],
      requiresConfirm: true,
      requiresPreview: false,
      severity: 'low',
      ticketIds: ['ticket_cached'],
      title: '1 张已同步票据可清理缓存',
      type: 'synced_ticket_cache',
    },
    {
      actionKind: 'open_day',
      actionLabel: '检查当天',
      canBatch: false,
      dayId: day.id,
      detail: '距离过远。',
      evidence: ['距离过远。'],
      id: 'ops-risk',
      itemId: item.id,
      message: '路线距离很远。',
      phaseWeight: 35,
      priority: 335,
      readinessIssueIds: ['issue-risk'],
      requiresConfirm: true,
      requiresPreview: false,
      severity: 'high',
      ticketIds: [],
      title: '今天路线可能过远',
      type: 'route_long_distance',
    },
  ],
  summary: {
    highRiskCount: 1,
    message: '旅行中优先处理：今天路线可能过远。',
    totalCount: 3,
  },
}

function getByTestId(testId: string) {
  const element = document.body.querySelector(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`Missing ${testId}`)
  return element
}

function getButton(name: string | RegExp) {
  const matcher = typeof name === 'string'
    ? (value: string) => value.trim() === name
    : (value: string) => name.test(value)
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => matcher(candidate.textContent ?? ''))
  if (!button) throw new Error(`Missing button ${String(name)}`)
  return button
}

async function clickButton(name: string | RegExp) {
  await act(async () => {
    getButton(name).click()
  })
}

async function waitForText(text: string) {
  for (let index = 0; index < 10; index += 1) {
    if (document.body.textContent?.includes(text)) {
      return
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Missing text ${text}`)
}
