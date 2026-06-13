// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripLiveModeCard } from './TripLiveModeCard'
import type { ItineraryItem } from '../../types'

const mocks = vi.hoisted(() => ({
  applyPatch: vi.fn(),
  providerConfigured: false,
  fetchPlan: vi.fn(),
  setExecutionState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../db', () => ({ setItineraryItemExecutionState: mocks.setExecutionState }))
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
  mocks.applyPatch.mockResolvedValue({ affectedDayIds: [day.id], affectedItemIds: [item.id], appliedChanges: [{ action: 'updated', dayId: day.id, itemId: item.id, title: item.title }], appliedOperationCount: 1, ok: true })
  mocks.fetchPlan.mockResolvedValue({ patchPlan: { operations: [{ endTime: '09:30', itemId: item.id, reason: '压缩安排。', type: 'update_item_time' }], summary: '压缩下一站' }, warnings: [] })
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
    await render(onChanged)
    const button = buttons().find((candidate) => candidate.textContent?.includes('已完成'))
    await act(async () => button?.click())
    expect(mocks.setExecutionState).toHaveBeenCalledWith(item.id, 'completed')
    expect(onChanged).toHaveBeenCalled()
    expect(container.textContent).toContain('下一站已更新')
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
})

async function render(onChanged = vi.fn().mockResolvedValue(undefined), onOpenItem = vi.fn(), target = item) {
  await act(async () => {
    root.render(<TripLiveModeCard allItems={[target]} day={day} days={[day]} items={[target]} now={new Date('2026-06-13T00:30:00Z')} onChanged={onChanged} onOpenItem={onOpenItem} onOpenMap={vi.fn()} onOpenOperation={vi.fn()} onOpenTickets={vi.fn()} trip={trip} />)
  })
}

function buttons() {
  return Array.from(container.querySelectorAll('button'))
}
