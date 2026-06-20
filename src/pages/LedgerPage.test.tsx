// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerPage } from './LedgerPage'

const mocks = vi.hoisted(() => ({
  createLedgerBudget: vi.fn(),
  createLedgerExpense: vi.fn(),
  createLedgerParticipant: vi.fn(),
  createLedgerSettings: vi.fn(),
  deleteLedgerBudget: vi.fn(),
  deleteLedgerExpense: vi.fn(),
  deleteLedgerParticipant: vi.fn(),
  getLedgerSettingsByTrip: vi.fn(),
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1' })),
  getTicketBlob: vi.fn(),
  getTrip: vi.fn(),
  restoreSuggestionState: vi.fn(),
  setSuggestionState: vi.fn(),
  listDaysByTrip: vi.fn(),
  listItemsByTrip: vi.fn(),
  listLedgerBudgets: vi.fn(),
  listLedgerExpenses: vi.fn(),
  listLedgerParticipants: vi.fn(),
  listTicketsByTrip: vi.fn(),
  navigateTo: vi.fn(),
  subscribeTravelDataChanged: vi.fn(() => () => {}),
  updateLedgerBudget: vi.fn(),
  updateLedgerExpense: vi.fn(),
  updateLedgerParticipant: vi.fn(),
}))

vi.mock('../lib/routes', () => ({
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../db', () => ({
  createLedgerBudget: mocks.createLedgerBudget,
  createLedgerExpense: mocks.createLedgerExpense,
  createLedgerParticipant: mocks.createLedgerParticipant,
  createLedgerSettings: mocks.createLedgerSettings,
  createTripDisruptionEvent: vi.fn(),
  deleteLedgerBudget: mocks.deleteLedgerBudget,
  deleteLedgerExpense: mocks.deleteLedgerExpense,
  deleteLedgerParticipant: mocks.deleteLedgerParticipant,
  getLedgerSettingsByTrip: mocks.getLedgerSettingsByTrip,
  getTicketBlob: mocks.getTicketBlob,
  getTrip: mocks.getTrip,
  listDaysByTrip: mocks.listDaysByTrip,
  listItemsByTrip: mocks.listItemsByTrip,
  listLedgerBudgets: mocks.listLedgerBudgets,
  listLedgerExpenses: mocks.listLedgerExpenses,
  listLedgerParticipants: mocks.listLedgerParticipants,
  listTicketsByTrip: mocks.listTicketsByTrip,
  setItineraryItemExecutionState: vi.fn(),
  updateLedgerBudget: mocks.updateLedgerBudget,
  updateLedgerExpense: mocks.updateLedgerExpense,
  updateLedgerParticipant: mocks.updateLedgerParticipant,
}))

vi.mock('../lib/dataEvents', () => ({
  subscribeTravelDataChanged: mocks.subscribeTravelDataChanged,
}))

vi.mock('../hooks/useTripIntelligencePersistence', () => ({
  useTripIntelligencePersistence: () => ({
    restoreSuggestionState: mocks.restoreSuggestionState,
    setSuggestionState: mocks.setSuggestionState,
    suggestionStates: [],
  }),
}))

vi.mock('../lib/ai/travelInbox', () => ({
  listTravelInboxEntriesByTrip: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/ai/existingTripImportExtraction', () => ({
  extractExistingTripImportSources: vi.fn(),
}))

vi.mock('../lib/companion', () => ({
  loadOwnerSharedTripState: vi.fn().mockResolvedValue(null),
}))

vi.mock('../lib/providerProxyClient', () => ({
  fetchProviderProxyAiExpenseExtract: vi.fn(),
  fetchProviderProxyAiExpenseQuery: vi.fn(),
  getProviderProxyConfig: vi.fn(() => ({ configured: false, proxyUrl: null })),
}))

vi.mock('../lib/accountAiPreferences', () => ({
  getAccountAiPreferences: vi.fn(() => ({ enabled: false })),
}))

vi.mock('../lib/travelDocumentCenter', () => ({
  listTransportBookings: vi.fn().mockResolvedValue([]),
  listTravelerProfiles: vi.fn().mockResolvedValue([]),
}))

vi.mock('../components/ledger/LedgerReviewQueue', () => ({
  LedgerReviewQueue: () => <div data-testid="ledger-review-queue" />,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.getTrip.mockResolvedValue({
    createdAt: 100,
    destination: '东京',
    endDate: '2026-04-05',
    id: 'trip_1',
    startDate: '2026-04-01',
    title: '东京旅行',
    updatedAt: 100,
  })
  mocks.getLedgerSettingsByTrip.mockResolvedValue({
    createdAt: 100,
    homeCurrency: 'CNY',
    id: 'settings_1',
    settlementCurrency: 'CNY',
    tripCurrency: 'JPY',
    tripId: 'trip_1',
    updatedAt: 100,
  })
  mocks.listLedgerParticipants.mockResolvedValue([
    { createdAt: 100, displayName: '我', id: 'person_1', isSelf: true, tripId: 'trip_1', updatedAt: 100 },
  ])
  mocks.listLedgerBudgets.mockResolvedValue([])
  mocks.listLedgerExpenses.mockResolvedValue([{
    amountMinor: 12_000,
    category: 'food',
    createdAt: 100,
    currency: 'JPY',
    date: '2026-04-01',
    id: 'expense_1',
    itemIds: ['item_1'],
    payerParticipantId: 'person_1',
    paymentStatus: 'paid',
    reviewStatus: 'needs_review',
    source: { kind: 'ticket', sourceId: 'ticket_1' },
    sourceLinks: [{ available: true, id: 'ticket:ticket_1', kind: 'ticket', role: 'payment_receipt', sourceId: 'ticket_1' }],
    splitMode: 'equal',
    splitShares: [{ participantId: 'person_1', weight: 1 }],
    status: 'draft',
    title: '餐厅费用',
    tripId: 'trip_1',
    updatedAt: 100,
  }])
  mocks.listDaysByTrip.mockResolvedValue([
    { createdAt: 100, date: '2026-04-01', id: 'day_1', sortOrder: 1, tripId: 'trip_1', updatedAt: 100 },
  ])
  mocks.listItemsByTrip.mockResolvedValue([
    { createdAt: 100, dayId: 'day_1', id: 'item_1', sortOrder: 1, title: '浅草寺', tripId: 'trip_1', updatedAt: 100 },
  ])
  mocks.listTicketsByTrip.mockResolvedValue([
    {
      createdAt: 100,
      fileName: 'receipt.pdf',
      fileType: 'pdf',
      id: 'ticket_1',
      itemId: 'item_1',
      mimeType: 'application/pdf',
      note: 'receipt paid JPY 12000',
      scope: 'item',
      size: 1024,
      storageMode: 'reference',
      ticketCategory: 'other',
      title: '收据',
      tripId: 'trip_1',
      updatedAt: 100,
    },
  ])
  mocks.createLedgerExpense.mockImplementation(async (input) => ({
    createdAt: 100,
    id: 'expense_1',
    updatedAt: 101,
    ...input,
  }))
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  vi.useRealTimers()
})

describe('LedgerPage', () => {
  it('receives review suggestions without scanning source material', async () => {
    await act(async () => {
      root?.render(<LedgerPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.querySelector('[data-testid="ledger-intelligence-panel"]')?.textContent).toContain('费用待确认')
    expect(container?.textContent).toContain('手动记一笔')
    expect(container?.textContent).not.toContain('从更多来源整理')

    const reviewButton = Array.from(container?.querySelectorAll('[data-testid="ledger-intelligence-suggestion"] button') ?? [])
      .find((button) => button.textContent?.includes('确认费用'))
    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.createLedgerExpense).not.toHaveBeenCalled()
    expect(container?.querySelector('[data-testid="ledger-review-queue"]')).toBeTruthy()
  })
})
