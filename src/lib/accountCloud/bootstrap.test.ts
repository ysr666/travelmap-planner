import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'
import type { TicketMeta, Trip } from '../../types'
import {
  activateAccountDatabase,
  activateLegacyDatabaseForTests,
} from '../accountDatabase'
import {
  AccountCloudBootstrapError,
  buildAccountCloudBootstrapPlanV1,
  persistAccountCloudBootstrapPlanV1,
  prepareAccountCloudBootstrapPlanV1,
  readLocalAccountObjectsForTripV1,
} from './bootstrap'
import type { AccountObjectMutationV1, AccountObjectRowV1, JsonObject } from './contract'
import { buildAccountMutationJournalEntry } from './localStore'
import { redactTicketMetaForAccountCloud } from './mutationBuilder'

const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const MUTATION_ID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-08-11T10:00:00.000Z'
const TRIP_ID = 'trip_uk'
let accountHash = ''
let accountDatabaseName = ''
let secondaryDatabaseName = ''
let database: TravelConsoleDatabase

beforeEach(async () => {
  const account = await activateAccountDatabase(`bootstrap-primary-${crypto.randomUUID()}`)
  accountHash = account.accountHash
  accountDatabaseName = account.databaseName
  secondaryDatabaseName = ''
  database = getActiveTravelDatabase()
  await database.delete()
  await database.open()
})

afterEach(async () => {
  activateLegacyDatabaseForTests()
  await Dexie.delete(accountDatabaseName)
  if (secondaryDatabaseName) await Dexie.delete(secondaryDatabaseName)
})

describe('account cloud bootstrap', () => {
  it('classifies every drift state without changing local data', () => {
    const localObjects = [
      makeLocal('trip', TRIP_ID, makeTrip()),
      makeLocal('day', 'day_local', { date: '2026-07-10', id: 'day_local', sortOrder: 0, tripId: TRIP_ID }),
      makeLocal('day', 'day_deleted', { date: '2026-07-11', id: 'day_deleted', sortOrder: 1, tripId: TRIP_ID }),
      makeLocal('item', 'item_drift', makeItemPayload('item_drift', 'Local')),
      makeLocal('item', 'item_pending', makeItemPayload('item_pending', 'Pending')),
    ]
    const remoteRows = [
      makeRow('day', 'day_deleted', null, { deletedAt: NOW, tombstone: true }),
      makeRow('item', 'item_absent_tombstone', null, { deletedAt: NOW, tombstone: true }),
      makeRow('item', 'item_drift', makeItemPayload('item_drift', 'Remote')),
      makeRow('item', 'item_pending', makeItemPayload('item_pending', 'Pending')),
      makeRow('item', 'item_remote', makeItemPayload('item_remote', 'Remote only')),
      makeRow('ledger_budget', 'budget_v2', {
        amountMinor: 100,
        createdAt: 1,
        currency: 'GBP',
        id: 'budget_v2',
        scope: 'trip',
        tripId: TRIP_ID,
        updatedAt: 1,
      }, { objectSchemaVersion: 2 }),
      makeRow('media_asset', 'media_server', {
        id: 'media_server',
        renderRef: 'controlled-media-ref',
        schemaVersion: 1,
        tripId: TRIP_ID,
      }),
      makeRow('trip', TRIP_ID, makeTrip()),
    ].sort(compareRows)

    const plan = buildAccountCloudBootstrapPlanV1({
      localObjects,
      pendingObjectKeys: new Set(['item:item_pending']),
      remoteRows,
      tripId: TRIP_ID,
    })

    expect(Object.fromEntries(plan.entries.map((entry) => [entry.objectKey, entry.status]))).toEqual({
      'day:day_deleted': 'tombstone_drift',
      'day:day_local': 'local_only',
      'item:item_absent_tombstone': 'tombstone_match',
      'item:item_drift': 'payload_drift',
      'item:item_pending': 'pending_mutation',
      'item:item_remote': 'remote_only',
      'ledger_budget:budget_v2': 'schema_unsupported',
      'media_asset:media_server': 'unsupported_remote',
      'trip:trip_uk': 'exact_match',
    })
    expect(plan.summary).toMatchObject({
      exact_match: 1,
      local_only: 1,
      payload_drift: 1,
      pending_mutation: 1,
      remote_only: 1,
      schema_unsupported: 1,
      tombstone_drift: 1,
      tombstone_match: 1,
      unsupported_remote: 1,
    })
  })

  it('rejects duplicate, cross-trip, sensitive, and unregistered local payloads', () => {
    const local = makeLocal('trip', TRIP_ID, makeTrip())
    expect(() => buildAccountCloudBootstrapPlanV1({
      localObjects: [local, local],
      remoteRows: [],
      tripId: TRIP_ID,
    })).toThrow(new AccountCloudBootstrapError('duplicate_object'))
    expect(() => buildAccountCloudBootstrapPlanV1({
      localObjects: [{ ...local, tripId: 'trip_other' }],
      remoteRows: [],
      tripId: TRIP_ID,
    })).toThrow(new AccountCloudBootstrapError('invalid_trip'))
    expect(() => buildAccountCloudBootstrapPlanV1({
      localObjects: [{ ...local, payload: { ...local.payload, accessToken: 'not-allowed' } }],
      remoteRows: [],
      tripId: TRIP_ID,
    })).toThrow()
    expect(() => buildAccountCloudBootstrapPlanV1({
      localObjects: [{ ...local, payload: { ...local.payload, id: 'different' } }],
      remoteRows: [],
      tripId: TRIP_ID,
    })).toThrow()
  })

  it('reads all legacy sync types and redacts ticket metadata before comparison', async () => {
    await database.trips.put(makeTrip())
    await database.ticketMetas.put(makeTicket())

    const objects = await readLocalAccountObjectsForTripV1(TRIP_ID, database)
    const ticket = objects.find((object) => object.objectType === 'ticket_meta')

    expect(objects.map((object) => `${object.objectType}:${object.objectId}`)).toHaveLength(2)
    expect(ticket?.payload).toEqual(toJson(redactTicketMetaForAccountCloud(makeTicket())))
    expect(ticket?.payload).not.toHaveProperty('fileName')
    expect(ticket?.payload).not.toHaveProperty('externalUrl')
    expect(ticket?.payload).not.toHaveProperty('referenceLocation')
    expect(ticket?.payload).not.toHaveProperty('note')
    expect(ticket?.payload).not.toHaveProperty('structuredFields')
  })

  it('atomically seeds only exact live rows and absent tombstones, then reruns idempotently', async () => {
    const trip = makeTrip()
    const ticket = makeTicket()
    await database.trips.put(trip)
    await database.ticketMetas.put(ticket)
    const before = {
      tickets: await database.ticketMetas.toArray(),
      trips: await database.trips.toArray(),
    }
    const remoteRows = [
      makeRow('item', 'item_deleted', null, { deletedAt: NOW, tombstone: true }),
      makeRow('ticket_meta', ticket.id, toJson(redactTicketMetaForAccountCloud(ticket))),
      makeRow('trip', trip.id, trip),
    ]
    const plan = await prepareAccountCloudBootstrapPlanV1({
      accountHash,
      database,
      remoteRows,
      tripId: TRIP_ID,
    })

    const first = await persistAccountCloudBootstrapPlanV1(plan, { accountHash, database, now: 10 })
    expect(first.seededObjectKeys.sort()).toEqual([
      'item:item_deleted',
      `ticket_meta:${ticket.id}`,
      `trip:${trip.id}`,
    ])
    expect(first.skipped).toEqual([])
    expect(await database.accountObjectRevisions.count()).toBe(3)
    expect(await database.accountObjectRevisions.get(`ticket_meta:${ticket.id}`)).toMatchObject({
      payload: toJson(redactTicketMetaForAccountCloud(ticket)),
      revision: 1,
    })
    expect(await database.trips.toArray()).toEqual(before.trips)
    expect(await database.ticketMetas.toArray()).toEqual(before.tickets)

    const second = await persistAccountCloudBootstrapPlanV1(plan, { accountHash, database, now: 20 })
    expect(second.seededObjectKeys).toEqual([])
    expect(second.idempotentObjectKeys.sort()).toEqual(first.seededObjectKeys.sort())
    expect(await database.accountObjectRevisions.count()).toBe(3)
  })

  it('revalidates stale local state and both legacy and V2 pending mutations inside persistence', async () => {
    const trip = makeTrip()
    await database.trips.put(trip)
    const exactRow = makeRow('trip', TRIP_ID, trip)
    const plan = await prepareAccountCloudBootstrapPlanV1({
      accountHash,
      database,
      remoteRows: [exactRow],
      tripId: TRIP_ID,
    })

    await database.trips.put({ ...trip, title: 'Changed after preview' })
    await expect(persistAccountCloudBootstrapPlanV1(plan, { accountHash, database })).resolves.toMatchObject({
      seededObjectKeys: [],
      skipped: [{ objectKey: `trip:${TRIP_ID}`, reason: 'local_state_changed' }],
    })
    await database.trips.put(trip)
    await database.syncOutbox.put({
      attempts: 0,
      createdAt: 1,
      deviceId: 'legacy_device',
      id: 'legacy_pending',
      objectId: TRIP_ID,
      objectKey: `trip:${TRIP_ID}`,
      objectType: 'trip',
      opId: 'legacy_op',
      operation: 'upsert',
      payload: trip,
      status: 'pending',
      tripId: TRIP_ID,
      updatedAt: 1,
      updatedAtMs: 1,
    })
    await expect(persistAccountCloudBootstrapPlanV1(plan, { accountHash, database })).resolves.toMatchObject({
      seededObjectKeys: [],
      skipped: [{ objectKey: `trip:${TRIP_ID}`, reason: 'pending_mutation' }],
    })
    await database.syncOutbox.clear()
    await database.accountMutationJournal.put(buildAccountMutationJournalEntry(
      makeMutation(trip),
      accountHash,
      1,
    ))
    await expect(persistAccountCloudBootstrapPlanV1(plan, { accountHash, database })).resolves.toMatchObject({
      seededObjectKeys: [],
      skipped: [{ objectKey: `trip:${TRIP_ID}`, reason: 'pending_mutation' }],
    })
  })

  it('rejects a tampered plan and a different active account database', async () => {
    const trip = makeTrip()
    await database.trips.put(trip)
    const plan = await prepareAccountCloudBootstrapPlanV1({
      accountHash,
      database,
      remoteRows: [makeRow('trip', TRIP_ID, trip)],
      tripId: TRIP_ID,
    })
    await expect(persistAccountCloudBootstrapPlanV1({
      ...plan,
      remoteSnapshotFingerprint: 'tampered',
    }, { accountHash, database })).rejects.toEqual(new AccountCloudBootstrapError('invalid_plan'))

    const secondary = await activateAccountDatabase(`bootstrap-secondary-${crypto.randomUUID()}`)
    secondaryDatabaseName = secondary.databaseName
    await expect(persistAccountCloudBootstrapPlanV1(plan, { accountHash, database }))
      .rejects.toEqual(new AccountCloudBootstrapError('account_context_mismatch'))
    expect(await getActiveTravelDatabase().accountObjectRevisions.count()).toBe(0)
  })

  it('does not accept an existing receipt with the same revision identifiers but different content', async () => {
    const trip = makeTrip()
    await database.trips.put(trip)
    const row = makeRow('trip', TRIP_ID, trip)
    const plan = await prepareAccountCloudBootstrapPlanV1({
      accountHash,
      database,
      remoteRows: [row],
      tripId: TRIP_ID,
    })
    await database.accountObjectRevisions.put({
      acknowledgedAt: 1,
      actorId: row.actorId,
      deletedAt: row.deletedAt,
      deviceId: row.deviceId,
      mutationId: row.mutationId,
      objectId: row.objectId,
      objectKey: `trip:${TRIP_ID}`,
      objectSchemaVersion: row.objectSchemaVersion,
      objectType: 'trip',
      payload: { ...trip, title: 'Different receipt payload' },
      revision: row.revision,
      serverCreatedAt: row.createdAt,
      serverUpdatedAt: row.updatedAt,
      tombstone: row.tombstone,
      tripId: row.tripId,
      updatedAt: 1,
    })

    await expect(persistAccountCloudBootstrapPlanV1(plan, { accountHash, database })).resolves.toMatchObject({
      idempotentObjectKeys: [],
      seededObjectKeys: [],
      skipped: [{ objectKey: `trip:${TRIP_ID}`, reason: 'existing_revision_conflict' }],
    })
  })
})

function makeLocal(
  objectType: Parameters<typeof buildAccountCloudBootstrapPlanV1>[0]['localObjects'][number]['objectType'],
  objectId: string,
  payload: JsonObject,
) {
  return { objectId, objectType, payload, tripId: TRIP_ID }
}

function makeRow(
  objectType: AccountObjectRowV1['objectType'],
  objectId: string,
  payload: JsonObject | object | null,
  overrides: Partial<AccountObjectRowV1> = {},
): AccountObjectRowV1 {
  return {
    actorId: ACTOR_ID,
    createdAt: NOW,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: MUTATION_ID,
    objectId,
    objectSchemaVersion: 1,
    objectType,
    payload: payload === null ? null : JSON.parse(JSON.stringify(payload)) as JsonObject,
    revision: 1,
    schemaVersion: 1,
    tombstone: false,
    tripId: TRIP_ID,
    updatedAt: NOW,
    ...overrides,
  }
}

function compareRows(left: AccountObjectRowV1, right: AccountObjectRowV1) {
  return `${left.objectType}:${left.objectId}`.localeCompare(`${right.objectType}:${right.objectId}`)
}

function makeTrip(): Trip {
  return {
    createdAt: 1,
    destination: 'London',
    endDate: '2026-07-21',
    id: TRIP_ID,
    startDate: '2026-07-10',
    title: 'UK',
    updatedAt: 1,
  }
}

function makeTicket(): TicketMeta {
  return {
    createdAt: 1,
    externalUrl: 'https://private.example/ticket',
    fileName: 'private-ticket.pdf',
    fileType: 'pdf',
    id: 'ticket_castle',
    mimeType: 'application/pdf',
    note: 'private note',
    referenceLocation: '/private/ticket.pdf',
    size: 100,
    structuredFields: { schemaVersion: 1 },
    ticketCategory: 'admission_ticket',
    title: 'Castle',
    tripId: TRIP_ID,
    updatedAt: 1,
  }
}

function makeItemPayload(id: string, title: string): JsonObject {
  return {
    createdAt: 1,
    dayId: 'day_a',
    id,
    sortOrder: 0,
    ticketIds: [],
    title,
    tripId: TRIP_ID,
    updatedAt: 1,
  }
}

function makeMutation(trip: Trip): AccountObjectMutationV1 {
  return {
    deviceId: 'device_primary',
    expectedRevision: 0,
    mutationId: '33333333-3333-4333-8333-333333333333',
    objectId: trip.id,
    objectSchemaVersion: 1,
    objectType: 'trip',
    operation: 'upsert',
    payload: trip,
    schemaVersion: 1,
    tripId: trip.id,
  }
}

function toJson(value: object) {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}
