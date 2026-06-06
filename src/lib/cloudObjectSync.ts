import {
  deleteTicketBlob,
  getTicketBlob,
  getTicketMeta,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
} from '../db'
import { db } from '../db/database'
import { createId } from '../db/ids'
import { safeFileName } from './backup'
import { readBlobArrayBuffer } from './blobUtils'
import {
  base64ToBlob,
  blobToBase64,
  getCurrentUser,
  readE2eCloudFixture,
  writeE2eCloudFixture,
  type CloudObjectFixtureRow,
  type CloudTicketBlobFixtureRow,
} from './cloudBackup'
import { emitTravelDataChanged } from './dataEvents'
import {
  buildObjectSyncKey,
  deletePendingObjectSyncConflictForKey,
  enqueueObjectDelete,
  enqueueObjectUpsert,
  getObjectSyncDeviceId,
  getTicketBlobSyncState,
  listObjectSyncBasesByTrip,
  listObjectSyncConflictsByTrip,
  listPendingObjectOutboxEntries,
  listTicketBlobSyncStatesByTrip,
  markObjectOutboxEntriesFailed,
  markObjectOutboxEntriesPending,
  markObjectOutboxEntriesSynced,
  markObjectOutboxEntriesSyncing,
  markTicketBlobMissing,
  putObjectSyncBaseFromPayload,
  putObjectSyncConflict,
  putTicketBlobSyncState,
} from './objectSyncLocal'
import {
  buildObjectConflictLabel,
  mergeObjectPayloadFields,
  resolveObjectSyncConflictPayload,
  type ObjectConflictResolutionInput,
} from './objectSyncMerge'
import { requireSupabaseClient } from './supabaseClient'
import { shouldExpectTicketBlob } from './tickets'
import { recordTripWriteForSync } from './tripSyncQueue'
import type {
  Day,
  ItineraryItem,
  ObjectSyncBase,
  ObjectSyncConflict,
  ObjectSyncConflictField,
  SyncObjectType,
  SyncOutboxEntry,
  SyncObjectPayload,
  TicketBlobSyncState,
  TicketMeta,
  Trip,
} from '../types'

const CLOUD_BACKUP_BUCKET = 'trip-backups'
const CLOUD_SYNC_OBJECTS_TABLE = 'cloud_sync_objects'
const CLOUD_TICKET_BLOBS_TABLE = 'cloud_ticket_blobs'

type CloudSyncObjectRow = {
  deleted_at_ms?: number | null
  device_id: string
  object_id: string
  object_type: SyncObjectType
  op_id: string
  payload?: unknown
  trip_id: string
  updated_at_ms: number
  user_id: string
}

type CloudTicketBlobRow = {
  deleted_at?: string | null
  file_name: string
  mime_type: string
  sha256: string
  size: number
  storage_path: string
  ticket_id: string
  trip_id: string
  uploaded_at: string
  user_id: string
}

export type ObjectSyncResult = {
  exportedAt: string
  warnings: string[]
}

export class CloudObjectSyncUnavailableError extends Error {
  constructor(message = '对象同步表不可用。') {
    super(message)
    this.name = 'CloudObjectSyncUnavailableError'
  }
}

export function isCloudObjectSyncUnavailableError(error: unknown) {
  return error instanceof CloudObjectSyncUnavailableError
}

export async function syncTripObjectsToCloud(tripId: string): Promise<ObjectSyncResult> {
  await ensureTicketBlobSyncStatesForTrip(tripId)
  const fixture = readE2eCloudFixture()
  if (fixture?.user) {
    return syncTripObjectsToE2eFixture(fixture, tripId, fixture.user.id)
  }

  const client = requireSupabaseClient()
  const user = await requireCurrentObjectSyncUser()
  const nowIso = new Date().toISOString()
  const warnings: string[] = []
  const pendingEntries = await listPendingObjectOutboxEntries(tripId)
  const remoteRows = await fetchCloudObjectRows(tripId, user.id)
  const plan = await buildObjectSyncPushPlan({ pendingEntries, remoteRows, tripId, userId: user.id })

  if (plan.rowsToPush.length > 0) {
    await markObjectOutboxEntriesSyncing(plan.entriesToMarkSynced)
    const { error } = await client.from(CLOUD_SYNC_OBJECTS_TABLE).upsert(plan.rowsToPush, {
      onConflict: 'user_id,object_type,object_id',
    })
    if (error) {
      await markObjectOutboxEntriesFailed(plan.entriesToMarkSynced, error.message)
      if (isMissingObjectSyncTableError(error)) {
        throw new CloudObjectSyncUnavailableError(error.message)
      }
      throw new Error('对象同步写入失败：' + error.message)
    }
    await markObjectOutboxEntriesSynced(plan.entriesToMarkSynced, Date.now())
    await putObjectSyncBasesFromRows(plan.rowsToPush)
    if (plan.rowsToApplyAfterPush.length > 0) {
      await applyCloudObjectRows(plan.rowsToApplyAfterPush)
    }
  } else {
    await markObjectOutboxEntriesSynced(plan.entriesToMarkSynced, Date.now())
  }

  if (plan.entriesToKeepPending.length > 0) {
    await markObjectOutboxEntriesPending(plan.entriesToKeepPending)
    warnings.push(`${plan.entriesToKeepPending.length} 个对象需要处理字段冲突后再同步。`)
  }

  await uploadPendingTicketBlobsToCloud({ tripId, userId: user.id })
  await applyCloudTicketBlobRows(await fetchCloudTicketBlobRows(tripId, user.id))
  return { exportedAt: nowIso, warnings }
}

export async function restoreTripObjectsFromCloud(tripId: string): Promise<ObjectSyncResult | null> {
  const fixture = readE2eCloudFixture()
  if (fixture?.user) {
    const rows = (fixture.objectRows ?? []).filter((row) => row.user_id === fixture.user!.id && row.trip_id === tripId)
    if (rows.length === 0) return null
    await applyCloudObjectRows(rows.map(mapFixtureObjectRow))
    await applyCloudTicketBlobRows((fixture.ticketBlobRows ?? []).filter((row) => row.user_id === fixture.user!.id && row.trip_id === tripId).map(mapFixtureTicketBlobRow))
    return { exportedAt: new Date(Math.max(...rows.map((row) => row.updated_at_ms))).toISOString(), warnings: [] }
  }

  const user = await requireCurrentObjectSyncUser()
  const rows = await fetchCloudObjectRows(tripId, user.id)
  if (rows.length === 0) return null
  await applyCloudObjectRows(rows)
  await applyCloudTicketBlobRows(await fetchCloudTicketBlobRows(tripId, user.id))
  return { exportedAt: new Date(Math.max(...rows.map((row) => row.updated_at_ms))).toISOString(), warnings: [] }
}

export async function clearSyncedTicketBlobCache(ticketId: string) {
  const [ticket, state] = await Promise.all([getTicketMeta(ticketId), getTicketBlobSyncState(ticketId)])
  if (!ticket || !shouldExpectTicketBlob(ticket)) {
    throw new Error('没有找到可清理的票据文件。')
  }
  if (state?.uploadStatus !== 'synced' || !state.cloudStoragePath) {
    throw new Error('票据文件尚未同步到账号，不能清理离线缓存。')
  }
  await deleteTicketBlob(ticketId)
  await putTicketBlobSyncState({
    ...state,
    cacheStatus: 'cleared',
    lastCacheCheckedAt: Date.now(),
    updatedAt: Date.now(),
  })
  emitTravelDataChanged()
}

export async function restoreTicketBlobCacheFromCloud(ticketId: string) {
  const fixture = readE2eCloudFixture()
  const ticket = await getTicketMeta(ticketId)
  const state = await getTicketBlobSyncState(ticketId)
  if (!ticket || !state?.cloudStoragePath) {
    throw new Error('没有找到可重新同步的票据文件。')
  }
  const cloudStoragePath = state.cloudStoragePath

  const blob = fixture?.user ? (() => {
    const stored = fixture.files?.[cloudStoragePath]
    if (!stored) {
      throw new Error('账号中的票据文件不可用，请重新上传票据。')
    }
    return base64ToBlob(stored.dataBase64, stored.mimeType)
  })() : await (async () => {
    const bucket = requireSupabaseClient().storage.from(CLOUD_BACKUP_BUCKET)
    const { data, error } = await bucket.download(cloudStoragePath)
    if (error || !data) {
      throw new Error('票据文件重新同步失败：' + (error?.message ?? '账号文件不可用'))
    }
    return data
  })()

  await db.ticketBlobs.put({ blob, ticketId })
  await putTicketBlobSyncState({
    ...state,
    cacheStatus: 'cached',
    lastDownloadedAt: Date.now(),
    lastError: undefined,
    updatedAt: Date.now(),
  })
  emitTravelDataChanged()
}

export async function retryTicketBlobUpload(ticketId: string) {
  const ticket = await getTicketMeta(ticketId)
  const blobRecord = await getTicketBlob(ticketId)
  if (!ticket || !blobRecord) {
    if (ticket) await markTicketBlobMissing(ticket)
    throw new Error('此设备没有可上传的票据离线缓存，请重新上传票据。')
  }
  await putTicketBlobSyncState({
    ...await getTicketBlobSyncState(ticketId),
    cacheStatus: 'cached',
    fileName: ticket.fileName,
    lastError: undefined,
    mimeType: ticket.mimeType || blobRecord.blob.type || 'application/octet-stream',
    size: blobRecord.blob.size,
    ticketId,
    tripId: ticket.tripId,
    updatedAt: Date.now(),
    uploadStatus: 'pending',
  })
}

export async function listPendingObjectSyncConflicts(tripId?: string) {
  return listObjectSyncConflictsByTrip(tripId)
}

export async function resolveObjectSyncConflict(conflictId: string, input: ObjectConflictResolutionInput) {
  const conflict = await db.objectSyncConflicts.get(conflictId)
  if (!conflict || conflict.status !== 'pending') {
    throw new Error('没有找到待处理的同步冲突。')
  }

  const now = Date.now()
  const resolution = resolveObjectSyncConflictPayload(conflict, input, now)
  if (resolution.operation === 'delete') {
    await applyResolvedDelete(conflict.objectType, conflict.objectId)
    await enqueueObjectDelete({
      deletedAtMs: now,
      objectId: conflict.objectId,
      objectType: conflict.objectType,
      tripId: conflict.tripId,
    })
  } else {
    await applyResolvedPayload(conflict.objectType, resolution.payload)
    await enqueueResolvedPayload(conflict.objectType, resolution.payload)
  }

  await db.objectSyncConflicts.put({
    ...conflict,
    status: 'resolved',
    updatedAt: now,
  })
  await db.objectSyncStates.put({
    ...await db.objectSyncStates.get(conflict.objectKey),
    conflictAt: undefined,
    conflictReason: undefined,
    objectId: conflict.objectId,
    objectKey: conflict.objectKey,
    objectType: conflict.objectType,
    tripId: conflict.tripId,
  })
  recordTripWriteForSync(conflict.tripId, 'object-sync-conflict-resolved')
}

export async function getTicketBlobCacheSummary(tripId: string) {
  await ensureTicketBlobSyncStatesForTrip(tripId)
  const [states, tickets] = await Promise.all([
    listTicketBlobSyncStatesByTrip(tripId),
    listTicketsByTrip(tripId),
  ])
  const copyTicketIds = new Set(tickets.filter(shouldExpectTicketBlob).map((ticket) => ticket.id))
  const relevantStates = states.filter((state) => copyTicketIds.has(state.ticketId))
  const cached = relevantStates.filter((state) => state.cacheStatus === 'cached')
  const clearable = relevantStates.filter((state) => state.cacheStatus === 'cached' && state.uploadStatus === 'synced')
  return {
    cachedCount: cached.length,
    cachedSizeBytes: cached.reduce((sum, state) => sum + (state.size ?? 0), 0),
    clearableCount: clearable.length,
    clearableSizeBytes: clearable.reduce((sum, state) => sum + (state.size ?? 0), 0),
    totalCopyTickets: copyTicketIds.size,
  }
}

export async function ensureTicketBlobSyncStatesForTrip(tripId: string) {
  const [tickets, states] = await Promise.all([
    listTicketsByTrip(tripId),
    listTicketBlobSyncStatesByTrip(tripId),
  ])
  const stateTicketIds = new Set(states.map((state) => state.ticketId))
  await Promise.all(tickets.filter(shouldExpectTicketBlob).map(async (ticket) => {
    if (stateTicketIds.has(ticket.id)) return
    const blob = await getTicketBlob(ticket.id)
    if (blob?.blob) {
      await putTicketBlobSyncState({
        cacheStatus: 'cached',
        fileName: ticket.fileName,
        lastCacheCheckedAt: Date.now(),
        mimeType: ticket.mimeType || blob.blob.type || 'application/octet-stream',
        size: blob.blob.size,
        ticketId: ticket.id,
        tripId: ticket.tripId,
        updatedAt: Date.now(),
        uploadStatus: 'pending',
      })
    } else {
      await markTicketBlobMissing(ticket)
    }
  }))
}

export async function clearSyncedTicketBlobCachesForTrip(tripId: string) {
  const states = await listTicketBlobSyncStatesByTrip(tripId)
  const clearable = states.filter((state) => state.cacheStatus === 'cached' && state.uploadStatus === 'synced' && state.cloudStoragePath)
  for (const state of clearable) {
    await clearSyncedTicketBlobCache(state.ticketId)
  }
  return { clearedCount: clearable.length }
}

async function syncTripObjectsToE2eFixture(
  fixture: NonNullable<ReturnType<typeof readE2eCloudFixture>>,
  tripId: string,
  userId: string,
): Promise<ObjectSyncResult> {
  const pendingEntries = await listPendingObjectOutboxEntries(tripId)
  const now = Date.now()
  const nextObjectRows = [...(fixture.objectRows ?? [])]
  const remoteRows = nextObjectRows
    .filter((row) => row.user_id === userId && row.trip_id === tripId)
    .map(mapFixtureObjectRow)
  const plan = await buildObjectSyncPushPlan({ pendingEntries, remoteRows, tripId, userId })

  for (const row of plan.rowsToPush) {
    const index = nextObjectRows.findIndex((existing) =>
      existing.user_id === userId &&
      existing.object_type === row.object_type &&
      existing.object_id === row.object_id
    )
    if (index >= 0) {
      nextObjectRows[index] = row
    } else {
      nextObjectRows.push(row)
    }
  }

  await markObjectOutboxEntriesSynced(plan.entriesToMarkSynced, now)
  await putObjectSyncBasesFromRows(plan.rowsToPush)
  if (plan.rowsToApplyAfterPush.length > 0) {
    await applyCloudObjectRows(plan.rowsToApplyAfterPush)
  }
  if (plan.entriesToKeepPending.length > 0) {
    await markObjectOutboxEntriesPending(plan.entriesToKeepPending, now)
  }
  const fixtureWithObjects = { ...fixture, objectRows: nextObjectRows }
  const uploadedFixture = await uploadPendingTicketBlobsToE2eFixture(fixtureWithObjects, tripId, userId)
  const nextFixture = await deleteRemovedTicketBlobsFromE2eFixture(uploadedFixture, tripId, userId)
  writeE2eCloudFixture(nextFixture)
  return {
    exportedAt: new Date(now).toISOString(),
    warnings: plan.entriesToKeepPending.length > 0
      ? [`${plan.entriesToKeepPending.length} 个对象需要处理字段冲突后再同步。`]
      : [],
  }
}

type ObjectSyncPushPlan = {
  entriesToKeepPending: SyncOutboxEntry[]
  entriesToMarkSynced: SyncOutboxEntry[]
  rowsToApplyAfterPush: CloudSyncObjectRow[]
  rowsToPush: CloudSyncObjectRow[]
}

async function buildObjectSyncPushPlan({
  pendingEntries,
  remoteRows,
  tripId,
  userId,
}: {
  pendingEntries: SyncOutboxEntry[]
  remoteRows: CloudSyncObjectRow[]
  tripId: string
  userId: string
}): Promise<ObjectSyncPushPlan> {
  const pendingConflicts = await listObjectSyncConflictsByTrip(tripId)
  if (remoteRows.length === 0 && pendingConflicts.length === 0) {
    const currentRows = await buildCurrentTripCloudObjectRows(tripId, userId)
    return {
      entriesToKeepPending: [],
      entriesToMarkSynced: pendingEntries,
      rowsToApplyAfterPush: [],
      rowsToPush: mergeCloudObjectRows([
        ...currentRows,
        ...pendingEntries.map((entry) => buildCloudObjectRow(userId, entry)),
      ]),
    }
  }

  const bases = new Map((await listObjectSyncBasesByTrip(tripId)).map((base) => [base.objectKey, base]))
  const remoteByKey = new Map(mergeCloudObjectRows(remoteRows).map((row) => [buildObjectSyncKey(row.object_type, row.object_id), row]))
  const pendingByKey = groupPendingEntriesByObject(pendingEntries)
  const keys = new Set([...remoteByKey.keys(), ...pendingByKey.keys()])
  const plan: ObjectSyncPushPlan = {
    entriesToKeepPending: [],
    entriesToMarkSynced: [],
    rowsToApplyAfterPush: [],
    rowsToPush: [],
  }
  const remoteRowsToApply: CloudSyncObjectRow[] = []

  for (const objectKey of keys) {
    const remoteRow = remoteByKey.get(objectKey)
    const entriesForObject = pendingByKey.get(objectKey) ?? []
    const latestEntry = getLatestPendingEntry(entriesForObject)
    const base = bases.get(objectKey)
    const remoteChanged = remoteRow ? isRemoteRowChangedSinceBase(remoteRow, base) : false

    if (remoteRow && !latestEntry) {
      if (remoteChanged) {
        remoteRowsToApply.push(remoteRow)
      }
      continue
    }

    if (latestEntry && !remoteRow) {
      plan.rowsToPush.push(buildCloudObjectRow(userId, latestEntry))
      plan.entriesToMarkSynced.push(...entriesForObject)
      continue
    }

    if (!latestEntry || !remoteRow) {
      continue
    }

    const localRow = buildCloudObjectRow(userId, latestEntry)
    if (isSameCloudObjectValue(localRow, remoteRow)) {
      plan.entriesToMarkSynced.push(...entriesForObject)
      await putObjectSyncBaseFromCloudRow(remoteRow)
      await deletePendingObjectSyncConflictForKey(objectKey)
      continue
    }

    if (!remoteChanged) {
      plan.rowsToPush.push(localRow)
      plan.entriesToMarkSynced.push(...entriesForObject)
      continue
    }

    if (localRow.deleted_at_ms && remoteRow.deleted_at_ms) {
      if (localRow.updated_at_ms > remoteRow.updated_at_ms) {
        plan.rowsToPush.push(localRow)
      } else {
        await putObjectSyncBaseFromCloudRow(remoteRow)
      }
      plan.entriesToMarkSynced.push(...entriesForObject)
      continue
    }

    const conflict = buildObjectLevelConflict({ base, entriesForObject, localRow, remoteRow, tripId })
    if (conflict) {
      await putObjectSyncConflict(conflict)
      plan.entriesToKeepPending.push(...entriesForObject)
      continue
    }

    const mergeResult = buildMergedCloudObjectRow({
      base,
      localRow,
      now: Date.now(),
      remoteRow,
      userId,
    })
    if (mergeResult.conflict) {
      await putObjectSyncConflict(mergeResult.conflict)
      plan.entriesToKeepPending.push(...entriesForObject)
      continue
    }
    const mergedRow = mergeResult.row
    if (!mergedRow) {
      plan.entriesToKeepPending.push(...entriesForObject)
      continue
    }

    plan.rowsToPush.push(mergedRow)
    plan.rowsToApplyAfterPush.push(mergedRow)
    plan.entriesToMarkSynced.push(...entriesForObject)
  }

  if (remoteRowsToApply.length > 0) {
    await applyCloudObjectRows(remoteRowsToApply)
  }

  return {
    ...plan,
    entriesToKeepPending: dedupeOutboxEntries(plan.entriesToKeepPending),
    entriesToMarkSynced: dedupeOutboxEntries(plan.entriesToMarkSynced),
    rowsToPush: mergeCloudObjectRows(plan.rowsToPush),
  }
}

async function buildCurrentTripCloudObjectRows(tripId: string, userId: string): Promise<CloudSyncObjectRow[]> {
  const [trip, days, items, tickets] = await Promise.all([
    getTrip(tripId),
    listDaysByTrip(tripId),
    listItemsByTrip(tripId),
    listTicketsByTrip(tripId),
  ])
  if (!trip) return []
  const deviceId = getObjectSyncDeviceId()
  return [
    buildCloudObjectUpsertRow({ object: trip, objectType: 'trip', tripId, userId, deviceId }),
    ...days.map((day) => buildCloudObjectUpsertRow({ object: day, objectType: 'day' as const, tripId, userId, deviceId })),
    ...items.map((item) => buildCloudObjectUpsertRow({ object: item, objectType: 'item' as const, tripId, userId, deviceId })),
    ...tickets.map((ticket) => buildCloudObjectUpsertRow({ object: ticket, objectType: 'ticket_meta' as const, tripId, userId, deviceId })),
  ]
}

function groupPendingEntriesByObject(entries: SyncOutboxEntry[]) {
  const byObject = new Map<string, SyncOutboxEntry[]>()
  for (const entry of entries) {
    byObject.set(entry.objectKey, [...(byObject.get(entry.objectKey) ?? []), entry])
  }
  for (const [key, group] of byObject) {
    byObject.set(key, group.sort(compareOutboxEntryAscending))
  }
  return byObject
}

function getLatestPendingEntry(entries: SyncOutboxEntry[]) {
  return [...entries].sort(compareOutboxEntryAscending).at(-1)
}

function compareOutboxEntryAscending(first: SyncOutboxEntry, second: SyncOutboxEntry) {
  return first.updatedAtMs - second.updatedAtMs || first.createdAt - second.createdAt
}

function dedupeOutboxEntries(entries: SyncOutboxEntry[]) {
  const byId = new Map<string, SyncOutboxEntry>()
  for (const entry of entries) {
    byId.set(entry.id, entry)
  }
  return [...byId.values()]
}

function isRemoteRowChangedSinceBase(row: CloudSyncObjectRow, base?: ObjectSyncBase) {
  if (!base) return true
  if (row.updated_at_ms > base.cloudUpdatedAtMs) return true
  const rowDeletedAt = row.deleted_at_ms ?? undefined
  if (rowDeletedAt !== base.deletedAtMs) return true
  if (!isSameJsonRecord(row.payload, base.payload)) return true
  return false
}

function isSameCloudObjectValue(left: CloudSyncObjectRow, right: CloudSyncObjectRow) {
  return left.object_type === right.object_type &&
    left.object_id === right.object_id &&
    (left.deleted_at_ms ?? undefined) === (right.deleted_at_ms ?? undefined) &&
    isSameJsonRecord(left.payload, right.payload)
}

function buildObjectLevelConflict({
  base,
  localRow,
  remoteRow,
  tripId,
}: {
  base?: ObjectSyncBase
  entriesForObject: SyncOutboxEntry[]
  localRow: CloudSyncObjectRow
  remoteRow: CloudSyncObjectRow
  tripId: string
}) {
  if (localRow.deleted_at_ms && !remoteRow.deleted_at_ms) {
    return buildFieldConflict({
      base,
      fields: [],
      localRow,
      remoteRow,
      tripId,
      type: 'local_delete_remote_update',
    })
  }
  if (!localRow.deleted_at_ms && remoteRow.deleted_at_ms) {
    return buildFieldConflict({
      base,
      fields: [],
      localRow,
      remoteRow,
      tripId,
      type: 'remote_delete_local_update',
    })
  }
  return null
}

function buildMergedCloudObjectRow({
  base,
  localRow,
  now,
  remoteRow,
  userId,
}: {
  base?: ObjectSyncBase
  localRow: CloudSyncObjectRow
  now: number
  remoteRow: CloudSyncObjectRow
  userId: string
}): { conflict?: ObjectSyncConflict; row: CloudSyncObjectRow } | { conflict: ObjectSyncConflict; row?: undefined } {
  if (!localRow.payload || !remoteRow.payload) {
    return {
      conflict: buildFieldConflict({
        base,
        fields: [],
        localRow,
        remoteRow,
        tripId: localRow.trip_id,
        type: 'field_conflict',
      }),
    }
  }
  const merge = mergeObjectPayloadFields({
    basePayload: base?.payload,
    localPayload: localRow.payload as SyncObjectPayload,
    now,
    objectType: localRow.object_type,
    remotePayload: remoteRow.payload as SyncObjectPayload,
  })
  if (merge.status === 'conflict') {
    return {
      conflict: buildFieldConflict({
        base,
        fields: merge.conflicts,
        localRow,
        remoteRow,
        tripId: localRow.trip_id,
        type: 'field_conflict',
      }),
    }
  }
  const payload = merge.payload
  return {
    row: {
      deleted_at_ms: null,
      device_id: getObjectSyncDeviceId(),
      object_id: localRow.object_id,
      object_type: localRow.object_type,
      op_id: createStableObjectOpId(localRow.object_type, localRow.object_id, getPayloadUpdatedAt(localRow.object_type, payload)),
      payload,
      trip_id: localRow.trip_id,
      updated_at_ms: getPayloadUpdatedAt(localRow.object_type, payload),
      user_id: userId,
    },
  }
}

function buildFieldConflict({
  base,
  fields,
  localRow,
  remoteRow,
  tripId,
  type,
}: {
  base?: ObjectSyncBase
  fields: ObjectSyncConflictField[]
  localRow: CloudSyncObjectRow
  remoteRow: CloudSyncObjectRow
  tripId: string
  type: ObjectSyncConflict['conflictType']
}): ObjectSyncConflict {
  const now = Date.now()
  const localPayload = localRow.payload as SyncObjectPayload | undefined
  const remotePayload = remoteRow.payload as SyncObjectPayload | undefined
  return {
    basePayload: base?.payload,
    createdAt: now,
    fields,
    conflictType: type,
    id: createId('object_conflict'),
    localDeletedAtMs: localRow.deleted_at_ms ?? undefined,
    localPayload,
    objectId: localRow.object_id,
    objectKey: buildObjectSyncKey(localRow.object_type, localRow.object_id),
    objectLabel: buildObjectConflictLabel(localRow.object_type, localPayload ?? remotePayload ?? base?.payload),
    objectType: localRow.object_type,
    remoteDeletedAtMs: remoteRow.deleted_at_ms ?? undefined,
    remotePayload,
    status: 'pending',
    tripId,
    updatedAt: now,
  }
}

async function putObjectSyncBaseFromCloudRow(row: CloudSyncObjectRow) {
  await putObjectSyncBaseFromPayload({
    cloudUpdatedAtMs: row.updated_at_ms,
    deletedAtMs: row.deleted_at_ms ?? undefined,
    objectId: row.object_id,
    objectType: row.object_type,
    payload: row.payload as SyncObjectPayload | undefined,
    tripId: row.trip_id,
  })
}

async function putObjectSyncBasesFromRows(rows: CloudSyncObjectRow[]) {
  await Promise.all(rows.map(putObjectSyncBaseFromCloudRow))
}

async function uploadPendingTicketBlobsToE2eFixture(
  fixture: NonNullable<ReturnType<typeof readE2eCloudFixture>>,
  tripId: string,
  userId: string,
) {
  const states = await listTicketBlobSyncStatesByTrip(tripId)
  const files = { ...(fixture.files ?? {}) }
  const ticketBlobRows = [...(fixture.ticketBlobRows ?? [])]

  for (const state of states.filter((record) => record.uploadStatus === 'pending' || record.uploadStatus === 'error')) {
    const ticket = await getTicketMeta(state.ticketId)
    const blobRecord = await getTicketBlob(state.ticketId)
    if (!ticket || !blobRecord) {
      if (ticket) await markTicketBlobMissing(ticket)
      continue
    }
    const next = await buildUploadedTicketBlobState({ blob: blobRecord.blob, ticket, userId })
    files[next.cloudStoragePath!] = {
      dataBase64: await blobToBase64(blobRecord.blob),
      mimeType: next.mimeType ?? blobRecord.blob.type,
      size: next.size ?? blobRecord.blob.size,
    }
    const row = buildCloudTicketBlobRow(userId, next)
    const index = ticketBlobRows.findIndex((existing) => existing.user_id === userId && existing.ticket_id === ticket.id)
    if (index >= 0) {
      ticketBlobRows[index] = row
    } else {
      ticketBlobRows.push(row)
    }
    await putTicketBlobSyncState(next)
  }

  return {
    ...fixture,
    files,
    ticketBlobRows,
  }
}

async function deleteRemovedTicketBlobsFromE2eFixture(
  fixture: NonNullable<ReturnType<typeof readE2eCloudFixture>>,
  tripId: string,
  userId: string,
) {
  const states = await listTicketBlobSyncStatesByTrip(tripId)
  const deletedStates = states.filter((state) => state.uploadStatus === 'deleted' && state.cloudStoragePath)
  if (deletedStates.length === 0) return fixture
  const files = { ...(fixture.files ?? {}) }
  const deletedTicketIds = new Set(deletedStates.map((state) => state.ticketId))
  for (const state of deletedStates) {
    if (state.cloudStoragePath) delete files[state.cloudStoragePath]
  }
  return {
    ...fixture,
    files,
    ticketBlobRows: (fixture.ticketBlobRows ?? []).filter((row) => !(row.user_id === userId && deletedTicketIds.has(row.ticket_id))),
  }
}

async function uploadPendingTicketBlobsToCloud({ tripId, userId }: { tripId: string; userId: string }) {
  const states = await listTicketBlobSyncStatesByTrip(tripId)
  const bucket = requireSupabaseClient().storage.from(CLOUD_BACKUP_BUCKET)
  const client = requireSupabaseClient()

  for (const state of states.filter((record) => record.uploadStatus === 'pending' || record.uploadStatus === 'error')) {
    const ticket = await getTicketMeta(state.ticketId)
    const blobRecord = await getTicketBlob(state.ticketId)
    if (!ticket || !blobRecord) {
      if (ticket) await markTicketBlobMissing(ticket)
      continue
    }

    const uploading: TicketBlobSyncState = {
      ...state,
      cacheStatus: 'cached',
      lastError: undefined,
      updatedAt: Date.now(),
      uploadStatus: 'uploading',
    }
    await putTicketBlobSyncState(uploading)

    try {
      const next = await buildUploadedTicketBlobState({ blob: blobRecord.blob, ticket, userId })
      const { error: uploadError } = await bucket.upload(next.cloudStoragePath!, blobRecord.blob, {
        contentType: next.mimeType,
        upsert: true,
      })
      if (uploadError) {
        throw new Error(uploadError.message)
      }
      const { error: tableError } = await client.from(CLOUD_TICKET_BLOBS_TABLE).upsert(buildCloudTicketBlobRow(userId, next), {
        onConflict: 'user_id,ticket_id',
      })
      if (tableError) {
        if (isMissingObjectSyncTableError(tableError)) {
          throw new CloudObjectSyncUnavailableError(tableError.message)
        }
        throw new Error(tableError.message)
      }
      await putTicketBlobSyncState(next)
    } catch (caught) {
      if (caught instanceof CloudObjectSyncUnavailableError) throw caught
      await putTicketBlobSyncState({
        ...uploading,
        lastError: caught instanceof Error ? caught.message : '票据文件上传失败。',
        updatedAt: Date.now(),
        uploadStatus: 'error',
      })
      throw new Error('票据文件上传失败：' + (caught instanceof Error ? caught.message : '未知错误'), { cause: caught })
    }
  }

  await deleteRemovedTicketBlobsFromCloud({ tripId, userId })
}

async function deleteRemovedTicketBlobsFromCloud({ tripId, userId }: { tripId: string; userId: string }) {
  const states = await listTicketBlobSyncStatesByTrip(tripId)
  const deletedStates = states.filter((state) => state.uploadStatus === 'deleted' && state.cloudStoragePath)
  if (deletedStates.length === 0) return
  const client = requireSupabaseClient()
  const bucket = client.storage.from(CLOUD_BACKUP_BUCKET)
  const paths = deletedStates.map((state) => state.cloudStoragePath).filter((path): path is string => Boolean(path))
  if (paths.length > 0) {
    const { error } = await bucket.remove(paths)
    if (error) {
      throw new Error('票据文件云端缓存清理失败：' + error.message)
    }
  }
  const deletedAt = new Date().toISOString()
  await Promise.all(deletedStates.map(async (state) => {
    const { error } = await client
      .from(CLOUD_TICKET_BLOBS_TABLE)
      .update({ deleted_at: deletedAt })
      .eq('user_id', userId)
      .eq('ticket_id', state.ticketId)
    if (error) {
      if (isMissingObjectSyncTableError(error)) {
        throw new CloudObjectSyncUnavailableError(error.message)
      }
      throw new Error('票据文件云端记录删除失败：' + error.message)
    }
  }))
}

async function fetchCloudObjectRows(tripId: string, userId: string) {
  const client = requireSupabaseClient()
  const { data, error } = await client
    .from(CLOUD_SYNC_OBJECTS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('trip_id', tripId)

  if (error) {
    if (isMissingObjectSyncTableError(error)) {
      throw new CloudObjectSyncUnavailableError(error.message)
    }
    throw new Error('对象同步读取失败：' + error.message)
  }
  return (data ?? []) as CloudSyncObjectRow[]
}

async function fetchCloudTicketBlobRows(tripId: string, userId: string) {
  const client = requireSupabaseClient()
  const { data, error } = await client
    .from(CLOUD_TICKET_BLOBS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('trip_id', tripId)
    .is('deleted_at', null)

  if (error) {
    if (isMissingObjectSyncTableError(error)) {
      throw new CloudObjectSyncUnavailableError(error.message)
    }
    throw new Error('票据文件云端引用读取失败：' + error.message)
  }
  return (data ?? []) as CloudTicketBlobRow[]
}

async function applyCloudTicketBlobRows(rows: CloudTicketBlobRow[]) {
  if (rows.length === 0) return
  await Promise.all(rows.map(async (row) => {
    const localBlob = await getTicketBlob(row.ticket_id)
    await putTicketBlobSyncState({
      ...await getTicketBlobSyncState(row.ticket_id),
      cacheStatus: localBlob ? 'cached' : 'cleared',
      cloudStoragePath: row.storage_path,
      fileName: row.file_name,
      lastUploadedAt: Date.parse(row.uploaded_at),
      mimeType: row.mime_type,
      sha256: row.sha256,
      size: row.size,
      ticketId: row.ticket_id,
      tripId: row.trip_id,
      updatedAt: Date.now(),
      uploadStatus: 'synced',
    })
  }))
}

async function applyCloudObjectRows(rows: CloudSyncObjectRow[]) {
  if (rows.length === 0) return
  const orderedRows = [...rows].sort((first, second) => first.updated_at_ms - second.updated_at_ms)
  let didApplyDataChange = false
  await db.transaction(
    'rw',
    [
      db.trips,
      db.days,
      db.itineraryItems,
      db.ticketMetas,
      db.ticketBlobs,
      db.objectSyncStates,
      db.objectSyncBases,
      db.objectSyncConflicts,
    ],
    async () => {
      for (const row of orderedRows) {
        const objectKey = buildObjectSyncKey(row.object_type, row.object_id)
        const existingState = await db.objectSyncStates.get(objectKey)
        if (row.deleted_at_ms) {
          didApplyDataChange = await applyRemoteDelete(row) || didApplyDataChange
        } else if (row.payload) {
          didApplyDataChange = await applyRemotePayload(row) || didApplyDataChange
        }
        await db.objectSyncStates.put({
          ...existingState,
          cloudDeletedAtMs: row.deleted_at_ms ?? existingState?.cloudDeletedAtMs,
          cloudUpdatedAtMs: row.updated_at_ms,
          conflictAt: undefined,
          conflictReason: undefined,
          lastSyncedAt: Date.now(),
          objectId: row.object_id,
          objectKey,
          objectType: row.object_type,
          tripId: row.trip_id,
        })
        await db.objectSyncBases.put({
          cloudUpdatedAtMs: row.updated_at_ms,
          deletedAtMs: row.deleted_at_ms ?? undefined,
          objectId: row.object_id,
          objectKey,
          objectType: row.object_type,
          payload: row.deleted_at_ms ? undefined : row.payload as SyncObjectPayload | undefined,
          tripId: row.trip_id,
          updatedAt: Date.now(),
        })
        await db.objectSyncConflicts.where('objectKey').equals(objectKey).delete()
      }
    },
  )
  if (didApplyDataChange) {
    emitTravelDataChanged()
  }
}

async function applyRemotePayload(row: CloudSyncObjectRow) {
  if (row.object_type === 'trip') {
    if (isSameJsonRecord(await db.trips.get(row.object_id), row.payload)) return false
    await db.trips.put(row.payload as Trip)
  } else if (row.object_type === 'day') {
    if (isSameJsonRecord(await db.days.get(row.object_id), row.payload)) return false
    await db.days.put(row.payload as Day)
  } else if (row.object_type === 'item') {
    if (isSameJsonRecord(await db.itineraryItems.get(row.object_id), row.payload)) return false
    await db.itineraryItems.put(row.payload as ItineraryItem)
  } else if (row.object_type === 'ticket_meta') {
    if (isSameJsonRecord(await db.ticketMetas.get(row.object_id), row.payload)) return false
    await db.ticketMetas.put(row.payload as TicketMeta)
  }
  return true
}

async function applyResolvedPayload(objectType: SyncObjectType, payload: SyncObjectPayload) {
  await db.transaction('rw', db.trips, db.days, db.itineraryItems, db.ticketMetas, async () => {
    if (objectType === 'trip') {
      await db.trips.put(payload as Trip)
    } else {
      await db.trips.update((payload as Day | ItineraryItem | TicketMeta).tripId, { updatedAt: Date.now() })
      if (objectType === 'day') {
        await db.days.put(payload as Day)
      } else if (objectType === 'item') {
        await db.itineraryItems.put(payload as ItineraryItem)
      } else {
        await db.ticketMetas.put(payload as TicketMeta)
      }
    }
  })
}

async function enqueueResolvedPayload(objectType: SyncObjectType, payload: SyncObjectPayload) {
  if (objectType === 'trip') {
    await enqueueObjectUpsert({ object: payload as Trip, objectType: 'trip' })
  } else if (objectType === 'day') {
    await enqueueObjectUpsert({ object: payload as Day, objectType: 'day' })
  } else if (objectType === 'item') {
    await enqueueObjectUpsert({ object: payload as ItineraryItem, objectType: 'item' })
  } else {
    await enqueueObjectUpsert({ object: payload as TicketMeta, objectType: 'ticket_meta' })
  }
}

async function applyRemoteDelete(row: CloudSyncObjectRow) {
  if (row.object_type === 'trip') {
    if (!await db.trips.get(row.object_id)) return false
    await db.trips.delete(row.object_id)
  } else if (row.object_type === 'day') {
    if (!await db.days.get(row.object_id)) return false
    await db.days.delete(row.object_id)
  } else if (row.object_type === 'item') {
    if (!await db.itineraryItems.get(row.object_id)) return false
    await db.itineraryItems.delete(row.object_id)
  } else if (row.object_type === 'ticket_meta') {
    if (!await db.ticketMetas.get(row.object_id)) return false
    await db.ticketMetas.delete(row.object_id)
    await db.ticketBlobs.delete(row.object_id)
  }
  return true
}

async function applyResolvedDelete(objectType: SyncObjectType, objectId: string) {
  await db.transaction('rw', [db.trips, db.days, db.itineraryItems, db.ticketMetas, db.ticketBlobs], async () => {
    if (objectType === 'trip') {
      await db.trips.delete(objectId)
    } else if (objectType === 'day') {
      const day = await db.days.get(objectId)
      if (day) await db.trips.update(day.tripId, { updatedAt: Date.now() })
      await db.days.delete(objectId)
    } else if (objectType === 'item') {
      const item = await db.itineraryItems.get(objectId)
      if (item) await db.trips.update(item.tripId, { updatedAt: Date.now() })
      await db.itineraryItems.delete(objectId)
    } else {
      const ticket = await db.ticketMetas.get(objectId)
      if (ticket) await db.trips.update(ticket.tripId, { updatedAt: Date.now() })
      await db.ticketMetas.delete(objectId)
      await db.ticketBlobs.delete(objectId)
    }
  })
}

async function buildUploadedTicketBlobState({
  blob,
  ticket,
  userId,
}: {
  blob: Blob
  ticket: TicketMeta
  userId: string
}): Promise<TicketBlobSyncState> {
  const sha256 = await hashBlobSha256(blob)
  const fileName = safeFileName(ticket.fileName, ticket.id)
  const cloudStoragePath = buildObjectTicketBlobPath(userId, ticket.tripId, ticket.id, sha256, fileName)
  return {
    ...await getTicketBlobSyncState(ticket.id),
    cacheStatus: 'cached',
    cloudStoragePath,
    fileName,
    lastError: undefined,
    lastUploadedAt: Date.now(),
    mimeType: ticket.mimeType || blob.type || 'application/octet-stream',
    sha256,
    size: blob.size,
    ticketId: ticket.id,
    tripId: ticket.tripId,
    updatedAt: Date.now(),
    uploadStatus: 'synced',
  }
}

function buildCloudObjectRow(userId: string, entry: SyncOutboxEntry): CloudSyncObjectRow {
  return {
    deleted_at_ms: entry.operation === 'delete' ? entry.deletedAtMs ?? entry.updatedAtMs : null,
    device_id: entry.deviceId,
    object_id: entry.objectId,
    object_type: entry.objectType,
    op_id: entry.opId,
    payload: entry.operation === 'upsert' ? entry.payload : null,
    trip_id: entry.tripId,
    updated_at_ms: entry.updatedAtMs,
    user_id: userId,
  }
}

function buildCloudObjectUpsertRow({
  deviceId,
  object,
  objectType,
  tripId,
  userId,
}: {
  deviceId: string
  object: Day | ItineraryItem | TicketMeta | Trip
  objectType: SyncObjectType
  tripId: string
  userId: string
}): CloudSyncObjectRow {
  return {
    deleted_at_ms: null,
    device_id: deviceId,
    object_id: object.id,
    object_type: objectType,
    op_id: createStableObjectOpId(objectType, object.id, getPayloadUpdatedAt(objectType, object)),
    payload: object,
    trip_id: tripId,
    updated_at_ms: getPayloadUpdatedAt(objectType, object),
    user_id: userId,
  }
}

function mergeCloudObjectRows(rows: CloudSyncObjectRow[]) {
  const byObject = new Map<string, CloudSyncObjectRow>()
  for (const row of rows) {
    const key = buildObjectSyncKey(row.object_type, row.object_id)
    const existing = byObject.get(key)
    if (!existing || row.updated_at_ms >= existing.updated_at_ms || row.deleted_at_ms) {
      byObject.set(key, row)
    }
  }
  return [...byObject.values()]
}

function createStableObjectOpId(objectType: SyncObjectType, objectId: string, updatedAtMs: number) {
  return `op:${objectType}:${objectId}:${updatedAtMs}`
}

function getPayloadUpdatedAt(objectType: SyncObjectType, object: Day | ItineraryItem | TicketMeta | Trip) {
  if (objectType === 'day') return Date.now()
  return (object as ItineraryItem | TicketMeta | Trip).updatedAt
}

function buildCloudTicketBlobRow(userId: string, state: TicketBlobSyncState): CloudTicketBlobRow {
  if (!state.cloudStoragePath || !state.sha256 || !state.fileName || !state.mimeType || state.size == null) {
    throw new Error('票据文件同步状态缺少云端引用。')
  }
  return {
    deleted_at: state.uploadStatus === 'deleted' ? new Date().toISOString() : null,
    file_name: state.fileName,
    mime_type: state.mimeType,
    sha256: state.sha256,
    size: state.size,
    storage_path: state.cloudStoragePath,
    ticket_id: state.ticketId,
    trip_id: state.tripId,
    uploaded_at: new Date(state.lastUploadedAt ?? Date.now()).toISOString(),
    user_id: userId,
  }
}

function mapFixtureObjectRow(row: CloudObjectFixtureRow): CloudSyncObjectRow {
  return {
    deleted_at_ms: row.deleted_at_ms,
    device_id: row.device_id,
    object_id: row.object_id,
    object_type: row.object_type as SyncObjectType,
    op_id: row.op_id,
    payload: row.payload,
    trip_id: row.trip_id,
    updated_at_ms: row.updated_at_ms,
    user_id: row.user_id,
  }
}

function mapFixtureTicketBlobRow(row: CloudTicketBlobFixtureRow): CloudTicketBlobRow {
  return {
    deleted_at: row.deleted_at,
    file_name: row.file_name,
    mime_type: row.mime_type,
    sha256: row.sha256,
    size: row.size,
    storage_path: row.storage_path,
    ticket_id: row.ticket_id,
    trip_id: row.trip_id,
    uploaded_at: row.uploaded_at,
    user_id: row.user_id,
  }
}

function isSameJsonRecord(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function buildObjectTicketBlobPath(userId: string, tripId: string, ticketId: string, sha256: string, fileName: string) {
  return `${safePathSegment(userId)}/objects/${safePathSegment(tripId)}/tickets/${safePathSegment(ticketId)}/${safePathSegment(sha256)}-${safeFileName(fileName, 'ticket')}`
}

async function hashBlobSha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await readBlobArrayBuffer(blob))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function requireCurrentObjectSyncUser() {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('请先登录后再使用云端同步。')
  }
  return user
}

function isMissingObjectSyncTableError(error: { code?: string; message?: string }) {
  const message = error.message ?? ''
  return error.code === '42P01' || message.includes(CLOUD_SYNC_OBJECTS_TABLE) || message.includes(CLOUD_TICKET_BLOBS_TABLE)
}

function safePathSegment(value: string) {
  const clean = safeFileName(value, 'segment')
  if (!clean || clean.includes('/') || clean.includes('\\') || clean === '.' || clean === '..') {
    throw new Error('云端对象路径包含不安全片段。')
  }
  return clean
}
