import { describe, expect, it } from 'vitest'
import type { TicketMeta } from '../../types'
import {
  AccountCloudContractError,
  parseAccountObjectMutationV1,
} from './contract'
import {
  buildAccountObjectDeleteMutation,
  buildAccountObjectUpsertMutation,
  redactTicketMetaForAccountCloud,
} from './mutationBuilder'

const options = {
  deviceId: 'device_primary',
  expectedRevision: 0,
  mutationId: '11111111-1111-4111-8111-111111111111',
  tripId: 'trip_uk',
}

describe('account mutation builder', () => {
  it('serializes a registered payload and strips undefined fields', () => {
    const mutation = buildAccountObjectUpsertMutation('item', {
      address: undefined,
      createdAt: 1,
      dayId: 'day_first',
      id: 'item_first',
      sortOrder: 0,
      ticketIds: [],
      title: 'Arrival',
      tripId: 'trip_uk',
      updatedAt: 1,
    }, options)

    expect(mutation.payload).not.toHaveProperty('address')
    expect(mutation).toMatchObject({
      objectId: 'item_first',
      objectType: 'item',
      operation: 'upsert',
    })
  })

  it('rejects payload identity substitution and sensitive fields', () => {
    expect(() => buildAccountObjectUpsertMutation('item', {
      createdAt: 1,
      dayId: 'day_first',
      id: 'item_first',
      sortOrder: 0,
      ticketIds: [],
      title: 'Arrival',
      tripId: 'trip_other',
      updatedAt: 1,
    }, options)).toThrow(AccountCloudContractError)

    expect(() => buildAccountObjectUpsertMutation('item', {
      createdAt: 1,
      dayId: 'day_first',
      id: 'item_first',
      ocrText: 'private document body',
      sortOrder: 0,
      ticketIds: [],
      title: 'Arrival',
      tripId: 'trip_uk',
      updatedAt: 1,
    } as never, options)).toThrow(AccountCloudContractError)
  })

  it('builds a payload-free tombstone mutation', () => {
    expect(buildAccountObjectDeleteMutation('item', 'item_first', {
      ...options,
      expectedRevision: 4,
    })).toEqual({
      ...options,
      expectedRevision: 4,
      objectId: 'item_first',
      objectSchemaVersion: 1,
      objectType: 'item',
      operation: 'delete',
      schemaVersion: 1,
    })
  })

  it('removes ticket file locations, signed URLs, notes, and extracted fields before V2 use', () => {
    const ticket: TicketMeta = {
      createdAt: 1,
      externalUrl: 'https://files.example/ticket.pdf?token=secret',
      fileName: '/Users/example/secret-booking.pdf',
      fileType: 'pdf',
      id: 'ticket_first',
      mimeType: 'application/pdf',
      note: 'passport 123 and booking 456',
      referenceLocation: '/Users/example/Downloads',
      scope: 'unassigned',
      size: 100,
      structuredFields: { schemaVersion: 1 },
      title: 'London admission',
      tripId: 'trip_uk',
      updatedAt: 1,
    }
    const redacted = redactTicketMetaForAccountCloud(ticket)

    expect(redacted).toEqual({
      bookingId: undefined,
      createdAt: 1,
      fileType: 'pdf',
      id: 'ticket_first',
      itemId: undefined,
      mimeType: 'application/pdf',
      scope: 'unassigned',
      sharedVisibility: undefined,
      size: 100,
      storageMode: undefined,
      ticketCategory: undefined,
      title: 'London admission',
      tripId: 'trip_uk',
      updatedAt: 1,
    })
    expect(JSON.stringify(redacted)).not.toMatch(/secret|passport|booking 456|Users/)

    const mutation = buildAccountObjectUpsertMutation('ticket_meta', ticket, options)
    expect(mutation.payload).toEqual(redacted)
    expect(JSON.stringify(mutation)).not.toMatch(/secret|passport|booking 456|Users/)
  })

  it('normalizes legacy Ticket scope without exposing private local fields', () => {
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'legacy.pdf',
      fileType: 'pdf',
      id: 'ticket_legacy',
      itemId: 'item_first',
      mimeType: 'application/pdf',
      note: 'private',
      size: 100,
      tripId: 'trip_uk',
      updatedAt: 2,
    }

    expect(redactTicketMetaForAccountCloud(ticket)).toMatchObject({
      itemId: 'item_first',
      scope: 'item',
    })
    expect(JSON.stringify(redactTicketMetaForAccountCloud(ticket))).not.toContain('private')
  })

  it('rejects unregistered Ticket metadata fields at the generic contract boundary', () => {
    expect(() => parseAccountObjectMutationV1({
      ...options,
      objectId: 'ticket_first',
      objectSchemaVersion: 1,
      objectType: 'ticket_meta',
      operation: 'upsert',
      payload: {
        createdAt: 1,
        fileName: '/Users/example/private.pdf',
        fileType: 'pdf',
        id: 'ticket_first',
        mimeType: 'application/pdf',
        scope: 'unassigned',
        size: 100,
        title: 'London admission',
        tripId: 'trip_uk',
        updatedAt: 1,
      },
      schemaVersion: 1,
    })).toThrow(AccountCloudContractError)
  })
})
