import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  db,
  getActiveTravelDatabase,
  TravelConsoleDatabase,
  setActiveTravelDatabase,
} from '../../db/database'
import type { ItineraryItem, LedgerExpense } from '../../types'
import {
  activateLegacyDatabaseForTests,
  buildAccountTravelDatabaseName,
} from '../accountDatabase'
import {
  clearActiveAccountStorageScope,
  setActiveAccountStorageScope,
} from '../accountStorageScope'
import type { AccountObjectRowV1 } from './contract'
import {
  buildAccountMutationJournalEntry,
  putAccountMutationIntent,
} from './localStore'
import type { AccountWorkflowRequestV1 } from './workflowContract'
import {
  acknowledgeAccountWorkflow,
  AccountWorkflowJournalError,
  buildAccountWorkflowJournalEntry,
  createOptimisticAccountWorkflowIntent,
  leaseAccountWorkflow,
  markAccountWorkflowForRetry,
  putAccountWorkflowIntent,
  reconcileOptimisticAccountWorkflowFailure,
  recoverTerminalOptimisticAccountWorkflows,
  resumeBlockedAuthAccountWorkflows,
  validateAccountWorkflowJournalEntry,
} from './workflowLocalStore'

const ACCOUNT_HASH = '0123456789abcdef0123456789abcdef'
const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MUTATION_A = '11111111-1111-4111-8111-111111111111'
const MUTATION_B = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'
const NOW_ISO = '2026-08-11T12:00:00.000Z'
const DATABASE_NAME = buildAccountTravelDatabaseName(ACCOUNT_HASH)

beforeEach(async () => {
  activateLegacyDatabaseForTests()
  await Dexie.delete(DATABASE_NAME)
  setActiveTravelDatabase(new TravelConsoleDatabase(DATABASE_NAME))
  setActiveAccountStorageScope(ACCOUNT_HASH)
  await db.open()
})

afterEach(async () => {
  activateLegacyDatabaseForTests()
  clearActiveAccountStorageScope()
  await Dexie.delete(DATABASE_NAME)
})

describe('account workflow local store', () => {
  it('rejects a partial inflight lease as a malformed journal entry', async () => {
    const { request } = await seedReorderBaseline()
    const snapshots = request.steps.map((step) => ({
      before: makeItem(step.objectId, step.objectId === 'item_a' ? 1 : 2),
      objectId: step.objectId,
      objectKey: `item:${step.objectId}`,
      objectType: step.objectType,
      stepId: step.stepId,
    }))
    const entry = buildAccountWorkflowJournalEntry(request, ACCOUNT_HASH, snapshots, 100)

    expect(() => validateAccountWorkflowJournalEntry({
      ...entry,
      leaseToken: MUTATION_A,
      status: 'inflight',
    })).toThrow(new AccountWorkflowJournalError('invalid_entry'))
    expect(() => validateAccountWorkflowJournalEntry({
      ...entry,
      rawProviderPayload: 'must never persist',
    } as never)).toThrow(new AccountWorkflowJournalError('invalid_entry'))
  })

  it('atomically writes the optimistic graph and one canonical batch intent', async () => {
    const { before, request } = await seedReorderBaseline()
    const after = request.steps.map((step) => step.payload as unknown as ItineraryItem)

    const result = await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: async () => {
        await db.itineraryItems.bulkPut(after)
        return 'applied'
      },
      input: request,
      now: 100,
    })

    expect(result.value).toBe('applied')
    expect(result.entry).toMatchObject({
      batchMutationId: BATCH_ID,
      objectKeys: ['item:item_a', 'item:item_b'],
      status: 'pending',
    })
    expect(result.entry.snapshots.map((snapshot) => snapshot.before)).toEqual(before)
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(1)
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    await expect(db.itineraryItems.toArray()).resolves.toEqual(expect.arrayContaining(after))
  })

  it('rolls back both data and intent when optimistic application fails', async () => {
    const { before, request } = await seedReorderBaseline()
    await expect(createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: async () => {
        await db.itineraryItems.put(request.steps[0].payload as unknown as ItineraryItem)
        throw new Error('simulated crash')
      },
      input: request,
    })).rejects.toThrow('simulated crash')

    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
    await expect(db.itineraryItems.bulkGet(['item_a', 'item_b'])).resolves.toEqual(before)
  })

  it('rejects a drifted local baseline before running the optimistic callback', async () => {
    const { request } = await seedReorderBaseline()
    await db.itineraryItems.update('item_b', { title: 'Untracked local drift' })
    const apply = vi.fn()

    await expect(createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply,
      input: request,
    })).rejects.toEqual(new AccountWorkflowJournalError('stale_revision'))
    expect(apply).not.toHaveBeenCalled()
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('rejects the wrong account database before touching local data', async () => {
    const { before, request } = await seedReorderBaseline()
    setActiveAccountStorageScope('ffffffffffffffffffffffffffffffff')
    const apply = vi.fn()

    await expect(createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply,
      input: request,
    })).rejects.toEqual(new AccountWorkflowJournalError('account_context_mismatch'))
    expect(apply).not.toHaveBeenCalled()
    await expect(db.itineraryItems.bulkGet(['item_a', 'item_b'])).resolves.toEqual(before)
    setActiveAccountStorageScope(ACCOUNT_HASH)
  })

  it('rolls back the optimistic transaction when the active account changes during apply', async () => {
    const { before, request } = await seedReorderBaseline()

    await expect(createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: async () => {
        await db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem))
        setActiveAccountStorageScope('ffffffffffffffffffffffffffffffff')
      },
      input: request,
    })).rejects.toEqual(new AccountWorkflowJournalError('account_context_mismatch'))
    setActiveAccountStorageScope(ACCOUNT_HASH)
    await expect(db.itineraryItems.bulkGet(['item_a', 'item_b'])).resolves.toEqual(before)
    await expect(db.accountWorkflowJournal.count()).resolves.toBe(0)
  })

  it('rejects batch reuse and cross-queue writes to any object in the batch', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
      now: 100,
    })
    const stored = await db.accountWorkflowJournal.get(BATCH_ID)
    await expect(putAccountWorkflowIntent({
      ...stored!,
      request: {
        ...stored!.request,
        deviceId: 'device_changed',
      },
    })).rejects.toEqual(new AccountWorkflowJournalError('invalid_entry'))

    const single = buildAccountMutationJournalEntry({
      deviceId: 'device_primary',
      expectedRevision: 1,
      mutationId: '44444444-4444-4444-8444-444444444444',
      objectId: 'item_a',
      objectSchemaVersion: 1,
      objectType: 'item',
      operation: 'upsert',
      payload: request.steps[0].payload,
      schemaVersion: 1,
      tripId: 'trip_uk',
    }, ACCOUNT_HASH, 200)
    await expect(putAccountMutationIntent(single))
      .rejects.toMatchObject({ code: 'object_busy' })
  })

  it('leases only the whole batch and rejects every late lease transition', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
      now: 100,
    })
    const first = await leaseAccountWorkflow(BATCH_ID, {
      leaseMs: 1_000,
      leaseToken: MUTATION_A,
      now: 100,
    })
    await expect(leaseAccountWorkflow(BATCH_ID, { now: 1_099 })).resolves.toBeNull()
    const second = await leaseAccountWorkflow(BATCH_ID, {
      leaseMs: 1_000,
      leaseToken: MUTATION_B,
      now: 1_100,
    })
    await expect(markAccountWorkflowForRetry(
      BATCH_ID,
      'request_failed',
      1_200,
      first?.leaseToken,
    )).rejects.toEqual(new AccountWorkflowJournalError('stale_lease'))
    await expect(markAccountWorkflowForRetry(
      BATCH_ID,
      'request_failed',
      1_200,
      second?.leaseToken,
    )).resolves.toMatchObject({ retryAt: 3_200, status: 'retry' })
  })

  it('atomically persists every revision before deleting the batch journal', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    const result = makeSuccess(request)
    const acknowledgement = await acknowledgeAccountWorkflow(BATCH_ID, result, 500)

    expect(acknowledgement).toMatchObject({ status: 'committed' })
    expect(acknowledgement.revisions.map((revision) => revision.revision)).toEqual([2, 2])
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeUndefined()
    await expect(db.accountObjectRevisions.bulkGet(['item:item_a', 'item:item_b']))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ mutationId: MUTATION_A, revision: 2 }),
        expect.objectContaining({ mutationId: MUTATION_B, revision: 2 }),
      ]))
  })

  it('keeps all server revisions when local data changes before a successful acknowledgement', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    await db.itineraryItems.update('item_b', { title: 'User edited after send' })

    const acknowledgement = await acknowledgeAccountWorkflow(BATCH_ID, makeSuccess(request), 500)

    expect(acknowledgement).toMatchObject({ status: 'stale_local' })
    await expect(db.accountObjectRevisions.bulkGet(['item:item_a', 'item:item_b']))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ mutationId: MUTATION_A, revision: 2 }),
        expect.objectContaining({ mutationId: MUTATION_B, revision: 2 }),
      ]))
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      lastErrorCode: 'local_state_changed',
      optimisticResolution: 'stale_local',
      serverAcknowledgedAt: 500,
      status: 'conflict',
    })
    await expect(db.itineraryItems.get('item_b')).resolves.toMatchObject({ title: 'User edited after send' })
  })

  it('rolls back every acknowledgement write when the active account changes mid-transaction', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    const revisionTable = getActiveTravelDatabase().accountObjectRevisions
    const originalBulkPut = revisionTable.bulkPut.bind(revisionTable)
    const spy = vi.spyOn(revisionTable, 'bulkPut').mockImplementationOnce((async (
      values: Parameters<typeof revisionTable.bulkPut>[0],
    ) => {
      const result = await originalBulkPut(values)
      setActiveAccountStorageScope('ffffffffffffffffffffffffffffffff')
      return result
    }) as typeof revisionTable.bulkPut)

    await expect(acknowledgeAccountWorkflow(BATCH_ID, makeSuccess(request), 500))
      .rejects.toEqual(new AccountWorkflowJournalError('account_context_mismatch'))
    spy.mockRestore()
    setActiveAccountStorageScope(ACCOUNT_HASH)

    await expect(db.accountObjectRevisions.bulkGet(['item:item_a', 'item:item_b']))
      .resolves.toEqual([
        expect.objectContaining({ revision: 1 }),
        expect.objectContaining({ revision: 1 }),
      ])
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeTruthy()
  })

  it('writes neither receipt when any acknowledgement step is stale', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    const invalid = makeSuccess(request)
    invalid.steps[1] = {
      ...invalid.steps[1],
      mutationId: '44444444-4444-4444-8444-444444444444',
    }
    await expect(acknowledgeAccountWorkflow(BATCH_ID, invalid, 500))
      .rejects.toEqual(new AccountWorkflowJournalError('stale_ack'))
    await expect(db.accountObjectRevisions.bulkGet(['item:item_a', 'item:item_b']))
      .resolves.toEqual([
        expect.objectContaining({ revision: 1 }),
        expect.objectContaining({ revision: 1 }),
      ])
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeTruthy()
  })

  it('rolls back the complete graph on conflict and preserves one conflict receipt', async () => {
    const { before, request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    const lease = await leaseAccountWorkflow(BATCH_ID, { leaseToken: MUTATION_A, now: 100 })
    const result = await reconcileOptimisticAccountWorkflowFailure(BATCH_ID, {
      errorCode: 'server_conflict',
      leaseToken: lease?.leaseToken,
      now: 200,
      retainJournal: true,
    })

    expect(result).toBe('rolled_back')
    await expect(db.itineraryItems.bulkGet(['item_a', 'item_b'])).resolves.toEqual(before)
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      optimisticResolution: 'rolled_back',
      status: 'conflict',
    })
  })

  it('rejects unregistered conflict fields before writing recovery state', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    const conflict = {
      currentObject: null,
      currentRevision: 0,
      mutationId: MUTATION_A,
      objectId: 'item_a',
      objectType: 'item',
      rawProviderPayload: 'must never persist',
      stepId: 'item_a',
    }

    await expect(reconcileOptimisticAccountWorkflowFailure(BATCH_ID, {
      conflicts: [conflict] as never,
      errorCode: 'server_conflict',
      now: 200,
      retainJournal: true,
    })).rejects.toEqual(new AccountWorkflowJournalError('invalid_entry'))
    expect(JSON.stringify(await db.accountWorkflowJournal.get(BATCH_ID)))
      .not.toContain('must never persist')
  })

  it('does not partially roll back when one object changed after the optimistic batch', async () => {
    const { request } = await seedReorderBaseline()
    const after = request.steps.map((step) => step.payload as unknown as ItineraryItem)
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(after),
      input: request,
    })
    await db.itineraryItems.update('item_b', { title: 'User edited later' })
    const currentA = await db.itineraryItems.get('item_a')
    const result = await reconcileOptimisticAccountWorkflowFailure(BATCH_ID, {
      errorCode: 'server_conflict',
      now: 200,
      retainJournal: true,
    })

    expect(result).toBe('stale_local')
    await expect(db.itineraryItems.get('item_a')).resolves.toEqual(currentA)
    await expect(db.itineraryItems.get('item_b')).resolves.toMatchObject({ title: 'User edited later' })
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      lastErrorCode: 'local_state_changed',
      optimisticResolution: 'stale_local',
      status: 'conflict',
    })
  })

  it('restores a deleted ledger object without converting the batch into an upsert retry', async () => {
    const expense = makeExpense()
    await db.ledgerExpenses.put(expense)
    await db.accountObjectRevisions.put({
      ...makeRevision(makeItem('placeholder', 1), '77777777-7777-4777-8777-777777777777', 1),
      objectId: expense.id,
      objectKey: `ledger_expense:${expense.id}`,
      objectType: 'ledger_expense',
      payload: expense,
    })
    const request: AccountWorkflowRequestV1 = {
      batchMutationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      deviceId: 'device_primary',
      schemaVersion: 1,
      steps: [{
        expectedRevision: 1,
        mutationId: '88888888-8888-4888-8888-888888888888',
        objectId: expense.id,
        objectSchemaVersion: 1,
        objectType: 'ledger_expense',
        operation: 'delete',
        stepId: 'delete_expense',
      }],
      tripId: 'trip_uk',
      workflowId: 'ledger.batch@1',
    }
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.ledgerExpenses.delete(expense.id),
      input: request,
    })
    await expect(db.ledgerExpenses.get(expense.id)).resolves.toBeUndefined()

    await expect(reconcileOptimisticAccountWorkflowFailure(request.batchMutationId, {
      errorCode: 'permission_denied',
      retainJournal: false,
    })).resolves.toBe('rolled_back')
    await expect(db.ledgerExpenses.get(expense.id)).resolves.toEqual(expense)
    await expect(db.accountWorkflowJournal.get(request.batchMutationId)).resolves.toBeUndefined()
  })

  it('recovers an unresolved terminal batch exactly once after restart', async () => {
    const { before, request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    await db.accountWorkflowJournal.update(BATCH_ID, {
      lastErrorCode: 'server_conflict',
      status: 'conflict',
    })

    await expect(recoverTerminalOptimisticAccountWorkflows({
      accountHash: ACCOUNT_HASH,
      database: getActiveTravelDatabase(),
      now: 300,
    })).resolves.toEqual({ recovered: 1, scanned: 1, staleLocal: 0 })
    await expect(db.itineraryItems.bulkGet(['item_a', 'item_b'])).resolves.toEqual(before)
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      optimisticResolution: 'rolled_back',
      status: 'conflict',
    })
    await expect(recoverTerminalOptimisticAccountWorkflows({
      accountHash: ACCOUNT_HASH,
      database: getActiveTravelDatabase(),
      now: 400,
    })).resolves.toEqual({ recovered: 0, scanned: 0, staleLocal: 0 })
  })

  it('recovers only matching authentication-blocked batches', async () => {
    const { request } = await seedReorderBaseline()
    const snapshots = request.steps.map((step) => ({
      before: null,
      objectId: step.objectId,
      objectKey: `${step.objectType}:${step.objectId}`,
      objectType: step.objectType,
      stepId: step.stepId,
    }))
    const entry = buildAccountWorkflowJournalEntry(request, ACCOUNT_HASH, snapshots, 100)
    await db.accountWorkflowJournal.put({
      ...entry,
      lastErrorCode: 'authentication_required',
      status: 'blocked_auth',
    })

    await expect(resumeBlockedAuthAccountWorkflows(200, getActiveTravelDatabase(), 'ffffffffffffffffffffffffffffffff'))
      .resolves.toBe(0)
    await expect(resumeBlockedAuthAccountWorkflows(300, getActiveTravelDatabase(), ACCOUNT_HASH)).resolves.toBe(1)
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      lastErrorCode: undefined,
      status: 'pending',
      updatedAt: 300,
    })
  })

  it('rolls back all acknowledgement writes when IndexedDB fails before commit', async () => {
    const { request } = await seedReorderBaseline()
    await createOptimisticAccountWorkflowIntent({
      accountHash: ACCOUNT_HASH,
      apply: () => db.itineraryItems.bulkPut(request.steps.map((step) => step.payload as unknown as ItineraryItem)),
      input: request,
    })
    const spy = vi.spyOn(db.accountObjectRevisions, 'bulkPut').mockImplementationOnce((async () => {
      await db.accountObjectRevisions.put(makeRevision(request.steps[0].payload as unknown as ItineraryItem, MUTATION_A, 2))
      throw new Error('storage fault')
    }) as unknown as typeof db.accountObjectRevisions.bulkPut)
    await expect(acknowledgeAccountWorkflow(BATCH_ID, makeSuccess(request), 500))
      .rejects.toThrow('storage fault')
    spy.mockRestore()

    await expect(db.accountObjectRevisions.bulkGet(['item:item_a', 'item:item_b']))
      .resolves.toEqual([
        expect.objectContaining({ revision: 1 }),
        expect.objectContaining({ revision: 1 }),
      ])
    await expect(db.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeTruthy()
  })
})

async function seedReorderBaseline() {
  const before = [makeItem('item_a', 1), makeItem('item_b', 2)]
  await db.itineraryItems.bulkPut(before)
  await db.accountObjectRevisions.bulkPut([
    makeRevision(before[0], '55555555-5555-4555-8555-555555555555', 1),
    makeRevision(before[1], '66666666-6666-4666-8666-666666666666', 1),
  ])
  return { before, request: makeRequest(before) }
}

function makeRequest(before: ItineraryItem[]): AccountWorkflowRequestV1 {
  return {
    batchMutationId: BATCH_ID,
    deviceId: 'device_primary',
    schemaVersion: 1,
    steps: [
      makeStep(before[0], { mutationId: MUTATION_A, sortOrder: 2, stepId: 'item_a' }),
      makeStep(before[1], { mutationId: MUTATION_B, sortOrder: 1, stepId: 'item_b' }),
    ],
    tripId: 'trip_uk',
    workflowId: 'day.items.reorder@1',
  }
}

function makeStep(
  item: ItineraryItem,
  options: { mutationId: string; sortOrder: number; stepId: string },
) {
  return {
    expectedRevision: 1,
    mutationId: options.mutationId,
    objectId: item.id,
    objectSchemaVersion: 1,
    objectType: 'item' as const,
    operation: 'upsert' as const,
    payload: { ...item, sortOrder: options.sortOrder, updatedAt: 2 },
    stepId: options.stepId,
  }
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

function makeExpense(): LedgerExpense {
  return {
    amountMinor: 2500,
    category: 'transport',
    createdAt: 1,
    currency: 'GBP',
    date: '2026-07-10',
    id: 'expense_a',
    source: { kind: 'manual' },
    splitMode: 'equal',
    splitShares: [],
    status: 'confirmed',
    title: 'Airport transfer',
    tripId: 'trip_uk',
    updatedAt: 1,
  }
}

function makeRevision(item: ItineraryItem, mutationId: string, revision: number) {
  return {
    acknowledgedAt: 1,
    actorId: ACTOR_ID,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId,
    objectId: item.id,
    objectKey: `item:${item.id}`,
    objectSchemaVersion: 1,
    objectType: 'item' as const,
    payload: item,
    revision,
    serverCreatedAt: NOW_ISO,
    serverUpdatedAt: NOW_ISO,
    tombstone: false,
    tripId: item.tripId,
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
      object: makeRow(step, request.tripId),
      stepId: step.stepId,
    })),
    tripId: request.tripId,
    workflowId: request.workflowId,
  }
}

function makeRow(
  step: AccountWorkflowRequestV1['steps'][number],
  tripId: string,
): AccountObjectRowV1 {
  return {
    actorId: ACTOR_ID,
    createdAt: NOW_ISO,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: step.mutationId,
    objectId: step.objectId,
    objectSchemaVersion: 1,
    objectType: step.objectType,
    payload: step.payload ?? null,
    revision: step.expectedRevision + 1,
    schemaVersion: 1,
    tombstone: false,
    tripId,
    updatedAt: NOW_ISO,
  }
}
