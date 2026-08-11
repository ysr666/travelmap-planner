import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountObjectMutationV1 } from '../lib/accountCloud/contract'
import { ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION } from '../lib/accountCloud/feature'
import {
  activateAccountDatabase,
  activateLegacyDatabaseForTests,
} from '../lib/accountDatabase'
import { db } from './database'
import * as repo from './repositories'
import {
  createDay,
  createItineraryItem,
  createTicketMeta,
  createTrip,
  reorderDayItems,
  updateItineraryItem,
  updateTicketMeta,
  updateTrip,
} from './trackedMutations'

const mocks = vi.hoisted(() => ({ commit: vi.fn() }))

vi.mock('../lib/accountCloud/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/accountCloud/client')>()
  return {
    ...actual,
    commitAccountObjectMutationV1: mocks.commit,
  }
})

vi.mock('../lib/accountCloud/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/accountCloud/feature')>()
  return {
    ...actual,
    isAccountCloudV2AccountEnabled: (activeHash: string | null) => Boolean(activeHash),
  }
})

const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const NOW_ISO = '2026-08-11T10:00:00.000Z'
let accountDatabaseName = ''
let accountHash = ''

beforeEach(async () => {
  const account = await activateAccountDatabase('tracked-runtime-account')
  accountDatabaseName = account.databaseName
  accountHash = account.accountHash
  await db.delete()
  await db.open()
  mocks.commit.mockReset()
  mocks.commit.mockImplementation(async (mutation: AccountObjectMutationV1) => (
    successResult(mutation, mutation.expectedRevision + 1)
  ))
  vi.stubEnv('VITE_ACCOUNT_CLOUD_V2_MODE', 'enabled')
  vi.stubEnv('VITE_ACCOUNT_CLOUD_V2_MIGRATION', ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION)
  vi.stubEnv('VITE_ACCOUNT_CLOUD_V2_ACCOUNT_HASHES', accountHash)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  activateLegacyDatabaseForTests()
  await Dexie.delete(accountDatabaseName)
})

describe('tracked mutations account-cloud cutover', () => {
  it('uses acknowledged V2 writes for bounded trip, day, and item creates and updates', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const tripUpdatedAt = trip.updatedAt
    const day = await createDay({
      date: '2026-08-11',
      sortOrder: 0,
      title: 'Arrival',
      tripId: trip.id,
    })
    const item = await createItineraryItem({
      dayId: day.id,
      sortOrder: 0,
      ticketIds: [],
      title: 'London',
      tripId: trip.id,
    })
    await expect(db.trips.get(trip.id)).resolves.toMatchObject({ updatedAt: tripUpdatedAt })
    const ticket = await createTicketMeta({
      fileName: 'london.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 120,
      storageMode: 'copy',
      tripId: trip.id,
    })
    const updated = await updateItineraryItem(item.id, { address: 'London, UK' })
    const updatedTicket = await updateTicketMeta(ticket.id, {
      scope: 'unassigned',
      title: 'London admission',
    })

    expect(updated).toMatchObject({ address: 'London, UK' })
    expect(updatedTicket?.ticket).toMatchObject({ title: 'London admission' })
    expect(mocks.commit.mock.calls.map(([mutation]) => (
      [(mutation as AccountObjectMutationV1).objectType, (mutation as AccountObjectMutationV1).expectedRevision]
    ))).toEqual([
      ['trip', 0],
      ['day', 0],
      ['item', 0],
      ['item', 1],
    ])
    await expect(db.syncOutbox.count()).resolves.toBe(2)
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    await expect(db.accountObjectRevisions.count()).resolves.toBe(3)
    await expect(db.accountObjectRevisions.get(`item:${item.id}`)).resolves.toMatchObject({ revision: 2 })
    await expect(db.accountObjectRevisions.get(`ticket_meta:${ticket.id}`)).resolves.toBeUndefined()
  })

  it('keeps an existing object without a V2 revision on the legacy path', async () => {
    const trip = await repo.createTrip({
      destination: 'Japan',
      endDate: '2026-09-02',
      startDate: '2026-09-01',
      title: 'Legacy',
    })

    await expect(updateTrip(trip.id, { title: 'Legacy updated' })).resolves.toMatchObject({
      title: 'Legacy updated',
    })

    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    await expect(db.syncOutbox.toArray()).resolves.toEqual([
      expect.objectContaining({ objectId: trip.id, objectType: 'trip', operation: 'upsert' }),
    ])
  })

  it('keeps multi-object reorder operations on the legacy atomic path', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const day = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const first = await createItineraryItem({ dayId: day.id, sortOrder: 0, ticketIds: [], title: 'A', tripId: trip.id })
    const second = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: 'B', tripId: trip.id })
    mocks.commit.mockClear()

    const reordered = await reorderDayItems(day.id, [second.id, first.id], [first.id, second.id])

    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    const outbox = await db.syncOutbox.toArray()
    expect(outbox.length).toBeGreaterThan(0)
    expect(outbox.every((entry) => entry.objectType === 'item')).toBe(true)
    expect(outbox.map((entry) => entry.objectId).sort())
      .toEqual(reordered.map((item) => item.id).sort())
  })

  it('keeps ticket binding changes on the legacy multi-object path', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const day = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, sortOrder: 0, ticketIds: [], title: 'A', tripId: trip.id })
    const ticket = await createTicketMeta({
      fileName: 'a.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 10,
      tripId: trip.id,
    })
    mocks.commit.mockClear()
    await db.syncOutbox.clear()

    const result = await updateTicketMeta(ticket.id, { itemId: item.id, scope: 'item' })

    expect(result?.changedItems).toHaveLength(1)
    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    const outbox = await db.syncOutbox.toArray()
    expect(outbox.map((entry) => entry.objectType).sort()).toEqual(['item', 'ticket_meta'])
  })
})

function successResult(mutation: AccountObjectMutationV1, revision: number) {
  return {
    appliedRevision: revision,
    currentRevision: revision,
    mutationId: mutation.mutationId,
    object: {
      actorId: ACTOR_ID,
      createdAt: NOW_ISO,
      deletedAt: null,
      deviceId: mutation.deviceId,
      mutationId: mutation.mutationId,
      objectId: mutation.objectId,
      objectSchemaVersion: mutation.objectSchemaVersion,
      objectType: mutation.objectType,
      payload: mutation.payload ?? null,
      revision,
      schemaVersion: 1 as const,
      tombstone: false,
      tripId: mutation.tripId,
      updatedAt: NOW_ISO,
    },
    schemaVersion: 1 as const,
    status: 'applied' as const,
  }
}
