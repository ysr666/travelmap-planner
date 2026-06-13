import type JSZip from 'jszip'
import {
  getTicketBlob,
  getTrip,
  importTripBackupRecords,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
} from '../db'
import { shouldExpectTicketBlob } from './tickets'
import type { Day, ItineraryItem, TicketBlob, TicketMeta, Trip } from '../types'

const SCHEMA_VERSION = 1
const APP_NAME = '旅图 TripMap'
const JSON_SPACE = 2

export type BackupManifest = {
  schemaVersion: 1
  appName: string
  exportedAt: string
  tripId: string
  tripTitle: string
  fileMap: Record<string, string>
  warnings?: string[]
}

export type ImportTripBackupResult = {
  tripId: string
  title: string
  warnings: string[]
}

type BackupPayload = {
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
}

export async function exportTripBackup(tripId: string): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const trip = await getTrip(tripId)
  if (!trip) {
    throw new Error('没有找到要导出的旅行。')
  }

  const [days, itineraryItems, ticketMetas] = await Promise.all([
    listDaysByTrip(tripId),
    listItemsByTrip(tripId),
    listTicketsByTrip(tripId),
  ])
  const zip = new JSZip()
  const fileMap: Record<string, string> = {}
  const warnings: string[] = []

  zip.file('data/trip.json', stringifyJson(trip))
  zip.file('data/days.json', stringifyJson(days))
  zip.file('data/itineraryItems.json', stringifyJson(itineraryItems))
  zip.file('data/ticketMetas.json', stringifyJson(ticketMetas))

  for (const ticket of ticketMetas) {
    if (!shouldExpectTicketBlob(ticket)) {
      continue
    }

    const ticketBlob = await getTicketBlob(ticket.id)
    const safeName = safeFileName(ticket.fileName, ticket.id)
    const filePath = `files/${ticket.id}/${safeName}`
    fileMap[ticket.id] = filePath

    if (!ticketBlob) {
      warnings.push(`票据「${ticket.fileName}」缺少文件内容，已仅导出元数据。`)
      continue
    }

    zip.file(filePath, ticketBlob.blob)
  }

  const manifest: BackupManifest = {
    appName: APP_NAME,
    exportedAt: new Date().toISOString(),
    fileMap,
    schemaVersion: SCHEMA_VERSION,
    tripId: trip.id,
    tripTitle: trip.title,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
  zip.file('manifest.json', stringifyJson(manifest))

  return zip.generateAsync({ type: 'blob' })
}

export async function importTripBackup(file: File): Promise<ImportTripBackupResult> {
  const warnings = validateImportFile(file)
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(file)
  const manifest = await readJsonFile<BackupManifest>(zip, 'manifest.json')
  validateManifest(manifest)

  const payload: BackupPayload = {
    trip: await readJsonFile<Trip>(zip, 'data/trip.json'),
    days: await readJsonFile<Day[]>(zip, 'data/days.json'),
    itineraryItems: await readJsonFile<ItineraryItem[]>(zip, 'data/itineraryItems.json'),
    ticketMetas: await readJsonFile<TicketMeta[]>(zip, 'data/ticketMetas.json'),
  }
  validatePayload(payload)

  if (manifest.warnings?.length) {
    warnings.push(...manifest.warnings)
  }

  const ticketBlobs: TicketBlob[] = []
  for (const ticket of payload.ticketMetas) {
    if (!shouldExpectTicketBlob(ticket)) {
      continue
    }

    const filePath = manifest.fileMap[ticket.id]
    if (!filePath) {
      warnings.push(`票据「${ticket.fileName}」在 manifest 中缺少文件路径。`)
      continue
    }

    const zipFile = zip.file(filePath)
    if (!zipFile) {
      warnings.push(`票据「${ticket.fileName}」缺少文件内容，可能是 zip 归档不完整。`)
      continue
    }

    ticketBlobs.push({
      blob: await zipFile.async('blob'),
      ticketId: ticket.id,
    })
  }

  const result = await importTripBackupRecords({
    days: payload.days,
    importedTitleSuffix: formatBackupTimestamp(new Date()),
    itineraryItems: payload.itineraryItems,
    ticketBlobs,
    ticketMetas: payload.ticketMetas,
    trip: payload.trip,
  })

  return { tripId: result.tripId, title: result.title, warnings }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

export function buildTripBackupFileName(tripTitle: string, exportedAt = new Date()) {
  return `travelmap-${safeFileName(tripTitle, 'trip')}-${formatBackupTimestamp(exportedAt)}.zip`
}

export function safeFileName(value: string | undefined, fallback = 'file') {
  const clean = (input: string) =>
    input
      .replace(/[\\/:*?"<>|]+/g, '_')
      .split('')
      .map((char) => {
        const code = char.charCodeAt(0)
        return code < 32 || code === 127 ? '_' : char
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .trim()

  const cleaned = value ? clean(value) : ''
  if (cleaned) {
    return cleaned
  }

  const cleanedFallback = clean(fallback)
  return cleanedFallback || 'file'
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, JSON_SPACE)
}

function validateImportFile(file: File | null | undefined) {
  if (!file || file.size <= 0) {
    throw new Error('请选择一个有效的 zip 归档文件。')
  }

  const warnings: string[] = []
  const hasZipExtension = file.name.toLowerCase().endsWith('.zip')
  const hasZipMime =
    file.type === '' ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.type === 'application/octet-stream'

  if (!hasZipExtension && !hasZipMime) {
    warnings.push('选择的文件看起来不像 zip，已尝试按归档文件导入。')
  }

  return warnings
}

async function readJsonFile<T>(zip: JSZip, path: string): Promise<T> {
  const file = zip.file(path)
  if (!file) {
    throw new Error(`归档缺少必要文件：${path}`)
  }

  try {
    return JSON.parse(await file.async('string')) as T
  } catch {
    throw new Error(`归档文件无法解析：${path}`)
  }
}

function validateManifest(manifest: BackupManifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json 格式不正确。')
  }

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`不支持的归档版本：${String(manifest.schemaVersion)}`)
  }

  if (!manifest.fileMap || typeof manifest.fileMap !== 'object') {
    throw new Error('manifest.json 缺少 fileMap。')
  }
}

function validatePayload(payload: BackupPayload) {
  if (!payload.trip?.id || !payload.trip.title) {
    throw new Error('归档中的旅行数据不完整。')
  }

  if (
    !Array.isArray(payload.days) ||
    !Array.isArray(payload.itineraryItems) ||
    !Array.isArray(payload.ticketMetas)
  ) {
    throw new Error('归档中的结构化数据格式不正确。')
  }

  for (const day of payload.days) {
    if (!day.id || !day.tripId) {
      throw new Error('归档中的 Day 数据不完整。')
    }
  }

  for (const item of payload.itineraryItems) {
    if (!item.id || !item.tripId || !item.dayId) {
      throw new Error('归档中的行程点数据不完整。')
    }
    if (!Array.isArray(item.ticketIds)) {
      item.ticketIds = []
    }
    if (item.executionState && !isValidExecutionState(item.executionState)) {
      throw new Error('归档中的行程点执行状态格式不正确。')
    }
  }

  for (const ticket of payload.ticketMetas) {
    if (!ticket.id || !ticket.tripId || !ticket.fileName) {
      throw new Error('归档中的票据元数据不完整。')
    }
  }
}

function isValidExecutionState(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (record.status === 'completed' || record.status === 'skipped')
    && typeof record.updatedAt === 'number'
    && Number.isFinite(record.updatedAt)
}

function formatBackupTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`
}
