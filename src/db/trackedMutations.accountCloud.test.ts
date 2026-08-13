import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountObjectMutationV1,
  AccountObjectRowV1,
} from '../lib/accountCloud/contract'
import { ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION } from '../lib/accountCloud/feature'
import { buildAccountObjectRevisionRecord } from '../lib/accountCloud/localStore'
import { redactTicketMetaForAccountCloud } from '../lib/accountCloud/mutationBuilder'
import type { AccountWorkflowRequestV1 } from '../lib/accountCloud/workflowContract'
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
  moveItineraryItemBetweenDays,
  reorderDayItems,
  updateItineraryItem,
  updateTicketMeta,
  updateTrip,
} from './trackedMutations'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  workflowCommit: vi.fn(),
}))

vi.mock('../lib/accountCloud/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/accountCloud/client')>()
  return {
    ...actual,
    commitAccountObjectMutationV1: mocks.commit,
  }
})

vi.mock('../lib/accountCloud/workflowClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/accountCloud/workflowClient')>()
  return {
    ...actual,
    commitAccountWorkflowV1: mocks.workflowCommit,
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
  mocks.workflowCommit.mockReset()
  mocks.commit.mockImplementation(async (mutation: AccountObjectMutationV1) => (
    successResult(mutation, mutation.expectedRevision + 1)
  ))
  mocks.workflowCommit.mockImplementation(async (request: AccountWorkflowRequestV1) => (
    workflowSuccessResult(request)
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

  it('keeps Item relationship and order fields off the single-object V2 path', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const day = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: 'A', tripId: trip.id })
    mocks.commit.mockClear()
    await db.syncOutbox.clear()

    await expect(updateItineraryItem(item.id, { ticketIds: ['ticket_pending'] }))
      .resolves.toMatchObject({ ticketIds: ['ticket_pending'] })

    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.accountObjectRevisions.get(`item:${item.id}`)).resolves.toMatchObject({
      payload: expect.objectContaining({ ticketIds: [] }),
      revision: 1,
    })
    await expect(db.syncOutbox.toArray()).resolves.toEqual([
      expect.objectContaining({ objectId: item.id, objectType: 'item', operation: 'upsert' }),
    ])
  })

  it('commits a complete day reorder as one registered workflow without a legacy write', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const day = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const first = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: 'A', tripId: trip.id })
    const second = await createItineraryItem({ dayId: day.id, sortOrder: 2, ticketIds: [], title: 'B', tripId: trip.id })
    const tripUpdatedAt = (await db.trips.get(trip.id))?.updatedAt
    mocks.commit.mockClear()
    mocks.workflowCommit.mockClear()
    await db.syncOutbox.clear()

    const reordered = await reorderDayItems(day.id, [second.id, first.id], [first.id, second.id])

    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.workflowCommit).toHaveBeenCalledTimes(1)
    const request = mocks.workflowCommit.mock.calls[0]?.[0] as AccountWorkflowRequestV1
    expect(request).toMatchObject({
      steps: [
        expect.objectContaining({ expectedRevision: 1, objectId: second.id, objectType: 'item' }),
        expect.objectContaining({ expectedRevision: 1, objectId: first.id, objectType: 'item' }),
      ],
      tripId: trip.id,
      workflowId: 'day.items.reorder@1',
    })
    expect(request.steps.map((step) => step.payload?.sortOrder)).toEqual([1, 2])
    expect(reordered.map((item) => item.id)).toEqual([second.id, first.id])
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)
    await expect(db.accountObjectRevisions.bulkGet([
      `item:${first.id}`,
      `item:${second.id}`,
    ])).resolves.toEqual([
      expect.objectContaining({ revision: 2 }),
      expect.objectContaining({ revision: 2 }),
    ])
    await expect(db.trips.get(trip.id)).resolves.toMatchObject({ updatedAt: tripUpdatedAt })
  })

  it('commits a cross-day move with every source and destination sibling in one workflow', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const sourceDay = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const destinationDay = await createDay({ date: '2026-08-12', sortOrder: 1, title: 'London', tripId: trip.id })
    const sourceFirst = await createItineraryItem({ dayId: sourceDay.id, sortOrder: 1, ticketIds: [], title: 'A', tripId: trip.id })
    const target = await createItineraryItem({ dayId: sourceDay.id, sortOrder: 2, ticketIds: [], title: 'B', tripId: trip.id })
    const sourceLast = await createItineraryItem({ dayId: sourceDay.id, sortOrder: 3, ticketIds: [], title: 'C', tripId: trip.id })
    const destinationFirst = await createItineraryItem({ dayId: destinationDay.id, sortOrder: 1, ticketIds: [], title: 'D', tripId: trip.id })
    const destinationLast = await createItineraryItem({ dayId: destinationDay.id, sortOrder: 2, ticketIds: [], title: 'E', tripId: trip.id })
    const tripUpdatedAt = (await db.trips.get(trip.id))?.updatedAt
    mocks.commit.mockClear()
    mocks.workflowCommit.mockClear()
    await db.syncOutbox.clear()

    const result = await moveItineraryItemBetweenDays(
      target.id,
      destinationDay.id,
      [destinationFirst.id, target.id, destinationLast.id],
      {
        expectedDestinationItemIds: [destinationFirst.id, destinationLast.id],
        expectedSourceItemIds: [sourceFirst.id, target.id, sourceLast.id],
        sourceDayId: sourceDay.id,
      },
    )

    expect(result.movedItem).toMatchObject({ dayId: destinationDay.id, id: target.id, sortOrder: 2 })
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.workflowCommit).toHaveBeenCalledTimes(1)
    const request = mocks.workflowCommit.mock.calls[0]?.[0] as AccountWorkflowRequestV1
    expect(request.workflowId).toBe('item.move@1')
    expect(request.steps.map((step) => step.objectId).sort()).toEqual([
      sourceFirst.id,
      target.id,
      sourceLast.id,
      destinationFirst.id,
      destinationLast.id,
    ].sort())
    expect(request.steps.every((step) => step.expectedRevision === 1)).toBe(true)
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)
    await expect(db.trips.get(trip.id)).resolves.toMatchObject({ updatedAt: tripUpdatedAt })
    const revisions = await db.accountObjectRevisions.bulkGet(
      request.steps.map((step) => `item:${step.objectId}`),
    )
    expect(revisions.every((revision) => revision?.revision === 2)).toBe(true)
  })

  it('falls back before mutation when the complete reorder graph is not bootstrapped', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const day = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const bootstrapped = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: 'A', tripId: trip.id })
    const legacy = await repo.createItineraryItem({ dayId: day.id, sortOrder: 2, ticketIds: [], title: 'B', tripId: trip.id })
    mocks.commit.mockClear()
    mocks.workflowCommit.mockClear()
    await db.syncOutbox.clear()

    const reordered = await reorderDayItems(day.id, [legacy.id, bootstrapped.id], [bootstrapped.id, legacy.id])

    expect(reordered.map((item) => item.id)).toEqual([legacy.id, bootstrapped.id])
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    const outbox = await db.syncOutbox.toArray()
    expect(outbox.map((entry) => entry.objectId).sort()).toEqual([
      bootstrapped.id,
      legacy.id,
    ].sort())
  })

  it('fails closed when a later V2 object is busy even if an earlier object needs fallback', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const day = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const legacy = await repo.createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: 'Legacy', tripId: trip.id })
    const bootstrapped = await createItineraryItem({ dayId: day.id, sortOrder: 2, ticketIds: [], title: 'Cloud', tripId: trip.id })
    await db.accountMutationJournal.put({
      accountHash,
      attempts: 0,
      createdAt: 1,
      deviceId: 'device_primary',
      expectedRevision: 1,
      mutationId: '33333333-3333-4333-8333-333333333333',
      objectId: bootstrapped.id,
      objectKey: `item:${bootstrapped.id}`,
      objectSchemaVersion: 1,
      objectType: 'item',
      operation: 'upsert',
      payload: bootstrapped,
      requestFingerprint: 'pending',
      status: 'pending',
      tripId: trip.id,
      updatedAt: 1,
    })
    mocks.commit.mockClear()
    mocks.workflowCommit.mockClear()
    await db.syncOutbox.clear()

    await expect(reorderDayItems(
      day.id,
      [bootstrapped.id, legacy.id],
      [legacy.id, bootstrapped.id],
    )).rejects.toMatchObject({ code: 'conflict' })

    await expect(repo.listItemsByDay(day.id)).resolves.toMatchObject([
      { id: legacy.id, sortOrder: 1 },
      { id: bootstrapped.id, sortOrder: 2 },
    ])
    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.syncOutbox.count()).resolves.toBe(0)
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
    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    const outbox = await db.syncOutbox.toArray()
    expect(outbox.map((entry) => entry.objectType).sort()).toEqual(['item', 'ticket_meta'])
  })

  it('commits a complete existing Ticket rebind through one registered workflow', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const day = await createDay({ date: '2026-08-11', sortOrder: 0, title: 'Arrival', tripId: trip.id })
    const first = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: 'A', tripId: trip.id })
    const second = await createItineraryItem({ dayId: day.id, sortOrder: 2, ticketIds: [], title: 'B', tripId: trip.id })
    const hidden = await createItineraryItem({ dayId: day.id, sortOrder: 3, ticketIds: [], title: 'C', tripId: trip.id })
    const ticket = await createTicketMeta({
      fileName: 'a.pdf',
      fileType: 'pdf',
      itemId: first.id,
      mimeType: 'application/pdf',
      note: 'private note',
      scope: 'item',
      size: 10,
      storageMode: 'copy',
      tripId: trip.id,
    })
    await repo.updateItineraryItem(first.id, { ticketIds: [ticket.id] })
    await repo.updateItineraryItem(hidden.id, { ticketIds: [ticket.id] })
    await db.accountObjectRevisions.put(buildAccountObjectRevisionRecord({
      actorId: ACTOR_ID,
      createdAt: NOW_ISO,
      deletedAt: null,
      deviceId: 'device_primary',
      mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      objectId: ticket.id,
      objectSchemaVersion: 1,
      objectType: 'ticket_meta',
      payload: JSON.parse(JSON.stringify(redactTicketMetaForAccountCloud(ticket))),
      revision: 1,
      schemaVersion: 1,
      tombstone: false,
      tripId: trip.id,
      updatedAt: NOW_ISO,
    }))
    for (const item of [first, hidden]) {
      const current = await repo.getItineraryItem(item.id)
      const revision = await db.accountObjectRevisions.get(`item:${item.id}`)
      if (!current || !revision) throw new Error('Missing Ticket relationship test baseline.')
      await db.accountObjectRevisions.put({
        ...revision,
        payload: JSON.parse(JSON.stringify(current)) as AccountObjectRowV1['payload'],
      })
    }
    mocks.commit.mockClear()
    mocks.workflowCommit.mockClear()
    await db.syncOutbox.clear()

    const result = await updateTicketMeta(ticket.id, {
      itemId: second.id,
      note: 'private note',
      scope: 'item',
      title: 'Updated ticket',
    })

    expect(result?.ticket).toMatchObject({ itemId: second.id, title: 'Updated ticket' })
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.workflowCommit).toHaveBeenCalledTimes(1)
    const request = mocks.workflowCommit.mock.calls[0]?.[0] as AccountWorkflowRequestV1
    expect(request.workflowId).toBe('ticket.bind@1')
    expect(request.steps).toHaveLength(4)
    expect(request.steps.map((step) => [step.objectType, step.objectId])).toEqual(expect.arrayContaining([
      ['ticket_meta', ticket.id],
      ['item', first.id],
      ['item', second.id],
      ['item', hidden.id],
    ]))
    expect(JSON.stringify(request)).not.toMatch(/private note|fileName|a\.pdf/)
    await expect(repo.getItineraryItem(first.id)).resolves.toMatchObject({ ticketIds: [] })
    await expect(repo.getItineraryItem(second.id)).resolves.toMatchObject({ ticketIds: [ticket.id] })
    await expect(repo.getItineraryItem(hidden.id)).resolves.toMatchObject({ ticketIds: [] })
    await expect(db.syncOutbox.count()).resolves.toBe(0)
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)

    mocks.workflowCommit.mockClear()
    await db.syncOutbox.clear()
    const privateOnly = await updateTicketMeta(ticket.id, {
      itemId: second.id,
      note: 'updated private note',
      scope: 'item',
      title: 'Updated ticket',
    })
    expect(privateOnly?.ticket.note).toBe('updated private note')
    expect(mocks.workflowCommit).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.workflowCommit.mock.calls[0]?.[0])).not.toContain('updated private note')
    await expect(db.syncOutbox.count()).resolves.toBe(0)
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

function workflowSuccessResult(request: AccountWorkflowRequestV1) {
  return {
    batchMutationId: request.batchMutationId,
    schemaVersion: 1 as const,
    status: 'applied' as const,
    steps: request.steps.map((step) => ({
      appliedRevision: step.expectedRevision + 1,
      currentRevision: step.expectedRevision + 1,
      mutationId: step.mutationId,
      object: workflowRow(step, request.tripId, step.expectedRevision + 1),
      stepId: step.stepId,
    })),
    tripId: request.tripId,
    workflowId: request.workflowId,
  }
}

function workflowRow(
  step: AccountWorkflowRequestV1['steps'][number],
  tripId: string,
  revision: number,
): AccountObjectRowV1 {
  return {
    actorId: ACTOR_ID,
    createdAt: NOW_ISO,
    deletedAt: null,
    deviceId: step.mutationId,
    mutationId: step.mutationId,
    objectId: step.objectId,
    objectSchemaVersion: step.objectSchemaVersion,
    objectType: step.objectType,
    payload: step.payload ?? null,
    revision,
    schemaVersion: 1,
    tombstone: false,
    tripId,
    updatedAt: NOW_ISO,
  }
}
