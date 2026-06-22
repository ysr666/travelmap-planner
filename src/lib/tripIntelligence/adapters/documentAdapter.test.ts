import { describe, expect, it } from 'vitest'
import { mapDocumentInputToSuggestions } from './documentAdapter'
import type {
  ReminderSchedule,
  TicketMeta,
  TransportBooking,
  TravelCenterSyncConflict,
  TravelDocumentData,
  TravelDocumentKind,
  TravelDocumentStatus,
} from '../../../types'

describe('mapDocumentInputToSuggestions', () => {
  it('maps document expiry, status, reminders, conflicts, migration, and transport without leaking sensitive fields', () => {
    const suggestions = mapDocumentInputToSuggestions({
      documentTripIds: {},
      documents: [
        documentRecord({
          applicationNumber: 'APP-SECRET-7788',
          documentNumber: 'P123456789',
          kind: 'passport',
          notes: 'private passport note',
          officialUrl: 'https://secret.example/passport',
          physicalLocation: 'home safe drawer',
          status: 'active',
          title: 'Alice passport P123456789',
          validUntil: '2026-06-20',
        }, 'doc-passport-secret'),
        documentRecord({
          applicationNumber: 'VISA-APP-7788',
          documentNumber: 'VISA-SECRET-8888',
          kind: 'visa',
          notes: 'visa provider payload',
          status: 'draft',
          title: 'Japan visa VISA-SECRET-8888',
        }, 'doc-visa-secret'),
      ],
      legacyTickets: [ticket({
        fileName: 'passport-P123456789.pdf',
        note: 'PNR ABC123 order ORDER-7788',
        title: 'passport P123456789',
      })],
      now: '2026-06-01T00:00:00.000Z',
      reminders: [],
      selectedTrip: { id: 'trip-1' },
      syncConflicts: [syncConflict()],
      transportBookings: [booking()],
      vaultUnlocked: true,
    })

    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(expect.arrayContaining([
      'document:sync-conflicts',
      'document:expiring:doc-passport-secret',
      'document:reminder:doc-passport-secret',
      'document:status:doc-visa-secret',
      'document:trip-documents:trip-1',
      'document:ticket-migration:ticket-1',
      'document:transport:booking-1',
    ]))
    expect(suggestions.find((suggestion) => suggestion.id === 'document:sync-conflicts')).toEqual(expect.objectContaining({
      severity: 'high',
      status: 'needs_confirmation',
    }))
    expect(suggestions.find((suggestion) => suggestion.id === 'document:status:doc-visa-secret')).toEqual(expect.objectContaining({
      title: '签证状态需要确认',
      status: 'needs_confirmation',
    }))

    const text = visibleText(suggestions)
    for (const sensitive of [
      'Alice',
      'P123456789',
      'APP-SECRET-7788',
      'private passport note',
      'secret.example',
      'home safe drawer',
      'VISA-SECRET-8888',
      'provider payload',
      'PNR ABC123',
      'ORDER-7788',
      'vault-object-secret-123',
      'remote raw payload',
    ]) {
      expect(text).not.toContain(sensitive)
    }
  })

  it('does not suggest a document reminder when a pending reminder already exists', () => {
    const suggestions = mapDocumentInputToSuggestions({
      documents: [documentRecord({ kind: 'insurance', status: 'active', validUntil: '2026-09-01' }, 'doc-insurance')],
      now: '2026-06-01T00:00:00.000Z',
      reminders: [reminder('doc-insurance')],
    })

    expect(suggestions.map((suggestion) => suggestion.id)).not.toContain('document:reminder:doc-insurance')
  })

  it('evaluates expiry against the selected trip local date', () => {
    const document = documentRecord({ kind: 'passport', status: 'active', validUntil: '2026-06-01' }, 'doc-zone')
    const now = '2026-06-01T15:30:00.000Z'

    const tokyo = mapDocumentInputToSuggestions({
      documents: [document],
      now,
      selectedTrip: { id: 'trip-tokyo', timeZone: 'Asia/Tokyo' },
    })
    const losAngeles = mapDocumentInputToSuggestions({
      documents: [document],
      now,
      selectedTrip: { id: 'trip-la', timeZone: 'America/Los_Angeles' },
    })

    expect(tokyo.map((suggestion) => suggestion.id)).toContain('document:expired:doc-zone')
    expect(losAngeles.map((suggestion) => suggestion.id)).toContain('document:expiring:doc-zone')
  })
})

function visibleText(suggestions: ReturnType<typeof mapDocumentInputToSuggestions>) {
  return suggestions.map((suggestion) => [
    suggestion.action?.label,
    suggestion.message,
    suggestion.source.label,
    suggestion.title,
  ].join(' ')).join('\n')
}

function documentRecord(
  patch: Partial<TravelDocumentData>,
  id = 'doc-1',
) {
  return {
    data: {
      attachmentIds: ['attachment-secret-1'],
      format: 'electronic' as const,
      kind: 'visa' as TravelDocumentKind,
      status: 'active' as TravelDocumentStatus,
      title: 'Sensitive document title',
      travelerIds: [],
      ...patch,
    },
    id,
  }
}

function ticket(patch: Partial<TicketMeta> = {}): TicketMeta {
  return {
    createdAt: 1,
    fileName: 'passport.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    mimeType: 'application/pdf',
    note: '',
    size: 1000,
    storageMode: 'copy',
    ticketCategory: 'other',
    title: 'passport',
    tripId: 'trip-1',
    updatedAt: 1,
    ...patch,
  }
}

function syncConflict(): TravelCenterSyncConflict {
  return {
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
  }
}

function booking(): TransportBooking {
  return {
    createdAt: 1,
    externalActions: [],
    id: 'booking-1',
    kind: 'flight',
    status: 'changed',
    title: 'Flight order ORDER-7788',
    tripId: 'trip-1',
    updatedAt: 2,
  }
}

function reminder(objectId: string): ReminderSchedule {
  return {
    createdAt: 1,
    id: `reminder-${objectId}`,
    kind: 'document_expiry',
    objectId,
    objectType: 'document',
    occurrenceId: `document_expiry:${objectId}`,
    status: 'pending',
    timeZone: 'Asia/Tokyo',
    triggerAt: '2026-08-01T00:00:00.000Z',
    updatedAt: 1,
  }
}
