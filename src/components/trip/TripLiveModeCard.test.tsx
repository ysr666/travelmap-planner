// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripLiveModeCard } from './TripLiveModeCard'
import { createEmptyTripOperationsLocalState } from '../../lib/tripOperationsState'
import type { ItineraryItem, TripReplanRecord } from '../../types'

const mocks = vi.hoisted(() => ({
  applyPatch: vi.fn(),
  applyReplan: vi.fn(),
  createReplanPreview: vi.fn(),
  createTripDisruptionEvent: vi.fn(),
  providerConfigured: false,
  fetchPlan: vi.fn(),
  listTripReplanRecordsByTrip: vi.fn().mockResolvedValue([]),
  setExecutionState: vi.fn(),
  undoReplan: vi.fn(),
}))

vi.mock('../../db', () => ({
  createTripDisruptionEvent: mocks.createTripDisruptionEvent,
  listTripReplanRecordsByTrip: mocks.listTripReplanRecordsByTrip,
  setItineraryItemExecutionState: mocks.setExecutionState,
}))
vi.mock('../../lib/ai/aiTripEditApply', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/ai/aiTripEditApply')>(),
  applyAiTripEditPatchPlanToDb: mocks.applyPatch,
}))
vi.mock('../../lib/providerProxyClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/providerProxyClient')>(),
  fetchProviderProxyAiTripEditPlan: mocks.fetchPlan,
  getProviderProxyConfig: () => mocks.providerConfigured
    ? { configured: true, provider: 'mock', proxyUrl: '/api/provider-proxy', source: 'proxy' }
    : { configured: false, provider: null, proxyUrl: null, source: 'none' },
}))
vi.mock('../../lib/adaptiveReplanning', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/adaptiveReplanning')>(),
  applyTripReplanOption: mocks.applyReplan,
  createTripReplanPreviewForEvent: mocks.createReplanPreview,
  undoTripReplan: mocks.undoReplan,
}))

const trip = { createdAt: 1, destination: '东京', endDate: '2026-06-13', id: 'trip_1', startDate: '2026-06-13', timeZone: 'Asia/Tokyo', title: '东京', updatedAt: 1 }
const day = { date: '2026-06-13', id: 'day_1', sortOrder: 1, title: '第一天', tripId: trip.id }
const item: ItineraryItem = { createdAt: 1, dayId: day.id, id: 'item_1', lat: 35, lng: 139, sortOrder: 1, startTime: '09:00', ticketIds: [], title: '浅草寺', tripId: trip.id, updatedAt: 1 }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.providerConfigured = false
  mocks.listTripReplanRecordsByTrip.mockResolvedValue([])
  mocks.applyPatch.mockResolvedValue({ affectedDayIds: [day.id], affectedItemIds: [item.id], appliedChanges: [{ action: 'updated', dayId: day.id, itemId: item.id, title: item.title }], appliedOperationCount: 1, ok: true })
  mocks.applyReplan.mockResolvedValue(replanRecord('applied'))
  mocks.createReplanPreview.mockResolvedValue(replanRecord('preview'))
  mocks.createTripDisruptionEvent.mockResolvedValue(disruptionEvent())
  mocks.fetchPlan.mockResolvedValue({ patchPlan: { operations: [{ endTime: '09:30', itemId: item.id, reason: '压缩安排。', type: 'update_item_time' }], summary: '压缩下一站' }, warnings: [] })
  mocks.setExecutionState.mockImplementation(async (itemId: string, status: 'completed' | 'skipped' | null) => ({
    ...item,
    executionState: status ? { status, updatedAt: 2 } : undefined,
    id: itemId,
    updatedAt: 2,
  }))
  mocks.undoReplan.mockResolvedValue(replanRecord('undone'))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TripLiveModeCard', () => {
  it('renders the current stage without calling provider on load', async () => {
    await render()
    expect(container.querySelector('[data-testid="trip-live-mode-card"]')).toBeTruthy()
    expect(container.textContent).toContain('该去下一站')
    expect(mocks.fetchPlan).not.toHaveBeenCalled()
  })

  it('marks the target complete and refreshes the page data', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    const onLocalStateChange = vi.fn()
    await render(onChanged, vi.fn(), item, { onLocalStateChange })
    const button = buttons().find((candidate) => candidate.textContent?.includes('已完成'))
    await act(async () => button?.click())
    expect(mocks.setExecutionState).toHaveBeenCalledWith(item.id, 'completed')
    expect(onChanged).toHaveBeenCalled()
    expect(container.textContent).toContain('下一站已更新')
    expect(onLocalStateChange.mock.calls.at(-1)?.[0].history[0].intelligenceAppliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'live_item_completed',
        targetId: item.id,
        targetType: 'item',
      }),
    ])
  })

  it('records unified history when skipping and restoring a live item', async () => {
    const onLocalStateChange = vi.fn()
    await render(vi.fn().mockResolvedValue(undefined), vi.fn(), item, { onLocalStateChange })

    await act(async () => buttons().find((candidate) => candidate.textContent?.trim() === '跳过')?.click())
    expect(mocks.setExecutionState).toHaveBeenCalledWith(item.id, 'skipped')
    expect(onLocalStateChange.mock.calls.at(-1)?.[0].history[0].intelligenceAppliedChanges).toEqual([
      expect.objectContaining({ actionType: 'live_item_skipped', targetId: item.id }),
    ])

    onLocalStateChange.mockClear()
    await render(vi.fn().mockResolvedValue(undefined), vi.fn(), {
      ...item,
      executionState: { status: 'skipped', updatedAt: 2 },
    }, { onLocalStateChange })
    await act(async () => buttons().find((candidate) => candidate.textContent?.includes('恢复'))?.click())
    expect(mocks.setExecutionState).toHaveBeenCalledWith(item.id, null)
    expect(onLocalStateChange.mock.calls.at(-1)?.[0].history[0].intelligenceAppliedChanges).toEqual([
      expect.objectContaining({ actionType: 'live_item_restored', targetId: item.id }),
    ])
  })

  it('falls back to manual item editing when provider is unavailable', async () => {
    const onOpenItem = vi.fn()
    await render(vi.fn().mockResolvedValue(undefined), onOpenItem, { ...item, previousTransportDurationMinutes: 30, startTime: '08:00' })
    const button = buttons().find((candidate) => candidate.textContent?.includes('调整下一站'))
    await act(async () => button?.click())
    expect(onOpenItem).toHaveBeenCalled()
    expect(mocks.fetchPlan).not.toHaveBeenCalled()
  })

  it('requires send confirmation and final apply confirmation for AI adjustments', async () => {
    mocks.providerConfigured = true
    const target = { ...item, previousTransportDurationMinutes: 30, startTime: '08:00' }
    await render(vi.fn().mockResolvedValue(undefined), vi.fn(), target)

    await act(async () => buttons().find((candidate) => candidate.textContent?.includes('压缩安排'))?.click())
    expect(mocks.fetchPlan).not.toHaveBeenCalled()
    const sendDialog = document.querySelector('[data-testid="trip-live-ai-send-confirm-dialog"]')
    expect(sendDialog).toBeTruthy()
    await act(async () => Array.from(sendDialog?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('确认发送'))?.click())

    expect(mocks.fetchPlan).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="trip-live-ai-patch-preview"]')).toBeTruthy()
    expect(mocks.applyPatch).not.toHaveBeenCalled()
    await act(async () => buttons().find((candidate) => candidate.textContent?.includes('应用修改'))?.click())
    const applyDialog = document.querySelector('[data-testid="trip-live-ai-apply-confirm-dialog"]')
    await act(async () => Array.from(applyDialog?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('确认应用'))?.click())

    expect(mocks.applyPatch).toHaveBeenCalledTimes(1)
  })

  it('records unified history when applying a replan option', async () => {
    const onLocalStateChange = vi.fn()
    mocks.listTripReplanRecordsByTrip.mockResolvedValueOnce([replanRecord('preview')])
    mocks.applyReplan.mockResolvedValueOnce(replanRecord('applied'))
    await render(vi.fn().mockResolvedValue(undefined), vi.fn(), item, { onLocalStateChange })
    await waitForText('选择一个方案后再确认写入')

    await act(async () => buttons().find((candidate) => candidate.textContent?.includes('确认应用重排'))?.click())
    const dialog = document.querySelector('[data-testid="trip-live-replan-apply-confirm-dialog"]')
    await act(async () => Array.from(dialog?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('确认应用'))?.click())
    await waitForText('已应用重排方案')

    expect(mocks.applyReplan).toHaveBeenCalledWith('replan_1', 'option_1')
    const state = onLocalStateChange.mock.calls.at(-1)?.[0]
    expect(state.history[0].intelligenceAppliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'replan_applied',
        targetId: 'replan_1',
        targetType: 'live',
      }),
    ])
  })

  it('records unified history when reporting a disruption and generating replan preview', async () => {
    const onLocalStateChange = vi.fn()
    const onChanged = vi.fn().mockResolvedValue(undefined)
    await render(onChanged, vi.fn(), item, { onLocalStateChange })

    await act(async () => buttons().find((candidate) => candidate.textContent?.includes('报告突发情况'))?.click())
    await act(async () => buttons().find((candidate) => candidate.textContent?.includes('生成重排方案'))?.click())
    await waitForText('确认前不会写入')

    expect(mocks.createTripDisruptionEvent).toHaveBeenCalledWith(expect.objectContaining({
      dayId: day.id,
      itemId: item.id,
      kind: 'late',
      tripId: trip.id,
    }))
    expect(mocks.createReplanPreview).toHaveBeenCalledWith('event_1')
    expect(onChanged).toHaveBeenCalled()
    expect(onLocalStateChange.mock.calls.at(-1)?.[0].history[0].intelligenceAppliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'live_disruption_reported',
        targetId: 'replan_1',
        targetType: 'live',
      }),
    ])
  })

  it('records unified history when undoing an applied replan', async () => {
    const onLocalStateChange = vi.fn()
    mocks.listTripReplanRecordsByTrip.mockResolvedValueOnce([replanRecord('applied')])
    mocks.undoReplan.mockResolvedValueOnce(replanRecord('undone'))
    await render(vi.fn().mockResolvedValue(undefined), vi.fn(), item, { onLocalStateChange })
    await waitForText('已应用，可整次撤销')

    await act(async () => buttons().find((candidate) => candidate.textContent?.includes('撤销重排'))?.click())
    await waitForText('已撤销整次重排')

    expect(mocks.undoReplan).toHaveBeenCalledWith('replan_1')
    const state = onLocalStateChange.mock.calls.at(-1)?.[0]
    expect(state.history[0].intelligenceAppliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'replan_undone',
        targetId: 'replan_1',
        targetType: 'live',
      }),
    ])
  })
})

async function render(
  onChanged = vi.fn().mockResolvedValue(undefined),
  onOpenItem = vi.fn(),
  target = item,
  options: {
    onLocalStateChange?: (state: ReturnType<typeof createEmptyTripOperationsLocalState>) => void
  } = {},
) {
  await act(async () => {
    root.render(<TripLiveModeCard allItems={[target]} day={day} days={[day]} items={[target]} localState={createEmptyTripOperationsLocalState()} now={new Date('2026-06-13T00:30:00Z')} onChanged={onChanged} onLocalStateChange={options.onLocalStateChange} onOpenItem={onOpenItem} onOpenMap={vi.fn()} onOpenOperation={vi.fn()} onOpenTickets={vi.fn()} trip={trip} />)
  })
}

function buttons() {
  return Array.from(container.querySelectorAll('button'))
}

async function waitForText(text: string) {
  for (let index = 0; index < 10; index += 1) {
    if (container.textContent?.includes(text) || document.body.textContent?.includes(text)) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Missing text ${text}`)
}

function disruptionEvent() {
  return {
    createdAt: 1,
    dayId: day.id,
    evidence: [],
    id: 'event_1',
    itemId: item.id,
    kind: 'late',
    occurredAt: '2026-06-13T01:00:00Z',
    reportedByRole: 'owner',
    status: 'reported',
    tripId: trip.id,
    updatedAt: 1,
  }
}

function replanRecord(status: TripReplanRecord['status']): TripReplanRecord {
  return {
    afterSnapshot: status === 'applied' || status === 'undone' ? { days: [day], items: [{ ...item, startTime: '09:30' }] } : undefined,
    appliedFingerprint: status === 'applied' || status === 'undone' ? 'applied' : undefined,
    baselineFingerprint: 'baseline',
    beforeSnapshot: { days: [day], items: [item] },
    createdAt: 1,
    eventId: 'event_1',
    evidence: [],
    id: 'replan_1',
    options: [{
      diff: {
        companionImpacts: [],
        itemChanges: [{
          after: { dayId: day.id, endTime: undefined, executionState: undefined, sortOrder: 1, startTime: '09:30' },
          before: { dayId: day.id, endTime: undefined, executionState: undefined, sortOrder: 1, startTime: '09:00' },
          changeType: 'time_changed',
          itemId: item.id,
          reason: '时间不足。',
          title: item.title,
        }],
        ledgerImpacts: [],
        routeImpacts: [],
        ticketImpacts: [],
        warnings: [],
      },
      id: 'option_1',
      itemPatches: [],
      score: 1,
      strategy: 'least_change',
      summary: '缩短停留',
      title: '最少改动',
    }],
    selectedDiff: status === 'preview' ? undefined : {
      companionImpacts: [],
      itemChanges: [{
        after: { dayId: day.id, endTime: undefined, executionState: undefined, sortOrder: 1, startTime: '09:30' },
        before: { dayId: day.id, endTime: undefined, executionState: undefined, sortOrder: 1, startTime: '09:00' },
        changeType: 'time_changed',
        itemId: item.id,
        reason: '时间不足。',
        title: item.title,
      }],
      ledgerImpacts: [],
      routeImpacts: [],
      ticketImpacts: [],
      warnings: [],
    },
    selectedOptionId: status === 'preview' ? undefined : 'option_1',
    status,
    tripId: trip.id,
    updatedAt: 2,
  }
}
