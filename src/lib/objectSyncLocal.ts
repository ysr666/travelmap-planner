import { db } from '../db/database'
import { createId } from '../db/ids'
import type {
  Day,
  ItineraryItem,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  ObjectSyncBase,
  ObjectSyncConflict,
  ObjectSyncState,
  SyncObjectPayload,
  SyncObjectType,
  SyncOutboxEntry,
  TicketBlobSyncState,
  TicketMeta,
  TripDisruptionEvent,
  TripReplanRecord,
  Trip,
} from '../types'

const OBJECT_SYNC_DEVICE_ID_KEY = 'tripmap:object-sync:device-id'

type SyncPayload = SyncObjectPayload

export type ObjectSyncRecordInput =
  | { object: Trip; objectType: 'trip'; operation?: 'upsert' }
  | { object: Day; objectType: 'day'; operation?: 'upsert' }
  | { object: ItineraryItem; objectType: 'item'; operation?: 'upsert' }
  | { object: TicketMeta; objectType: 'ticket_meta'; operation?: 'upsert' }
  | { object: LedgerSettings; objectType: 'ledger_settings'; operation?: 'upsert' }
  | { object: LedgerParticipant; objectType: 'ledger_participant'; operation?: 'upsert' }
  | { object: LedgerBudget; objectType: 'ledger_budget'; operation?: 'upsert' }
  | { object: LedgerExpense; objectType: 'ledger_expense'; operation?: 'upsert' }
  | { object: TripDisruptionEvent; objectType: 'replan_event'; operation?: 'upsert' }
  | { object: TripReplanRecord; objectType: 'replan_record'; operation?: 'upsert' }

export type ObjectSyncDeleteInput = {
  objectId: string
  objectType: SyncObjectType
  tripId: string
  deletedAtMs?: number
}

export function buildObjectSyncKey(objectType: SyncObjectType, objectId: string) {
  return `${objectType}:${objectId}`
}

export function getObjectSyncDeviceId() {
  const existing = readStorageValue(OBJECT_SYNC_DEVICE_ID_KEY)
  if (existing) {
    return existing
  }
  const next = createId('device')
  writeStorageValue(OBJECT_SYNC_DEVICE_ID_KEY, next)
  return next
}

export async function enqueueObjectUpsert(input: ObjectSyncRecordInput) {
  const object = input.object
  const now = Date.now()
  const objectId = object.id
  const tripId = getObjectTripId(input.objectType, object)
  const objectKey = buildObjectSyncKey(input.objectType, objectId)
  const updatedAtMs = getObjectUpdatedAt(input.objectType, object)
  const entry: SyncOutboxEntry = {
    attempts: 0,
    createdAt: now,
    deviceId: getObjectSyncDeviceId(),
    id: createId('sync_outbox'),
    objectId,
    objectKey,
    objectType: input.objectType,
    operation: 'upsert',
    opId: createId('op'),
    payload: object,
    status: 'pending',
    tripId,
    updatedAt: now,
    updatedAtMs,
  }
  const state: ObjectSyncState = {
    objectId,
    objectKey,
    objectType: input.objectType,
    localUpdatedAtMs: updatedAtMs,
    tripId,
  }
  await db.transaction('rw', db.syncOutbox, db.objectSyncStates, async () => {
    await db.syncOutbox.add(entry)
    await db.objectSyncStates.put({
      ...await db.objectSyncStates.get(objectKey),
      ...state,
    })
  })
  return entry
}

export async function enqueueObjectDelete({
  deletedAtMs = Date.now(),
  objectId,
  objectType,
  tripId,
}: ObjectSyncDeleteInput) {
  const now = Date.now()
  const objectKey = buildObjectSyncKey(objectType, objectId)
  const entry: SyncOutboxEntry = {
    attempts: 0,
    createdAt: now,
    deletedAtMs,
    deviceId: getObjectSyncDeviceId(),
    id: createId('sync_outbox'),
    objectId,
    objectKey,
    objectType,
    operation: 'delete',
    opId: createId('op'),
    status: 'pending',
    tripId,
    updatedAt: now,
    updatedAtMs: deletedAtMs,
  }
  await db.transaction('rw', db.syncOutbox, db.objectSyncStates, async () => {
    await db.syncOutbox.add(entry)
    await db.objectSyncStates.put({
      ...await db.objectSyncStates.get(objectKey),
      localDeletedAtMs: deletedAtMs,
      objectId,
      objectKey,
      objectType,
      tripId,
    })
  })
  return entry
}

export async function listPendingObjectOutboxEntries(tripId: string) {
  return db.syncOutbox
    .where('[tripId+status]')
    .equals([tripId, 'pending'])
    .or('[tripId+status]')
    .equals([tripId, 'error'])
    .toArray()
}

export async function markObjectOutboxEntriesSyncing(entries: SyncOutboxEntry[], now = Date.now()) {
  if (entries.length === 0) return
  await db.syncOutbox.bulkPut(entries.map((entry) => ({
    ...entry,
    status: 'syncing',
    updatedAt: now,
  })))
}

export async function markObjectOutboxEntriesPending(entries: SyncOutboxEntry[], now = Date.now()) {
  if (entries.length === 0) return
  await db.syncOutbox.bulkPut(entries.map((entry) => ({
    ...entry,
    status: 'pending',
    updatedAt: now,
  })))
}

export async function markObjectOutboxEntriesSynced(entries: SyncOutboxEntry[], cloudUpdatedAtMs: number, now = Date.now()) {
  if (entries.length === 0) return
  const ids = entries.map((entry) => entry.id)
  await db.transaction('rw', db.syncOutbox, db.objectSyncStates, db.objectSyncBases, db.objectSyncConflicts, async () => {
    await db.syncOutbox.bulkDelete(ids)
    await Promise.all(entries.map(async (entry) => {
      const existing = await db.objectSyncStates.get(entry.objectKey)
      await db.objectSyncStates.put({
        ...existing,
        cloudDeletedAtMs: entry.operation === 'delete' ? entry.deletedAtMs ?? entry.updatedAtMs : existing?.cloudDeletedAtMs,
        cloudUpdatedAtMs,
        lastSyncedAt: now,
        localDeletedAtMs: entry.operation === 'delete' ? entry.deletedAtMs ?? entry.updatedAtMs : existing?.localDeletedAtMs,
        localUpdatedAtMs: entry.operation === 'upsert' ? entry.updatedAtMs : existing?.localUpdatedAtMs,
        objectId: entry.objectId,
        objectKey: entry.objectKey,
        objectType: entry.objectType,
        tripId: entry.tripId,
      })
      await db.objectSyncBases.put({
        cloudUpdatedAtMs,
        deletedAtMs: entry.operation === 'delete' ? entry.deletedAtMs ?? entry.updatedAtMs : undefined,
        objectId: entry.objectId,
        objectKey: entry.objectKey,
        objectType: entry.objectType,
        payload: entry.operation === 'upsert' ? entry.payload : undefined,
        tripId: entry.tripId,
        updatedAt: now,
      })
      await db.objectSyncConflicts.where('objectKey').equals(entry.objectKey).delete()
    }))
  })
}

export async function markObjectOutboxEntriesFailed(entries: SyncOutboxEntry[], error: string, now = Date.now()) {
  if (entries.length === 0) return
  await db.syncOutbox.bulkPut(entries.map((entry) => ({
    ...entry,
    attempts: entry.attempts + 1,
    lastError: error,
    status: 'error',
    updatedAt: now,
  })))
}

export async function getObjectSyncBase(objectKey: string) {
  return db.objectSyncBases.get(objectKey)
}

export async function listObjectSyncBasesByTrip(tripId: string) {
  return db.objectSyncBases.where('tripId').equals(tripId).toArray()
}

export async function putObjectSyncBase(base: ObjectSyncBase) {
  await db.objectSyncBases.put(base)
  return base
}

export async function putObjectSyncBaseFromPayload({
  cloudUpdatedAtMs,
  deletedAtMs,
  objectId,
  objectType,
  payload,
  tripId,
}: {
  cloudUpdatedAtMs: number
  deletedAtMs?: number
  objectId: string
  objectType: SyncObjectType
  payload?: SyncObjectPayload
  tripId: string
}) {
  const base: ObjectSyncBase = {
    cloudUpdatedAtMs,
    deletedAtMs,
    objectId,
    objectKey: buildObjectSyncKey(objectType, objectId),
    objectType,
    payload,
    tripId,
    updatedAt: Date.now(),
  }
  await db.objectSyncBases.put(base)
  return base
}

export async function listObjectSyncConflictsByTrip(tripId?: string) {
  if (tripId) {
    return db.objectSyncConflicts
      .where('[tripId+status]')
      .equals([tripId, 'pending'])
      .toArray()
  }
  return db.objectSyncConflicts.where('status').equals('pending').toArray()
}

export async function countObjectSyncConflicts(tripId?: string) {
  if (tripId) {
    return db.objectSyncConflicts
      .where('[tripId+status]')
      .equals([tripId, 'pending'])
      .count()
  }
  return db.objectSyncConflicts.where('status').equals('pending').count()
}

export async function putObjectSyncConflict(conflict: ObjectSyncConflict) {
  const now = Date.now()
  await db.transaction('rw', db.objectSyncConflicts, db.objectSyncStates, async () => {
    await db.objectSyncConflicts.where('objectKey').equals(conflict.objectKey).delete()
    await db.objectSyncConflicts.put({
      ...conflict,
      status: 'pending',
      updatedAt: now,
    })
    await db.objectSyncStates.put({
      ...await db.objectSyncStates.get(conflict.objectKey),
      conflictAt: conflict.createdAt,
      conflictReason: conflict.conflictType === 'field_conflict'
        ? '同一对象的同一字段在此设备和账号中都有不同修改。'
        : '同一对象在此设备和账号中出现删除/更新冲突。',
      objectId: conflict.objectId,
      objectKey: conflict.objectKey,
      objectType: conflict.objectType,
      tripId: conflict.tripId,
    })
  })
}

export async function clearObjectSyncConflict(conflictId: string, now = Date.now()) {
  const conflict = await db.objectSyncConflicts.get(conflictId)
  if (!conflict) return
  await db.transaction('rw', db.objectSyncConflicts, db.objectSyncStates, async () => {
    await db.objectSyncConflicts.put({
      ...conflict,
      status: 'resolved',
      updatedAt: now,
    })
    const remaining = await db.objectSyncConflicts
      .where('objectKey')
      .equals(conflict.objectKey)
      .filter((record) => record.id !== conflictId && record.status === 'pending')
      .count()
    if (remaining === 0) {
      const existing = await db.objectSyncStates.get(conflict.objectKey)
      if (existing) {
        await db.objectSyncStates.put({
          ...existing,
          conflictAt: undefined,
          conflictReason: undefined,
        })
      }
    }
  })
}

export async function deletePendingObjectSyncConflictForKey(objectKey: string) {
  await db.transaction('rw', db.objectSyncConflicts, db.objectSyncStates, async () => {
    await db.objectSyncConflicts.where('objectKey').equals(objectKey).delete()
    const existing = await db.objectSyncStates.get(objectKey)
    if (existing) {
      await db.objectSyncStates.put({
        ...existing,
        conflictAt: undefined,
        conflictReason: undefined,
      })
    }
  })
}

export async function getTicketBlobSyncState(ticketId: string) {
  return db.ticketBlobSyncStates.get(ticketId)
}

export async function listTicketBlobSyncStatesByTrip(tripId: string) {
  return db.ticketBlobSyncStates.where('tripId').equals(tripId).toArray()
}

export async function putTicketBlobSyncState(state: TicketBlobSyncState) {
  await db.ticketBlobSyncStates.put(state)
  return state
}

export async function markTicketBlobPendingUpload({
  blob,
  ticket,
}: {
  blob: Blob
  ticket: TicketMeta
}) {
  const now = Date.now()
  const state: TicketBlobSyncState = {
    ...await db.ticketBlobSyncStates.get(ticket.id),
    cacheStatus: 'cached',
    fileName: ticket.fileName,
    lastCacheCheckedAt: now,
    lastError: undefined,
    mimeType: ticket.mimeType || blob.type || 'application/octet-stream',
    size: blob.size,
    ticketId: ticket.id,
    tripId: ticket.tripId,
    updatedAt: now,
    uploadStatus: 'pending',
  }
  await db.ticketBlobSyncStates.put(state)
  return state
}

export async function markTicketBlobMissing(ticket: TicketMeta, now = Date.now()) {
  const state: TicketBlobSyncState = {
    ...await db.ticketBlobSyncStates.get(ticket.id),
    cacheStatus: 'missing',
    fileName: ticket.fileName,
    lastCacheCheckedAt: now,
    mimeType: ticket.mimeType,
    size: ticket.size,
    ticketId: ticket.id,
    tripId: ticket.tripId,
    updatedAt: now,
    uploadStatus: 'missing',
  }
  await db.ticketBlobSyncStates.put(state)
  return state
}

export async function markTicketBlobDeleted(ticket: TicketMeta, now = Date.now()) {
  const existing = await db.ticketBlobSyncStates.get(ticket.id)
  await db.ticketBlobSyncStates.put({
    ...existing,
    cacheStatus: existing?.cacheStatus ?? 'missing',
    fileName: ticket.fileName,
    mimeType: ticket.mimeType,
    size: existing?.size ?? ticket.size,
    ticketId: ticket.id,
    tripId: ticket.tripId,
    updatedAt: now,
    uploadStatus: 'deleted',
  })
}

function getObjectUpdatedAt(objectType: SyncObjectType, object: SyncPayload) {
  if (objectType === 'day') {
    return Date.now()
  }
  return (object as Exclude<SyncPayload, Day>).updatedAt
}

function getObjectTripId(objectType: SyncObjectType, object: SyncPayload) {
  if (objectType === 'trip') {
    return object.id
  }
  return (object as Exclude<SyncPayload, Trip>).tripId
}

function readStorageValue(key: string) {
  if (typeof window === 'undefined') {
    return undefined
  }
  try {
    return window.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function writeStorageValue(key: string, value: string) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Device ID persistence is best effort; a new one is still safe.
  }
}
