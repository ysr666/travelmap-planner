import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import type {
  Day,
  ItineraryItem,
  TicketMeta,
  Trip,
  TripDisruptionEvent,
  TripIntelligenceAppliedChangeRecord,
  TripReplanRecord,
} from '../../types'
import {
  activateAccountDatabase,
  activateLegacyDatabaseForTests,
} from '../accountDatabase'
import { AccountCloudTransportError } from './client'
import type {
  AccountObjectRowV1,
  ClientMutableAccountObjectType,
  JsonObject,
} from './contract'
import type { AccountWorkflowRequestV1 } from './workflowContract'
import { redactTicketMetaForAccountCloud } from './mutationBuilder'
import {
  AccountCloudWorkflowWriteError,
  executeProductAccountWorkflow,
  type ProductAccountWorkflowStep,
} from './workflowMutationRuntime'

const mocks = vi.hoisted(() => ({ commit: vi.fn() }))

vi.mock('./feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feature')>()
  return {
    ...actual,
    isAccountCloudV2AccountEnabled: (accountHash: string | null) => Boolean(accountHash),
  }
})

vi.mock('./workflowClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workflowClient')>()
  return {
    ...actual,
    commitAccountWorkflowV1: mocks.commit,
  }
})

const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const NOW_ISO = '2026-08-11T12:00:00.000Z'
const PRIMARY_ACCOUNT = 'workflow-product-runtime'
let databaseName = ''
let secondaryDatabaseName = ''

beforeEach(async () => {
  const account = await activateAccountDatabase(PRIMARY_ACCOUNT)
  databaseName = account.databaseName
  secondaryDatabaseName = ''
  await db.delete()
  await db.open()
  mocks.commit.mockReset()
  mocks.commit.mockImplementation(async (request: AccountWorkflowRequestV1) => makeSuccess(request))
})

afterEach(async () => {
  activateLegacyDatabaseForTests()
  await Dexie.delete(databaseName)
  if (secondaryDatabaseName) await Dexie.delete(secondaryDatabaseName)
})

describe('product account workflow runtime', () => {
  it('commits one registered batch and persists every revision receipt', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await seedBootstrappedItems(before)
    const after = [
      { ...before[1], sortOrder: 1, updatedAt: 2 },
      { ...before[0], sortOrder: 2, updatedAt: 2 },
    ]

    const result = await executeProductAccountWorkflow({
      apply: async () => {
        await db.itineraryItems.bulkPut(after)
        return after
      },
      steps: after.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    })

    expect(result).toEqual({ handled: true, value: after })
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.commit.mock.calls[0]?.[0]).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({ expectedRevision: 1, objectId: 'item_a' }),
        expect.objectContaining({ expectedRevision: 1, objectId: 'item_b' }),
      ]),
      workflowId: 'day.items.reorder@1',
    })
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    await expect(db.accountObjectRevisions.bulkGet(['item:item_a', 'item:item_b']))
      .resolves.toEqual([
        expect.objectContaining({ revision: 2 }),
        expect.objectContaining({ revision: 2 }),
      ])
  })

  it('falls back before apply when any existing object is not bootstrapped', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await db.itineraryItems.bulkPut(before)
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: before.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    })).resolves.toEqual({ handled: false })

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('fails closed instead of falling back across pending single-object work', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await seedBootstrappedItems(before)
    await db.accountMutationJournal.put({
      accountHash: '00000000000000000000000000000000',
      attempts: 0,
      createdAt: 1,
      deviceId: 'device_primary',
      expectedRevision: 1,
      mutationId: '33333333-3333-4333-8333-333333333333',
      objectId: 'item_a',
      objectKey: 'item:item_a',
      objectSchemaVersion: 1,
      objectType: 'item',
      operation: 'upsert',
      payload: before[0],
      requestFingerprint: 'pending',
      status: 'pending',
      tripId: 'trip_uk',
      updatedAt: 1,
    })
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: before.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))
    expect(apply).not.toHaveBeenCalled()
  })

  it('checks every object for pending work before choosing legacy fallback', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await db.itineraryItems.put(before[0])
    await seedBootstrappedItems([before[1]])
    await db.accountMutationJournal.put({
      accountHash: '00000000000000000000000000000000',
      attempts: 0,
      createdAt: 1,
      deviceId: 'device_primary',
      expectedRevision: 1,
      mutationId: '33333333-3333-4333-8333-333333333333',
      objectId: 'item_b',
      objectKey: 'item:item_b',
      objectSchemaVersion: 1,
      objectType: 'item',
      operation: 'upsert',
      payload: before[1],
      requestFingerprint: 'pending',
      status: 'pending',
      tripId: 'trip_uk',
      updatedAt: 1,
    })
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: before.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('rejects unregistered workflow input and unknown or sensitive fields before apply', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await seedBootstrappedItems(before)
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: before.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'arbitrary.function@1',
    } as never)).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))

    await expect(executeProductAccountWorkflow({
      apply,
      steps: before.map((item, index) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: index === 0 ? { ...item, providerKey: 'forbidden' } : item,
        ...(index === 1 ? { functionName: 'arbitrary' } : {}),
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    } as never)).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('rejects stale ledger timestamps and tombstone restoration before optimistic apply', async () => {
    const participant = {
      createdAt: 1,
      displayName: 'Traveler',
      id: 'participant_a',
      source: 'manual' as const,
      tripId: 'trip_uk',
      updatedAt: 1,
    }
    await db.ledgerParticipants.put(participant)
    await db.accountObjectRevisions.put(makeLedgerParticipantRevision(participant))
    const staleApply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply: staleApply,
      steps: [{
        objectId: participant.id,
        objectType: 'ledger_participant',
        operation: 'upsert',
        payload: { ...participant, displayName: 'Changed' },
      }],
      tripId: participant.tripId,
      workflowId: 'ledger.batch@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))
    expect(staleApply).not.toHaveBeenCalled()

    await db.ledgerParticipants.delete(participant.id)
    await db.accountObjectRevisions.put({
      ...makeLedgerParticipantRevision(participant),
      deletedAt: NOW_ISO,
      payload: null,
      revision: 2,
      tombstone: true,
    })
    const restoreApply = vi.fn()
    await expect(executeProductAccountWorkflow({
      apply: restoreApply,
      steps: [{
        objectId: participant.id,
        objectType: 'ledger_participant',
        operation: 'upsert',
        payload: { ...participant, updatedAt: 2 },
      }],
      tripId: participant.tripId,
      workflowId: 'ledger.batch@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))
    expect(restoreApply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('checks ledger dependencies for pending work before choosing legacy fallback', async () => {
    const trip = {
      createdAt: 1,
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      id: 'trip_uk',
      startDate: '2026-08-11',
      title: 'UK',
      updatedAt: 1,
    }
    const participant = {
      createdAt: 1,
      displayName: 'Traveler',
      id: 'participant_a',
      source: 'manual' as const,
      tripId: trip.id,
      updatedAt: 1,
    }
    const budget = {
      amountMinor: 10_000,
      createdAt: 1,
      currency: 'GBP',
      id: 'budget_a',
      scope: 'trip' as const,
      tripId: trip.id,
      updatedAt: 1,
    }
    await db.trips.put(trip)
    await db.ledgerParticipants.put(participant)
    await db.ledgerBudgets.put(budget)
    await db.accountObjectRevisions.bulkPut([
      makeRevision('trip', trip.id, trip.id, trip),
      makeLedgerParticipantRevision(participant),
    ])
    await db.accountMutationJournal.put({
      accountHash: '00000000000000000000000000000000',
      attempts: 0,
      createdAt: 1,
      deviceId: 'device_primary',
      expectedRevision: 1,
      mutationId: '66666666-6666-4666-8666-666666666666',
      objectId: participant.id,
      objectKey: `ledger_participant:${participant.id}`,
      objectSchemaVersion: 1,
      objectType: 'ledger_participant',
      operation: 'upsert',
      payload: participant,
      requestFingerprint: 'pending',
      status: 'pending',
      tripId: trip.id,
      updatedAt: 1,
    })
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: [{
        objectId: budget.id,
        objectType: 'ledger_budget',
        operation: 'upsert',
        payload: { ...budget, amountMinor: 12_000, updatedAt: 2 },
      }],
      tripId: trip.id,
      workflowId: 'ledger.batch@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('keeps historical graph violations on the legacy path without allowing new violations', async () => {
    const trip = {
      createdAt: 1,
      destination: 'United Kingdom',
      endDate: '2026-08-20',
      id: 'trip_uk',
      startDate: '2026-08-11',
      title: 'UK',
      updatedAt: 1,
    }
    const historicalExpense = {
      category: 'food' as const,
      createdAt: 1,
      date: '2026-08-11',
      id: 'expense_historical',
      itemIds: ['deleted_item'],
      source: { kind: 'manual' as const },
      splitMode: 'equal' as const,
      splitShares: [],
      status: 'confirmed' as const,
      title: 'Historical expense',
      tripId: trip.id,
      updatedAt: 1,
    }
    await db.trips.put(trip)
    await db.ledgerExpenses.put(historicalExpense)
    await db.accountObjectRevisions.bulkPut([
      makeRevision('trip', trip.id, trip.id, trip),
      makeRevision('ledger_expense', historicalExpense.id, trip.id, historicalExpense),
    ])
    const legacyApply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply: legacyApply,
      steps: [{
        objectId: 'budget_new',
        objectType: 'ledger_budget',
        operation: 'upsert',
        payload: {
          amountMinor: 10_000,
          createdAt: 2,
          currency: 'GBP',
          id: 'budget_new',
          scope: 'trip',
          tripId: trip.id,
          updatedAt: 2,
        },
      }],
      tripId: trip.id,
      workflowId: 'ledger.batch@1',
    })).resolves.toEqual({ handled: false })
    expect(legacyApply).not.toHaveBeenCalled()

    await db.ledgerExpenses.clear()
    await db.accountObjectRevisions.delete(`ledger_expense:${historicalExpense.id}`)
    const invalidApply = vi.fn()
    await expect(executeProductAccountWorkflow({
      apply: invalidApply,
      steps: [{
        objectId: 'expense_new',
        objectType: 'ledger_expense',
        operation: 'upsert',
        payload: { ...historicalExpense, id: 'expense_new' },
      }],
      tripId: trip.id,
      workflowId: 'ledger.batch@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))
    expect(invalidApply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('rejects a new-trip import when any unsubmitted local object already uses the trip scope', async () => {
    await db.tripIntelligenceSuggestionStates.put({
      createdAt: 1,
      id: 'suggestion_orphan',
      status: 'later',
      suggestionKey: 'suggestion_orphan',
      tripId: 'trip_import',
      updatedAt: 1,
    })
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: [{
        objectId: 'trip_import',
        objectType: 'trip',
        operation: 'upsert',
        payload: {
          createdAt: 1,
          destination: 'United Kingdom',
          endDate: '2026-08-20',
          id: 'trip_import',
          startDate: '2026-08-11',
          title: 'UK',
          updatedAt: 1,
        },
      }],
      tripId: 'trip_import',
      workflowId: 'trip.import.commit@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('rejects a Ticket workflow that omits any current reverse-linked Item', async () => {
    const ticket = makeTicket('item_a')
    const first = { ...makeItem('item_a', 1), ticketIds: [ticket.id] }
    const second = makeItem('item_b', 2)
    await seedBootstrappedItems([first, second])
    await seedBootstrappedTicket(ticket)
    const afterTicket = { ...ticket, itemId: second.id, updatedAt: 2 }
    const afterSecond = { ...second, ticketIds: [ticket.id], updatedAt: 2 }
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: [
        {
          objectId: ticket.id,
          objectType: 'ticket_meta',
          operation: 'upsert',
          payload: redactTicketMetaForAccountCloud(afterTicket),
        },
        {
          objectId: second.id,
          objectType: 'item',
          operation: 'upsert',
          payload: afterSecond,
        },
      ],
      tripId: 'trip_uk',
      workflowId: 'ticket.bind@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('rejects Ticket workflows that mutate unrelated Item fields or relationships', async () => {
    const ticket = makeTicket('item_a')
    const first = { ...makeItem('item_a', 1), ticketIds: [ticket.id] }
    const second = makeItem('item_b', 2)
    await seedBootstrappedItems([first, second])
    await seedBootstrappedTicket(ticket)
    const afterTicket = { ...ticket, itemId: second.id, updatedAt: 2 }

    for (const afterSecond of [
      { ...second, ticketIds: [ticket.id], title: 'Changed through binding', updatedAt: 2 },
      { ...second, ticketIds: [ticket.id, 'ticket_other'], updatedAt: 2 },
    ]) {
      await expect(executeProductAccountWorkflow({
        apply: vi.fn(),
        steps: [
          {
            objectId: ticket.id,
            objectType: 'ticket_meta',
            operation: 'upsert',
            payload: redactTicketMetaForAccountCloud(afterTicket),
          },
          {
            objectId: first.id,
            objectType: 'item',
            operation: 'upsert',
            payload: { ...first, ticketIds: [], updatedAt: 2 },
          },
          {
            objectId: second.id,
            objectType: 'item',
            operation: 'upsert',
            payload: afterSecond,
          },
        ],
        tripId: 'trip_uk',
        workflowId: 'ticket.bind@1',
      })).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))
    }

    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('allows one existing unbound Ticket step while still transacting over Item relationships', async () => {
    const ticket = makeTicket()
    await seedBootstrappedTicket(ticket)
    const afterTicket = { ...ticket, title: 'Updated', updatedAt: 2 }

    const result = await executeProductAccountWorkflow({
      apply: async () => {
        await db.ticketMetas.put(afterTicket)
        return afterTicket
      },
      steps: [{
        objectId: ticket.id,
        objectType: 'ticket_meta',
        operation: 'upsert',
        payload: redactTicketMetaForAccountCloud(afterTicket),
      }],
      tripId: 'trip_uk',
      workflowId: 'ticket.bind@1',
    })

    expect(result).toEqual({ handled: true, value: afterTicket })
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('rolls back Ticket cloud metadata and relationships without erasing local-only fields', async () => {
    const ticket = makeTicket('item_a')
    const first = { ...makeItem('item_a', 1), ticketIds: [ticket.id] }
    const second = makeItem('item_b', 2)
    await seedBootstrappedItems([first, second])
    await seedBootstrappedTicket(ticket)
    const afterTicket = {
      ...ticket,
      itemId: second.id,
      note: 'edited local note',
      title: 'Updated admission',
      updatedAt: 2,
    }
    const afterFirst = { ...first, ticketIds: [], updatedAt: 2 }
    const afterSecond = { ...second, ticketIds: [ticket.id], updatedAt: 2 }
    mocks.commit.mockImplementationOnce(async (request: AccountWorkflowRequestV1) => ({
      batchMutationId: request.batchMutationId,
      conflicts: [{
        currentObject: makeRow(request.steps[0], request.tripId, 2),
        currentRevision: 2,
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

    await expect(executeProductAccountWorkflow({
      apply: async () => {
        await db.ticketMetas.put(afterTicket)
        await db.itineraryItems.bulkPut([afterFirst, afterSecond])
        return afterTicket
      },
      steps: [
        {
          objectId: ticket.id,
          objectType: 'ticket_meta',
          operation: 'upsert',
          payload: redactTicketMetaForAccountCloud(afterTicket),
        },
        {
          objectId: first.id,
          objectType: 'item',
          operation: 'upsert',
          payload: afterFirst,
        },
        {
          objectId: second.id,
          objectType: 'item',
          operation: 'upsert',
          payload: afterSecond,
        },
      ],
      tripId: 'trip_uk',
      workflowId: 'ticket.bind@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    await expect(db.ticketMetas.get(ticket.id)).resolves.toMatchObject({
      itemId: ticket.itemId,
      note: 'edited local note',
      title: ticket.title,
      updatedAt: ticket.updatedAt,
    })
    await expect(db.itineraryItems.bulkGet([first.id, second.id])).resolves.toEqual([first, second])
    await expect(db.accountWorkflowJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ optimisticResolution: 'rolled_back', status: 'conflict' }),
    ])
  })

  it('rolls back the complete local graph on a server conflict', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await seedBootstrappedItems(before)
    const after = [
      { ...before[1], sortOrder: 1, updatedAt: 2 },
      { ...before[0], sortOrder: 2, updatedAt: 2 },
    ]
    mocks.commit.mockImplementationOnce(async (request: AccountWorkflowRequestV1) => ({
      batchMutationId: request.batchMutationId,
      conflicts: [{
        currentObject: makeRow(request.steps[0], request.tripId, 2),
        currentRevision: 2,
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

    await expect(executeProductAccountWorkflow({
      apply: async () => {
        await db.itineraryItems.bulkPut(after)
        return after
      },
      steps: after.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    await expect(db.itineraryItems.bulkGet(['item_a', 'item_b'])).resolves.toEqual(before)
    await expect(db.accountWorkflowJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ optimisticResolution: 'rolled_back', status: 'conflict' }),
    ])
  })

  it('keeps one exact retry batch after an uncertain network failure', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await seedBootstrappedItems(before)
    mocks.commit.mockRejectedValueOnce(new AccountCloudTransportError('request_failed', true))

    await expect(executeProductAccountWorkflow({
      apply: async () => before,
      steps: before.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    })).resolves.toEqual({ handled: true, value: before })

    await expect(db.accountWorkflowJournal.toArray()).resolves.toEqual([
      expect.objectContaining({
        attempts: 1,
        lastErrorCode: 'request_failed',
        status: 'retry',
      }),
    ])
  })

  it('commits a fully bootstrapped adaptive replan and advances only submitted revisions', async () => {
    const fixture = makeAdaptiveRuntimeFixture()
    await seedAdaptiveRuntimeFixture(fixture)
    const apply = vi.fn(async () => {
      await db.trips.put(fixture.afterTrip)
      await db.itineraryItems.put(fixture.afterItem)
      await db.tripReplanEvents.put(fixture.event)
      await db.tripReplanRecords.put(fixture.record)
      await db.tripIntelligenceAppliedChanges.put(fixture.history)
      return 'applied'
    })

    await expect(executeProductAccountWorkflow({
      apply,
      steps: fixture.steps,
      tripId: fixture.trip.id,
      workflowId: 'trip.replan.apply@1',
    })).resolves.toEqual({ handled: true, value: 'applied' })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.commit.mock.calls[0]?.[0]).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({ expectedRevision: 1, objectId: fixture.trip.id }),
        expect.objectContaining({ expectedRevision: 1, objectId: fixture.item.id }),
      ]),
      workflowId: 'trip.replan.apply@1',
    })
    await expect(db.accountObjectRevisions.bulkGet([
      `trip:${fixture.trip.id}`,
      `day:${fixture.day.id}`,
      `item:${fixture.item.id}`,
    ])).resolves.toEqual([
      expect.objectContaining({ revision: 2 }),
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({ revision: 2 }),
    ])
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('rolls back the complete adaptive local graph on a terminal server conflict', async () => {
    const fixture = makeAdaptiveRuntimeFixture()
    await seedAdaptiveRuntimeFixture(fixture)
    mocks.commit.mockImplementationOnce(async (request: AccountWorkflowRequestV1) => ({
      batchMutationId: request.batchMutationId,
      conflicts: [{
        currentObject: makeRow(request.steps[0], request.tripId, 2),
        currentRevision: 2,
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

    await expect(executeProductAccountWorkflow({
      apply: async () => {
        await db.trips.put(fixture.afterTrip)
        await db.itineraryItems.put(fixture.afterItem)
        await db.tripReplanEvents.put(fixture.event)
        await db.tripReplanRecords.put(fixture.record)
        await db.tripIntelligenceAppliedChanges.put(fixture.history)
        return 'applied'
      },
      steps: fixture.steps,
      tripId: fixture.trip.id,
      workflowId: 'trip.replan.apply@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    await expect(db.trips.get(fixture.trip.id)).resolves.toEqual(fixture.trip)
    await expect(db.itineraryItems.get(fixture.item.id)).resolves.toEqual(fixture.item)
    await expect(db.tripReplanEvents.get(fixture.event.id)).resolves.toBeUndefined()
    await expect(db.tripReplanRecords.get(fixture.record.id)).resolves.toBeUndefined()
    await expect(db.tripIntelligenceAppliedChanges.get(fixture.history.id)).resolves.toBeUndefined()
    await expect(db.accountWorkflowJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ optimisticResolution: 'rolled_back', status: 'conflict' }),
    ])
  })

  it('falls back before apply when an unsubmitted adaptive dependency is not bootstrapped', async () => {
    const fixture = makeAdaptiveRuntimeFixture({ dayExpectedRevision: 0 })
    await seedAdaptiveRuntimeFixture(fixture, { omitDayRevision: true })
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: fixture.steps,
      tripId: fixture.trip.id,
      workflowId: 'trip.replan.apply@1',
    })).resolves.toEqual({ handled: false })

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('fails closed when an adaptive dependency has pending single-object work', async () => {
    const fixture = makeAdaptiveRuntimeFixture()
    await seedAdaptiveRuntimeFixture(fixture)
    await db.accountMutationJournal.put({
      accountHash: '00000000000000000000000000000000',
      attempts: 0,
      createdAt: 1,
      deviceId: 'device_primary',
      expectedRevision: 1,
      mutationId: '35555555-5555-4555-8555-555555555555',
      objectId: fixture.day.id,
      objectKey: `day:${fixture.day.id}`,
      objectSchemaVersion: 1,
      objectType: 'day',
      operation: 'upsert',
      payload: fixture.day,
      requestFingerprint: 'pending-replan-day',
      status: 'pending',
      tripId: fixture.trip.id,
      updatedAt: 1,
    })
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: fixture.steps,
      tripId: fixture.trip.id,
      workflowId: 'trip.replan.apply@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('checks pending adaptive dependencies before falling back for an unbootstrapped submitted object', async () => {
    const fixture = makeAdaptiveRuntimeFixture({ tripExpectedRevision: 0 })
    await seedAdaptiveRuntimeFixture(fixture, { omitTripRevision: true })
    await db.accountMutationJournal.put({
      accountHash: '00000000000000000000000000000000',
      attempts: 0,
      createdAt: 1,
      deviceId: 'device_primary',
      expectedRevision: 1,
      mutationId: '37777777-7777-4777-8777-777777777777',
      objectId: fixture.day.id,
      objectKey: `day:${fixture.day.id}`,
      objectSchemaVersion: 1,
      objectType: 'day',
      operation: 'upsert',
      payload: fixture.day,
      requestFingerprint: 'pending-before-fallback',
      status: 'pending',
      tripId: fixture.trip.id,
      updatedAt: 1,
    })
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: fixture.steps,
      tripId: fixture.trip.id,
      workflowId: 'trip.replan.apply@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('fails closed when an adaptive baseline revision is stale', async () => {
    const fixture = makeAdaptiveRuntimeFixture({ dayExpectedRevision: 2 })
    await seedAdaptiveRuntimeFixture(fixture)
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: fixture.steps,
      tripId: fixture.trip.id,
      workflowId: 'trip.replan.apply@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('conflict'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('rejects unknown adaptive baseline fields before creating a workflow journal', async () => {
    const fixture = makeAdaptiveRuntimeFixture({ baselineExtraField: true })
    await seedAdaptiveRuntimeFixture(fixture)
    const apply = vi.fn()

    await expect(executeProductAccountWorkflow({
      apply,
      steps: fixture.steps,
      tripId: fixture.trip.id,
      workflowId: 'trip.replan.apply@1',
    })).rejects.toEqual(new AccountCloudWorkflowWriteError('invalid_state'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('never acknowledges a primary workflow into a newly active account database', async () => {
    const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
    await seedBootstrappedItems(before)
    const after = [
      { ...before[1], sortOrder: 1, updatedAt: 2 },
      { ...before[0], sortOrder: 2, updatedAt: 2 },
    ]
    mocks.commit.mockImplementationOnce(async (request: AccountWorkflowRequestV1) => {
      const secondary = await activateAccountDatabase('workflow-product-secondary')
      secondaryDatabaseName = secondary.databaseName
      await db.open()
      await db.itineraryItems.put({ ...before[0], title: 'Secondary account item' })
      return makeSuccess(request)
    })

    await expect(executeProductAccountWorkflow({
      apply: async () => {
        await db.itineraryItems.bulkPut(after)
        return after
      },
      steps: after.map((item) => ({
        objectId: item.id,
        objectType: 'item' as const,
        operation: 'upsert' as const,
        payload: item,
      })),
      tripId: 'trip_uk',
      workflowId: 'day.items.reorder@1',
    })).resolves.toEqual({ handled: true, value: after })

    await expect(db.itineraryItems.get('item_a')).resolves.toMatchObject({
      title: 'Secondary account item',
    })
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)

    await activateAccountDatabase(PRIMARY_ACCOUNT)
    await db.open()
    await expect(db.itineraryItems.bulkGet(['item_a', 'item_b'])).resolves.toEqual([
      after[1],
      after[0],
    ])
    await expect(db.accountWorkflowJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ status: 'inflight' }),
    ])
  })
})

async function seedBootstrappedItems(items: ItineraryItem[]) {
  await db.itineraryItems.bulkPut(items)
  await db.accountObjectRevisions.bulkPut(items.map((item, index) => ({
    acknowledgedAt: 1,
    actorId: ACTOR_ID,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: `${index + 1}1111111-1111-4111-8111-111111111111`.slice(0, 36),
    objectId: item.id,
    objectKey: `item:${item.id}`,
    objectSchemaVersion: 1,
    objectType: 'item' as const,
    payload: item,
    revision: 1,
    serverCreatedAt: NOW_ISO,
    serverUpdatedAt: NOW_ISO,
    tombstone: false,
    tripId: item.tripId,
    updatedAt: 1,
  })))
}

async function seedBootstrappedTicket(ticket: TicketMeta) {
  const payload = JSON.parse(JSON.stringify(redactTicketMetaForAccountCloud(ticket)))
  await db.ticketMetas.put(ticket)
  await db.accountObjectRevisions.put({
    acknowledgedAt: 1,
    actorId: ACTOR_ID,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: '44444444-4444-4444-8444-444444444444',
    objectId: ticket.id,
    objectKey: `ticket_meta:${ticket.id}`,
    objectSchemaVersion: 1,
    objectType: 'ticket_meta',
    payload,
    revision: 1,
    serverCreatedAt: NOW_ISO,
    serverUpdatedAt: NOW_ISO,
    tombstone: false,
    tripId: ticket.tripId,
    updatedAt: 1,
  })
}

function makeAdaptiveRuntimeFixture(options: {
  baselineExtraField?: boolean
  dayExpectedRevision?: number
  tripExpectedRevision?: number
} = {}) {
  const trip: Trip = {
    createdAt: 1,
    destination: 'United Kingdom',
    endDate: '2026-08-20',
    id: 'replan_trip',
    startDate: '2026-08-11',
    title: 'UK',
    updatedAt: 1,
  }
  const day: Day = {
    date: '2026-08-11',
    id: 'replan_day',
    sortOrder: 1,
    title: 'London',
    tripId: trip.id,
  }
  const item: ItineraryItem = {
    createdAt: 1,
    dayId: day.id,
    endTime: '11:00',
    id: 'replan_item',
    sortOrder: 1,
    startTime: '10:00',
    ticketIds: [],
    title: 'Museum',
    tripId: trip.id,
    updatedAt: 1,
  }
  const afterTrip = { ...trip, updatedAt: 2 }
  const afterItem = { ...item, endTime: '11:30', startTime: '10:30', updatedAt: 2 }
  const event: TripDisruptionEvent = {
    createdAt: 2,
    dayId: day.id,
    delayMinutes: 30,
    evidence: [],
    id: 'replan_event',
    itemId: item.id,
    kind: 'late',
    notes: 'Arrival delay',
    occurredAt: '2026-08-11T12:00:00.000Z',
    reportedByRole: 'owner',
    status: 'applied',
    tripId: trip.id,
    updatedAt: 2,
  }
  const beforeSchedule = {
    dayId: day.id,
    endTime: item.endTime,
    sortOrder: item.sortOrder,
    startTime: item.startTime,
  }
  const afterSchedule = {
    dayId: day.id,
    endTime: afterItem.endTime,
    sortOrder: afterItem.sortOrder,
    startTime: afterItem.startTime,
  }
  const diff = {
    companionImpacts: [],
    itemChanges: [{
      after: afterSchedule,
      before: beforeSchedule,
      changeType: 'time_changed' as const,
      itemId: item.id,
      reason: 'Arrival delay',
      title: item.title,
    }],
    ledgerImpacts: [],
    routeImpacts: [],
    ticketImpacts: [],
    warnings: [],
  }
  const option = (strategy: 'least_change' | 'preserve_most' | 'shortest_route') => ({
    diff,
    id: `replan_${strategy}`,
    itemPatches: [{ itemId: item.id, patch: { endTime: '11:30', startTime: '10:30' } }],
    score: 100,
    strategy,
    summary: 'Shifted one stop',
    title: strategy,
  })
  const selected = option('least_change')
  const firstBaseline = {
    expectedRevision: options.tripExpectedRevision ?? 1,
    objectId: trip.id,
    objectType: 'trip' as const,
    ...(options.baselineExtraField ? { arbitraryFunction: 'database.run' } : {}),
  }
  const record: TripReplanRecord = {
    accountObjectBaseline: [
      firstBaseline,
      {
        expectedRevision: options.dayExpectedRevision ?? 1,
        objectId: day.id,
        objectType: 'day',
      },
      { expectedRevision: 1, objectId: item.id, objectType: 'item' },
    ] as TripReplanRecord['accountObjectBaseline'],
    afterSnapshot: { days: [day], items: [afterItem] },
    appliedFingerprint: 'applied-fingerprint',
    baselineFingerprint: 'baseline-fingerprint',
    beforeSnapshot: { days: [day], items: [item] },
    createdAt: 2,
    eventId: event.id,
    evidence: [{
      id: 'user-report:replan_event',
      kind: 'user_report',
      label: '用户报告',
      retrievedAt: event.occurredAt,
      snippet: 'Arrival delay',
      sourceType: 'unknown',
    }],
    id: 'replan_record',
    operationFingerprint: 'ai-action-replan',
    operationKind: 'adaptive_replan',
    options: [selected, option('preserve_most'), option('shortest_route')],
    scopeItemIds: [item.id],
    selectedDiff: diff,
    selectedOptionId: selected.id,
    status: 'applied',
    tripId: trip.id,
    updatedAt: 2,
  }
  const history: TripIntelligenceAppliedChangeRecord = {
    actionType: 'global_ai_adaptive_replan_applied',
    dedupeKey: `${trip.id}:change`,
    detail: 'Shifted one stop',
    executionId: 'trip-operations-2-',
    executionSource: 'live',
    executionStatus: 'success',
    executionTitle: 'Adaptive replan',
    id: 'replan_history',
    occurredAt: 2,
    privacyLevel: 'private',
    recommendationFingerprints: [],
    sourceId: record.id,
    sourceKind: 'live',
    sourceLabel: 'Adaptive replan',
    targetId: item.id,
    targetType: 'live',
    title: 'Replan applied',
    tripId: trip.id,
    updatedAt: 2,
  }
  const steps: ProductAccountWorkflowStep[] = [
    { objectId: trip.id, objectType: 'trip', operation: 'upsert', payload: afterTrip },
    { objectId: item.id, objectType: 'item', operation: 'upsert', payload: afterItem },
    { objectId: event.id, objectType: 'replan_event', operation: 'upsert', payload: event },
    { objectId: record.id, objectType: 'replan_record', operation: 'upsert', payload: record },
    {
      objectId: history.id,
      objectType: 'trip_intelligence_applied_change',
      operation: 'upsert',
      payload: history,
    },
  ]
  return { afterItem, afterTrip, day, event, history, item, record, steps, trip }
}

async function seedAdaptiveRuntimeFixture(
  fixture: ReturnType<typeof makeAdaptiveRuntimeFixture>,
  options: { omitDayRevision?: boolean; omitTripRevision?: boolean } = {},
) {
  await db.trips.put(fixture.trip)
  await db.days.put(fixture.day)
  await db.itineraryItems.put(fixture.item)
  const objects: Array<{
    object: Trip | Day | ItineraryItem
    objectType: ClientMutableAccountObjectType
  }> = [
    ...(options.omitTripRevision
      ? []
      : [{ object: fixture.trip, objectType: 'trip' as const }]),
    { object: fixture.item, objectType: 'item' },
    ...(options.omitDayRevision ? [] : [{ object: fixture.day, objectType: 'day' as const }]),
  ]
  await db.accountObjectRevisions.bulkPut(objects.map(({ object, objectType }, index) => ({
    acknowledgedAt: 1,
    actorId: ACTOR_ID,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: `36666666-6666-4666-8666-${index.toString().padStart(12, '0')}`,
    objectId: object.id,
    objectKey: `${objectType}:${object.id}`,
    objectSchemaVersion: 1,
    objectType,
    payload: object as unknown as JsonObject,
    revision: 1,
    serverCreatedAt: NOW_ISO,
    serverUpdatedAt: NOW_ISO,
    tombstone: false,
    tripId: fixture.trip.id,
    updatedAt: 1,
  })))
}

function makeItem(id: string, sortOrder: number): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day_a',
    id,
    sortOrder,
    ticketIds: [],
    title: id,
    tripId: 'trip_uk',
    updatedAt: 1,
  }
}

function makeLedgerParticipantRevision(participant: {
  createdAt: number
  displayName: string
  id: string
  source: 'manual'
  tripId: string
  updatedAt: number
}) {
  return {
    acknowledgedAt: 1,
    actorId: ACTOR_ID,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: '55555555-5555-4555-8555-555555555555',
    objectId: participant.id,
    objectKey: `ledger_participant:${participant.id}`,
    objectSchemaVersion: 1,
    objectType: 'ledger_participant' as const,
    payload: participant,
    revision: 1,
    serverCreatedAt: NOW_ISO,
    serverUpdatedAt: NOW_ISO,
    tombstone: false,
    tripId: participant.tripId,
    updatedAt: 1,
  }
}

function makeRevision(
  objectType: 'ledger_expense' | 'trip',
  objectId: string,
  tripId: string,
  payload: JsonObject,
) {
  return {
    acknowledgedAt: 1,
    actorId: ACTOR_ID,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: '77777777-7777-4777-8777-777777777777',
    objectId,
    objectKey: `${objectType}:${objectId}`,
    objectSchemaVersion: 1,
    objectType,
    payload,
    revision: 1,
    serverCreatedAt: NOW_ISO,
    serverUpdatedAt: NOW_ISO,
    tombstone: false,
    tripId,
    updatedAt: 1,
  }
}

function makeTicket(itemId?: string): TicketMeta {
  return {
    createdAt: 1,
    fileName: 'private.pdf',
    fileType: 'pdf',
    id: 'ticket_a',
    itemId,
    mimeType: 'application/pdf',
    note: 'private note',
    scope: itemId ? 'item' : 'unassigned',
    size: 100,
    storageMode: 'copy',
    title: 'Admission',
    tripId: 'trip_uk',
    updatedAt: 1,
  }
}

function makeSuccess(request: AccountWorkflowRequestV1) {
  return {
    batchMutationId: request.batchMutationId,
    schemaVersion: 1 as const,
    status: 'applied' as const,
    steps: request.steps.map((step) => ({
      appliedRevision: step.expectedRevision + 1,
      currentRevision: step.expectedRevision + 1,
      mutationId: step.mutationId,
      object: makeRow(step, request.tripId, step.expectedRevision + 1),
      stepId: step.stepId,
    })),
    tripId: request.tripId,
    workflowId: request.workflowId,
  }
}

function makeRow(
  step: AccountWorkflowRequestV1['steps'][number],
  tripId: string,
  revision: number,
): AccountObjectRowV1 {
  return {
    actorId: ACTOR_ID,
    createdAt: NOW_ISO,
    deletedAt: null,
    deviceId: 'device_primary',
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
