import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import type {
  AccountObjectMutationResultV1,
  AccountObjectMutationV1,
  AccountObjectRowV1,
  JsonObject,
} from './contract'
import {
  AccountMutationJournalError,
  acknowledgeAccountMutation,
  buildAccountMutationJournalEntry,
  computeAccountMutationRetryAt,
  leaseAccountMutation,
  listRunnableAccountMutations,
  markAccountMutationBlocked,
  markAccountMutationConflict,
  markAccountMutationForRetry,
  putAccountMutationIntent,
  recoverTerminalOptimisticAccountMutations,
  resumeBlockedAuthAccountMutations,
} from './localStore'

const MUTATION_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_HASH = '0123456789abcdef0123456789abcdef'
const NOW_ISO = '2026-08-11T10:00:00.000Z'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('account mutation local store', () => {
  it('stores one canonical intent and rejects mutation ID reuse with different content', async () => {
    const first = buildAccountMutationJournalEntry(makeMutation(), ACCOUNT_HASH, 100)
    const reordered = buildAccountMutationJournalEntry(makeMutation({
      payload: {
        updatedAt: 1,
        title: 'Arrival',
        ticketIds: [],
        sortOrder: 0,
        id: 'item_first',
        tripId: 'trip_uk',
        dayId: 'day_first',
        createdAt: 1,
      },
    }), ACCOUNT_HASH, 200)

    expect(reordered.requestFingerprint).toBe(first.requestFingerprint)
    await putAccountMutationIntent(first)
    await expect(putAccountMutationIntent(reordered)).resolves.toMatchObject({
      createdAt: 100,
      requestFingerprint: first.requestFingerprint,
      updatedAt: 200,
    })
    expect(await db.accountMutationJournal.count()).toBe(1)

    const changed = buildAccountMutationJournalEntry(makeMutation({
      payload: makePayload({ title: 'Changed' }),
    }), ACCOUNT_HASH, 300)
    changed.requestFingerprint = first.requestFingerprint
    await expect(putAccountMutationIntent(changed)).rejects.toEqual(
      new AccountMutationJournalError('mutation_reused'),
    )
  })

  it('leases only runnable work and recovers an expired lease', async () => {
    await putAccountMutationIntent(buildAccountMutationJournalEntry(makeMutation(), ACCOUNT_HASH, 100))

    const firstLease = await leaseAccountMutation(MUTATION_ID, { leaseMs: 5_000, now: 100 })
    expect(firstLease).toMatchObject({ attempts: 1, leaseExpiresAt: 5_100, status: 'inflight' })
    await expect(leaseAccountMutation(MUTATION_ID, { now: 5_099 })).resolves.toBeNull()
    const recovered = await leaseAccountMutation(MUTATION_ID, { now: 5_100 })
    expect(recovered).toMatchObject({ attempts: 2, status: 'inflight' })
  })

  it('serializes multiple writes to the same object', async () => {
    const first = buildAccountMutationJournalEntry(makeMutation(), ACCOUNT_HASH, 100)
    const second = buildAccountMutationJournalEntry(makeMutation({
      expectedRevision: 1,
      mutationId: '33333333-3333-4333-8333-333333333333',
      payload: makePayload({ title: 'Second' }),
    }), ACCOUNT_HASH, 101)
    await db.accountMutationJournal.bulkPut([first, second])

    await expect(leaseAccountMutation(second.mutationId, { now: 200 })).resolves.toBeNull()
    await expect(leaseAccountMutation(first.mutationId, { now: 200 })).resolves.toMatchObject({
      mutationId: first.mutationId,
    })
    await db.accountMutationJournal.delete(first.mutationId)
    await expect(leaseAccountMutation(second.mutationId, { now: 300 })).resolves.toMatchObject({
      mutationId: second.mutationId,
    })
  })

  it('resumes only authentication-blocked mutations after sign-in', async () => {
    const authBlocked = buildAccountMutationJournalEntry(makeMutation(), ACCOUNT_HASH, 100)
    const contractBlocked = buildAccountMutationJournalEntry(makeMutation({
      mutationId: '33333333-3333-4333-8333-333333333333',
      objectId: 'item_second',
      payload: makePayload({ id: 'item_second' }),
    }), ACCOUNT_HASH, 101)
    await db.accountMutationJournal.bulkPut([authBlocked, contractBlocked])
    await markAccountMutationBlocked(authBlocked.mutationId, 'blocked_auth', 'authentication_required', 200)
    await markAccountMutationBlocked(contractBlocked.mutationId, 'blocked_contract', 'permission_denied', 200)

    await expect(resumeBlockedAuthAccountMutations(300)).resolves.toBe(1)
    await expect(db.accountMutationJournal.get(authBlocked.mutationId)).resolves.toMatchObject({
      lastErrorCode: undefined,
      status: 'pending',
      updatedAt: 300,
    })
    await expect(db.accountMutationJournal.get(contractBlocked.mutationId)).resolves.toMatchObject({
      lastErrorCode: 'permission_denied',
      status: 'blocked_contract',
    })
  })

  it('applies bounded backoff and never reruns blocked or conflicted rows', async () => {
    const first = buildAccountMutationJournalEntry(makeMutation(), ACCOUNT_HASH, 100)
    const second = buildAccountMutationJournalEntry(makeMutation({
      mutationId: '33333333-3333-4333-8333-333333333333',
      objectId: 'item_second',
      payload: makePayload({ id: 'item_second' }),
    }), ACCOUNT_HASH, 101)
    const third = buildAccountMutationJournalEntry(makeMutation({
      mutationId: '44444444-4444-4444-8444-444444444444',
      objectId: 'item_third',
      payload: makePayload({ id: 'item_third' }),
    }), ACCOUNT_HASH, 102)
    await db.accountMutationJournal.bulkPut([first, second, third])
    const lease = await leaseAccountMutation(first.mutationId, { now: 100 })
    const retry = await markAccountMutationForRetry(
      first.mutationId,
      'request_failed',
      200,
      lease?.leaseToken,
    )
    expect(retry.retryAt).toBe(1_200)
    expect(computeAccountMutationRetryAt(99, 0)).toBe(256_000)
    await markAccountMutationBlocked(second.mutationId, 'blocked_contract', 'permission_denied', 200)
    await markAccountMutationConflict(third.mutationId, null, 200)

    await expect(listRunnableAccountMutations({ now: 1_199 })).resolves.toEqual([])
    await expect(listRunnableAccountMutations({ now: 1_200 })).resolves.toEqual([
      expect.objectContaining({ mutationId: first.mutationId }),
    ])
  })

  it('atomically turns an ack into a durable revision and removes the journal row', async () => {
    await putAccountMutationIntent(buildAccountMutationJournalEntry(makeMutation(), ACCOUNT_HASH, 100))
    const result = makeAppliedResult(makeMutation(), 1)

    const revision = await acknowledgeAccountMutation(MUTATION_ID, result, 500)

    expect(revision).toMatchObject({
      acknowledgedAt: 500,
      mutationId: MUTATION_ID,
      objectKey: 'item:item_first',
      revision: 1,
    })
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toBeUndefined()
    await expect(db.accountObjectRevisions.get('item:item_first')).resolves.toEqual(revision)
  })

  it('rejects every late state transition from an expired lease generation', async () => {
    const mutation = makeMutation()
    await putAccountMutationIntent(buildAccountMutationJournalEntry(mutation, ACCOUNT_HASH, 100))
    const first = await leaseAccountMutation(MUTATION_ID, {
      leaseMs: 1_000,
      leaseToken: '11111111-1111-4111-8111-111111111111',
      now: 100,
    })
    const second = await leaseAccountMutation(MUTATION_ID, {
      leaseMs: 1_000,
      leaseToken: '22222222-2222-4222-8222-222222222222',
      now: 1_100,
    })

    await expect(markAccountMutationForRetry(
      MUTATION_ID,
      'request_failed',
      1_200,
      first?.leaseToken,
    )).rejects.toEqual(new AccountMutationJournalError('stale_lease'))
    await expect(acknowledgeAccountMutation(
      MUTATION_ID,
      makeAppliedResult(mutation, 1),
      1_200,
      first?.leaseToken,
    )).rejects.toEqual(new AccountMutationJournalError('stale_lease'))
    await expect(markAccountMutationForRetry(
      MUTATION_ID,
      'request_failed',
      1_200,
      second?.leaseToken,
    )).resolves.toMatchObject({ status: 'retry' })
  })

  it('joins a domain transaction so a crash cannot leave data without its intent', async () => {
    const mutation = makeMutation()
    await expect(db.transaction('rw', db.itineraryItems, db.accountMutationJournal, db.accountWorkflowJournal, async () => {
      await db.itineraryItems.put(mutation.payload as never)
      await putAccountMutationIntent(buildAccountMutationJournalEntry(mutation, ACCOUNT_HASH, 100))
      throw new Error('simulated crash')
    })).rejects.toThrow('simulated crash')

    await expect(db.itineraryItems.get(mutation.objectId)).resolves.toBeUndefined()
    await expect(db.accountMutationJournal.get(mutation.mutationId)).resolves.toBeUndefined()
  })

  it('recovers an unreconciled terminal optimistic write exactly once after restart', async () => {
    const mutation = makeMutation()
    const entry = {
      ...buildAccountMutationJournalEntry(mutation, ACCOUNT_HASH, 100),
      optimisticAfter: mutation.payload,
      optimisticBefore: null,
    }
    await db.transaction('rw', db.itineraryItems, db.accountMutationJournal, db.accountWorkflowJournal, async () => {
      await db.itineraryItems.put(mutation.payload as never)
      await putAccountMutationIntent(entry)
    })
    await markAccountMutationConflict(mutation.mutationId, null, 200)

    await expect(recoverTerminalOptimisticAccountMutations({
      accountHash: ACCOUNT_HASH,
      now: 300,
    })).resolves.toEqual({ recovered: 1, scanned: 1, staleLocal: 0 })
    await expect(db.itineraryItems.get(mutation.objectId)).resolves.toBeUndefined()
    await expect(db.accountMutationJournal.get(mutation.mutationId)).resolves.toMatchObject({
      optimisticResolution: 'rolled_back',
      status: 'conflict',
    })
    await expect(recoverTerminalOptimisticAccountMutations({
      accountHash: ACCOUNT_HASH,
      now: 400,
    })).resolves.toEqual({ recovered: 0, scanned: 0, staleLocal: 0 })
  })

  it('never discards a journal row when a newer or unrelated revision is already stored', async () => {
    const mutation = makeMutation()
    const entry = buildAccountMutationJournalEntry(mutation, ACCOUNT_HASH, 100)
    await putAccountMutationIntent(entry)
    const newer = makeRow(mutation, 2, {
      mutationId: '55555555-5555-4555-8555-555555555555',
    })
    await db.accountObjectRevisions.put({
      acknowledgedAt: 100,
      actorId: newer.actorId,
      deletedAt: newer.deletedAt,
      deviceId: newer.deviceId,
      mutationId: newer.mutationId,
      objectId: newer.objectId,
      objectKey: 'item:item_first',
      objectSchemaVersion: newer.objectSchemaVersion,
      objectType: 'item',
      payload: newer.payload,
      revision: newer.revision,
      serverCreatedAt: newer.createdAt,
      serverUpdatedAt: newer.updatedAt,
      tombstone: newer.tombstone,
      tripId: newer.tripId,
      updatedAt: 100,
    })

    await expect(acknowledgeAccountMutation(MUTATION_ID, makeAppliedResult(mutation, 1), 200))
      .rejects.toEqual(new AccountMutationJournalError('stale_ack'))
    await expect(db.accountMutationJournal.get(MUTATION_ID)).resolves.toBeTruthy()

    await db.accountMutationJournal.delete(MUTATION_ID)
    const nextMutation = makeMutation({ mutationId: '66666666-6666-4666-8666-666666666666' })
    await putAccountMutationIntent(buildAccountMutationJournalEntry(nextMutation, ACCOUNT_HASH, 300))
    const equalOther = makeAppliedResult(nextMutation, 2, {
      object: makeRow(nextMutation, 2, { mutationId: MUTATION_ID }),
    })
    await expect(acknowledgeAccountMutation(nextMutation.mutationId, equalOther, 400))
      .rejects.toEqual(new AccountMutationJournalError('stale_ack'))
    await expect(db.accountMutationJournal.get(nextMutation.mutationId)).resolves.toBeTruthy()
  })
})

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

function makeAppliedResult(
  mutation: AccountObjectMutationV1,
  revision: number,
  overrides: Partial<AccountObjectMutationSuccessV1> = {},
): AccountObjectMutationSuccessV1 {
  return {
    appliedRevision: revision,
    currentRevision: revision,
    mutationId: mutation.mutationId,
    object: makeRow(mutation, revision),
    schemaVersion: 1,
    status: 'applied',
    ...overrides,
  }
}

type AccountObjectMutationSuccessV1 = Extract<
  AccountObjectMutationResultV1,
  { object: AccountObjectRowV1 }
>
