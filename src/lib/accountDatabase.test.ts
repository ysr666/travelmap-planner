// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { LEGACY_TRAVEL_DATABASE_NAME, TravelConsoleDatabase } from '../db/database'
import type { Trip } from '../types'
import {
  activateAccountDatabase,
  buildAccountTravelDatabaseName,
  hashAccountId,
  migrateLegacyDatabaseToAccount,
  summarizeLegacyDatabase,
  activateLegacyDatabaseForTests,
} from './accountDatabase'

const accountIds = ['account-a', 'account-b']

beforeEach(async () => {
  activateLegacyDatabaseForTests()
  await deleteTestDatabases()
  window.localStorage.clear()
})

afterEach(async () => {
  activateLegacyDatabaseForTests()
  await deleteTestDatabases()
  window.localStorage.clear()
})

describe('account-scoped travel database', () => {
  it('isolates records between account database namespaces', async () => {
    const { accountHash } = await activateAccountDatabase(accountIds[0])
    await db.trips.put(makeTrip('trip-a'))
    await db.accountObjectRevisions.put({
      acknowledgedAt: 1,
      actorId: '22222222-2222-4222-8222-222222222222',
      deletedAt: null,
      deviceId: 'device-a',
      mutationId: '11111111-1111-4111-8111-111111111111',
      objectId: 'trip-a',
      objectKey: 'trip:trip-a',
      objectSchemaVersion: 1,
      objectType: 'trip',
      payload: makeTrip('trip-a'),
      revision: 1,
      serverCreatedAt: '2026-08-11T10:00:00.000Z',
      serverUpdatedAt: '2026-08-11T10:00:00.000Z',
      tombstone: false,
      tripId: 'trip-a',
      updatedAt: 1,
    })
    await db.accountMutationJournal.put({
      accountHash,
      attempts: 0,
      createdAt: 1,
      deviceId: 'device-a',
      expectedRevision: 1,
      mutationId: '33333333-3333-4333-8333-333333333333',
      objectId: 'trip-a',
      objectKey: 'trip:trip-a',
      objectSchemaVersion: 1,
      objectType: 'trip',
      operation: 'upsert',
      payload: { ...makeTrip('trip-a'), title: 'Pending' },
      requestFingerprint: 'test-only-fingerprint',
      status: 'pending',
      tripId: 'trip-a',
      updatedAt: 1,
    })

    await activateAccountDatabase(accountIds[1])
    expect(await db.trips.count()).toBe(0)
    expect(await db.accountObjectRevisions.count()).toBe(0)
    expect(await db.accountMutationJournal.count()).toBe(0)
    await db.trips.put(makeTrip('trip-b'))

    await activateAccountDatabase(accountIds[0])
    expect((await db.trips.toArray()).map((trip) => trip.id)).toEqual(['trip-a'])
    expect(await db.accountObjectRevisions.count()).toBe(1)
    expect(await db.accountMutationJournal.count()).toBe(1)
  })

  it('copies domain records, rebuilds sync state, and preserves the legacy database', async () => {
    const legacy = new TravelConsoleDatabase()
    await legacy.open()
    await legacy.trips.put(makeTrip('legacy-trip'))
    await legacy.objectSyncStates.put({
      objectId: 'stale',
      objectKey: 'trip:stale',
      objectType: 'trip',
      tripId: 'stale',
    })
    legacy.close()

    const result = await migrateLegacyDatabaseToAccount(accountIds[0])

    expect(result.tripCount).toBe(1)
    expect(result.queuedObjects).toBe(1)
    expect(await db.trips.get('legacy-trip')).toBeTruthy()
    expect(await db.objectSyncStates.get('trip:stale')).toBeUndefined()
    expect(await db.objectSyncStates.get('trip:legacy-trip')).toBeTruthy()
    expect(await db.syncOutbox.where('objectKey').equals('trip:legacy-trip').count()).toBe(1)
    expect(await Dexie.exists(LEGACY_TRAVEL_DATABASE_NAME)).toBe(true)
    expect((await summarizeLegacyDatabase()).tripCount).toBe(1)
  })
})

function makeTrip(id: string): Trip {
  return {
    createdAt: 1,
    destination: 'Tokyo',
    endDate: '2026-06-22',
    id,
    startDate: '2026-06-21',
    title: id,
    updatedAt: 1,
  }
}

async function deleteTestDatabases() {
  const names = [LEGACY_TRAVEL_DATABASE_NAME]
  for (const accountId of accountIds) {
    names.push(buildAccountTravelDatabaseName(await hashAccountId(accountId)))
  }
  for (const name of names) {
    try {
      await Dexie.delete(name)
    } catch {
      // A failed test may already have removed the database.
    }
  }
}
