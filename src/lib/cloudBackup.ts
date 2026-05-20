import type { Session, User } from '@supabase/supabase-js'
import {
  getTicketBlob,
  getTrip,
  importTripPlanRecords,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
} from '../db'
import { createId } from '../db/ids'
import { safeFileName } from './backup'
import { requireSupabaseClient } from './supabaseClient'
import { formatFileSize, shouldExpectTicketBlob } from './tickets'
import type { Day, ItineraryItem, TicketBlob, TicketMeta, Trip } from '../types'

export { getSupabaseConfigStatus } from './supabaseClient'

const CLOUD_BACKUP_BUCKET = 'trip-backups'
const CLOUD_BACKUP_TABLE = 'cloud_trip_backups'
const CLOUD_BACKUP_SCHEMA_VERSION = 1
const CLOUD_BACKUP_TYPE = 'cloud-trip-backup'
const CLOUD_APP_NAME = '旅图'

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
  warnings: string[]
}

export type RestoreCloudBackupResult = {
  restoredAt?: number
  restoredFromCloudExportedAt?: string
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

type CloudRestoreMetadata = {
  backupId: string
  exportedAt: string
  originalTripId: string
}

type E2eCloudFixture = {
  backups?: CloudBackupSummary[]
  user?: {
    email?: string
    id: string
  }
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
    return fixture.backups ?? []
  }

  const client = requireSupabaseClient()
  const user = await requireCurrentUser()
  const { data, error } = await client
    .from(CLOUD_BACKUP_TABLE)
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    throw new Error('获取云端备份列表失败：' + error.message)
  }

  return (data as CloudBackupRow[] | null ?? []).map(mapCloudBackupRow)
}

export async function uploadTripCloudBackup(tripId: string): Promise<CloudBackupResult> {
  const client = requireSupabaseClient()
  const user = await requireCurrentUser()
  const backupId = crypto.randomUUID()
  const snapshotResult = await buildCloudSnapshotForTrip(tripId, user.id, backupId)
  const bucket = client.storage.from(CLOUD_BACKUP_BUCKET)
  const uploadedPaths: string[] = []

  try {
    for (const file of snapshotResult.fileUploads) {
      const { error } = await bucket.upload(file.path, file.blob, {
        contentType: file.mimeType,
        upsert: false,
      })
      if (error) {
        throw new Error('票据文件上传失败：' + error.message)
      }
      uploadedPaths.push(file.path)
    }

    const snapshotBlob = new Blob([JSON.stringify(snapshotResult.snapshot, null, 2)], {
      type: 'application/json',
    })
    const { error: snapshotError } = await bucket.upload(
      snapshotResult.metadata.snapshot_path,
      snapshotBlob,
      {
        contentType: 'application/json',
        upsert: false,
      },
    )
    if (snapshotError) {
      throw new Error('快照上传失败：' + snapshotError.message)
    }
    uploadedPaths.push(snapshotResult.metadata.snapshot_path)

    const { error: insertError } = await client.from(CLOUD_BACKUP_TABLE).insert(snapshotResult.metadata)
    if (insertError) {
      throw new Error('备份记录写入失败：' + insertError.message)
    }

    return { backupId, warnings: snapshotResult.warnings }
  } catch (caught) {
    await cleanupUploadedObjects(uploadedPaths)
    throw caught
  }
}

export async function restoreCloudBackup(backupId: string): Promise<RestoreCloudBackupResult> {
  const client = requireSupabaseClient()
  const user = await requireCurrentUser()
  const metadata = await getCloudBackupRow(backupId, user.id)
  validateCloudBackupSnapshotPath(user.id, backupId, metadata.snapshot_path)
  const bucket = client.storage.from(CLOUD_BACKUP_BUCKET)
  const { data: snapshotBlob, error: snapshotError } = await bucket.download(metadata.snapshot_path)

  if (snapshotError || !snapshotBlob) {
    throw new Error(snapshotError?.message ?? '云端备份 snapshot.json 下载失败。')
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

  const restoredAt = Date.now()
  const records = buildCloudRestoreRecords(snapshot, ticketBlobs, {
    now: restoredAt,
    restoreMetadata: {
      backupId,
      exportedAt: snapshot.exportedAt,
      originalTripId: snapshot.originalTripId,
    },
  })
  const result = await importTripPlanRecords(records, { markDirty: false })
  return {
    restoredAt,
    restoredFromCloudExportedAt: snapshot.exportedAt,
    title: result.title,
    tripId: result.tripId,
    warnings,
  }
}

export async function deleteCloudBackup(backupId: string): Promise<DeleteCloudBackupResult> {
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
    warnings.push('云端 snapshot 无法读取，已按当前备份路径清理可枚举文件。')
  }

  const safePathsToRemove = [...pathsToRemove].map((path) => {
    assertCloudObjectPathInBackup(path, user.id, backupId)
    return path
  })

  if (safePathsToRemove.length === 0) {
    throw new Error('没有找到可删除的云端备份文件。')
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
    throw new Error(`云端文件已清理，但 metadata 删除失败。请在 Supabase 后台检查该备份记录：${deleteError.message}`)
  }

  return { warnings }
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
  options: {
    createIdFn?: (prefix: string) => string
    now?: number
    restoreMetadata?: CloudRestoreMetadata
  } = {},
) {
  const snapshot = parseCloudSnapshot(snapshotInput)
  validateSnapshotGraph(snapshot)

  const createIdFn = options.createIdFn ?? createId
  const now = options.now ?? Date.now()
  const nextTripId = createIdFn('trip')
  const dayIdMap = new Map(snapshot.days.map((day) => [day.id, createIdFn('day')]))
  const itemIdMap = new Map(snapshot.itineraryItems.map((item) => [item.id, createIdFn('item')]))
  const ticketIdMap = new Map(snapshot.ticketMetas.map((ticket) => [ticket.id, createIdFn('ticket')]))

  const trip: Trip = {
    ...snapshot.trip,
    createdAt: now,
    id: nextTripId,
    ...(options.restoreMetadata
      ? {
          restoredAt: now,
          restoredFromCloudBackupId: options.restoreMetadata.backupId,
          restoredFromCloudExportedAt: options.restoreMetadata.exportedAt,
          restoredFromCloudOriginalTripId: options.restoreMetadata.originalTripId,
        }
      : {}),
    updatedAt: now,
  }
  const days: Day[] = snapshot.days.map((day) => ({
    ...day,
    id: requireMappedCloudId(dayIdMap, day.id),
    tripId: nextTripId,
  }))
  const itineraryItems: ItineraryItem[] = snapshot.itineraryItems.map((item) => ({
    ...item,
    dayId: requireMappedCloudId(dayIdMap, item.dayId),
    id: requireMappedCloudId(itemIdMap, item.id),
    ticketIds: item.ticketIds.map((ticketId) => requireMappedCloudId(ticketIdMap, ticketId)),
    tripId: nextTripId,
  }))
  const ticketMetas: TicketMeta[] = snapshot.ticketMetas.map((ticket) => ({
    ...ticket,
    id: requireMappedCloudId(ticketIdMap, ticket.id),
    itemId: ticket.itemId ? requireMappedCloudId(itemIdMap, ticket.itemId) : undefined,
    tripId: nextTripId,
  }))
  const copyTicketIds = new Set(
    snapshot.ticketMetas.filter(shouldExpectTicketBlob).map((ticket) => ticket.id),
  )
  const ticketBlobsById = new Map(ticketBlobs.map((ticketBlob) => [ticketBlob.ticketId, ticketBlob.blob]))
  const nextTicketBlobs: TicketBlob[] = []

  for (const [oldTicketId, blob] of ticketBlobsById) {
    const nextTicketId = ticketIdMap.get(oldTicketId)
    if (nextTicketId && copyTicketIds.has(oldTicketId)) {
      nextTicketBlobs.push({ blob, ticketId: nextTicketId })
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

export function validateCloudBackupSnapshotPath(userId: string, backupId: string, snapshotPath: string) {
  const expectedPath = buildCloudSnapshotPath(userId, backupId)
  if (snapshotPath !== expectedPath) {
    throw new Error('云端备份 metadata 中的 snapshot 路径与当前用户或备份不匹配。')
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
    throw new Error('云端备份 snapshot.json 格式不正确。')
  }
  if (value.schemaVersion !== CLOUD_BACKUP_SCHEMA_VERSION) {
    throw new Error(`不支持的云端备份版本：${String(value.schemaVersion)}`)
  }
  if (value.type !== CLOUD_BACKUP_TYPE) {
    throw new Error('这不是旅图云端旅行备份。')
  }
  if (!isRecord(value.trip) || !Array.isArray(value.days) || !Array.isArray(value.itineraryItems)) {
    throw new Error('云端备份缺少必要的旅行结构化数据。')
  }
  if (!Array.isArray(value.ticketMetas) || !Array.isArray(value.fileRefs)) {
    throw new Error('云端备份缺少票据元数据。')
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
    throw new Error('云端备份 snapshot.json 无法解析。')
  }

  return parseCloudSnapshot(value)
}

export function validateCloudSnapshotForRestore(snapshot: CloudTripSnapshot, userId: string, backupId: string) {
  validateSnapshotGraph(snapshot)
  validateCloudFileRefPaths(snapshot, userId, backupId)
}

export function formatCloudBackupSize(size: number) {
  return formatFileSize(size)
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
    throw new Error('请先登录后再使用云端备份。')
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
    throw new Error('没有找到该云端备份。')
  }

  return data as CloudBackupRow
}

async function cleanupUploadedObjects(paths: string[]) {
  if (paths.length === 0) {
    return
  }

  try {
    const client = requireSupabaseClient()
    await client.storage.from(CLOUD_BACKUP_BUCKET).remove(paths)
  } catch {
    // Best-effort cleanup must not hide the original upload failure.
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

function readE2eCloudFixture(): E2eCloudFixture | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const hostname = window.location.hostname
    const isLocalTestHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
    if (!isLocalTestHost) {
      return null
    }

    const raw = window.localStorage.getItem('tripmap:e2e:cloud-fixture')
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

function validateSnapshotGraph(snapshot: CloudTripSnapshot) {
  if (!snapshot.trip.id || !snapshot.trip.title) {
    throw new Error('云端备份中的旅行数据不完整。')
  }

  const dayIds = new Set<string>()
  for (const day of snapshot.days) {
    if (!day.id || day.tripId !== snapshot.trip.id) {
      throw new Error('云端备份中的 Day 数据引用不正确。')
    }
    if (dayIds.has(day.id)) {
      throw new Error(`云端备份中的 Day 数据存在重复 ID：${day.id}`)
    }
    dayIds.add(day.id)
  }

  const itemIds = new Set<string>()
  for (const item of snapshot.itineraryItems) {
    if (!item.id || item.tripId !== snapshot.trip.id || !dayIds.has(item.dayId)) {
      throw new Error('云端备份中的行程点引用不正确。')
    }
    if (itemIds.has(item.id)) {
      throw new Error(`云端备份中的行程点存在重复 ID：${item.id}`)
    }
    if (!Array.isArray(item.ticketIds)) {
      throw new Error('云端备份中的行程点票据列表格式不正确。')
    }
    itemIds.add(item.id)
  }

  const ticketIds = new Set<string>()
  const ticketMap = new Map<string, TicketMeta>()
  for (const ticket of snapshot.ticketMetas) {
    if (!ticket.id || ticket.tripId !== snapshot.trip.id) {
      throw new Error('云端备份中的票据元数据引用不正确。')
    }
    if (ticket.itemId && !itemIds.has(ticket.itemId)) {
      throw new Error('云端备份中的票据绑定了不存在的行程点。')
    }
    if (ticketIds.has(ticket.id)) {
      throw new Error(`云端备份中的票据存在重复 ID：${ticket.id}`)
    }
    ticketIds.add(ticket.id)
    ticketMap.set(ticket.id, ticket)
  }

  for (const item of snapshot.itineraryItems) {
    for (const ticketId of item.ticketIds) {
      if (!ticketIds.has(ticketId)) {
        throw new Error('云端备份中的行程点引用了不存在的票据。')
      }
    }
  }

  const fileRefTicketIds = new Set<string>()
  for (const rawFileRef of snapshot.fileRefs as unknown[]) {
    if (!isCloudFileRefShape(rawFileRef)) {
      throw new Error('云端备份中的文件引用格式不正确。')
    }
    const fileRef = rawFileRef
    if (fileRefTicketIds.has(fileRef.ticketId)) {
      throw new Error('云端备份中的文件引用存在重复票据。')
    }
    fileRefTicketIds.add(fileRef.ticketId)
    if (!ticketIds.has(fileRef.ticketId)) {
      throw new Error('云端备份中的文件引用了不存在的票据。')
    }
    const ticket = ticketMap.get(fileRef.ticketId)
    if (!ticket || !shouldExpectTicketBlob(ticket)) {
      throw new Error('云端备份中的文件引用只能绑定 copy 模式票据。')
    }
  }
}

function validateCloudFileRefPaths(snapshot: CloudTripSnapshot, userId: string, backupId: string) {
  const seenTicketIds = new Set<string>()

  for (const rawFileRef of snapshot.fileRefs as unknown[]) {
    if (!isCloudFileRefShape(rawFileRef)) {
      throw new Error('云端备份中的文件引用格式不正确。')
    }
    const fileRef = rawFileRef
    if (seenTicketIds.has(fileRef.ticketId)) {
      throw new Error('云端备份中的文件引用存在重复票据。')
    }
    seenTicketIds.add(fileRef.ticketId)

    const expectedPrefix = `${buildCloudBackupPrefix(userId, backupId)}/files/${safeCloudPathSegment(
      fileRef.ticketId,
    )}/`
    if (!isSafeCloudObjectPath(fileRef.path, expectedPrefix)) {
      throw new Error('云端备份中的文件路径不属于当前备份。')
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
    throw new Error('云端备份文件路径不属于当前用户或备份。')
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

function requireMappedCloudId(idMap: Map<string, string>, id: string) {
  const mappedId = idMap.get(id)
  if (!mappedId) {
    throw new Error(`云端备份数据引用了不存在的 ID：${id}`)
  }

  return mappedId
}

function safeCloudPathSegment(value: string) {
  const clean = safeFileName(value, 'segment')
  if (clean.includes('/') || clean.includes('\\') || clean === '.' || clean === '..') {
    throw new Error('云端备份路径包含不安全片段。')
  }

  return clean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
