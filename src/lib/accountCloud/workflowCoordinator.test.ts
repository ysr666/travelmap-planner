import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TravelConsoleDatabase,
  setActiveTravelDatabase,
} from '../../db/database'
import type { ItineraryItem } from '../../types'
import {
  activateLegacyDatabaseForTests,
  buildAccountTravelDatabaseName,
} from '../accountDatabase'
import {
  clearActiveAccountStorageScope,
  setActiveAccountStorageScope,
} from '../accountStorageScope'
import { AccountCloudTransportError } from './client'
import type { AccountObjectRowV1 } from './contract'
import type {
  AccountWorkflowRequestV1,
  AccountWorkflowRunResultV1,
} from './workflowContract'
import {
  drainAccountWorkflowJournal,
  processAccountWorkflow,
  type AccountWorkflowCommit,
} from './workflowCoordinator'
import { createOptimisticAccountWorkflowIntent } from './workflowLocalStore'

const ACCOUNT_HASH = '0123456789abcdef0123456789abcdef'
const OTHER_ACCOUNT_HASH = 'ffffffffffffffffffffffffffffffff'
const DATABASE_NAME = buildAccountTravelDatabaseName(ACCOUNT_HASH)
const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MUTATION_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const NOW_ISO = '2026-08-11T12:00:00.000Z'

let database: TravelConsoleDatabase

beforeEach(async () => {
  activateLegacyDatabaseForTests()
  await Dexie.delete(DATABASE_NAME)
  database = new TravelConsoleDatabase(DATABASE_NAME)
  setActiveTravelDatabase(database)
  setActiveAccountStorageScope(ACCOUNT_HASH)
  await database.open()
})

afterEach(async () => {
  activateLegacyDatabaseForTests()
  clearActiveAccountStorageScope()
  await Dexie.delete(DATABASE_NAME)
})

describe('account workflow coordinator', () => {
  it('keeps an offline workflow as one pending batch without calling the RPC', async () => {
    await seedIntent()
    const commit = vi.fn()

    await expect(processAccountWorkflow(BATCH_ID, {
      commit,
      database,
      isOnline: () => false,
      now: () => 100,
    })).resolves.toEqual({ batchMutationId: BATCH_ID, status: 'queued_offline' })

    expect(commit).not.toHaveBeenCalled()
    await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      attempts: 0,
      status: 'pending',
    })
  })

  it.each(['applied', 'idempotent'] as const)(
    'acknowledges every step of a %s response in one transaction',
    async (status) => {
      const request = await seedIntent()
      const commit = vi.fn().mockResolvedValue(makeSuccess(request, status))

      await expect(processAccountWorkflow(BATCH_ID, {
        commit,
        database,
        now: () => 200,
      })).resolves.toEqual({
        batchMutationId: BATCH_ID,
        replayed: status === 'idempotent',
        revisions: [2],
        status: 'committed',
      })

      expect(commit).toHaveBeenCalledWith(request)
      await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeUndefined()
      await expect(database.accountObjectRevisions.get('item:item_a')).resolves.toMatchObject({
        mutationId: MUTATION_ID,
        revision: 2,
      })
    },
  )

  it('preserves the exact request and batch identity across 100 uncertain retries', async () => {
    const request = await seedIntent()
    const serializedRequests: string[] = []
    let calls = 0
    const commit = vi.fn<AccountWorkflowCommit>(async (candidate) => {
      serializedRequests.push(JSON.stringify(candidate))
      calls += 1
      if (calls < 100) throw new AccountCloudTransportError('request_failed', true)
      return makeSuccess(candidate, 'idempotent')
    })
    let now = 100
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const result = await processAccountWorkflow(BATCH_ID, {
        commit,
        database,
        now: () => now,
      })
      if (attempt < 100) {
        expect(result.status).toBe('retry_scheduled')
        now = (result as Extract<typeof result, { status: 'retry_scheduled' }>).retryAt
      } else {
        expect(result).toMatchObject({ replayed: true, status: 'committed' })
      }
    }

    expect(calls).toBe(100)
    expect(new Set(serializedRequests)).toEqual(new Set([JSON.stringify(request)]))
    await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeUndefined()
  })

  it('keeps authentication failures for same-ID resume without rolling back', async () => {
    const request = await seedIntent()
    const optimistic = request.steps[0].payload
    const commit = vi.fn().mockRejectedValue(
      new AccountCloudTransportError('authentication_required', false),
    )

    await expect(processAccountWorkflow(BATCH_ID, {
      commit,
      database,
      now: () => 200,
    })).resolves.toEqual({ batchMutationId: BATCH_ID, status: 'blocked_auth' })
    await expect(database.itineraryItems.get('item_a')).resolves.toEqual(optimistic)
    await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      lastErrorCode: 'authentication_required',
      request,
      status: 'blocked_auth',
    })
  })

  it('rolls back the optimistic batch and retains a bounded server conflict', async () => {
    const request = await seedIntent()
    const commit = vi.fn().mockResolvedValue(makeConflict(request))

    await expect(processAccountWorkflow(BATCH_ID, {
      commit,
      database,
      now: () => 200,
    })).resolves.toEqual({
      batchMutationId: BATCH_ID,
      conflictCount: 1,
      status: 'conflict',
    })

    await expect(database.itineraryItems.get('item_a')).resolves.toMatchObject({
      title: 'Before',
      updatedAt: 1,
    })
    const entry = await database.accountWorkflowJournal.get(BATCH_ID)
    expect(entry).toMatchObject({
      conflicts: [expect.objectContaining({ objectId: 'item_a' })],
      optimisticResolution: 'rolled_back',
      status: 'conflict',
    })
    expect(JSON.stringify(entry)).not.toContain('raw provider')
  })

  it('treats an invalid or substituted response as uncertain and retries the original batch', async () => {
    const request = await seedIntent()
    const substituted = makeSuccess(request, 'applied')
    substituted.tripId = 'trip_other'

    await expect(processAccountWorkflow(BATCH_ID, {
      commit: vi.fn().mockResolvedValue(substituted),
      database,
      now: () => 200,
    })).resolves.toEqual({
      batchMutationId: BATCH_ID,
      retryAt: 1_200,
      status: 'retry_scheduled',
    })
    await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      lastErrorCode: 'invalid_response',
      request,
      status: 'retry',
    })
  })

  it('discards an in-flight response after an account switch and applies no receipt', async () => {
    const request = await seedIntent()
    const commit = vi.fn(async () => {
      setActiveAccountStorageScope(OTHER_ACCOUNT_HASH)
      return makeSuccess(request, 'applied')
    })

    await expect(processAccountWorkflow(BATCH_ID, {
      commit,
      database,
      now: () => 200,
    })).resolves.toEqual({ batchMutationId: BATCH_ID, status: 'not_runnable' })
    await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toMatchObject({
      status: 'inflight',
    })
    await expect(database.accountObjectRevisions.get('item:item_a')).resolves.toMatchObject({
      revision: 1,
    })
  })

  it('rolls back deterministic failures without storing raw error content', async () => {
    await seedIntent()
    const raw = new AccountCloudTransportError('permission_denied', false)
    Object.defineProperty(raw, 'message', { value: 'raw provider secret' })

    await expect(processAccountWorkflow(BATCH_ID, {
      commit: vi.fn().mockRejectedValue(raw),
      database,
      now: () => 200,
    })).resolves.toEqual({ batchMutationId: BATCH_ID, status: 'blocked_contract' })
    await expect(database.itineraryItems.get('item_a')).resolves.toMatchObject({ title: 'Before' })
    await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeUndefined()
    expect(JSON.stringify(await database.accountObjectRevisions.toArray()))
      .not.toContain('raw provider secret')
  })

  it('continues independent batches while retaining a conflicted batch', async () => {
    const first = await seedIntent()
    const secondBatch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const secondMutation = '44444444-4444-4444-8444-444444444444'
    const second = await seedIntent({
      batchMutationId: secondBatch,
      itemId: 'item_b',
      mutationId: secondMutation,
    })
    const commit = vi.fn<AccountWorkflowCommit>(async (request) => (
      request.batchMutationId === BATCH_ID
        ? makeConflict(first)
        : makeSuccess(second, 'applied')
    ))

    const result = await drainAccountWorkflowJournal({ commit, database, now: () => 200 })

    expect(result.processed.map((entry) => [entry.batchMutationId, entry.status])).toEqual([
      [BATCH_ID, 'conflict'],
      [secondBatch, 'committed'],
    ])
    expect(result.skippedBatchMutationIds).toEqual([])
    await expect(database.accountWorkflowJournal.get(BATCH_ID)).resolves.toBeTruthy()
    await expect(database.accountWorkflowJournal.get(secondBatch)).resolves.toBeUndefined()
  })
})

async function seedIntent({
  batchMutationId = BATCH_ID,
  itemId = 'item_a',
  mutationId = MUTATION_ID,
}: {
  batchMutationId?: string
  itemId?: string
  mutationId?: string
} = {}) {
  const before = makeItem(itemId, 'Before', 1)
  await database.itineraryItems.put(before)
  await database.accountObjectRevisions.put(makeRevision(before))
  const request = makeRequest(batchMutationId, mutationId, before)
  await createOptimisticAccountWorkflowIntent({
    accountHash: ACCOUNT_HASH,
    apply: () => database.itineraryItems.put(request.steps[0].payload as unknown as ItineraryItem),
    database,
    input: request,
    now: 1,
  })
  return request
}

function makeRequest(
  batchMutationId: string,
  mutationId: string,
  before: ItineraryItem,
): AccountWorkflowRequestV1 {
  return {
    batchMutationId,
    deviceId: 'device_primary',
    schemaVersion: 1,
    steps: [{
      expectedRevision: 1,
      mutationId,
      objectId: before.id,
      objectSchemaVersion: 1,
      objectType: 'item',
      operation: 'upsert',
      payload: makeItem(before.id, 'After', 2),
      stepId: `repair_${before.id}`,
    }],
    tripId: 'trip_uk',
    workflowId: 'trip.repair.apply@1',
  }
}

function makeSuccess(
  request: AccountWorkflowRequestV1,
  status: 'applied' | 'idempotent',
) {
  return {
    batchMutationId: request.batchMutationId,
    schemaVersion: 1 as const,
    status,
    steps: request.steps.map((step) => ({
      appliedRevision: 2,
      currentRevision: 2,
      mutationId: step.mutationId,
      object: makeRow(step, 2),
      stepId: step.stepId,
    })),
    tripId: request.tripId,
    workflowId: request.workflowId,
  }
}

function makeConflict(request: AccountWorkflowRequestV1): AccountWorkflowRunResultV1 {
  const step = request.steps[0]
  return {
    batchMutationId: request.batchMutationId,
    conflicts: [{
      currentObject: makeRow({
        ...step,
        mutationId: '55555555-5555-4555-8555-555555555555',
        payload: makeItem(step.objectId, 'Remote', 3),
      }, 3),
      currentRevision: 3,
      mutationId: step.mutationId,
      objectId: step.objectId,
      objectType: step.objectType,
      stepId: step.stepId,
    }],
    reason: 'revision_mismatch',
    schemaVersion: 1,
    status: 'conflict',
    tripId: request.tripId,
    workflowId: request.workflowId,
  }
}

function makeRow(
  step: AccountWorkflowRequestV1['steps'][number],
  revision: number,
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
    revision,
    schemaVersion: 1,
    tombstone: false,
    tripId: 'trip_uk',
    updatedAt: NOW_ISO,
  }
}

function makeItem(id: string, title: string, updatedAt: number): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day_a',
    id,
    sortOrder: id === 'item_a' ? 1 : 2,
    ticketIds: [],
    title,
    tripId: 'trip_uk',
    updatedAt,
  }
}

function makeRevision(item: ItineraryItem) {
  return {
    acknowledgedAt: 1,
    actorId: ACTOR_ID,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: '66666666-6666-4666-8666-666666666666',
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
  }
}
