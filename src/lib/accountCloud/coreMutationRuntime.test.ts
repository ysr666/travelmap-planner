import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import * as repo from '../../db/repositories'
import type { Trip } from '../../types'
import {
  activateAccountDatabase,
  activateLegacyDatabaseForTests,
} from '../accountDatabase'
import { AccountCloudTransportError } from './client'
import type {
  AccountObjectMutationResultV1,
  AccountObjectMutationV1,
} from './contract'
import {
  AccountCloudWriteError,
  createCoreAccountObject,
  updateCoreAccountObject,
} from './coreMutationRuntime'
import { drainAccountMutationJournal } from './coordinator'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  mode: vi.fn<() => 'disabled' | 'enabled' | 'shadow'>(() => 'enabled'),
}))

vi.mock('./feature', () => ({
  getAccountCloudV2Mode: mocks.mode,
  isAccountCloudV2AccountEnabled: (accountHash: string | null) => (
    mocks.mode() === 'enabled' && Boolean(accountHash)
  ),
}))

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return {
    ...actual,
    commitAccountObjectMutationV1: mocks.commit,
  }
})

const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const NOW_ISO = '2026-08-11T10:00:00.000Z'
const PRIMARY_ACCOUNT = 'core-runtime-account'
let accountDatabaseName = ''
let secondaryDatabaseName = ''

beforeEach(async () => {
  accountDatabaseName = (await activateAccountDatabase(PRIMARY_ACCOUNT)).databaseName
  secondaryDatabaseName = ''
  await db.delete()
  await db.open()
  mocks.commit.mockReset()
  mocks.mode.mockReset()
  mocks.mode.mockReturnValue('enabled')
  mocks.commit.mockImplementation(async (mutation: AccountObjectMutationV1) => (
    makeSuccessResult(mutation)
  ))
})

afterEach(async () => {
  activateLegacyDatabaseForTests()
  await Dexie.delete(accountDatabaseName)
  if (secondaryDatabaseName) await Dexie.delete(secondaryDatabaseName)
})

describe('core account-cloud mutation runtime', () => {
  it('atomically creates, acknowledges, and persists a cloud revision', async () => {
    const result = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('London')),
      objectType: 'trip',
    })

    expect(result.handled).toBe(true)
    const trip = result.handled ? result.value : undefined
    expect(trip).toBeTruthy()
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    await expect(db.accountObjectRevisions.get(`trip:${trip?.id}`)).resolves.toMatchObject({
      mutationId: expect.any(String),
      revision: 1,
    })
  })

  it('retains optimistic data only for a retryable transport failure', async () => {
    mocks.commit.mockRejectedValue(new AccountCloudTransportError('request_failed', true))
    const result = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('Offline London')),
      objectType: 'trip',
    })

    expect(result.handled).toBe(true)
    const trip = result.handled ? result.value : undefined
    await expect(db.trips.get(trip?.id ?? '')).resolves.toEqual(trip)
    await expect(db.accountMutationJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ lastErrorCode: 'request_failed', status: 'retry' }),
    ])
  })

  it('rolls back an unauthorized create without leaving a hidden replay', async () => {
    mocks.commit.mockRejectedValue(new AccountCloudTransportError('permission_denied', false))
    let createdId = ''

    await expect(createCoreAccountObject({
      apply: async () => {
        const trip = await repo.createTrip(makeTripInput('Denied'))
        createdId = trip.id
        return trip
      },
      objectType: 'trip',
    })).rejects.toEqual(new AccountCloudWriteError('contract_unavailable'))

    await expect(db.trips.get(createdId)).resolves.toBeUndefined()
    await expect(db.accountMutationJournal.toArray()).resolves.toEqual([])
  })

  it('rolls back the full local transaction when payload validation fails', async () => {
    let createdId = ''
    await expect(createCoreAccountObject({
      apply: async () => {
        const trip = await repo.createTrip(makeTripInput('Sensitive'))
        createdId = trip.id
        return { ...trip, password: 'must-not-persist' } as Trip
      },
      objectType: 'trip',
    })).rejects.toThrow()

    await expect(db.trips.get(createdId)).resolves.toBeUndefined()
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('leaves unbootstrapped updates on the legacy path without applying twice', async () => {
    const trip = await repo.createTrip(makeTripInput('Legacy'))
    const apply = vi.fn(() => repo.updateTrip(trip.id, { title: 'Cloud title' }))

    await expect(updateCoreAccountObject({
      apply,
      objectId: trip.id,
      objectType: 'trip',
      tripId: trip.id,
    })).resolves.toEqual({ handled: false })

    expect(apply).not.toHaveBeenCalled()
    await expect(db.trips.get(trip.id)).resolves.toMatchObject({ title: 'Legacy' })
  })

  it('updates a bootstrapped object and rolls back a server conflict', async () => {
    const created = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('Original')),
      objectType: 'trip',
    })
    if (!created.handled) throw new Error('expected cloud create')
    const trip = created.value
    mocks.commit.mockImplementationOnce(async (mutation: AccountObjectMutationV1) => ({
      currentObject: makeRow(mutation, 2, '33333333-3333-4333-8333-333333333333'),
      currentRevision: 2,
      mutationId: mutation.mutationId,
      reason: 'revision_mismatch',
      schemaVersion: 1,
      status: 'conflict',
    }))

    await expect(updateCoreAccountObject({
      apply: () => repo.updateTrip(trip.id, { title: 'Local edit' }),
      objectId: trip.id,
      objectType: 'trip',
      tripId: trip.id,
    })).rejects.toEqual(new AccountCloudWriteError('conflict'))

    await expect(db.trips.get(trip.id)).resolves.toMatchObject({ title: 'Original' })
    await expect(db.accountMutationJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ optimisticResolution: 'rolled_back', status: 'conflict' }),
    ])
  })

  it('rejects an update when local state no longer matches its acknowledged revision', async () => {
    const created = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('Original')),
      objectType: 'trip',
    })
    if (!created.handled) throw new Error('expected cloud create')
    const trip = created.value
    await repo.updateTrip(trip.id, { title: 'Legacy-only edit' })
    const apply = vi.fn(() => repo.updateTrip(trip.id, { title: 'Unsafe overwrite' }))

    await expect(updateCoreAccountObject({
      apply,
      objectId: trip.id,
      objectType: 'trip',
      tripId: trip.id,
    })).rejects.toEqual(new AccountCloudWriteError('invalid_state'))

    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    await expect(db.trips.get(trip.id)).resolves.toMatchObject({ title: 'Legacy-only edit' })
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
  })

  it('never reconciles an old account write against the newly active account database', async () => {
    let objectId = ''
    mocks.commit.mockImplementationOnce(async (mutation: AccountObjectMutationV1) => {
      objectId = mutation.objectId
      secondaryDatabaseName = (await activateAccountDatabase('core-runtime-secondary')).databaseName
      await db.open()
      await db.trips.put({
        ...(mutation.payload as unknown as Trip),
        title: 'Secondary account record',
      })
      return makeSuccessResult(mutation)
    })

    const result = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('Primary optimistic record')),
      objectType: 'trip',
    })

    expect(result).toMatchObject({ handled: true, value: { title: 'Primary optimistic record' } })
    await expect(db.trips.get(objectId)).resolves.toMatchObject({ title: 'Secondary account record' })
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)

    await activateAccountDatabase(PRIMARY_ACCOUNT)
    await db.open()
    await expect(db.trips.get(objectId)).resolves.toMatchObject({ title: 'Primary optimistic record' })
    await expect(db.accountMutationJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ status: 'inflight' }),
    ])
  })

  it('chains offline edits by revision and drains them in order exactly once', async () => {
    mocks.commit.mockRejectedValue(new AccountCloudTransportError('request_failed', true))
    const created = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('First')),
      objectType: 'trip',
    })
    if (!created.handled) throw new Error('expected cloud create')
    const trip = created.value

    const updated = await updateCoreAccountObject({
      apply: () => repo.updateTrip(trip.id, { title: 'Second' }),
      objectId: trip.id,
      objectType: 'trip',
      tripId: trip.id,
    })
    expect(updated).toMatchObject({ handled: true, value: { title: 'Second' } })
    const queued = (await db.accountMutationJournal.toArray())
      .sort((left, right) => left.createdAt - right.createdAt)
    expect(queued.map((entry) => entry.expectedRevision)).toEqual([0, 1])
    expect(queued[1]?.createdAt).toBeGreaterThan(queued[0]?.createdAt ?? 0)

    await db.accountMutationJournal.toCollection().modify({ retryAt: 0, status: 'pending' })
    mocks.commit.mockImplementation(async (mutation: AccountObjectMutationV1) => (
      makeSuccessResult(mutation, mutation.expectedRevision + 1)
    ))
    const drained = await drainAccountMutationJournal({ now: () => Date.now() })

    expect(drained.processed.map((result) => result.status)).toEqual(['committed', 'committed'])
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
    await expect(db.accountObjectRevisions.get(`trip:${trip.id}`)).resolves.toMatchObject({
      revision: 2,
      payload: expect.objectContaining({ title: 'Second' }),
    })
  })

  it('rolls back an entire dependent optimistic chain when background replay conflicts', async () => {
    mocks.commit.mockRejectedValue(new AccountCloudTransportError('request_failed', true))
    const created = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('First')),
      objectType: 'trip',
    })
    if (!created.handled) throw new Error('expected cloud create')
    const trip = created.value
    await updateCoreAccountObject({
      apply: () => repo.updateTrip(trip.id, { title: 'Second' }),
      objectId: trip.id,
      objectType: 'trip',
      tripId: trip.id,
    })
    await db.accountMutationJournal.toCollection().modify({ retryAt: 0, status: 'pending' })
    mocks.commit.mockImplementation(async (mutation: AccountObjectMutationV1) => ({
      currentObject: null,
      currentRevision: 0,
      mutationId: mutation.mutationId,
      reason: 'revision_mismatch',
      schemaVersion: 1,
      status: 'conflict',
    }))

    const result = await drainAccountMutationJournal({
      now: () => Date.now(),
      reconcileOptimistic: true,
    })

    expect(result.processed).toHaveLength(1)
    await expect(db.trips.get(trip.id)).resolves.toBeUndefined()
    await expect(db.accountMutationJournal.toArray()).resolves.toEqual([
      expect.objectContaining({ status: 'conflict' }),
      expect.objectContaining({ status: 'conflict' }),
    ])
  })

  it('rolls back and discards dependent optimistic writes after a definitive denial', async () => {
    mocks.commit.mockRejectedValue(new AccountCloudTransportError('request_failed', true))
    const created = await createCoreAccountObject({
      apply: () => repo.createTrip(makeTripInput('Denied later')),
      objectType: 'trip',
    })
    if (!created.handled) throw new Error('expected cloud create')
    const trip = created.value
    await db.accountMutationJournal.toCollection().modify({ retryAt: 0, status: 'pending' })
    mocks.commit.mockRejectedValue(new AccountCloudTransportError('permission_denied', false))

    await drainAccountMutationJournal({ now: () => Date.now(), reconcileOptimistic: true })

    await expect(db.trips.get(trip.id)).resolves.toBeUndefined()
    await expect(db.accountMutationJournal.count()).resolves.toBe(0)
  })

  it('preserves the legacy runtime when the feature is disabled', async () => {
    mocks.mode.mockReturnValue('disabled')
    const apply = vi.fn(() => repo.createTrip(makeTripInput('Disabled')))

    await expect(createCoreAccountObject({ apply, objectType: 'trip' }))
      .resolves.toEqual({ handled: false })
    expect(apply).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    await expect(db.trips.count()).resolves.toBe(0)
  })
})

function makeTripInput(title: string) {
  return {
    destination: 'United Kingdom',
    endDate: '2026-08-20',
    startDate: '2026-08-11',
    title,
  }
}

function makeRow(
  mutation: AccountObjectMutationV1,
  revision: number,
  mutationId = mutation.mutationId,
) {
  return {
    actorId: ACTOR_ID,
    createdAt: NOW_ISO,
    deletedAt: null,
    deviceId: mutation.deviceId,
    mutationId,
    objectId: mutation.objectId,
    objectSchemaVersion: mutation.objectSchemaVersion,
    objectType: mutation.objectType,
    payload: mutation.payload ?? null,
    revision,
    schemaVersion: 1 as const,
    tombstone: false,
    tripId: mutation.tripId,
    updatedAt: NOW_ISO,
  }
}

function makeSuccessResult(
  mutation: AccountObjectMutationV1,
  revision = 1,
): AccountObjectMutationResultV1 {
  return {
    appliedRevision: revision,
    currentRevision: revision,
    mutationId: mutation.mutationId,
    object: makeRow(mutation, revision),
    schemaVersion: 1,
    status: 'applied',
  }
}
