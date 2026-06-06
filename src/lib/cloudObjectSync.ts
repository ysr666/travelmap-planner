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
  getObjectSyncDeviceId,
  getTicketBlobSyncState,
  listPendingObjectOutboxEntries,
  listTicketBlobSyncStatesByTrip,
  markObjectOutboxEntriesFailed,
  markObjectOutboxEntriesSynced,
  markObjectOutboxEntriesSyncing,
  markTicketBlobMissing,
  putTicketBlobSyncState,
} from './objectSyncLocal'
import { requireSupabaseClient } from './supabaseClient'
import { shouldExpectTicketBlob } from './tickets'
import type {
  Day,
  ItineraryItem,
  SyncObjectType,
  SyncOutboxEntry,
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
  const currentRows = await buildCurrentTripCloudObjectRows(tripId, user.id)

  if (currentRows.length > 0 || pendingEntries.length > 0) {
    await markObjectOutboxEntriesSyncing(pendingEntries)
    const rows = mergeCloudObjectRows([
      ...currentRows,
      ...pendingEntries.map((entry) => buildCloudObjectRow(user.id, entry)),
    ])
    const { error } = await client.from(CLOUD_SYNC_OBJECTS_TABLE).upsert(rows, {
      onConflict: 'user_id,object_type,object_id',
    })
    if (error) {
      await markObjectOutboxEntriesFailed(pendingEntries, error.message)
      if (isMissingObjectSyncTableError(error)) {
        throw new CloudObjectSyncUnavailableError(error.message)
      }
      throw new Error('对象同步写入失败：' + error.message)
    }
    await markObjectOutboxEntriesSynced(pendingEntries, Date.now())
  }

  await uploadPendingTicketBlobsToCloud({ tripId, userId: user.id })
  await pullTripObjectsFromCloud({ tripId, userId: user.id })
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
  const currentRows = await buildCurrentTripCloudObjectRows(tripId, userId)

  for (const row of mergeCloudObjectRows([
    ...currentRows,
    ...pendingEntries.map((entry) => buildCloudObjectRow(userId, entry)),
  ])) {
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

  await markObjectOutboxEntriesSynced(pendingEntries, now)
  const fixtureWithObjects = { ...fixture, objectRows: nextObjectRows }
  const uploadedFixture = await uploadPendingTicketBlobsToE2eFixture(fixtureWithObjects, tripId, userId)
  const nextFixture = await deleteRemovedTicketBlobsFromE2eFixture(uploadedFixture, tripId, userId)
  writeE2eCloudFixture(nextFixture)
  await applyCloudObjectRows(nextObjectRows.filter((row) => row.user_id === userId && row.trip_id === tripId).map(mapFixtureObjectRow))
  return { exportedAt: new Date(now).toISOString(), warnings: [] }
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

async function pullTripObjectsFromCloud({ tripId, userId }: { tripId: string; userId: string }) {
  const rows = await fetchCloudObjectRows(tripId, userId)
  await applyCloudObjectRows(rows)
  await applyCloudTicketBlobRows(await fetchCloudTicketBlobRows(tripId, userId))
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
    [db.trips, db.days, db.itineraryItems, db.ticketMetas, db.ticketBlobs, db.objectSyncStates],
    async () => {
      for (const row of orderedRows) {
        const objectKey = buildObjectSyncKey(row.object_type, row.object_id)
        const existingState = await db.objectSyncStates.get(objectKey)
        if ((existingState?.localUpdatedAtMs ?? 0) > row.updated_at_ms && !existingState?.lastSyncedAt) {
          await db.objectSyncStates.put({
            ...existingState,
            conflictAt: Date.now(),
            conflictReason: '同一对象在此设备和账号中都有更新。',
            objectId: row.object_id,
            objectKey,
            objectType: row.object_type,
            tripId: row.trip_id,
          })
          continue
        }
        if (row.deleted_at_ms) {
          didApplyDataChange = await applyRemoteDelete(row) || didApplyDataChange
        } else if (row.payload) {
          didApplyDataChange = await applyRemotePayload(row) || didApplyDataChange
        }
        await db.objectSyncStates.put({
          ...existingState,
          cloudDeletedAtMs: row.deleted_at_ms ?? existingState?.cloudDeletedAtMs,
          cloudUpdatedAtMs: row.updated_at_ms,
          lastSyncedAt: Date.now(),
          objectId: row.object_id,
          objectKey,
          objectType: row.object_type,
          tripId: row.trip_id,
        })
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
