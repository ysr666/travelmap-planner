// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripOperationsPanel } from './TripOperationsPanel'
import type { TripDailyTravelTipModel } from '../../lib/ai/tripDailyTravelTip'
import type { TripReadinessModel } from '../../lib/tripReadiness'
import type { TripOperationsModel } from '../../lib/tripOperationsAgent'
import { createEmptyTripOperationsLocalState, type TripOperationsLocalState } from '../../lib/tripOperationsState'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../../types'

const mocks = vi.hoisted(() => ({
  applyAiPatch: vi.fn(),
  applyContent: vi.fn(),
  buildAiFingerprint: vi.fn(),
  clearCache: vi.fn(),
  executeRepair: vi.fn(),
  fetchAiPatch: vi.fn(),
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

vi.mock('../../lib/ai/aiTripEditApply', () => ({
  applyAiTripEditPatchPlanToDb: mocks.applyAiPatch,
  buildAiTripEditLocalStateFingerprint: mocks.buildAiFingerprint,
}))

vi.mock('../../lib/cloudObjectSync', () => ({
  clearSyncedTicketBlobCache: mocks.clearCache,
}))

vi.mock('../../lib/providerProxyClient', () => ({
  fetchProviderProxyAiTripEditPlan: mocks.fetchAiPatch,
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
    retriedTicketIds: [],
    routeResult: {
      failedCount: 0,
      generatedCount: 1,
      outcomes: [{ day, lineStrings: [], message: '路线预览已生成。', provider: 'google', saved: true, status: 'generated', warnings: [] }],
      previewCacheSaved: true,
      provider: 'google',
      skippedCount: 0,
    },
    ticketErrors: [],
    ticketRetryCount: 0,
  })
  mocks.clearCache.mockResolvedValue(undefined)
  mocks.buildAiFingerprint.mockReturnValue('ai-baseline')
  mocks.fetchAiPatch.mockResolvedValue({
    ok: true,
    operation: 'ai_trip_edit_plan',
    patchPlan: {
      operations: [{ itemId: item.id, reason: '错开行程', startTime: '10:30', type: 'update_item_time' }],
      summary: '把西湖时间调整到 10:30',
      warnings: [],
    },
    source: 'mock',
  })
  mocks.applyAiPatch.mockResolvedValue({
    affectedDayIds: [day.id],
    affectedItemIds: [item.id],
    appliedChanges: [{ action: 'updated', dayId: day.id, itemId: item.id, title: item.title }],
    appliedOperationCount: 1,
    ok: true,
  })
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
    await waitForText('路线预览已生成')

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
      buttons[2]?.click()
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('day', { dayId: 'day_1', tripId: trip.id, view: 'schedule' })
  })

  it('records snooze and ignore dispositions without executing work', async () => {
    const onLocalStateChange = vi.fn()
    await renderPanel(undefined, { onLocalStateChange })

    const snooze = document.body.querySelector<HTMLButtonElement>('[aria-label^="稍后处理："]')
    await act(async () => snooze?.click())
    expect(onLocalStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      dispositions: [expect.objectContaining({ fingerprint: 'route-fingerprint', status: 'snoozed' })],
    }))

    const ignore = document.body.querySelector<HTMLButtonElement>('[aria-label^="忽略建议："]')
    await act(async () => ignore?.click())
    expect(onLocalStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      dispositions: [expect.objectContaining({ fingerprint: 'route-fingerprint', status: 'ignored' })],
    }))
    expect(mocks.executeRepair).not.toHaveBeenCalled()
  })

  it('only records successful recommendations when a low risk batch partially fails', async () => {
    mocks.clearCache.mockRejectedValueOnce(new Error('缓存正在使用'))
    const onLocalStateChange = vi.fn()
    await renderPanel(undefined, { onLocalStateChange })

    await clickButton(/批量处理/)
    await clickButton('确认处理')
    await waitForText('路线预览已生成')

    const state = onLocalStateChange.mock.calls.at(-1)?.[0]
    expect(state.dispositions).toEqual([
      expect.objectContaining({ fingerprint: 'route-fingerprint', status: 'completed' }),
    ])
    expect(state.history[0]).toEqual(expect.objectContaining({ status: 'partial' }))
    expect(state.history[0].appliedChanges).toHaveLength(1)
  })

  it('restores a hidden recommendation without clearing execution history', async () => {
    const hiddenRecommendation = model.recommendations[0]
    const disposition = {
      createdAt: 1,
      fingerprint: hiddenRecommendation.fingerprint,
      phase: model.phase,
      scopeKey: hiddenRecommendation.scopeKey,
      status: 'ignored' as const,
      zonedDate: '2026-06-10',
    }
    const localState = {
      dispositions: [disposition],
      history: [{
        appliedChanges: [],
        createdAt: 2,
        id: 'history-1',
        recommendationFingerprints: [],
        source: 'trip_operations' as const,
        status: 'success' as const,
        title: '之前的处理',
      }],
      version: 2 as const,
    }
    const hiddenModel: TripOperationsModel = {
      ...model,
      hiddenRecommendations: [{ disposition, recommendation: hiddenRecommendation }],
      recommendations: model.recommendations.slice(1),
    }
    const onLocalStateChange = vi.fn()
    await renderPanel(undefined, { localState, model: hiddenModel, onLocalStateChange })

    await clickButton('恢复')
    expect(onLocalStateChange).toHaveBeenCalledWith(expect.objectContaining({
      dispositions: [],
      history: localState.history,
    }))
  })

  it('generates and applies a high risk AI patch only after two explicit confirmations', async () => {
    const highRiskRecommendation = {
      ...model.recommendations[2],
      actionKind: 'generate_ai_patch' as const,
      executionMode: 'high_risk_ai' as const,
      requiresPreview: true,
    }
    const highRiskModel: TripOperationsModel = {
      ...model,
      allRecommendations: [highRiskRecommendation],
      batchableRecommendations: [],
      recommendations: [highRiskRecommendation],
    }
    const onLocalStateChange = vi.fn()
    await renderPanel(undefined, { model: highRiskModel, onLocalStateChange })

    expect(mocks.fetchAiPatch).not.toHaveBeenCalled()
    await clickButton('处理')
    expect(getByTestId('trip-operations-ai-send-confirm-dialog').textContent).toContain('发送脱敏上下文')
    expect(mocks.fetchAiPatch).not.toHaveBeenCalled()

    await clickButton('确认发送')
    await waitForText('把西湖时间调整到 10:30')
    expect(mocks.fetchAiPatch).toHaveBeenCalledTimes(1)
    expect(mocks.applyAiPatch).not.toHaveBeenCalled()
    expect(onLocalStateChange).not.toHaveBeenCalled()

    await clickButton('应用修改')
    expect(getByTestId('trip-operations-ai-apply-confirm-dialog').textContent).toContain('应用 AI 修改方案')
    await clickButton('确认应用')
    await waitForText('西湖：把西湖时间调整到 10:30')
    expect(mocks.applyAiPatch).toHaveBeenCalledWith(trip.id, expect.anything(), {
      expectedBaselineFingerprint: 'ai-baseline',
    })
    expect(onLocalStateChange).toHaveBeenCalledWith(expect.objectContaining({
      dispositions: [expect.objectContaining({ fingerprint: highRiskRecommendation.fingerprint, status: 'completed' })],
    }))
  })
})

async function renderPanel(
  onChanged = vi.fn(async () => {}),
  overrides: {
    localState?: ReturnType<typeof createEmptyTripOperationsLocalState>
    model?: TripOperationsModel
    onLocalStateChange?: (state: TripOperationsLocalState) => void
  } = {},
) {
  await act(async () => {
    root?.render(
      <TripOperationsPanel
        activeInboxPreview={null}
        allItems={[item]}
        dailyTipModel={dailyTipModel}
        days={[day]}
        itemsByDay={{ [day.id]: [item] }}
        localState={overrides.localState ?? createEmptyTripOperationsLocalState()}
        model={overrides.model ?? model}
        onChanged={onChanged}
        onLocalStateChange={overrides.onLocalStateChange ?? vi.fn()}
        readinessModel={readinessModel}
        tickets={[ticket]}
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

const ticket: TicketMeta = {
  createdAt: 1,
  fileName: 'ticket.pdf',
  fileType: 'pdf',
  id: 'ticket_cached',
  mimeType: 'application/pdf',
  size: 10,
  storageMode: 'copy',
  title: '门票',
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
  activeRecommendations: [],
  allRecommendations: [],
  batchableRecommendations: [],
  batchableCount: 2,
  hiddenRecommendations: [],
  phase: 'traveling',
  phaseLabel: '旅行中',
  recommendations: [
    {
      actionKind: 'generate_routes',
      actionLabel: '生成路线',
      affectedDayIds: [day.id],
      affectedItemIds: [],
      canBatch: true,
      dayId: day.id,
      detail: '第一天可生成路线。',
      evidence: ['第一天可生成路线。'],
      executionMode: 'confirmed_low_risk',
      fingerprint: 'route-fingerprint',
      id: 'ops-route',
      message: '这一天还没有路线缓存。',
      phaseWeight: 35,
      priority: 135,
      readinessIssueIds: ['issue-route'],
      requiresConfirm: true,
      requiresPreview: true,
      scopeKey: 'route-scope',
      severity: 'low',
      ticketIds: [],
      title: '缺少路线预览',
      type: 'missing_route',
    },
    {
      actionKind: 'clear_ticket_cache',
      actionLabel: '清理缓存',
      affectedDayIds: [],
      affectedItemIds: [],
      canBatch: true,
      detail: '门票',
      evidence: ['已同步。'],
      executionMode: 'confirmed_low_risk',
      fingerprint: 'cache-fingerprint',
      id: 'ops-cache',
      message: '只删除此设备缓存。',
      phaseWeight: 10,
      priority: 110,
      readinessIssueIds: [],
      requiresConfirm: true,
      requiresPreview: false,
      scopeKey: 'cache-scope',
      severity: 'low',
      ticketIds: ['ticket_cached'],
      title: '1 张已同步票据可清理缓存',
      type: 'synced_ticket_cache',
    },
    {
      actionKind: 'open_day',
      actionLabel: '检查当天',
      affectedDayIds: [day.id],
      affectedItemIds: [item.id],
      canBatch: false,
      dayId: day.id,
      detail: '距离过远。',
      evidence: ['距离过远。'],
      executionMode: 'manual_navigation',
      fingerprint: 'risk-fingerprint',
      id: 'ops-risk',
      itemId: item.id,
      message: '路线距离很远。',
      phaseWeight: 35,
      priority: 335,
      readinessIssueIds: ['issue-risk'],
      requiresConfirm: true,
      requiresPreview: false,
      scopeKey: 'risk-scope',
      severity: 'high',
      ticketIds: [],
      title: '今天路线可能过远',
      type: 'route_long_distance',
    },
  ],
  replanTimeline: [],
  summary: {
    highRiskCount: 1,
    message: '旅行中优先处理：今天路线可能过远。',
    totalCount: 3,
  },
}

model.allRecommendations = model.recommendations
model.activeRecommendations = model.recommendations
model.batchableRecommendations = model.recommendations.slice(0, 2)

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
