import type { Session, User } from '@supabase/supabase-js'
import {
  getTicketBlob,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
  replaceTripPlanRecords,
} from '../db'
import { safeFileName } from './backup'
import { readBlobArrayBuffer } from './blobUtils'
import {
  isCloudObjectSyncUnavailableError,
  restoreTripObjectsFromCloud,
  syncTripObjectsToCloud,
} from './cloudObjectSync'
import { emitTravelDataChanged } from './dataEvents'
import { requireSupabaseClient } from './supabaseClient'
import { shouldExpectTicketBlob } from './tickets'
import type { Day, ItineraryItem, TicketBlob, TicketMeta, Trip } from '../types'

export { getSupabaseConfigStatus } from './supabaseClient'

const CLOUD_BACKUP_BUCKET = 'trip-backups'
const CLOUD_BACKUP_TABLE = 'cloud_trip_backups'
const CLOUD_BACKUP_SCHEMA_VERSION = 1
const CLOUD_BACKUP_TYPE = 'cloud-trip-backup'
const CLOUD_APP_NAME = '旅图'
const E2E_CLOUD_FIXTURE_KEY = 'tripmap:e2e:cloud-fixture'

export type CloudFileRef = {
  ticketId: string
  path: string
  fileName: string
  mimeType: string
  size: number
}

export type CloudTripSnapshot = {
  schemaVersion: 1
  type: 'cloud-trip-backup'
  appName: string
  exportedAt: string
  appVersion: string
  originalTripId: string
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  fileRefs: CloudFileRef[]
  warnings: string[]
}

export type CloudBackupSummary = {
  id: string
  userId: string
  originalTripId?: string
  title: string
  destination?: string
  createdAt: string
  updatedAt: string
  exportedAt: string
  appVersion?: string
  schemaVersion: number
  snapshotPath: string
  filesCount: number
  totalSizeBytes: number
  warnings: string[]
  notes?: string
}

export type CloudBackupResult = {
  backupId: string
  exportedAt: string
  warnings: string[]
}

export type RestoreCloudBackupResult = {
  exportedAt: string
  tripId: string
  title: string
  warnings: string[]
}

export type DeleteCloudBackupResult = {
  warnings: string[]
}

export type CloudFileUpload = CloudFileRef & {
  blob: Blob
}

export type BuildCloudSnapshotInput = {
  userId: string
  backupId: string
  exportedAt: string
  appVersion: string
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  ticketBlobs: TicketBlob[]
}

export type BuildCloudSnapshotResult = {
  snapshot: CloudTripSnapshot
  fileUploads: CloudFileUpload[]
  metadata: CloudBackupInsertRecord
  warnings: string[]
}

type E2eCloudFixture = {
  backups?: CloudBackupSummary[]
  files?: Record<string, E2eCloudStoredFile>
  objectRows?: CloudObjectFixtureRow[]
  snapshots?: Record<string, CloudTripSnapshot>
  ticketBlobRows?: CloudTicketBlobFixtureRow[]
  user?: {
    email?: string
    id: string
  }
}

type E2eCloudStoredFile = {
  dataBase64: string
  mimeType: string
  size: number
}

export type CloudObjectFixtureRow = {
  deleted_at_ms?: number | null
  device_id: string
  object_id: string
  object_type: string
  op_id: string
  payload?: unknown
  trip_id: string
  updated_at_ms: number
  user_id: string
}

export type CloudTicketBlobFixtureRow = {
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

type CloudStorageListEntry = {
  name: string
}

type CloudStorageBucket = ReturnType<ReturnType<typeof requireSupabaseClient>['storage']['from']>

type CloudBackupInsertRecord = {
  id: string
  user_id: string
  original_trip_id: string
  title: string
  destination: string | null
  exported_at: string
  app_version: string
  schema_version: number
  snapshot_path: string
  files_count: number
  total_size_bytes: number
  updated_at?: string
  warnings: string[]
  notes: string | null
}

type CloudBackupRow = CloudBackupInsertRecord & {
  created_at: string
  updated_at: string
}

export async function getCurrentSession(): Promise<Session | null> {
  const fixtureUser = readE2eCloudFixture()?.user
  if (fixtureUser) {
    return { user: fixtureUser } as Session
  }

  const client = requireSupabaseClient()
  const { data, error } = await client.auth.getSession()
  if (error) {
    throw new Error('获取登录状态失败：' + error.message)
  }

  return data.session
}

export async function getCurrentUser(): Promise<User | null> {
  const fixtureUser = readE2eCloudFixture()?.user
  if (fixtureUser) {
    return fixtureUser as User
  }

  const client = requireSupabaseClient()
  const { data, error } = await client.auth.getUser()
  if (error) {
    throw new Error('获取用户信息失败：' + error.message)
  }

  return data.user
}

export async function signInWithEmailOtp(email: string) {
  const client = requireSupabaseClient()
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href,
      shouldCreateUser: true,
    },
  })
  if (error) {
    throw new Error('发送验证码失败：' + error.message)
  }
}

export async function verifyEmailOtp(email: string, token: string) {
  const client = requireSupabaseClient()
  const { error } = await client.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  if (error) {
    throw new Error('验证码验证失败：' + error.message)
  }
}

export async function signOut() {
  const client = requireSupabaseClient()
  const { error } = await client.auth.signOut()
  if (error) {
    throw new Error('退出登录失败：' + error.message)
  }
}

export async function listCloudBackups(): Promise<CloudBackupSummary[]> {
  const fixture = readE2eCloudFixture()
  if (fixture?.user) {
    return sortCloudBackupSummaries(fixture.backups ?? [])
  }

  const client = requireSupabaseClient()
  const user = await requireCurrentUser()
  const { data, error } = await client
    .from(CLOUD_BACKUP_TABLE)
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    throw new Error('获取云端同步列表失败：' + error.message)
  }

  return (data as CloudBackupRow[] | null ?? []).map(mapCloudBackupRow)
}

export async function uploadTripCloudBackup(tripId: string): Promise<CloudBackupResult> {
  const objectSyncWarnings: string[] = []
  try {
    const objectResult = await syncTripObjectsToCloud(tripId)
    objectSyncWarnings.push(...objectResult.warnings)
  } catch (caught) {
    if (!isCloudObjectSyncUnavailableError(caught)) {
      throw caught
    }
    objectSyncWarnings.push('对象同步表暂不可用，已使用兼容 snapshot 同步。')
  }

  const fixture = readE2eCloudFixture()
  if (fixture?.user) {
    const result = await uploadTripCloudBackupToE2eFixture(fixture, tripId, fixture.user.id)
    return { ...result, warnings: [...objectSyncWarnings, ...result.warnings] }
  }

  const client = requireSupabaseClient()
  const user = await requireCurrentUser()
  const backupId = await buildStableCloudBackupId(user.id, tripId)
  const snapshotResult = await buildCloudSnapshotForTrip(tripId, user.id, backupId)
  const bucket = client.storage.from(CLOUD_BACKUP_BUCKET)

  for (const file of snapshotResult.fileUploads) {
    const { error } = await bucket.upload(file.path, file.blob, {
      contentType: file.mimeType,
      upsert: true,
    })
    if (error) {
      throw new Error('票据文件上传失败：' + error.message)
    }
  }

  const snapshotBlob = new Blob([JSON.stringify(snapshotResult.snapshot, null, 2)], {
    type: 'application/json',
  })
  const { error: snapshotError } = await bucket.upload(snapshotResult.metadata.snapshot_path, snapshotBlob, {
    contentType: 'application/json',
    upsert: true,
  })
  if (snapshotError) {
    throw new Error('云端同步文件上传失败：' + snapshotError.message)
  }

  const { error: upsertError } = await client.from(CLOUD_BACKUP_TABLE).upsert(snapshotResult.metadata, {
    onConflict: 'id',
  })
  if (upsertError) {
    throw new Error('云端同步记录写入失败：' + upsertError.message)
  }

  const warnings = [...objectSyncWarnings, ...snapshotResult.warnings]
  try {
    await removeStaleCloudBackupObjects(
      bucket,
      user.id,
      backupId,
      new Set([snapshotResult.metadata.snapshot_path, ...snapshotResult.snapshot.fileRefs.map((fileRef) => fileRef.path)]),
    )
  } catch {
    warnings.push('旧云端附件清理失败，下一次立即同步时会再次尝试。')
  }

  return { backupId, exportedAt: snapshotResult.snapshot.exportedAt, warnings }
}

export async function restoreCloudBackup(backupId: string): Promise<RestoreCloudBackupResult> {
  const fixture = readE2eCloudFixture()
  if (fixture?.user) {
    const metadata = fixture.backups?.find((backup) => backup.id === backupId && backup.userId === fixture.user!.id)
    if (metadata?.originalTripId) {
      const objectResult = await restoreTripObjectsFromCloud(metadata.originalTripId)
      if (objectResult) {
        const trip = await getTrip(metadata.originalTripId)
        return {
          exportedAt: objectResult.exportedAt,
          title: trip?.title ?? metadata.title,
          tripId: metadata.originalTripId,
          warnings: objectResult.warnings,
        }
      }
    }
    return restoreCloudBackupFromE2eFixture(fixture, backupId, fixture.user.id)
  }

  const client = requireSupabaseClient()
  const user = await requireCurrentUser()
  const metadata = await getCloudBackupRow(backupId, user.id)
  if (metadata.original_trip_id) {
    try {
      const objectResult = await restoreTripObjectsFromCloud(metadata.original_trip_id)
      if (objectResult) {
        const trip = await getTrip(metadata.original_trip_id)
        return {
          exportedAt: objectResult.exportedAt,
          title: trip?.title ?? metadata.title,
          tripId: metadata.original_trip_id,
          warnings: objectResult.warnings,
        }
      }
    } catch (caught) {
      if (!isCloudObjectSyncUnavailableError(caught)) {
        throw caught
      }
    }
  }
  validateCloudBackupSnapshotPath(user.id, backupId, metadata.snapshot_path)
  const bucket = client.storage.from(CLOUD_BACKUP_BUCKET)
  const { data: snapshotBlob, error: snapshotError } = await bucket.download(metadata.snapshot_path)

  if (snapshotError || !snapshotBlob) {
    throw new Error(snapshotError?.message ?? '云端同步 snapshot.json 下载失败。')
  }

  const snapshot = parseCloudSnapshotText(await snapshotBlob.text())
  validateCloudSnapshotForRestore(snapshot, user.id, backupId)
  const ticketBlobs: TicketBlob[] = []
  const warnings = [...snapshot.warnings, ...buildMissingCloudFileRefWarnings(snapshot)]

  for (const fileRef of snapshot.fileRefs) {
    const { data, error } = await bucket.download(fileRef.path)
    if (error || !data) {
      warnings.push(`票据「${fileRef.fileName}」文件下载失败，已仅恢复元数据。`)
      continue
    }

    ticketBlobs.push({
      blob: data,
      ticketId: fileRef.ticketId,
    })
  }

  const records = buildCloudRestoreRecords(snapshot, ticketBlobs)
  const result = await replaceTripPlanRecords(records, { markDirty: false })
  await verifyRestoredCloudRecords(records)
  emitTravelDataChanged()
  return {
    exportedAt: snapshot.exportedAt,
    title: result.title,
    tripId: result.tripId,
    warnings,
  }
}

export async function deleteCloudBackup(backupId: string): Promise<DeleteCloudBackupResult> {
  const fixture = readE2eCloudFixture()
  if (fixture?.user) {
    return deleteCloudBackupFromE2eFixture(fixture, backupId, fixture.user.id)
  }

  const client = requireSupabaseClient()
  const user = await requireCurrentUser()
  const metadata = await getCloudBackupRow(backupId, user.id)
  validateCloudBackupSnapshotPath(user.id, backupId, metadata.snapshot_path)
  const bucket = client.storage.from(CLOUD_BACKUP_BUCKET)
  const warnings: string[] = []
  const listedPaths = await listCloudBackupObjectPaths(bucket, user.id, backupId)
  const pathsToRemove = new Set<string>([metadata.snapshot_path, ...listedPaths])

  try {
    const { data, error: snapshotError } = await bucket.download(metadata.snapshot_path)
    if (snapshotError || !data) {
      throw new Error(snapshotError?.message ?? 'snapshot.json 下载失败')
    }
    if (data) {
      const snapshot = parseCloudSnapshotText(await data.text())
      validateCloudSnapshotForRestore(snapshot, user.id, backupId)
      for (const fileRef of snapshot.fileRefs) {
        pathsToRemove.add(fileRef.path)
      }
    }
  } catch {
    warnings.push('云端 snapshot 无法读取，已按当前云端记录路径清理可枚举文件。')
  }

  const safePathsToRemove = [...pathsToRemove].map((path) => {
    assertCloudObjectPathInBackup(path, user.id, backupId)
    return path
  })

  if (safePathsToRemove.length === 0) {
    throw new Error('没有找到可删除的云端同步文件。')
  }

  const { error: removeError } = await bucket.remove(safePathsToRemove)
  if (removeError) {
    throw new Error(`云端文件删除失败，无法确认附件是否全部可清理。请稍后重试或检查 Supabase Storage policy。${removeError.message}`)
  }

  const { error: deleteError } = await client
    .from(CLOUD_BACKUP_TABLE)
    .delete()
    .eq('id', backupId)
    .eq('user_id', user.id)

  if (deleteError) {
    throw new Error(`云端文件已清理，但 metadata 删除失败。请在 Supabase 后台检查该云端同步记录：${deleteError.message}`)
  }

  return { warnings }
}

async function uploadTripCloudBackupToE2eFixture(
  fixture: E2eCloudFixture,
  tripId: string,
  userId: string,
): Promise<CloudBackupResult> {
  const backupId = await buildStableCloudBackupId(userId, tripId)
  const snapshotResult = await buildCloudSnapshotForTrip(tripId, userId, backupId)
  const exportedAt = snapshotResult.snapshot.exportedAt
  const previousBackup = fixture.backups?.find((backup) => backup.id === backupId)
  const nextFiles: Record<string, E2eCloudStoredFile> = { ...(fixture.files ?? {}) }
  const keepPaths = new Set(snapshotResult.snapshot.fileRefs.map((fileRef) => fileRef.path))
  const backupPrefix = `${buildCloudBackupPrefix(userId, backupId)}/`

  for (const path of Object.keys(nextFiles)) {
    if (path.startsWith(backupPrefix) && !keepPaths.has(path)) {
      delete nextFiles[path]
    }
  }

  for (const file of snapshotResult.fileUploads) {
    nextFiles[file.path] = {
      dataBase64: await blobToBase64(file.blob),
      mimeType: file.mimeType,
      size: file.blob.size,
    }
  }

  const nextBackup: CloudBackupSummary = {
    appVersion: snapshotResult.metadata.app_version,
    createdAt: previousBackup?.createdAt ?? exportedAt,
    destination: snapshotResult.metadata.destination ?? undefined,
    exportedAt,
    filesCount: snapshotResult.metadata.files_count,
    id: backupId,
    notes: snapshotResult.metadata.notes ?? undefined,
    originalTripId: snapshotResult.metadata.original_trip_id,
    schemaVersion: snapshotResult.metadata.schema_version,
    snapshotPath: snapshotResult.metadata.snapshot_path,
    title: snapshotResult.metadata.title,
    totalSizeBytes: snapshotResult.metadata.total_size_bytes,
    updatedAt: exportedAt,
    userId,
    warnings: snapshotResult.metadata.warnings,
  }
  const nextBackups = sortCloudBackupSummaries([
    ...(fixture.backups ?? []).filter((backup) => backup.id !== backupId),
    nextBackup,
  ])

  writeE2eCloudFixture({
    ...fixture,
    backups: nextBackups,
    files: nextFiles,
    snapshots: {
      ...(fixture.snapshots ?? {}),
      [backupId]: snapshotResult.snapshot,
    },
  })

  return { backupId, exportedAt, warnings: snapshotResult.warnings }
}

async function restoreCloudBackupFromE2eFixture(
  fixture: E2eCloudFixture,
  backupId: string,
  userId: string,
): Promise<RestoreCloudBackupResult> {
  const metadata = fixture.backups?.find((backup) => backup.id === backupId && backup.userId === userId)
  if (!metadata) {
    throw new Error('没有找到该云端同步。')
  }

  validateCloudBackupSnapshotPath(userId, backupId, metadata.snapshotPath)
  const snapshot = fixture.snapshots?.[backupId]
  if (!snapshot) {
    throw new Error('云端同步 snapshot.json 下载失败。')
  }
  validateCloudSnapshotForRestore(snapshot, userId, backupId)
  const ticketBlobs: TicketBlob[] = []
  const warnings = [...snapshot.warnings, ...buildMissingCloudFileRefWarnings(snapshot)]

  for (const fileRef of snapshot.fileRefs) {
    const storedFile = fixture.files?.[fileRef.path]
    if (!storedFile) {
      warnings.push(`票据「${fileRef.fileName}」文件下载失败，已仅恢复元数据。`)
      continue
    }

    ticketBlobs.push({
      blob: base64ToBlob(storedFile.dataBase64, storedFile.mimeType),
      ticketId: fileRef.ticketId,
    })
  }

  const records = buildCloudRestoreRecords(snapshot, ticketBlobs)
  const result = await replaceTripPlanRecords(records, { markDirty: false })
  await verifyRestoredCloudRecords(records)
  emitTravelDataChanged()
  return {
    exportedAt: snapshot.exportedAt,
    title: result.title,
    tripId: result.tripId,
    warnings,
  }
}

function deleteCloudBackupFromE2eFixture(
  fixture: E2eCloudFixture,
  backupId: string,
  userId: string,
): DeleteCloudBackupResult {
  const metadata = fixture.backups?.find((backup) => backup.id === backupId && backup.userId === userId)
  if (!metadata) {
    throw new Error('没有找到该云端同步。')
  }

  validateCloudBackupSnapshotPath(userId, backupId, metadata.snapshotPath)
  const nextFiles = { ...(fixture.files ?? {}) }
  const backupPrefix = `${buildCloudBackupPrefix(userId, backupId)}/`
  for (const path of Object.keys(nextFiles)) {
    if (path.startsWith(backupPrefix)) {
      delete nextFiles[path]
    }
  }

  const nextSnapshots = { ...(fixture.snapshots ?? {}) }
  delete nextSnapshots[backupId]
  writeE2eCloudFixture({
    ...fixture,
    backups: (fixture.backups ?? []).filter((backup) => backup.id !== backupId),
    files: nextFiles,
    snapshots: nextSnapshots,
  })

  return { warnings: [] }
}

export function buildCloudSnapshotFromRecords({
  appVersion,
  backupId,
  days,
  exportedAt,
  itineraryItems,
  ticketBlobs,
  ticketMetas,
  trip,
  userId,
}: BuildCloudSnapshotInput): BuildCloudSnapshotResult {
  const ticketBlobMap = new Map(ticketBlobs.map((ticketBlob) => [ticketBlob.ticketId, ticketBlob.blob]))
  const warnings: string[] = []
  const fileUploads: CloudFileUpload[] = []
  const fileRefs: CloudFileRef[] = []

  for (const ticket of ticketMetas) {
    if (!shouldExpectTicketBlob(ticket)) {
      continue
    }

    const blob = ticketBlobMap.get(ticket.id)
    if (!blob) {
      warnings.push(`票据「${ticket.fileName}」缺少文件内容，已仅上传元数据。`)
      continue
    }

    const fileName = safeFileName(ticket.fileName, ticket.id)
    const path = buildCloudFilePath(userId, backupId, ticket.id, fileName)
    const fileRef: CloudFileRef = {
      fileName,
      mimeType: ticket.mimeType || blob.type || 'application/octet-stream',
      path,
      size: blob.size,
      ticketId: ticket.id,
    }

    fileRefs.push(fileRef)
    fileUploads.push({ ...fileRef, blob })
  }

  const snapshotPath = buildCloudSnapshotPath(userId, backupId)
  const snapshot: CloudTripSnapshot = {
    appName: CLOUD_APP_NAME,
    appVersion,
    days,
    exportedAt,
    fileRefs,
    itineraryItems,
    originalTripId: trip.id,
    schemaVersion: CLOUD_BACKUP_SCHEMA_VERSION,
    ticketMetas,
    trip,
    type: CLOUD_BACKUP_TYPE,
    warnings,
  }
  const totalSizeBytes = fileRefs.reduce((sum, fileRef) => sum + fileRef.size, 0)

  return {
    fileUploads,
    metadata: {
      app_version: appVersion,
      destination: trip.destination || null,
      exported_at: exportedAt,
      files_count: fileRefs.length,
      id: backupId,
      notes: null,
      original_trip_id: trip.id,
      schema_version: CLOUD_BACKUP_SCHEMA_VERSION,
      snapshot_path: snapshotPath,
      title: trip.title,
      total_size_bytes: totalSizeBytes,
      updated_at: exportedAt,
      user_id: userId,
      warnings,
    },
    snapshot,
    warnings,
  }
}

export function buildCloudRestoreRecords(
  snapshotInput: CloudTripSnapshot,
  ticketBlobs: TicketBlob[],
) {
  const snapshot = parseCloudSnapshot(snapshotInput)
  validateSnapshotGraph(snapshot)

  const trip: Trip = {
    ...snapshot.trip,
    restoredAt: undefined,
    restoredFromCloudBackupId: undefined,
    restoredFromCloudExportedAt: undefined,
    restoredFromCloudOriginalTripId: undefined,
  }
  const days: Day[] = snapshot.days.map((day) => ({
    ...day,
    tripId: snapshot.trip.id,
  }))
  const itineraryItems: ItineraryItem[] = snapshot.itineraryItems.map((item) => ({
    ...item,
    tripId: snapshot.trip.id,
  }))
  const ticketMetas: TicketMeta[] = snapshot.ticketMetas.map((ticket) => ({
    ...ticket,
    tripId: snapshot.trip.id,
  }))
  const copyTicketIds = new Set(
    snapshot.ticketMetas.filter(shouldExpectTicketBlob).map((ticket) => ticket.id),
  )
  const ticketBlobsById = new Map(ticketBlobs.map((ticketBlob) => [ticketBlob.ticketId, ticketBlob.blob]))
  const nextTicketBlobs: TicketBlob[] = []

  for (const [oldTicketId, blob] of ticketBlobsById) {
    if (copyTicketIds.has(oldTicketId)) {
      nextTicketBlobs.push({ blob, ticketId: oldTicketId })
    }
  }

  return {
    days,
    itineraryItems,
    ticketBlobs: nextTicketBlobs,
    ticketMetas,
    trip,
  }
}

type CloudRestoreRecords = ReturnType<typeof buildCloudRestoreRecords>

export async function verifyRestoredCloudRecords(records: CloudRestoreRecords) {
  const [restoredTrip, restoredDays, restoredItems, restoredTickets] = await Promise.all([
    getTrip(records.trip.id),
    listDaysByTrip(records.trip.id),
    listItemsByTrip(records.trip.id),
    listTicketsByTrip(records.trip.id),
  ])

  if (!restoredTrip || restoredTrip.id !== records.trip.id || restoredTrip.title !== records.trip.title) {
    throwCloudRestoreWriteVerificationError('旅行')
  }

  assertSameIdsForCloudRestore('每日行程', restoredDays, records.days)
  assertSameIdsForCloudRestore('行程点', restoredItems, records.itineraryItems)
  assertSameIdsForCloudRestore('票据', restoredTickets, records.ticketMetas)

  await Promise.all(
    records.ticketBlobs.map(async (expectedBlob) => {
      const restoredBlob = await getTicketBlob(expectedBlob.ticketId)
      if (
        !restoredBlob
        || restoredBlob.ticketId !== expectedBlob.ticketId
        || restoredBlob.blob.size !== expectedBlob.blob.size
        || restoredBlob.blob.type !== expectedBlob.blob.type
      ) {
        throwCloudRestoreWriteVerificationError('票据文件')
      }
    }),
  )
}

export function buildCloudSnapshotPath(userId: string, backupId: string) {
  return `${buildCloudBackupPrefix(userId, backupId)}/snapshot.json`
}

export function buildCloudFilePath(userId: string, backupId: string, ticketId: string, fileName: string) {
  return `${buildCloudBackupPrefix(userId, backupId)}/files/${safeCloudPathSegment(ticketId)}/${safeFileName(
    fileName,
    'file',
  )}`
}

export function buildCloudBackupPrefix(userId: string, backupId: string) {
  return `${safeCloudPathSegment(userId)}/${safeCloudPathSegment(backupId)}`
}

export async function buildStableCloudBackupId(userId: string, tripId: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`tripmap-cloud-backup:v1:${userId}:${tripId}`),
  )
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuidBytes(bytes)
}

export function validateCloudBackupSnapshotPath(userId: string, backupId: string, snapshotPath: string) {
  const expectedPath = buildCloudSnapshotPath(userId, backupId)
  if (snapshotPath !== expectedPath) {
    throw new Error('云端同步 metadata 中的 snapshot 路径与当前用户或保存记录不匹配。')
  }
}

export function buildMissingCloudFileRefWarnings(snapshot: CloudTripSnapshot) {
  const fileRefTicketIds = new Set(snapshot.fileRefs.map((fileRef) => fileRef.ticketId))
  return snapshot.ticketMetas
    .filter((ticket) => shouldExpectTicketBlob(ticket) && !fileRefTicketIds.has(ticket.id))
    .map((ticket) => `票据「${ticket.title || ticket.note || ticket.fileName}」缺少云端文件内容，已仅恢复元数据。`)
}

export function parseCloudSnapshot(value: unknown): CloudTripSnapshot {
  if (!isRecord(value)) {
    throw new Error('云端同步 snapshot.json 格式不正确。')
  }
  if (value.schemaVersion !== CLOUD_BACKUP_SCHEMA_VERSION) {
    throw new Error(`不支持的云端同步版本：${String(value.schemaVersion)}`)
  }
  if (value.type !== CLOUD_BACKUP_TYPE) {
    throw new Error('这不是旅图云端旅行保存。')
  }
  if (!isRecord(value.trip) || !Array.isArray(value.days) || !Array.isArray(value.itineraryItems)) {
    throw new Error('云端同步缺少必要的旅行结构化数据。')
  }
  if (!Array.isArray(value.ticketMetas) || !Array.isArray(value.fileRefs)) {
    throw new Error('云端同步缺少票据元数据。')
  }

  return {
    appName: typeof value.appName === 'string' ? value.appName : CLOUD_APP_NAME,
    appVersion: typeof value.appVersion === 'string' ? value.appVersion : '',
    days: value.days as Day[],
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    fileRefs: value.fileRefs as CloudFileRef[],
    itineraryItems: value.itineraryItems as ItineraryItem[],
    originalTripId:
      typeof value.originalTripId === 'string'
        ? value.originalTripId
        : typeof value.trip.id === 'string'
          ? value.trip.id
          : '',
    schemaVersion: CLOUD_BACKUP_SCHEMA_VERSION,
    ticketMetas: value.ticketMetas as TicketMeta[],
    trip: value.trip as Trip,
    type: CLOUD_BACKUP_TYPE,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(isString) : [],
  }
}

export function parseCloudSnapshotText(text: string): CloudTripSnapshot {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('云端同步 snapshot.json 无法解析。')
  }

  return parseCloudSnapshot(value)
}

export function validateCloudSnapshotForRestore(snapshot: CloudTripSnapshot, userId: string, backupId: string) {
  validateSnapshotGraph(snapshot)
  validateCloudFileRefPaths(snapshot, userId, backupId)
}

async function buildCloudSnapshotForTrip(tripId: string, userId: string, backupId: string) {
  const trip = await getTrip(tripId)
  if (!trip) {
    throw new Error('没有找到要上传的旅行。')
  }

  const [days, itineraryItems, ticketMetas] = await Promise.all([
    listDaysByTrip(tripId),
    listItemsByTrip(tripId),
    listTicketsByTrip(tripId),
  ])
  const ticketBlobs = (
    await Promise.all(
      ticketMetas.filter(shouldExpectTicketBlob).map((ticket) => getTicketBlob(ticket.id)),
    )
  ).filter((ticketBlob): ticketBlob is TicketBlob => Boolean(ticketBlob))

  return buildCloudSnapshotFromRecords({
    appVersion: __APP_VERSION__,
    backupId,
    days,
    exportedAt: new Date().toISOString(),
    itineraryItems,
    ticketBlobs,
    ticketMetas,
    trip,
    userId,
  })
}

async function requireCurrentUser() {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('请先登录后再使用云端同步。')
  }

  return user
}

async function getCloudBackupRow(backupId: string, userId: string) {
  const client = requireSupabaseClient()
  const { data, error } = await client
    .from(CLOUD_BACKUP_TABLE)
    .select('*')
    .eq('id', backupId)
    .eq('user_id', userId)
    .single()

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('没有找到该云端同步。')
  }

  return data as CloudBackupRow
}

async function removeStaleCloudBackupObjects(
  bucket: CloudStorageBucket,
  userId: string,
  backupId: string,
  keepPaths: Set<string>,
) {
  const listedPaths = await listCloudBackupObjectPaths(bucket, userId, backupId)
  const pathsToRemove = listedPaths.filter((path) => !keepPaths.has(path))
  if (pathsToRemove.length === 0) {
    return
  }

  const { error } = await bucket.remove(pathsToRemove)
  if (error) {
    throw new Error(error.message)
  }
}

function mapCloudBackupRow(row: CloudBackupRow): CloudBackupSummary {
  return {
    appVersion: row.app_version || undefined,
    createdAt: row.created_at,
    destination: row.destination || undefined,
    exportedAt: row.exported_at,
    filesCount: row.files_count,
    id: row.id,
    notes: row.notes || undefined,
    originalTripId: row.original_trip_id || undefined,
    schemaVersion: row.schema_version,
    snapshotPath: row.snapshot_path,
    title: row.title,
    totalSizeBytes: row.total_size_bytes,
    updatedAt: row.updated_at,
    userId: row.user_id,
    warnings: Array.isArray(row.warnings) ? row.warnings.filter(isString) : [],
  }
}

function sortCloudBackupSummaries(backups: CloudBackupSummary[]) {
  return [...backups].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

export function readE2eCloudFixture(): E2eCloudFixture | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const hostname = window.location.hostname
    const isLocalTestHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
    if (!isLocalTestHost) {
      return null
    }

    const raw = window.localStorage.getItem(E2E_CLOUD_FIXTURE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as E2eCloudFixture
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function writeE2eCloudFixture(fixture: E2eCloudFixture) {
  const currentFixture = readE2eCloudFixture()
  if (!currentFixture?.user) {
    throw new Error('测试云端同步 fixture 不可用。')
  }

  window.localStorage.setItem(E2E_CLOUD_FIXTURE_KEY, JSON.stringify(fixture))
}

function validateSnapshotGraph(snapshot: CloudTripSnapshot) {
  if (!snapshot.trip.id || !snapshot.trip.title) {
    throw new Error('云端同步中的旅行数据不完整。')
  }

  const dayIds = new Set<string>()
  for (const day of snapshot.days) {
    if (!day.id || day.tripId !== snapshot.trip.id) {
      throw new Error('云端同步中的 Day 数据引用不正确。')
    }
    if (dayIds.has(day.id)) {
      throw new Error(`云端同步中的 Day 数据存在重复 ID：${day.id}`)
    }
    dayIds.add(day.id)
  }

  const itemIds = new Set<string>()
  for (const item of snapshot.itineraryItems) {
    if (!item.id || item.tripId !== snapshot.trip.id || !dayIds.has(item.dayId)) {
      throw new Error('云端同步中的行程点引用不正确。')
    }
    if (itemIds.has(item.id)) {
      throw new Error(`云端同步中的行程点存在重复 ID：${item.id}`)
    }
    if (!Array.isArray(item.ticketIds)) {
      throw new Error('云端同步中的行程点票据列表格式不正确。')
    }
    if (item.executionState && !isValidItineraryExecutionState(item.executionState)) {
      throw new Error('云端同步中的行程点执行状态格式不正确。')
    }
    itemIds.add(item.id)
  }

  const ticketIds = new Set<string>()
  const ticketMap = new Map<string, TicketMeta>()
  for (const ticket of snapshot.ticketMetas) {
    if (!ticket.id || ticket.tripId !== snapshot.trip.id) {
      throw new Error('云端同步中的票据元数据引用不正确。')
    }
    if (ticket.itemId && !itemIds.has(ticket.itemId)) {
      throw new Error('云端同步中的票据绑定了不存在的行程点。')
    }
    if (ticketIds.has(ticket.id)) {
      throw new Error(`云端同步中的票据存在重复 ID：${ticket.id}`)
    }
    ticketIds.add(ticket.id)
    ticketMap.set(ticket.id, ticket)
  }

  for (const item of snapshot.itineraryItems) {
    for (const ticketId of item.ticketIds) {
      if (!ticketIds.has(ticketId)) {
        throw new Error('云端同步中的行程点引用了不存在的票据。')
      }
    }
  }

  const fileRefTicketIds = new Set<string>()
  for (const rawFileRef of snapshot.fileRefs as unknown[]) {
    if (!isCloudFileRefShape(rawFileRef)) {
      throw new Error('云端同步中的文件引用格式不正确。')
    }
    const fileRef = rawFileRef
    if (fileRefTicketIds.has(fileRef.ticketId)) {
      throw new Error('云端同步中的文件引用存在重复票据。')
    }
    fileRefTicketIds.add(fileRef.ticketId)
    if (!ticketIds.has(fileRef.ticketId)) {
      throw new Error('云端同步中的文件引用了不存在的票据。')
    }
    const ticket = ticketMap.get(fileRef.ticketId)
    if (!ticket || !shouldExpectTicketBlob(ticket)) {
      throw new Error('云端同步中的文件引用只能绑定 copy 模式票据。')
    }
  }
}

function isValidItineraryExecutionState(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (record.status === 'completed' || record.status === 'skipped')
    && typeof record.updatedAt === 'number'
    && Number.isFinite(record.updatedAt)
}

function validateCloudFileRefPaths(snapshot: CloudTripSnapshot, userId: string, backupId: string) {
  const seenTicketIds = new Set<string>()

  for (const rawFileRef of snapshot.fileRefs as unknown[]) {
    if (!isCloudFileRefShape(rawFileRef)) {
      throw new Error('云端同步中的文件引用格式不正确。')
    }
    const fileRef = rawFileRef
    if (seenTicketIds.has(fileRef.ticketId)) {
      throw new Error('云端同步中的文件引用存在重复票据。')
    }
    seenTicketIds.add(fileRef.ticketId)

    const expectedPrefix = `${buildCloudBackupPrefix(userId, backupId)}/files/${safeCloudPathSegment(
      fileRef.ticketId,
    )}/`
    if (!isSafeCloudObjectPath(fileRef.path, expectedPrefix)) {
      throw new Error('云端同步中的文件路径不属于当前保存记录。')
    }
  }
}

async function listCloudBackupObjectPaths(
  bucket: CloudStorageBucket,
  userId: string,
  backupId: string,
) {
  const backupPrefix = buildCloudBackupPrefix(userId, backupId)
  const paths = new Set<string>()
  const rootEntries = await listCloudStorageFolder(bucket, backupPrefix)

  for (const entry of rootEntries) {
    if (entry.name === 'snapshot.json') {
      paths.add(`${backupPrefix}/snapshot.json`)
    } else if (entry.name === 'files') {
      const ticketEntries = await listCloudStorageFolder(bucket, `${backupPrefix}/files`)
      for (const ticketEntry of ticketEntries) {
        const ticketPrefix = `${backupPrefix}/files/${ticketEntry.name}`
        const fileEntries = await listCloudStorageFolder(bucket, ticketPrefix)
        for (const fileEntry of fileEntries) {
          const path = `${ticketPrefix}/${fileEntry.name}`
          assertCloudObjectPathInBackup(path, userId, backupId)
          paths.add(path)
        }
      }
    }
  }

  return [...paths]
}

async function listCloudStorageFolder(bucket: CloudStorageBucket, path: string) {
  const entries: CloudStorageListEntry[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await bucket.list(path, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })

    if (error) {
      throw new Error(
        `云端文件列表读取失败，无法确认附件是否全部可清理。请稍后重试或检查 Supabase Storage policy。${error.message}`,
      )
    }

    const page = ((data ?? []) as CloudStorageListEntry[]).filter(
      (entry) => typeof entry.name === 'string' && entry.name.length > 0,
    )
    entries.push(...page)

    if (page.length < limit) {
      break
    }
    offset += page.length
  }

  return entries
}

function assertCloudObjectPathInBackup(path: string, userId: string, backupId: string) {
  const expectedPrefix = `${buildCloudBackupPrefix(userId, backupId)}/`
  if (!isSafeCloudObjectPath(path, expectedPrefix)) {
    throw new Error('云端同步文件路径不属于当前用户或保存记录。')
  }
}

function isCloudFileRefShape(value: unknown): value is CloudFileRef {
  return (
    isRecord(value) &&
    typeof value.ticketId === 'string' &&
    value.ticketId.trim().length > 0 &&
    typeof value.path === 'string' &&
    value.path.trim().length > 0 &&
    typeof value.fileName === 'string' &&
    value.fileName.trim().length > 0 &&
    typeof value.mimeType === 'string' &&
    value.mimeType.trim().length > 0 &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    value.size >= 0
  )
}

function isSafeCloudObjectPath(path: string, expectedPrefix: string) {
  if (!path.startsWith(expectedPrefix) || hasControlCharacter(path) || path.includes('\\')) {
    return false
  }

  const segments = path.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) {
      return true
    }
  }

  return false
}

function safeCloudPathSegment(value: string) {
  const clean = safeFileName(value, 'segment')
  if (clean.includes('/') || clean.includes('\\') || clean === '.' || clean === '..') {
    throw new Error('云端同步路径包含不安全片段。')
  }

  return clean
}

function assertSameIdsForCloudRestore(
  label: string,
  actualRecords: Array<{ id: string }>,
  expectedRecords: Array<{ id: string }>,
) {
  const actualIds = actualRecords.map((record) => record.id).sort()
  const expectedIds = expectedRecords.map((record) => record.id).sort()
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throwCloudRestoreWriteVerificationError(label)
  }
}

function throwCloudRestoreWriteVerificationError(label: string): never {
  throw new Error(`账号数据写入此设备后校验失败：${label} 未与云端同步一致。请重试同步，或先导出 zip 归档后再继续。`)
}

export async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await readBlobArrayBuffer(blob))
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return window.btoa(binary)
}

export function base64ToBlob(dataBase64: string, mimeType: string) {
  const binary = window.atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function formatUuidBytes(bytes: Uint8Array) {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
