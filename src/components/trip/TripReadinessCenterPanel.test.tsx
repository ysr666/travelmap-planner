// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripReadinessCenterPanel } from './TripReadinessCenterPanel'
import type { TripDailyTravelTipModel } from '../../lib/ai/tripDailyTravelTip'
import type { TripReadinessModel } from '../../lib/tripReadiness'
import type { Day, ItineraryItem, Trip } from '../../types'

const mocks = vi.hoisted(() => ({
  applyContent: vi.fn(),
  fetchPlaceLookup: vi.fn(),
  generateContent: vi.fn(),
  generateDailyTip: vi.fn(),
  generateRoutes: vi.fn(),
  retryTicketBlobUpload: vi.fn(),
  saveDailyTip: vi.fn(),
  updateItineraryItem: vi.fn(),
}))

vi.mock('../../lib/ai/tripContentEnrichment', () => ({
  TRIP_CONTENT_ENRICHMENT_MAX_ITEMS: 6,
  applyTripContentEnrichmentPreviewsToDb: mocks.applyContent,
  estimateTripContentEnrichmentRequestCounts: vi.fn((targets: unknown[]) => ({
    aiSynthesis: targets.length > 0 ? 1 : 0,
    placeDetails: targets.length,
    placeLookup: targets.length,
    total: targets.length * 3 + (targets.length > 0 ? 1 : 0),
    travelSearch: targets.length,
  })),
  generateTripContentEnrichmentPreview: mocks.generateContent,
}))

vi.mock('../../lib/ai/tripDailyTravelTip', () => ({
  generateEnhancedTripDailyTravelTip: mocks.generateDailyTip,
  saveTripDailyTravelTipPreviewToNotes: mocks.saveDailyTip,
}))

vi.mock('../../lib/cloudObjectSync', () => ({
  retryTicketBlobUpload: mocks.retryTicketBlobUpload,
}))

vi.mock('../../lib/providerProxyClient', () => ({
  fetchProviderProxyPlaceLookup: mocks.fetchPlaceLookup,
  getProviderProxyConfig: vi.fn(() => ({
    configured: true,
    provider: 'google',
    proxyUrl: '/api/provider-proxy',
    source: 'proxy',
  })),
}))

vi.mock('../../db', () => ({
  updateItineraryItem: mocks.updateItineraryItem,
}))

vi.mock('../../lib/routeGeneration', () => ({
  generateRoutePreviewsForTrip: mocks.generateRoutes,
}))

vi.mock('../../lib/routing', () => ({
  getRoutingConfig: vi.fn(() => ({
    configured: true,
    provider: 'openrouteservice',
    routeProxyUrl: '/api/provider-proxy',
    source: 'proxy',
  })),
}))

vi.mock('../../lib/routes', () => ({
  navigateTo: vi.fn(),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.generateRoutes.mockResolvedValue({
    failedCount: 0,
    generatedCount: 1,
    outcomes: [],
    previewCacheSaved: false,
    provider: 'openrouteservice',
    skippedCount: 0,
  })
  mocks.retryTicketBlobUpload.mockResolvedValue(undefined)
  mocks.fetchPlaceLookup.mockResolvedValue({
    ok: true,
    operation: 'place_lookup',
    results: [{
      displayName: '西湖风景名胜区',
      formattedAddress: '浙江省杭州市西湖区',
      location: { lat: 30.25, lng: 120.16 },
      placeId: 'places/west-lake',
      provider: 'google_places',
      retrievedAt: '2026-06-01T00:00:00.000Z',
    }],
    retrievedAt: '2026-06-01T00:00:00.000Z',
    source: 'google_places',
  })
  mocks.updateItineraryItem.mockResolvedValue({ ...item, lat: 30.25, lng: 120.16, locationName: '西湖风景名胜区' })
  mocks.generateContent.mockResolvedValue({
    baselineFingerprint: 'content-base',
    checkedIds: ['content:item_1'],
    generatedAt: '2026-06-01T00:00:00.000Z',
    items: [{
      checkedByDefault: true,
      enrichment: {
        baselineFingerprint: 'content-base',
        generatedAt: '2026-06-01T00:00:00.000Z',
        notices: [],
        openingHours: { sourceIds: ['source_1'], text: '09:00-18:00' },
        sources: [],
        ticketPrice: { kind: 'admission', sourceIds: ['source_1'], text: '免费' },
        warnings: [],
      },
      hasWrite: true,
      id: 'content:item_1',
      itemId: 'item_1',
      itemTitle: '西湖',
      summary: ['开放时间', '票价'],
      warnings: [],
    }],
    requestCounts: { aiSynthesis: 1, placeDetails: 1, placeLookup: 1, total: 4, travelSearch: 1 },
    warnings: [],
  })
  mocks.generateDailyTip.mockResolvedValue({
    baselineFingerprint: 'daily-base',
    generatedAt: '2026-06-01T00:00:00.000Z',
    requestCounts: { aiSynthesis: 1, total: 1, travelSearch: 0 },
    response: { content: '今日提示', ok: true, operation: 'trip_daily_tip', source: 'mock', warnings: [] },
    sources: [],
    targetDate: '2026-06-10',
    targetTitle: '第一天',
    warnings: [],
  })
  mocks.applyContent.mockResolvedValue({ appliedCount: 1, ok: true })
  mocks.saveDailyTip.mockResolvedValue({ ok: true })
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

describe('TripReadinessCenterPanel', () => {
  it('previews before low risk batch repair and keeps AI writes gated', async () => {
    const onChanged = vi.fn(async () => {})
    await renderPanel(onChanged)

    expect(getByTestId('trip-readiness-status').textContent).toContain('有 1 个高风险问题')
    const checkboxes = [...document.body.querySelectorAll<HTMLInputElement>('[data-testid="trip-readiness-issue-checkbox"]')]
    expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(5)
    expect(checkboxes.some((checkbox) => checkbox.disabled)).toBe(true)

    await clickTestId('trip-readiness-batch-button')
    expect(getByTestId('trip-readiness-repair-confirm-dialog').textContent).toContain('预计联网/路线请求')
    expect(mocks.generateRoutes).toHaveBeenCalledTimes(0)
    expect(mocks.retryTicketBlobUpload).toHaveBeenCalledTimes(0)
    expect(mocks.generateContent).toHaveBeenCalledTimes(0)
    expect(mocks.generateDailyTip).toHaveBeenCalledTimes(0)

    await clickButton('确认处理')
    await waitForText('已处理 1 天路线缓存')

    expect(mocks.generateRoutes).toHaveBeenCalledWith(expect.objectContaining({
      targetDayIds: ['day_1'],
      tripId: 'trip_1',
    }))
    expect(mocks.fetchPlaceLookup).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'place_lookup',
      query: expect.stringContaining('西湖'),
    }), '/api/provider-proxy')
    expect(mocks.updateItineraryItem).toHaveBeenCalledWith('item_1', expect.objectContaining({
      lat: 30.25,
      lng: 120.16,
      locationName: '西湖风景名胜区',
    }))
    expect(mocks.retryTicketBlobUpload).toHaveBeenCalledWith('ticket_pending')
    expect(mocks.retryTicketBlobUpload).not.toHaveBeenCalledWith('ticket_error')
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
    expect(mocks.generateDailyTip).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(getByTestId('trip-readiness-content-preview').textContent).toContain('确认后才会写入')
    expect(getByTestId('trip-readiness-daily-tip-preview').textContent).toContain('确认后写入旅行备注')

    await clickTestId('trip-readiness-apply-content-button')
    expect(mocks.applyContent).toHaveBeenCalledTimes(0)
    await clickButton('确认应用')
    await waitForText('已写入 1 个行程点')
    expect(mocks.applyContent).toHaveBeenCalledWith('trip_1', expect.any(Array), ['content:item_1'], {
      expectedBaselineFingerprint: 'content-base',
    })
    expect(onChanged).toHaveBeenCalledTimes(2)

    await clickTestId('trip-readiness-save-daily-tip-button')
    expect(mocks.saveDailyTip).toHaveBeenCalledTimes(0)
    await clickButton('确认保存')
    await waitForText('已保存每日旅行提示')
    expect(mocks.saveDailyTip).toHaveBeenCalledWith(expect.objectContaining({
      expectedBaselineFingerprint: 'daily-base',
      tripId: 'trip_1',
    }))
    expect(onChanged).toHaveBeenCalledTimes(3)
  })
})

async function renderPanel(onChanged: () => Promise<void>) {
  await act(async () => {
    root?.render(
      <TripReadinessCenterPanel
        allItems={[item]}
        dailyTipModel={dailyTipModel}
        days={[day]}
        itemsByDay={{ [day.id]: [item] }}
        model={model}
        onChanged={onChanged}
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
  lat: 30.25,
  lng: 120.16,
  locationName: '西湖',
  sortOrder: 1,
  ticketIds: [],
  title: '西湖',
  tripId: trip.id,
  updatedAt: 1,
}

const dailyTipModel: TripDailyTravelTipModel = {
  localSourceSummaries: [],
  mode: 'pre_trip',
  searchTargets: [],
  sections: [],
  subtitle: '第一天',
  targetDate: day.date,
  targetDay: day,
  targetItems: [item],
  title: '今日旅行提示',
  warnings: [],
}

const model: TripReadinessModel = {
  issues: [
    {
      actionKind: 'retry_ticket_upload',
      actionLabel: '重新同步票据',
      canBatchFix: false,
      defaultSelected: false,
      evidence: ['上传失败'],
      id: 'issue-ticket-error',
      message: '票据上传失败，需要确认后重试。',
      requiresPreview: true,
      severity: 'high',
      ticketId: 'ticket_error',
      title: '票据同步失败',
      type: 'ticket_unsynced',
    },
    {
      actionKind: 'lookup_place',
      actionLabel: '智能补地点',
      canBatchFix: true,
      dayId: day.id,
      defaultSelected: true,
      evidence: ['缺少坐标。'],
      id: 'issue-place',
      itemId: item.id,
      message: '可用地点服务自动匹配地址和坐标。',
      requiresPreview: true,
      severity: 'medium',
      title: '缺少地点坐标',
      type: 'missing_coordinate',
    },
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
      actionKind: 'retry_ticket_upload',
      actionLabel: '重新同步票据',
      canBatchFix: true,
      defaultSelected: true,
      evidence: ['票据等待上传。'],
      id: 'issue-ticket-pending',
      message: '票据文件还在本地队列中。',
      requiresPreview: true,
      severity: 'low',
      ticketId: 'ticket_pending',
      title: '票据等待同步',
      type: 'ticket_unsynced',
    },
    {
      actionKind: 'generate_content_preview',
      actionLabel: '补充景点内容',
      canBatchFix: true,
      dayId: day.id,
      defaultSelected: true,
      evidence: ['缺少开放时间、票价。'],
      id: 'issue-content',
      itemId: item.id,
      message: '可生成带来源的景点内容预览。',
      requiresPreview: true,
      severity: 'low',
      title: '西湖缺少出行信息',
      type: 'missing_content',
    },
    {
      actionKind: 'generate_daily_tip_preview',
      actionLabel: '生成每日提示',
      canBatchFix: true,
      dayId: day.id,
      defaultSelected: true,
      evidence: ['旅行备注中没有今日旅行提示。'],
      id: 'issue-daily-tip',
      message: '可先生成增强提示预览。',
      requiresPreview: true,
      severity: 'low',
      title: '缺少每日旅行提示',
      type: 'daily_tip_missing',
    },
  ],
  summary: {
    fixableCount: 5,
    highRiskCount: 1,
    message: '发现 6 项准备问题，其中 1 个高风险问题需要优先处理。',
    selectedCount: 5,
    status: 'high_risk',
    statusLabel: '有 1 个高风险问题',
    totalCount: 6,
  },
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

async function clickButton(label: string) {
  const button = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) {
    throw new Error(`Button not found: ${label}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function waitForText(text: string) {
  for (let index = 0; index < 30; index += 1) {
    if (document.body.textContent?.includes(text)) {
      return
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
  throw new Error(`Text not found: ${text}`)
}
