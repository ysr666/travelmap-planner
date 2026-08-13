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
  createLedgerBudget,
  createLedgerExpense,
  createLedgerExpenseIdempotent,
  initializeLedger,
  updateLedgerExpense,
} from './ledgerTrackedMutations'
import {
  createDay,
  createItineraryItem,
  createTicketMeta,
  createTrip,
  importTripPlanRecords,
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

  it('commits one complete new-trip import graph without a legacy write', async () => {
    const records = makeTripImportRecords()

    const result = await importTripPlanRecords(records)

    expect(result).toEqual({ title: records.trip.title, tripId: records.trip.id })
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.workflowCommit).toHaveBeenCalledTimes(1)
    const request = mocks.workflowCommit.mock.calls[0]?.[0] as AccountWorkflowRequestV1
    expect(request.workflowId).toBe('trip.import.commit@1')
    expect(request.steps).toHaveLength(8)
    expect(request.steps.every((step) => step.expectedRevision === 0)).toBe(true)
    expect(request.steps.map((step) => step.objectType)).toEqual([
      'trip',
      'day',
      'item',
      'ticket_meta',
      'ledger_settings',
      'ledger_participant',
      'ledger_budget',
      'ledger_expense',
    ])
    expect(JSON.stringify(request)).not.toMatch(/private-ticket\.pdf|private note|referenceLocation|structuredFields/)
    await expect(db.ticketMetas.get('ticket_import')).resolves.toMatchObject({
      fileName: 'private-ticket.pdf',
      note: 'private note',
      referenceLocation: '/private/ticket.pdf',
    })
    await expect(db.accountObjectRevisions.count()).resolves.toBe(8)
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)
  })

  it('rolls back every imported record when the server rejects one step', async () => {
    const records = makeTripImportRecords()
    mocks.workflowCommit.mockImplementationOnce(async (request: AccountWorkflowRequestV1) => ({
      batchMutationId: request.batchMutationId,
      conflicts: [{
        currentObject: null,
        currentRevision: 0,
        mutationId: request.steps[0].mutationId,
        objectId: request.steps[0].objectId,
        objectType: request.steps[0].objectType,
        stepId: request.steps[0].stepId,
      }],
      reason: 'revision_mismatch' as const,
      schemaVersion: 1 as const,
      status: 'conflict' as const,
      tripId: request.tripId,
      workflowId: request.workflowId,
    }))

    await expect(importTripPlanRecords(records)).rejects.toMatchObject({ code: 'conflict' })

    await expect(db.trips.get(records.trip.id)).resolves.toBeUndefined()
    await expect(db.days.where('tripId').equals(records.trip.id).count()).resolves.toBe(0)
    await expect(db.itineraryItems.where('tripId').equals(records.trip.id).count()).resolves.toBe(0)
    await expect(db.ticketMetas.where('tripId').equals(records.trip.id).count()).resolves.toBe(0)
    await expect(db.ledgerExpenses.where('tripId').equals(records.trip.id).count()).resolves.toBe(0)
    await expect(db.accountObjectRevisions.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)
    await expect(db.accountWorkflowJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ optimisticResolution: 'rolled_back', status: 'conflict' }),
    ])
  })

  it('commits ledger initialization and later expense updates only through the registered workflow', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    mocks.commit.mockClear()
    mocks.workflowCommit.mockClear()

    const initialized = await initializeLedger({
      budget: { amountMinor: 100_000, currency: 'GBP', scope: 'trip', tripId: trip.id },
      participant: { displayName: 'Me', isSelf: true, source: 'manual', tripId: trip.id },
      settings: {
        homeCurrency: 'CNY',
        settlementCurrency: 'CNY',
        tripCurrency: 'GBP',
        tripId: trip.id,
      },
    })
    const expense = await createLedgerExpense({
      amountMinor: 2_500,
      category: 'food',
      currency: 'GBP',
      date: '2026-08-11',
      payerParticipantId: initialized.participant.id,
      source: { fingerprint: 'receipt_1', kind: 'manual' },
      splitMode: 'equal',
      splitShares: [{ participantId: initialized.participant.id, weight: 1 }],
      status: 'confirmed',
      title: 'Dinner',
      tripId: trip.id,
    })
    const updated = await updateLedgerExpense(expense.id, { title: 'Dinner updated' })

    expect(updated).toMatchObject({ title: 'Dinner updated' })
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.workflowCommit).toHaveBeenCalledTimes(3)
    const requests = mocks.workflowCommit.mock.calls.map(([request]) => request as AccountWorkflowRequestV1)
    expect(requests.map((request) => request.workflowId)).toEqual([
      'ledger.batch@1',
      'ledger.batch@1',
      'ledger.batch@1',
    ])
    expect(requests[0].steps.map((step) => step.objectType)).toEqual([
      'ledger_settings',
      'ledger_participant',
      'ledger_budget',
    ])
    expect(requests[0].steps.every((step) => step.expectedRevision === 0)).toBe(true)
    expect(requests[1].steps).toEqual([
      expect.objectContaining({ expectedRevision: 0, objectType: 'ledger_expense' }),
    ])
    expect(requests[2].steps).toEqual([
      expect.objectContaining({ expectedRevision: 1, objectType: 'ledger_expense' }),
    ])
    await expect(db.accountObjectRevisions.get(`ledger_expense:${expense.id}`)).resolves.toMatchObject({
      revision: 2,
    })
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)
  })

  it('rolls back an optimistic ledger batch when the server reports a conflict', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const initialized = await initializeLedger({
      budget: { amountMinor: 100_000, currency: 'GBP', scope: 'trip', tripId: trip.id },
      participant: { displayName: 'Me', isSelf: true, source: 'manual', tripId: trip.id },
      settings: {
        homeCurrency: 'CNY',
        settlementCurrency: 'CNY',
        tripCurrency: 'GBP',
        tripId: trip.id,
      },
    })
    mocks.workflowCommit.mockImplementationOnce(async (request: AccountWorkflowRequestV1) => ({
      batchMutationId: request.batchMutationId,
      conflicts: [{
        currentObject: null,
        currentRevision: 0,
        mutationId: request.steps[0].mutationId,
        objectId: request.steps[0].objectId,
        objectType: request.steps[0].objectType,
        stepId: request.steps[0].stepId,
      }],
      reason: 'revision_mismatch' as const,
      schemaVersion: 1 as const,
      status: 'conflict' as const,
      tripId: request.tripId,
      workflowId: request.workflowId,
    }))

    await expect(createLedgerExpense({
      amountMinor: 2_500,
      category: 'food',
      currency: 'GBP',
      date: '2026-08-11',
      payerParticipantId: initialized.participant.id,
      source: { kind: 'manual' },
      splitMode: 'equal',
      splitShares: [{ participantId: initialized.participant.id, weight: 1 }],
      status: 'confirmed',
      title: 'Dinner',
      tripId: trip.id,
    })).rejects.toMatchObject({ code: 'conflict' })

    await expect(db.ledgerExpenses.where('tripId').equals(trip.id).count()).resolves.toBe(0)
    await expect(db.accountWorkflowJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ optimisticResolution: 'rolled_back', status: 'conflict' }),
    ])
    await expect(db.syncOutbox.count()).resolves.toBe(0)
  })

  it('falls back before mutation when the parent trip has no V2 revision', async () => {
    const trip = await repo.createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'Legacy UK',
    })
    mocks.workflowCommit.mockClear()

    await initializeLedger({
      budget: { amountMinor: 100_000, currency: 'GBP', scope: 'trip', tripId: trip.id },
      participant: { displayName: 'Me', isSelf: true, source: 'manual', tripId: trip.id },
      settings: {
        homeCurrency: 'CNY',
        settlementCurrency: 'CNY',
        tripCurrency: 'GBP',
        tripId: trip.id,
      },
    })

    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    const outbox = await db.syncOutbox.toArray()
    expect(outbox.map((entry) => entry.objectType).sort()).toEqual([
      'ledger_budget',
      'ledger_participant',
      'ledger_settings',
    ])
  })

  it('falls back when any existing ledger dependency is still on the legacy path', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    await db.ledgerParticipants.put({
      createdAt: 1,
      displayName: 'Legacy companion',
      id: 'legacy_participant',
      source: 'manual',
      tripId: trip.id,
      updatedAt: 1,
    })
    const tripUpdatedAt = trip.updatedAt
    mocks.workflowCommit.mockClear()
    await db.syncOutbox.clear()

    const budget = await createLedgerBudget({
      amountMinor: 10_000,
      category: 'food',
      currency: 'GBP',
      scope: 'category',
      tripId: trip.id,
    })

    expect(budget).toMatchObject({ category: 'food' })
    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.syncOutbox.toArray()).resolves.toEqual([
      expect.objectContaining({ objectId: budget.id, objectType: 'ledger_budget' }),
    ])
    await expect(db.trips.get(trip.id)).resolves.toMatchObject({ updatedAt: tripUpdatedAt })
  })

  it('keeps idempotent recovery queued until the existing expense has a trusted V2 revision', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const input = {
      amountMinor: 1_200,
      category: 'food' as const,
      currency: 'GBP',
      date: '2026-08-11',
      source: { fingerprint: 'legacy_receipt', kind: 'manual' as const },
      splitMode: 'equal' as const,
      splitShares: [],
      status: 'confirmed' as const,
      title: 'Legacy dinner',
      tripId: trip.id,
    }
    await db.ledgerExpenses.put({
      ...input,
      createdAt: 1,
      id: 'legacy_expense',
      updatedAt: 1,
    })
    await db.syncOutbox.clear()

    const result = await createLedgerExpenseIdempotent(input)

    expect(result).toMatchObject({ created: false, record: { id: 'legacy_expense' } })
    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.syncOutbox.toArray()).resolves.toEqual([
      expect.objectContaining({ objectId: 'legacy_expense', objectType: 'ledger_expense' }),
    ])
  })

  it('coalesces concurrent idempotent expense creates onto one cloud object', async () => {
    const trip = await createTrip({
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      startDate: '2026-08-11',
      title: 'UK',
    })
    const input = {
      amountMinor: 1_200,
      category: 'food' as const,
      currency: 'GBP',
      date: '2026-08-11',
      source: { fingerprint: 'concurrent_receipt', kind: 'manual' as const },
      splitMode: 'equal' as const,
      splitShares: [],
      status: 'confirmed' as const,
      title: 'Concurrent dinner',
      tripId: trip.id,
    }

    const [first, second] = await Promise.all([
      createLedgerExpenseIdempotent(input),
      createLedgerExpenseIdempotent(input),
    ])

    expect(first.record.id).toBe(second.record.id)
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1)
    await expect(db.ledgerExpenses.where('tripId').equals(trip.id).count()).resolves.toBe(1)
    expect(mocks.workflowCommit).toHaveBeenCalledTimes(1)
    await expect(db.syncOutbox.count()).resolves.toBe(0)
  })

  it('keeps copied Ticket Blob imports entirely on the legacy lifecycle path', async () => {
    const records = makeTripImportRecords()
    records.ticketMetas[0] = { ...records.ticketMetas[0], storageMode: 'copy' }
    records.ticketBlobs = [{
      blob: new Blob(['ticket'], { type: 'application/pdf' }),
      ticketId: records.ticketMetas[0].id,
    }]

    await importTripPlanRecords(records)

    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.ticketBlobs.get(records.ticketMetas[0].id)).resolves.toBeDefined()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    expect(await db.syncOutbox.count()).toBeGreaterThan(0)
  })

  it('keeps imports larger than the registered atomic workflow on the legacy path', async () => {
    const records = makeTripImportRecords()
    records.days = Array.from({ length: 256 }, (_, index) => ({
      date: `2026-08-${String((index % 20) + 1).padStart(2, '0')}`,
      id: `day_import_${index}`,
      sortOrder: index,
      title: `Day ${index + 1}`,
      tripId: records.trip.id,
    }))
    records.itineraryItems = []
    records.ticketMetas = []
    records.ledgerSettings = []
    records.ledgerParticipants = []
    records.ledgerBudgets = []
    records.ledgerExpenses = []

    await importTripPlanRecords(records)

    expect(mocks.workflowCommit).not.toHaveBeenCalled()
    await expect(db.days.where('tripId').equals(records.trip.id).count()).resolves.toBe(256)
    expect(await db.syncOutbox.count()).toBeGreaterThan(0)
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

function makeTripImportRecords(): repo.ImportTripPlanRecordsInput {
  const tripId = 'trip_import'
  const now = 100
  return {
    days: [{
      date: '2026-08-11',
      id: 'day_import',
      sortOrder: 0,
      title: 'Arrival',
      tripId,
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'day_import',
      id: 'item_import',
      sortOrder: 0,
      ticketIds: ['ticket_import'],
      title: 'Edinburgh Castle',
      tripId,
      updatedAt: now,
    }],
    ledgerBudgets: [{
      amountMinor: 100_000,
      createdAt: now,
      currency: 'GBP',
      id: 'budget_import',
      scope: 'trip',
      tripId,
      updatedAt: now,
    }],
    ledgerExpenses: [{
      amountMinor: 2_500,
      category: 'admission',
      createdAt: now,
      currency: 'GBP',
      date: '2026-08-11',
      id: 'expense_import',
      itemIds: ['item_import'],
      payerParticipantId: 'participant_import',
      source: { kind: 'ticket', sourceId: 'ticket_import' },
      splitMode: 'equal',
      splitShares: [{ participantId: 'participant_import', weight: 1 }],
      status: 'confirmed',
      title: 'Admission',
      tripId,
      updatedAt: now,
    }],
    ledgerParticipants: [{
      createdAt: now,
      displayName: 'Owner',
      id: 'participant_import',
      isSelf: true,
      tripId,
      updatedAt: now,
    }],
    ledgerSettings: [{
      createdAt: now,
      homeCurrency: 'CNY',
      id: 'settings_import',
      settlementCurrency: 'CNY',
      tripCurrency: 'GBP',
      tripId,
      updatedAt: now,
    }],
    ticketBlobs: [],
    ticketMetas: [{
      createdAt: now,
      fileName: 'private-ticket.pdf',
      fileType: 'pdf',
      id: 'ticket_import',
      itemId: 'item_import',
      mimeType: 'application/pdf',
      note: 'private note',
      referenceLocation: '/private/ticket.pdf',
      scope: 'item',
      size: 2_048,
      storageMode: 'reference',
      structuredFields: { schemaVersion: 1, status: 'ready' },
      ticketCategory: 'admission_ticket',
      title: 'Castle admission',
      tripId,
      updatedAt: now,
    }],
    trip: {
      createdAt: now,
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      id: tripId,
      startDate: '2026-08-11',
      title: 'UK',
      updatedAt: now,
    },
  }
}

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
