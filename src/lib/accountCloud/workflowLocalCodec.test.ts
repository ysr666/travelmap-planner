import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import type { TicketMeta } from '../../types'
import {
  ACCOUNT_WORKFLOW_LOCAL_OBJECT_TYPES,
  AccountWorkflowLocalCodecError,
  encodeAccountWorkflowLocalPayload,
  getAccountWorkflowLocalObjectTable,
  readAccountWorkflowLocalPayload,
  writeAccountWorkflowLocalPayload,
} from './workflowLocalCodec'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('account workflow local codec', () => {
  it('binds every registered local workflow object to a fixed IndexedDB table', () => {
    const tableNames = ACCOUNT_WORKFLOW_LOCAL_OBJECT_TYPES.map((objectType) =>
      getAccountWorkflowLocalObjectTable(objectType, db).name)
    expect(tableNames).toEqual([
      'trips',
      'days',
      'itineraryItems',
      'ticketMetas',
      'ledgerSettings',
      'ledgerParticipants',
      'ledgerBudgets',
      'ledgerExpenses',
      'tripReplanEvents',
      'tripReplanRecords',
      'tripIntelligenceAppliedChanges',
      'tripIntelligenceSuggestionStates',
    ])
    expect(() => getAccountWorkflowLocalObjectTable('document_index', db))
      .toThrowError(new AccountWorkflowLocalCodecError('unsupported_object'))
  })

  it('redacts Ticket-only fields while preserving them across a safe binding rollback', async () => {
    const ticket: TicketMeta = {
      createdAt: 1,
      externalUrl: 'https://private.example/ticket',
      fileName: '/private/path/boarding-pass.pdf',
      fileType: 'pdf',
      id: 'ticket_a',
      itemId: 'item_a',
      mimeType: 'application/pdf',
      note: 'private note',
      referenceLocation: 'mailbox',
      size: 100,
      storageMode: 'copy',
      structuredFields: { schemaVersion: 1, status: 'ready' },
      title: 'Boarding pass',
      tripId: 'trip_uk',
      updatedAt: 2,
    }
    await db.ticketMetas.put(ticket)

    const encoded = await readAccountWorkflowLocalPayload('ticket_meta', ticket.id, ticket.tripId, db)
    expect(encoded).toMatchObject({ id: ticket.id, itemId: 'item_a', title: 'Boarding pass' })
    expect(encoded).not.toHaveProperty('externalUrl')
    expect(encoded).not.toHaveProperty('fileName')
    expect(encoded).not.toHaveProperty('note')
    expect(encoded).not.toHaveProperty('referenceLocation')
    expect(encoded).not.toHaveProperty('structuredFields')

    await writeAccountWorkflowLocalPayload('ticket_meta', ticket.id, ticket.tripId, {
      ...encoded!,
      itemId: 'item_b',
      title: 'Updated pass',
      updatedAt: 3,
    }, db)
    await expect(db.ticketMetas.get(ticket.id)).resolves.toMatchObject({
      externalUrl: ticket.externalUrl,
      fileName: ticket.fileName,
      itemId: 'item_b',
      note: ticket.note,
      referenceLocation: ticket.referenceLocation,
      structuredFields: ticket.structuredFields,
      title: 'Updated pass',
    })
  })

  it('rejects sensitive nested values before they can enter a workflow snapshot', () => {
    expect(() => encodeAccountWorkflowLocalPayload('item', 'item_a', 'trip_uk', {
      createdAt: 1,
      dayId: 'day_a',
      id: 'item_a',
      metadata: { apiKey: 'secret' },
      sortOrder: 1,
      ticketIds: [],
      title: 'Arrival',
      tripId: 'trip_uk',
      updatedAt: 1,
    })).toThrowError(new AccountWorkflowLocalCodecError('invalid_object'))
  })
})
