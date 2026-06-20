// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TravelDocumentCenterPage } from './TravelDocumentCenterPage'

const mocks = vi.hoisted(() => ({
  deleteTicket: vi.fn(),
  encryptExistingTicketAsDocument: vi.fn(),
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip-1' })),
  getTravelVaultStatus: vi.fn(),
  linkDocumentToTrip: vi.fn(),
  listDocumentTripLinks: vi.fn(),
  listTicketsByTrip: vi.fn(),
  listTransportBookings: vi.fn(),
  listTransportSegments: vi.fn(),
  listTravelCenterSyncConflicts: vi.fn(),
  listTravelDocuments: vi.fn(),
  listTravelerProfiles: vi.fn(),
  listTrips: vi.fn(),
  listUpcomingReminders: vi.fn(),
  navigateTo: vi.fn(),
}))

vi.mock('../db', () => ({
  createItineraryItem: vi.fn(),
  deleteTicket: mocks.deleteTicket,
  listDaysByTrip: vi.fn().mockResolvedValue([]),
  listItemsByDay: vi.fn().mockResolvedValue([]),
  listTicketsByTrip: mocks.listTicketsByTrip,
  listTrips: mocks.listTrips,
}))

vi.mock('../lib/routes', () => ({
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../lib/travelDocumentCenter', () => ({
  addDocumentAttachment: vi.fn(),
  createTransportBooking: vi.fn(),
  createTravelDocument: vi.fn(),
  createTravelerProfile: vi.fn(),
  deleteTransportBooking: vi.fn(),
  deleteTravelDocument: vi.fn(),
  encryptExistingTicketAsDocument: mocks.encryptExistingTicketAsDocument,
  getTravelVaultStatus: mocks.getTravelVaultStatus,
  initializeTravelVault: vi.fn(),
  isSafeExternalAction: vi.fn(() => true),
  linkDocumentToTrip: mocks.linkDocumentToTrip,
  listDocumentTripLinks: mocks.listDocumentTripLinks,
  listTransportBookings: mocks.listTransportBookings,
  listTransportSegments: mocks.listTransportSegments,
  listTravelDocuments: mocks.listTravelDocuments,
  listTravelerProfiles: mocks.listTravelerProfiles,
  lockTravelVault: vi.fn(),
  openDocumentAttachment: vi.fn(),
  unlockTravelVault: vi.fn(),
  updateTravelDocument: vi.fn(),
}))

vi.mock('../lib/cloudTravelCenter', () => ({
  listTravelCenterSyncConflicts: mocks.listTravelCenterSyncConflicts,
  resolveTravelCenterSyncConflict: vi.fn(),
  syncTravelCenter: vi.fn().mockResolvedValue({ conflicts: 0, deleted: 0, downloaded: 0, uploaded: 0 }),
}))

vi.mock('../lib/travelReminders', () => ({
  listUpcomingReminders: mocks.listUpcomingReminders,
  scheduleDocumentExpiryReminder: vi.fn(),
  scheduleTransportReminder: vi.fn(),
}))

vi.mock('../lib/vaultBackup', () => ({
  exportEncryptedVaultBackup: vi.fn(),
  importEncryptedVaultBackup: vi.fn(),
}))

vi.mock('../lib/backup', () => ({
  downloadBlob: vi.fn(),
}))

vi.mock('../lib/webPush', () => ({
  enableTravelWebPush: vi.fn(),
  showDueLocalReminders: vi.fn().mockResolvedValue(0),
}))

vi.mock('../lib/sensitiveDocumentOcr', () => ({
  extractSensitiveDocumentPreview: vi.fn(),
}))

vi.mock('../lib/flightStatusProvider', () => ({
  createDisabledFlightStatusProvider: vi.fn(() => ({ getStatus: vi.fn().mockResolvedValue({ warnings: ['disabled'] }) })),
}))

vi.mock('../lib/transportImport', () => ({
  extractTransportImportPreview: vi.fn(),
}))

vi.mock('./TicketLibraryPage', () => ({
  TicketLibraryPage: () => <div data-testid="ticket-library-page" />,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.getTravelVaultStatus.mockResolvedValue({ exists: true, unlocked: true, vaultId: 'vault-1' })
  mocks.listTrips.mockResolvedValue([{ createdAt: 1, destination: '东京', endDate: '2026-06-20', id: 'trip-1', startDate: '2026-06-10', title: '东京旅行', updatedAt: 1 }])
  mocks.listTicketsByTrip.mockResolvedValue([{
    createdAt: 1,
    fileName: 'passport-P123456789.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    mimeType: 'application/pdf',
    note: 'PNR ABC123 ORDER-7788',
    size: 1000,
    storageMode: 'copy',
    ticketCategory: 'other',
    title: 'passport P123456789',
    tripId: 'trip-1',
    updatedAt: 1,
  }])
  mocks.listTravelCenterSyncConflicts.mockResolvedValue([{
    cloudUpdatedAt: 2,
    createdAt: 1,
    id: 'conflict-1',
    localUpdatedAt: 1,
    objectId: 'vault-object-secret-123',
    objectKey: 'vault_object:vault-object-secret-123',
    objectType: 'vault_object',
    remoteRecord: { raw: 'remote raw payload' },
    status: 'pending',
    updatedAt: 2,
  }])
  mocks.listTravelDocuments.mockResolvedValue([{
    data: {
      applicationNumber: 'APP-SECRET-7788',
      attachmentIds: [],
      documentNumber: 'P123456789',
      format: 'electronic',
      kind: 'passport',
      notes: 'private note',
      status: 'active',
      title: 'passport P123456789',
      travelerIds: [],
      validUntil: '2026-06-20',
    },
    id: 'doc-1',
    updatedAt: 1,
    vaultId: 'vault-1',
  }])
  mocks.listDocumentTripLinks.mockResolvedValue([])
  mocks.listTravelerProfiles.mockResolvedValue([])
  mocks.listTransportBookings.mockResolvedValue([])
  mocks.listTransportSegments.mockResolvedValue([])
  mocks.listUpcomingReminders.mockResolvedValue([])
  mocks.encryptExistingTicketAsDocument.mockResolvedValue({ documentId: 'doc-new' })
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

describe('TravelDocumentCenterPage unified intelligence', () => {
  it('renders redacted document suggestions and opens the existing migration confirmation', async () => {
    await renderPage()
    await waitForText('资料建议')

    const panel = getByTestId('travel-document-intelligence-panel')
    expect(panel.textContent).toContain('票据可转入加密资料库')
    expect(panel.textContent).toContain('资料同步冲突待处理')
    for (const sensitive of ['P123456789', 'APP-SECRET-7788', 'PNR ABC123', 'ORDER-7788', 'vault-object-secret-123', 'remote raw payload']) {
      expect(panel.textContent).not.toContain(sensitive)
    }

    await clickSuggestion('票据可转入加密资料库')
    await waitForText('转入加密资料库')
    expect(getByTestId('travel-document-migration-confirm-dialog')).toBeTruthy()
    expect(mocks.encryptExistingTicketAsDocument).not.toHaveBeenCalled()
  })

  it('does not write when migration is suggested while the vault is locked', async () => {
    mocks.getTravelVaultStatus.mockResolvedValue({ exists: true, unlocked: false, vaultId: 'vault-1' })
    mocks.listTravelDocuments.mockResolvedValue([])
    await renderPage()
    await waitForText('票据可转入加密资料库')

    await clickSuggestion('票据可转入加密资料库')
    await waitForText('先解锁旅行资料库')

    expect(mocks.encryptExistingTicketAsDocument).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="travel-document-migration-confirm-dialog"]')).toBeNull()
  })
})

async function renderPage() {
  await act(async () => {
    root?.render(<TravelDocumentCenterPage />)
  })
}

async function clickSuggestion(text: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="travel-document-intelligence-action"]')]
    .find((element) => element.textContent?.includes(text))
  if (!button) throw new Error(`Missing suggestion: ${text}`)
  await act(async () => {
    button.click()
  })
}

function getByTestId(testId: string) {
  const element = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`Missing test id: ${testId}`)
  return element
}

async function waitForText(text: string) {
  for (let index = 0; index < 20; index += 1) {
    if (document.body.textContent?.includes(text)) return
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }
  throw new Error(`Missing text: ${text}`)
}
