import { db } from '../db/database'
import { createId } from '../db/ids'
import type {
  ReminderSchedule,
  TransportBooking,
  TransportSegment,
  TravelCenterSyncConflict,
  TravelCenterSyncState,
  VaultBlobRecord,
  VaultKeyState,
  VaultObjectRecord,
} from '../types'
import { requireSupabaseClient } from './supabaseClient'

type RemoteTransportRow = {
  trip_id: string
  object_type: 'transport_booking' | 'transport_segment'
  object_id: string
  payload: TransportBooking | TransportSegment | null
  updated_at_ms: number
  deleted_at_ms?: number | null
}

type RemoteVaultObjectRow = {
  vault_id: string
  object_type: VaultObjectRecord['objectType']
  object_id: string
  key_version: number
  schema_version: number
  aad_version: number
  iv: string
  ciphertext: string
  created_at_ms: number
  updated_at_ms: number
  deleted_at_ms?: number | null
}

type RemoteVaultBlobRow = {
  vault_id: string
  blob_id: string
  object_id: string
  storage_path: string
  key_version: number
  schema_version: number
  aad_version: number
  iv: string
  encrypted_size: number
  created_at_ms: number
  updated_at_ms: number
  deleted_at_ms?: number | null
}

type RemoteKeyRow = {
  vault_id: string
  owner_id: string
  key_version: number
  schema_version: number
  salt: string
  wrap_iv: string
  wrapped_key: string
  pbkdf2_iterations: number
  updated_at_ms: number
}

type RemoteReminderRow = {
  id: string
  occurrence_id: string
  vault_id?: string | null
  trip_id?: string | null
  object_type: ReminderSchedule['objectType']
  object_id: string
  reminder_kind: ReminderSchedule['kind']
  trigger_at: string
  time_zone: string
  status: ReminderSchedule['status']
  sent_at?: string | null
  created_at: string
  updated_at: string
}

export type TravelCenterSyncResult = {
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
}

export async function syncTravelCenter(): Promise<TravelCenterSyncResult> {
  const client = requireSupabaseClient()
  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError || !authData.user) throw new Error('请先登录 Supabase 账号再同步旅行资料。')
  const userId = authData.user.id
  const result: TravelCenterSyncResult = { conflicts: 0, deleted: 0, downloaded: 0, uploaded: 0 }
  await syncKeyEnvelope(userId, result)
  await applyLocalTombstones(userId, result)
  await syncTransportRows(userId, result)
  await syncVaultObjectRows(userId, result)
  await syncVaultBlobRows(userId, result)
  await syncReminderRows(userId, result)
  return result
}

export function listTravelCenterSyncConflicts() {
  return db.travelCenterSyncConflicts.where('status').equals('pending').toArray()
}

export async function resolveTravelCenterSyncConflict(conflictId: string, choice: 'local' | 'remote') {
  const conflict = await db.travelCenterSyncConflicts.get(conflictId)
  if (!conflict) return
  if (choice === 'remote') await applyRemoteConflict(conflict)
  const currentState = await db.travelCenterSyncStates.get(conflict.objectKey)
  const localUpdatedAt = await getLocalUpdatedAt(conflict.objectType, conflict.objectId)
  await db.travelCenterSyncStates.put({
    lastSyncedAt: Date.now(),
    objectId: conflict.objectId,
    objectKey: conflict.objectKey,
    objectType: conflict.objectType,
    syncedCloudUpdatedAt: conflict.cloudUpdatedAt,
    syncedLocalUpdatedAt: choice === 'remote' ? localUpdatedAt : (currentState?.syncedLocalUpdatedAt ?? 0),
  })
  await db.travelCenterSyncConflicts.update(conflictId, { status: 'resolved', updatedAt: Date.now() })
}

async function syncKeyEnvelope(userId: string, result: TravelCenterSyncResult) {
  const client = requireSupabaseClient()
  const local = await db.vaultKeyState.orderBy('updatedAt').last()
  const { data, error } = await client.from('vault_key_envelopes').select('*').eq('user_id', userId).order('updated_at_ms', { ascending: false }).limit(1)
  if (error) throw new Error('读取加密资料库密钥信封失败。')
  const remote = data?.[0] as RemoteKeyRow | undefined
  if (!local && remote) {
    await db.vaultKeyState.put(remoteKeyToLocal(remote))
    result.downloaded += 1
    return
  }
  if (!local) return
  if (remote && remote.vault_id !== local.vaultId) throw new Error('云端存在另一份旅行资料库，请先导出本机加密备份后再处理。')
  if (remote && remote.updated_at_ms > local.updatedAt) {
    await db.vaultKeyState.put(remoteKeyToLocal(remote))
    result.downloaded += 1
    return
  }
  const { error: uploadError } = await client.from('vault_key_envelopes').upsert({
    key_version: local.keyVersion,
    owner_id: local.ownerId,
    pbkdf2_iterations: local.pbkdf2Iterations,
    salt: local.salt,
    schema_version: local.schemaVersion,
    updated_at_ms: local.updatedAt,
    user_id: userId,
    vault_id: local.vaultId,
    wrap_iv: local.wrapIv,
    wrapped_key: local.wrappedKey,
  }, { onConflict: 'user_id,vault_id' })
  if (uploadError) throw new Error('上传加密资料库密钥信封失败。')
  result.uploaded += 1
}

async function applyLocalTombstones(userId: string, result: TravelCenterSyncResult) {
  const client = requireSupabaseClient()
  const tombstones = await db.travelCenterTombstones.toArray()
  for (const tombstone of tombstones) {
    if (tombstone.objectType === 'transport_booking' || tombstone.objectType === 'transport_segment') {
      const { error } = await client.from('cloud_transport_objects').upsert({
        deleted_at_ms: tombstone.deletedAt,
        object_id: tombstone.objectId,
        object_type: tombstone.objectType,
        payload: null,
        trip_id: tombstone.tripId ?? 'deleted',
        updated_at_ms: tombstone.deletedAt,
        user_id: userId,
      }, { onConflict: 'user_id,object_type,object_id' })
      if (error) throw new Error('同步交通订单删除状态失败。')
    } else if (tombstone.objectType === 'vault_object') {
      await client.from('cloud_vault_objects').update({ deleted_at_ms: tombstone.deletedAt, updated_at_ms: tombstone.deletedAt }).eq('user_id', userId).eq('object_id', tombstone.objectId)
    } else if (tombstone.objectType === 'vault_blob') {
      const { data } = await client.from('cloud_vault_blobs').select('storage_path').eq('user_id', userId).eq('blob_id', tombstone.objectId).maybeSingle()
      if (data?.storage_path) await client.storage.from('travel-vault').remove([data.storage_path])
      await client.from('cloud_vault_blobs').update({ deleted_at_ms: tombstone.deletedAt, updated_at_ms: tombstone.deletedAt }).eq('user_id', userId).eq('blob_id', tombstone.objectId)
    }
    await db.travelCenterTombstones.delete(tombstone.objectKey)
    await db.travelCenterSyncStates.delete(tombstone.objectKey)
    result.deleted += 1
  }
}

async function syncTransportRows(userId: string, result: TravelCenterSyncResult) {
  const client = requireSupabaseClient()
  const [bookings, segments, remoteResult] = await Promise.all([
    db.transportBookings.toArray(),
    db.transportSegments.toArray(),
    client.from('cloud_transport_objects').select('*').eq('user_id', userId),
  ])
  if (remoteResult.error) throw new Error('读取云端交通订单失败。')
  const localRows = [
    ...bookings.map((payload) => ({ objectType: 'transport_booking' as const, payload })),
    ...segments.map((payload) => ({ objectType: 'transport_segment' as const, payload })),
  ]
  const remoteRows = (remoteResult.data ?? []) as RemoteTransportRow[]
  await syncRecordSet({
    applyRemote: async (remote) => {
      if (remote.deleted_at_ms) {
        if (remote.object_type === 'transport_booking') await db.transportBookings.delete(remote.object_id)
        else await db.transportSegments.delete(remote.object_id)
        return
      }
      if (!remote.payload) return
      if (remote.object_type === 'transport_booking') await db.transportBookings.put(remote.payload as TransportBooking)
      else await db.transportSegments.put(remote.payload as TransportSegment)
    },
    localRows: localRows.map(({ objectType, payload }) => ({ id: payload.id, objectType, payload, updatedAt: payload.updatedAt })),
    remoteRows: remoteRows.map((row) => ({ id: row.object_id, objectType: row.object_type, raw: row, updatedAt: row.deleted_at_ms ?? row.updated_at_ms })),
    result,
    uploadLocal: async (local) => {
      const payload = local.payload as TransportBooking | TransportSegment
      const { error } = await client.from('cloud_transport_objects').upsert({
        deleted_at_ms: null,
        object_id: local.id,
        object_type: local.objectType,
        payload,
        trip_id: payload.tripId,
        updated_at_ms: payload.updatedAt,
        user_id: userId,
      }, { onConflict: 'user_id,object_type,object_id' })
      if (error) throw new Error('上传交通订单失败。')
    },
  })
}

async function syncVaultObjectRows(userId: string, result: TravelCenterSyncResult) {
  const client = requireSupabaseClient()
  const [localRows, remoteResult] = await Promise.all([
    db.vaultObjects.toArray(),
    client.from('cloud_vault_objects').select('*').eq('user_id', userId),
  ])
  if (remoteResult.error) throw new Error('读取云端加密资料失败。')
  await syncRecordSet({
    applyRemote: async (remote) => {
      if (remote.deleted_at_ms) await db.vaultObjects.delete(remote.object_id)
      else await db.vaultObjects.put(remoteVaultObjectToLocal(remote))
    },
    localRows: localRows.map((payload) => ({ id: payload.id, objectType: 'vault_object' as const, payload, updatedAt: payload.updatedAt })),
    remoteRows: ((remoteResult.data ?? []) as RemoteVaultObjectRow[]).map((row) => ({ id: row.object_id, objectType: 'vault_object' as const, raw: row, updatedAt: row.deleted_at_ms ?? row.updated_at_ms })),
    result,
    uploadLocal: async (local) => {
      const object = local.payload as VaultObjectRecord
      const { error } = await client.from('cloud_vault_objects').upsert({
        aad_version: object.aadVersion,
        ciphertext: object.ciphertext,
        created_at_ms: object.createdAt,
        deleted_at_ms: null,
        iv: object.iv,
        key_version: object.keyVersion,
        object_id: object.id,
        object_type: object.objectType,
        schema_version: object.schemaVersion,
        updated_at_ms: object.updatedAt,
        user_id: userId,
        vault_id: object.vaultId,
      }, { onConflict: 'user_id,vault_id,object_id' })
      if (error) throw new Error('上传加密资料失败。')
    },
  })
}

async function syncVaultBlobRows(userId: string, result: TravelCenterSyncResult) {
  const client = requireSupabaseClient()
  const [localRows, remoteResult] = await Promise.all([
    db.vaultBlobs.toArray(),
    client.from('cloud_vault_blobs').select('*').eq('user_id', userId),
  ])
  if (remoteResult.error) throw new Error('读取云端加密附件失败。')
  await syncRecordSet({
    applyRemote: async (remote) => {
      if (remote.deleted_at_ms) { await db.vaultBlobs.delete(remote.blob_id); return }
      const { data, error } = await client.storage.from('travel-vault').download(remote.storage_path)
      if (error || !data) throw new Error('下载加密附件失败。')
      const existing = await db.vaultBlobs.get(remote.blob_id)
      await db.vaultBlobs.put(remoteVaultBlobToLocal(remote, data, existing))
    },
    localRows: localRows.map((payload) => ({ id: payload.id, objectType: 'vault_blob' as const, payload, updatedAt: payload.updatedAt })),
    remoteRows: ((remoteResult.data ?? []) as RemoteVaultBlobRow[]).map((row) => ({ id: row.blob_id, objectType: 'vault_blob' as const, raw: row, updatedAt: row.deleted_at_ms ?? row.updated_at_ms })),
    result,
    uploadLocal: async (local) => {
      const blob = local.payload as VaultBlobRecord
      const path = `${userId}/${blob.vaultId}/${blob.id}.bin`
      const { error: storageError } = await client.storage.from('travel-vault').upload(path, blob.ciphertext, { contentType: 'application/octet-stream', upsert: true })
      if (storageError) throw new Error('上传加密附件失败。')
      const { error } = await client.from('cloud_vault_blobs').upsert({
        aad_version: blob.aadVersion,
        blob_id: blob.id,
        created_at_ms: blob.createdAt,
        deleted_at_ms: null,
        encrypted_size: blob.ciphertext.size,
        iv: blob.iv,
        key_version: blob.keyVersion,
        object_id: blob.objectId,
        schema_version: blob.schemaVersion,
        storage_path: path,
        updated_at_ms: blob.updatedAt,
        user_id: userId,
        vault_id: blob.vaultId,
      }, { onConflict: 'user_id,vault_id,blob_id' })
      if (error) throw new Error('写入加密附件元数据失败。')
    },
  })
}

async function syncReminderRows(userId: string, result: TravelCenterSyncResult) {
  const client = requireSupabaseClient()
  const [localRows, remoteResult] = await Promise.all([
    db.reminderSchedules.toArray(),
    client.from('reminder_schedules').select('*').eq('user_id', userId),
  ])
  if (remoteResult.error) throw new Error('读取云端提醒失败。')
  const remoteRows = (remoteResult.data ?? []) as RemoteReminderRow[]
  const remoteById = new Map(remoteRows.map((row) => [row.id, row]))
  for (const local of localRows) {
    const remote = remoteById.get(local.id)
    const remoteUpdatedAt = remote ? Date.parse(remote.updated_at) : 0
    if (remote && remoteUpdatedAt > local.updatedAt) await db.reminderSchedules.put(remoteReminderToLocal(remote))
    else {
      const { error } = await client.from('reminder_schedules').upsert(reminderToRemote(local, userId), { onConflict: 'user_id,id' })
      if (error) throw new Error('上传提醒计划失败。')
      result.uploaded += 1
    }
    remoteById.delete(local.id)
  }
  for (const remote of remoteById.values()) { await db.reminderSchedules.put(remoteReminderToLocal(remote)); result.downloaded += 1 }
}

async function syncRecordSet<TLocal extends { id: string; objectType: TravelCenterSyncState['objectType']; payload: unknown; updatedAt: number }, TRemote extends { id: string; objectType: TravelCenterSyncState['objectType']; raw: unknown; updatedAt: number }>({ applyRemote, localRows, remoteRows, result, uploadLocal }: {
  applyRemote: (remote: TRemote['raw']) => Promise<void>
  localRows: TLocal[]
  remoteRows: TRemote[]
  result: TravelCenterSyncResult
  uploadLocal: (local: TLocal) => Promise<void>
}) {
  const localByKey = new Map(localRows.map((row) => [`${row.objectType}:${row.id}`, row]))
  const remoteByKey = new Map(remoteRows.map((row) => [`${row.objectType}:${row.id}`, row]))
  const keys = new Set([...localByKey.keys(), ...remoteByKey.keys()])
  for (const objectKey of keys) {
    const local = localByKey.get(objectKey)
    const remote = remoteByKey.get(objectKey)
    const state = await db.travelCenterSyncStates.get(objectKey)
    if (local && remote && state) {
      const localChanged = local.updatedAt > state.syncedLocalUpdatedAt
      const remoteChanged = remote.updatedAt > state.syncedCloudUpdatedAt
      if (localChanged && remoteChanged && local.updatedAt !== remote.updatedAt) {
        await saveConflict(local, remote, objectKey)
        result.conflicts += 1
        continue
      }
    }
    if (remote && (!local || remote.updatedAt > local.updatedAt)) {
      await applyRemote(remote.raw)
      result.downloaded += 1
      await saveSyncState(remote.objectType, remote.id, remote.updatedAt, remote.updatedAt)
    } else if (local) {
      await uploadLocal(local)
      result.uploaded += 1
      await saveSyncState(local.objectType, local.id, local.updatedAt, local.updatedAt)
    }
  }
}

async function saveConflict(local: { id: string; objectType: TravelCenterSyncState['objectType']; updatedAt: number }, remote: { raw: unknown; updatedAt: number }, objectKey: string) {
  const existing = await db.travelCenterSyncConflicts.where('objectKey').equals(objectKey).filter((item) => item.status === 'pending').first()
  if (existing) return
  const now = Date.now()
  await db.travelCenterSyncConflicts.add({ cloudUpdatedAt: remote.updatedAt, createdAt: now, id: createId('travel_sync_conflict'), localUpdatedAt: local.updatedAt, objectId: local.id, objectKey, objectType: local.objectType, remoteRecord: remote.raw, status: 'pending', updatedAt: now })
}

function saveSyncState(objectType: TravelCenterSyncState['objectType'], objectId: string, localUpdatedAt: number, cloudUpdatedAt: number) {
  return db.travelCenterSyncStates.put({ lastSyncedAt: Date.now(), objectId, objectKey: `${objectType}:${objectId}`, objectType, syncedCloudUpdatedAt: cloudUpdatedAt, syncedLocalUpdatedAt: localUpdatedAt })
}

async function applyRemoteConflict(conflict: TravelCenterSyncConflict) {
  if (conflict.objectType === 'transport_booking' || conflict.objectType === 'transport_segment') {
    const remote = conflict.remoteRecord as RemoteTransportRow
    if (remote.deleted_at_ms) {
      if (conflict.objectType === 'transport_booking') await db.transportBookings.delete(conflict.objectId)
      else await db.transportSegments.delete(conflict.objectId)
    } else if (remote.payload) {
      if (conflict.objectType === 'transport_booking') await db.transportBookings.put(remote.payload as TransportBooking)
      else await db.transportSegments.put(remote.payload as TransportSegment)
    }
  } else if (conflict.objectType === 'vault_object') {
    const remote = conflict.remoteRecord as RemoteVaultObjectRow
    if (remote.deleted_at_ms) await db.vaultObjects.delete(conflict.objectId)
    else await db.vaultObjects.put(remoteVaultObjectToLocal(remote))
  } else if (conflict.objectType === 'vault_blob') {
    throw new Error('加密附件冲突请先导出本机备份，再重新同步并选择保留版本。')
  }
}

async function getLocalUpdatedAt(objectType: TravelCenterSyncState['objectType'], objectId: string) {
  if (objectType === 'transport_booking') return (await db.transportBookings.get(objectId))?.updatedAt ?? 0
  if (objectType === 'transport_segment') return (await db.transportSegments.get(objectId))?.updatedAt ?? 0
  if (objectType === 'vault_object') return (await db.vaultObjects.get(objectId))?.updatedAt ?? 0
  if (objectType === 'vault_blob') return (await db.vaultBlobs.get(objectId))?.updatedAt ?? 0
  return 0
}

function remoteKeyToLocal(row: RemoteKeyRow): VaultKeyState {
  return { createdAt: row.updated_at_ms, keyVersion: row.key_version, ownerId: row.owner_id, pbkdf2Iterations: row.pbkdf2_iterations, salt: row.salt, schemaVersion: row.schema_version, updatedAt: row.updated_at_ms, vaultId: row.vault_id, wrapIv: row.wrap_iv, wrappedKey: row.wrapped_key }
}

function remoteVaultObjectToLocal(row: RemoteVaultObjectRow): VaultObjectRecord {
  return { aadVersion: row.aad_version, ciphertext: row.ciphertext, createdAt: row.created_at_ms, id: row.object_id, iv: row.iv, keyVersion: row.key_version, objectType: row.object_type, schemaVersion: row.schema_version, updatedAt: row.updated_at_ms, vaultId: row.vault_id }
}

function remoteVaultBlobToLocal(row: RemoteVaultBlobRow, ciphertext: Blob, existing?: VaultBlobRecord): VaultBlobRecord {
  return { aadVersion: row.aad_version, ciphertext, createdAt: row.created_at_ms, fileName: existing?.fileName ?? 'encrypted-file', id: row.blob_id, iv: row.iv, keyVersion: row.key_version, mimeType: existing?.mimeType ?? 'application/octet-stream', objectId: row.object_id, schemaVersion: row.schema_version, size: existing?.size ?? row.encrypted_size, updatedAt: row.updated_at_ms, vaultId: row.vault_id }
}

function reminderToRemote(reminder: ReminderSchedule, userId: string) {
  return { id: reminder.id, object_id: reminder.objectId, object_type: reminder.objectType, occurrence_id: reminder.occurrenceId, reminder_kind: reminder.kind, sent_at: reminder.sentAt, status: reminder.status, time_zone: reminder.timeZone, trigger_at: reminder.triggerAt, trip_id: reminder.tripId, user_id: userId, vault_id: reminder.vaultId }
}

function remoteReminderToLocal(row: RemoteReminderRow): ReminderSchedule {
  return { createdAt: Date.parse(row.created_at), id: row.id, kind: row.reminder_kind, objectId: row.object_id, objectType: row.object_type, occurrenceId: row.occurrence_id, sentAt: row.sent_at ?? undefined, status: row.status, timeZone: row.time_zone, triggerAt: row.trigger_at, tripId: row.trip_id ?? undefined, updatedAt: Date.parse(row.updated_at), vaultId: row.vault_id ?? undefined }
}
