import { db } from '../db/database'
import { createId } from '../db/ids'
import { sha256Blob } from './travelInboxSourceHash'
import type { TravelInboxAccountSource, TravelInboxLocalConnector } from '../types'

const LOCAL_FOLDER_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const TRAVEL_INBOX_FILE_ACCEPT = '.txt,.md,.markdown,.eml,.html,.htm,.pdf,image/*,.json,.zip,.csv,.xlsx,.xlsm,.xls'
export const TRAVEL_INBOX_MANUAL_MAX_FILE_COUNT = 60

export function supportsTravelInboxLocalFolders() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function createTravelInboxLocalFolderConnector(autoAiEnabled = true) {
  if (!supportsTravelInboxLocalFolders()) throw new Error('当前浏览器不支持持续读取本地文件夹。')
  const handle = await window.showDirectoryPicker({ mode: 'read' })
  const now = Date.now()
  const connector: TravelInboxLocalConnector = {
    autoAiEnabled,
    createdAt: now,
    deviceId: getDeviceId(),
    directoryHandle: handle,
    fileFingerprints: {},
    id: createId('local_connector'),
    kind: 'local_folder',
    name: handle.name,
    status: 'active',
    updatedAt: now,
  }
  await db.travelInboxLocalConnectors.add(connector)
  return connector
}

export function listTravelInboxLocalFolderConnectors() {
  return db.travelInboxLocalConnectors.orderBy('updatedAt').reverse().toArray()
}

export async function importTravelInboxFiles(files: File[]) {
  const selected = files.slice(0, TRAVEL_INBOX_MANUAL_MAX_FILE_COUNT)
  const created: TravelInboxAccountSource[] = []
  const createdFiles: Array<{ file: File; source: TravelInboxAccountSource }> = []
  const warnings: string[] = []
  const seenContentHashes = new Set<string>()

  for (const file of selected) {
    if (!isSupportedFileName(file.name)) {
      warnings.push(`${file.name} 暂不支持。`)
      continue
    }
    if (file.size > LOCAL_FOLDER_MAX_FILE_SIZE_BYTES) {
      warnings.push(`${file.name} 超过 20MB，未处理。`)
      continue
    }
    const contentHash = await sha256Blob(file)
    if (seenContentHashes.has(contentHash)) continue
    seenContentHashes.add(contentHash)
    const now = Date.now()
    const source: TravelInboxAccountSource = {
      connectorKind: 'local_folder',
      createdAt: now,
      fileName: file.name,
      id: createId('account_inbox'),
      label: file.name,
      mimeType: file.type || 'application/octet-stream',
      receivedAt: file.lastModified || now,
      size: file.size,
      sourceKind: inferKind(file),
      status: 'queued',
      updatedAt: now,
      warnings: [],
    }
    created.push(source)
    createdFiles.push({ file, source })
  }

  if (files.length > TRAVEL_INBOX_MANUAL_MAX_FILE_COUNT) {
    warnings.push(`最多导入 ${TRAVEL_INBOX_MANUAL_MAX_FILE_COUNT} 个文件。`)
  }
  if (created.length > 0) {
    await db.transaction('rw', db.travelInboxAccountSources, db.travelInboxAccountSourceBlobs, async () => {
      await db.travelInboxAccountSources.bulkAdd(created)
      await db.travelInboxAccountSourceBlobs.bulkPut(createdFiles.map(({ file, source }) => ({
        blob: file,
        sourceId: source.id,
      })))
    })
  }
  return { created, warnings }
}

export async function deleteTravelInboxLocalFolderConnector(id: string) {
  await db.travelInboxLocalConnectors.delete(id)
}

export async function scanTravelInboxLocalFolder(connector: TravelInboxLocalConnector) {
  const permission = await connector.directoryHandle.queryPermission({ mode: 'read' })
  if (permission !== 'granted') {
    const requested = await connector.directoryHandle.requestPermission({ mode: 'read' })
    if (requested !== 'granted') {
      await db.travelInboxLocalConnectors.update(connector.id, { status: 'error', updatedAt: Date.now() })
      throw new Error('本地文件夹权限已撤销。')
    }
  }
  const fingerprints = { ...connector.fileFingerprints }
  const seenContentHashes = new Set(
    Object.values(fingerprints)
      .map(readFingerprintContentHash)
      .filter((value): value is string => Boolean(value)),
  )
  const created: TravelInboxAccountSource[] = []
  const scanWarnings: string[] = []
  for await (const { file, name } of walkDirectory(connector.directoryHandle)) {
    if (!isSupportedFileName(name)) continue
    if (file.size > LOCAL_FOLDER_MAX_FILE_SIZE_BYTES) {
      fingerprints[name] = `${file.size}:${file.lastModified}:oversize`
      scanWarnings.push(`${name} 超过 20MB，未处理。`)
      continue
    }
    const contentHash = await sha256Blob(file)
    const fingerprint = `${file.size}:${file.lastModified}:${contentHash}`
    if (fingerprints[name] === fingerprint) continue
    fingerprints[name] = fingerprint
    if (seenContentHashes.has(contentHash)) continue
    seenContentHashes.add(contentHash)
    const now = Date.now()
    const source: TravelInboxAccountSource = {
      connectorId: connector.id,
      connectorKind: 'local_folder',
      createdAt: now,
      fileName: name,
      id: createId('account_inbox'),
      label: name,
      mimeType: file.type || 'application/octet-stream',
      receivedAt: file.lastModified || now,
      size: file.size,
      sourceKind: inferKind(file, name),
      status: 'queued',
      updatedAt: now,
      warnings: [],
    }
    await db.transaction('rw', db.travelInboxAccountSources, db.travelInboxAccountSourceBlobs, async () => {
      await db.travelInboxAccountSources.add(source)
      await db.travelInboxAccountSourceBlobs.put({ blob: file, sourceId: source.id })
    })
    created.push(source)
  }
  await db.travelInboxLocalConnectors.update(connector.id, {
    fileFingerprints: fingerprints,
    lastScannedAt: Date.now(),
    lastScanSkippedCount: scanWarnings.length,
    lastScanWarnings: scanWarnings.slice(0, 5),
    status: 'active',
    updatedAt: Date.now(),
  })
  return created
}

async function* walkDirectory(directoryHandle: FileSystemDirectoryHandle, prefix = ''): AsyncGenerator<{ file: File; name: string }> {
  for await (const [entryName, handle] of directoryHandle.entries()) {
    const name = prefix ? `${prefix}/${entryName}` : entryName
    if (handle.kind === 'file') {
      yield { file: await handle.getFile(), name }
      continue
    }
    if (typeof handle.entries !== 'function') continue
    yield* walkDirectory(handle, name)
  }
}

function inferKind(file: File, fileName = file.name): TravelInboxAccountSource['sourceKind'] {
  const name = fileName.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  if (/\.(csv|xlsx|xlsm|xls)$/i.test(name) || file.type.includes('spreadsheet') || file.type.includes('excel')) return 'spreadsheet'
  if (name.endsWith('.eml')) return 'email'
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html'
  return 'text_file'
}
function isSupportedFileName(name: string) { return /\.(txt|md|markdown|eml|html?|pdf|png|jpe?g|webp|json|zip|csv|xlsx|xlsm|xls)$/i.test(name) }
function readFingerprintContentHash(fingerprint: string) {
  const match = fingerprint.match(/:([a-f0-9]{64})$/i)
  return match?.[1]?.toLowerCase()
}
function getDeviceId() {
  const key = 'tripmap:device-id'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const next = crypto.randomUUID()
  window.localStorage.setItem(key, next)
  return next
}
