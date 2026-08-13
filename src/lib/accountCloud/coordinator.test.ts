import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import {
  clearActiveAccountStorageScope,
  setActiveAccountStorageScope,
} from '../accountStorageScope'
import { AccountCloudTransportError } from './client'
import type {
  AccountObjectMutationResultV1,
  AccountObjectMutationV1,
  AccountObjectRowV1,
  JsonObject,
} from './contract'
import {
  drainAccountMutationJournal,
  processAccountMutation,
  type AccountMutationCommit,
} from './coordinator'
import {
  buildAccountMutationJournalEntry,
  putAccountMutationIntent,
} from './localStore'

const MUTATION_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_HASH = '0123456789abcdef0123456789abcdef'
const NOW_ISO = '2026-08-11T10:00:00.000Z'

beforeEach(async () => {
  setActiveAccountStorageScope(ACCOUNT_HASH)
  await db.delete()
  await db.open()
})

afterEach(() => clearActiveAccountStorageScope())

describe('account mutation coordinator', () => {
  it('keeps offline work pending without attempting the RPC', async () => {
    await putIntent(makeMutation(), 100)
    const commit = vi.fn()

    await expect(processAccountMutation(MUTATION_ID, {
      commit,
      isOnline: () => false,
      now: () => 100,
    })).resolves.toEqual({ mutationId: MUTATION_ID, status: 'queued_offline' })

    expect(commit).not.toHaveBeenCalled()
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      attempts: 0,
      status: 'pending',
    })
  })

  it.each(['applied', 'idempotent'] as const)(
    'commits and durably acknowledges a %s response',
    async (status) => {
      const mutation = makeMutation()
      await putIntent(mutation, 100)
      const commit = vi.fn().mockResolvedValue(makeSuccessResult(mutation, status))

      await expect(processAccountMutation(MUTATION_ID, {
        commit,
        isOnline: () => true,
        now: () => 200,
      })).resolves.toEqual({
        mutationId: MUTATION_ID,
        replayed: status === 'idempotent',
        revision: 1,
        status: 'committed',
      })

      expect(commit).toHaveBeenCalledWith(mutation)
      await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toBeUndefined()
      await expect(db.accountObjectRevisions.get('item:item_first')).resolves.toMatchObject({ revision: 1 })
    },
  )

  it('persists a bounded conflict snapshot and does not retry it', async () => {
    const mutation = makeMutation()
    await putIntent(mutation, 100)
    const currentObject = makeRow(mutation, 3, {
      mutationId: '33333333-3333-4333-8333-333333333333',
    })
    const commit = vi.fn().mockResolvedValue({
      currentObject,
      currentRevision: 3,
      mutationId: MUTATION_ID,
      reason: 'revision_mismatch',
      schemaVersion: 1,
      status: 'conflict',
    } satisfies AccountObjectMutationResultV1)

    await expect(processAccountMutation(MUTATION_ID, { commit, now: () => 200 }))
      .resolves.toEqual({ currentRevision: 3, mutationId: MUTATION_ID, status: 'conflict' })
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      conflictObject: currentObject,
      lastErrorCode: 'server_conflict',
      status: 'conflict',
    })
    await expect(processAccountMutation(MUTATION_ID, { commit, now: () => 300 }))
      .resolves.toEqual({ mutationId: MUTATION_ID, status: 'not_runnable' })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('keeps an advanced idempotent replay as a conflict instead of blessing stale local data', async () => {
    const mutation = makeMutation()
    await putIntent(mutation, 100)
    const currentObject = makeRow(mutation, 2, {
      mutationId: '33333333-3333-4333-8333-333333333333',
      payload: makePayload({ title: 'Changed on another device' }),
    })
    const commit = vi.fn().mockResolvedValue({
      appliedRevision: 1,
      currentRevision: 2,
      mutationId: MUTATION_ID,
      object: currentObject,
      schemaVersion: 1,
      status: 'idempotent',
    } satisfies AccountObjectMutationResultV1)

    await expect(processAccountMutation(MUTATION_ID, { commit, now: () => 200 }))
      .resolves.toEqual({ currentRevision: 2, mutationId: MUTATION_ID, status: 'conflict' })
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      conflictObject: currentObject,
      status: 'conflict',
    })
    await expect(db.accountObjectRevisions.get('item:item_first')).resolves.toBeUndefined()
  })

  it('does not send or acknowledge a mutation after the active account changes', async () => {
    const mutation = makeMutation()
    await putIntent(mutation, 100)
    const commit = vi.fn().mockImplementation(async () => {
      setActiveAccountStorageScope('ffffffffffffffffffffffffffffffff')
      return makeSuccessResult(mutation, 'applied')
    })

    await expect(processAccountMutation(MUTATION_ID, { commit, now: () => 200 }))
      .resolves.toEqual({ mutationId: MUTATION_ID, status: 'not_runnable' })
    expect(commit).toHaveBeenCalledTimes(1)
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      status: 'inflight',
    })
    await expect(db.accountObjectRevisions.get('item:item_first')).resolves.toBeUndefined()

    setActiveAccountStorageScope(ACCOUNT_HASH)
    await db.accountMutationJournal.toCollection().modify({ leaseExpiresAt: 0 })
    await expect(processAccountMutation(MUTATION_ID, {
      commit: vi.fn().mockResolvedValue(makeSuccessResult(mutation, 'idempotent')),
      now: () => 300,
    })).resolves.toMatchObject({ replayed: true, status: 'committed' })
  })

  it('turns a stale acknowledgement into a terminal conflict without deleting intent', async () => {
    const mutation = makeMutation()
    await putIntent(mutation, 100)
    const invalidAck = makeSuccessResult(mutation, 'applied')
    const commit = vi.fn().mockResolvedValue({
      ...invalidAck,
      mutationId: '33333333-3333-4333-8333-333333333333',
    })

    await expect(processAccountMutation(MUTATION_ID, { commit, now: () => 200 }))
      .resolves.toEqual({ currentRevision: 1, mutationId: MUTATION_ID, status: 'conflict' })
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      attempts: 1,
      status: 'conflict',
    })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['authentication_required', false, 'blocked_auth', 'blocked_auth'],
    ['permission_denied', false, 'blocked_contract', 'blocked_contract'],
    ['contract_unavailable', false, 'blocked_contract', 'blocked_contract'],
    ['invalid_response', false, 'blocked_contract', 'blocked_contract'],
    ['request_failed', false, 'blocked_contract', 'blocked_contract'],
  ] as const)(
    'classifies %s as a terminal local state',
    async (code, retryable, resultStatus, journalStatus) => {
      await putIntent(makeMutation(), 100)
      const commit = vi.fn().mockRejectedValue(new AccountCloudTransportError(code, retryable))

      await expect(processAccountMutation(MUTATION_ID, { commit, now: () => 200 }))
        .resolves.toEqual({ mutationId: MUTATION_ID, status: resultStatus })
      await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
        lastErrorCode: code,
        status: journalStatus,
      })
    },
  )

  it('schedules retryable transport failures without persisting raw errors', async () => {
    await putIntent(makeMutation(), 100)
    const raw = new AccountCloudTransportError('request_failed', true)
    Object.defineProperty(raw, 'message', { value: 'secret upstream payload' })
    const commit = vi.fn().mockRejectedValue(raw)

    await expect(processAccountMutation(MUTATION_ID, { commit, now: () => 200 }))
      .resolves.toEqual({ mutationId: MUTATION_ID, retryAt: 1_200, status: 'retry_scheduled' })
    const entry = await db.accountMutationJournal.get(MUTATION_ID)
    expect(entry).toMatchObject({ lastErrorCode: 'request_failed', status: 'retry' })
    expect(JSON.stringify(entry)).not.toContain('secret upstream payload')
  })

  it('blocks rejected and unexpected failures without exposing their content', async () => {
    await putIntent(makeMutation(), 100)
    const rejectedCommit = vi.fn().mockResolvedValue({
      mutationId: MUTATION_ID,
      reason: 'invalid_or_sensitive_payload',
      schemaVersion: 1,
      status: 'rejected',
    } satisfies AccountObjectMutationResultV1)
    await expect(processAccountMutation(MUTATION_ID, { commit: rejectedCommit, now: () => 200 }))
      .resolves.toEqual({ mutationId: MUTATION_ID, status: 'rejected' })
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      lastErrorCode: 'server_rejected',
      status: 'blocked_contract',
    })

    await db.accountMutationJournal.clear()
    await putIntent(makeMutation(), 300)
    const unexpectedCommit = vi.fn().mockRejectedValue(new Error('raw secret stack'))
    await expect(processAccountMutation(MUTATION_ID, { commit: unexpectedCommit, now: () => 400 }))
      .resolves.toEqual({ mutationId: MUTATION_ID, status: 'blocked_contract' })
    const entry = await db.accountMutationJournal.get(MUTATION_ID)
    expect(JSON.stringify(entry)).not.toContain('raw secret stack')
  })

  it('preserves mutation reuse as a conflict and account mismatch as auth-blocked', async () => {
    await putIntent(makeMutation(), 100)
    const reused = vi.fn().mockResolvedValue({
      mutationId: MUTATION_ID,
      reason: 'mutation_id_reused',
      schemaVersion: 1,
      status: 'rejected',
    } satisfies AccountObjectMutationResultV1)
    await expect(processAccountMutation(MUTATION_ID, { commit: reused, now: () => 200 }))
      .resolves.toEqual({ currentRevision: null, mutationId: MUTATION_ID, status: 'conflict' })
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      status: 'conflict',
    })

    await db.accountMutationJournal.clear()
    await putIntent(makeMutation(), 300)
    const wrongAccount = vi.fn().mockResolvedValue({
      mutationId: MUTATION_ID,
      reason: 'account_context_mismatch',
      schemaVersion: 1,
      status: 'rejected',
    } satisfies AccountObjectMutationResultV1)
    await expect(processAccountMutation(MUTATION_ID, { commit: wrongAccount, now: () => 400 }))
      .resolves.toEqual({ mutationId: MUTATION_ID, status: 'blocked_auth' })
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toMatchObject({
      status: 'blocked_auth',
    })
  })

  it('stops later writes to a conflicted object but continues independent objects', async () => {
    const first = makeMutation()
    const sameObject = makeMutation({
      expectedRevision: 1,
      mutationId: '33333333-3333-4333-8333-333333333333',
      payload: makePayload({ title: 'Second local edit' }),
    })
    const independent = makeMutation({
      mutationId: '44444444-4444-4444-8444-444444444444',
      objectId: 'item_independent',
      payload: makePayload({ id: 'item_independent', title: 'Independent' }),
    })
    await Promise.all([
      putIntent(first, 100),
      putIntent(sameObject, 101),
      putIntent(independent, 102),
    ])
    const commit = vi.fn<AccountMutationCommit>(async (mutation) => {
      if (mutation.objectId === 'item_first') {
        return {
          currentObject: null,
          currentRevision: 0,
          mutationId: mutation.mutationId,
          reason: 'revision_mismatch',
          schemaVersion: 1,
          status: 'conflict',
        }
      }
      return makeSuccessResult(mutation, 'applied')
    })

    const result = await drainAccountMutationJournal({ commit, now: () => 200 })

    expect(result.processed.map((entry) => [entry.mutationId, entry.status])).toEqual([
      [first.mutationId, 'conflict'],
      [independent.mutationId, 'committed'],
    ])
    expect(result.skippedMutationIds).toEqual([sameObject.mutationId])
    expect(commit).toHaveBeenCalledTimes(2)
    await expect(db.accountMutationJournal.get(sameObject.mutationId)).resolves.toBeTruthy()
  })
})

async function putIntent(mutation: AccountObjectMutationV1, now: number) {
  return putAccountMutationIntent(buildAccountMutationJournalEntry(mutation, ACCOUNT_HASH, now))
}

function makeMutation(overrides: Partial<AccountObjectMutationV1> = {}): AccountObjectMutationV1 {
  return {
    deviceId: 'device_primary',
    expectedRevision: 0,
    mutationId: MUTATION_ID,
    objectId: 'item_first',
    objectSchemaVersion: 1,
    objectType: 'item',
    operation: 'upsert',
    payload: makePayload(),
    schemaVersion: 1,
    tripId: 'trip_uk',
    ...overrides,
  }
}

function makePayload(overrides: JsonObject = {}): JsonObject {
  return {
    createdAt: 1,
    dayId: 'day_first',
    id: 'item_first',
    sortOrder: 0,
    ticketIds: [],
    title: 'Arrival',
    tripId: 'trip_uk',
    updatedAt: 1,
    ...overrides,
  }
}

function makeRow(
  mutation: AccountObjectMutationV1,
  revision: number,
  overrides: Partial<AccountObjectRowV1> = {},
): AccountObjectRowV1 {
  return {
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
    schemaVersion: 1,
    tombstone: false,
    tripId: mutation.tripId,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

function makeSuccessResult(
  mutation: AccountObjectMutationV1,
  status: 'applied' | 'idempotent',
): AccountObjectMutationResultV1 {
  return {
    appliedRevision: 1,
    currentRevision: 1,
    mutationId: mutation.mutationId,
    object: makeRow(mutation, 1),
    schemaVersion: 1,
    status,
  }
}
