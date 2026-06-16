import { db } from '../../db/database'
import { createId } from '../../db/ids'
import {
  type ExistingTripImportApplyFile,
  type ExistingTripImportTicketSummary,
  type ExistingTripImportPreview,
  type ExistingTripImportSourceKind,
  type ExistingTripImportSourceSummary,
} from './existingTripImport'
import { buildExistingTripImportRequestSources, type ExistingTripImportExtractionResult } from './existingTripImportExtraction'
import { PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION, type ProviderProxyExistingTripImportRequest, type ProviderProxyExistingTripImportTicketSummary } from './providerProxyContract'
import type {
  Day,
  ItineraryItem,
  TicketMeta,
  Trip,
  TravelInboxEntry,
  TravelInboxEntryCategory,
  TravelInboxPreviewRecord,
  TravelInboxSourceKind,
} from '../../types'

const TRAVEL_INBOX_AUTO_RECOGNIZE_KEY = 'tripmap:travel-inbox:auto-recognize'

export function isTravelInboxAutoRecognizeEnabled() {
  return readStorageValue(TRAVEL_INBOX_AUTO_RECOGNIZE_KEY) === '1'
}

export function setTravelInboxAutoRecognizeEnabled(enabled: boolean) {
  writeStorageValue(TRAVEL_INBOX_AUTO_RECOGNIZE_KEY, enabled ? '1' : '0')
}

export async function listTravelInboxEntriesByTrip(tripId: string) {
  return db.travelInboxEntries
    .where('tripId')
    .equals(tripId)
    .sortBy('createdAt')
}

export async function getTravelInboxEntry(entryId: string) {
  return db.travelInboxEntries.get(entryId)
}

export async function getActiveTravelInboxPreview(tripId: string) {
  const previews = await db.travelInboxPreviews
    .where('tripId')
    .equals(tripId)
    .reverse()
    .sortBy('createdAt')
  return previews.find((preview) => preview.status === 'ready') as TravelInboxPreviewRecord | undefined
}

export async function addTravelInboxExtraction({
  extraction,
  tripId,
}: {
  extraction: ExistingTripImportExtractionResult
  tripId: string
}) {
  const now = Date.now()
  const entries: TravelInboxEntry[] = extraction.sources.map((source) => ({
    category: inferTravelInboxCategory(source.kind),
    createdAt: now,
    error: undefined,
    extractedText: source.text,
    fileName: source.fileName,
    id: createId('inbox'),
    label: source.label,
    mimeType: source.mimeType,
    size: source.size,
    sourceKind: source.kind as TravelInboxSourceKind,
    status: 'ready',
    tripId,
    updatedAt: now,
    warnings: source.warnings ?? [],
  }))
  const sourceIdByEntryId = new Map(entries.map((entry, index) => [extraction.sources[index].id, entry.id]))
  const blobs = entries.flatMap((entry, index) => {
    const source = extraction.sources[index]
    const file = extraction.filesBySourceId.get(source.id)
    return file ? [{ blob: file.blob, entryId: entry.id }] : []
  })

  await db.transaction('rw', db.travelInboxEntries, db.travelInboxBlobs, async () => {
    if (entries.length > 0) await db.travelInboxEntries.bulkAdd(entries)
    if (blobs.length > 0) await db.travelInboxBlobs.bulkPut(blobs)
  })

  return { entries, sourceIdByEntryId }
}

export async function addTravelInboxErrorEntry({
  blob,
  error,
  fileName,
  mimeType,
  size,
  tripId,
}: {
  blob?: Blob
  error: string
  fileName: string
  mimeType?: string
  size?: number
  tripId: string
}) {
  const now = Date.now()
  const entry: TravelInboxEntry = {
    category: inferTravelInboxCategory(inferTravelInboxSourceKind(fileName, mimeType)),
    createdAt: now,
    error,
    extractedText: '',
    fileName,
    id: createId('inbox'),
    label: fileName,
    mimeType,
    size,
    sourceKind: inferTravelInboxSourceKind(fileName, mimeType),
    status: 'error',
    tripId,
    updatedAt: now,
    warnings: [],
  }
  await db.transaction('rw', db.travelInboxEntries, db.travelInboxBlobs, async () => {
    await db.travelInboxEntries.add(entry)
    if (blob) await db.travelInboxBlobs.put({ blob, entryId: entry.id })
  })
  return entry
}

export async function replaceTravelInboxEntryWithExtraction({
  entryId,
  extraction,
}: {
  entryId: string
  extraction: ExistingTripImportExtractionResult
}) {
  const source = extraction.sources[0]
  const existing = await db.travelInboxEntries.get(entryId)
  if (!existing || !source) return undefined
  const now = Date.now()
  const next: TravelInboxEntry = {
    ...existing,
    category: inferTravelInboxCategory(source.kind),
    error: undefined,
    extractedText: source.text,
    fileName: source.fileName ?? existing.fileName,
    label: source.label || existing.label,
    mimeType: source.mimeType ?? existing.mimeType,
    size: source.size ?? existing.size,
    sourceKind: source.kind as TravelInboxSourceKind,
    status: 'ready',
    updatedAt: now,
    warnings: source.warnings ?? [],
  }
  await db.travelInboxEntries.put(next)
  return next
}

export function buildTravelInboxSourceSummaries(entries: TravelInboxEntry[]): ExistingTripImportSourceSummary[] {
  return entries.map((entry) => ({
    fileName: entry.fileName,
    id: entry.id,
    kind: entry.sourceKind as ExistingTripImportSourceKind,
    label: entry.label || entry.fileName || describeTravelInboxSourceKind(entry.sourceKind),
    mimeType: entry.mimeType,
    size: entry.size,
    text: entry.extractedText,
    warnings: entry.warnings.length ? entry.warnings : undefined,
  }))
}

export function buildTravelInboxProviderSources(entries: TravelInboxEntry[]) {
  return buildExistingTripImportRequestSources(buildTravelInboxSourceSummaries(entries))
}

export function buildTravelInboxTicketSummaries(tickets: TicketMeta[]): ExistingTripImportTicketSummary[] {
  return [...tickets]
    .sort((first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id))
    .map((ticket, index) => ({
      itemId: ticket.itemId,
      scope: ticket.scope,
      summaryId: `existing-ticket:${index + 1}`,
      ticketCategory: ticket.ticketCategory ?? 'other',
      ticketId: ticket.id,
      title: ticket.title?.trim() || ticket.note?.trim() || '未命名票据',
    }))
}

export function buildTravelInboxProviderTicketSummaries(
  summaries: ExistingTripImportTicketSummary[],
): ProviderProxyExistingTripImportTicketSummary[] {
  return summaries.map((summary) => ({
    itemId: summary.itemId,
    scope: summary.scope,
    summaryId: summary.summaryId,
    ticketCategory: summary.ticketCategory,
    title: summary.title,
  }))
}

export async function buildTravelInboxApplyFiles(entryIds: string[]) {
  const entries = await db.travelInboxEntries.bulkGet(entryIds)
  const blobs = await db.travelInboxBlobs.bulkGet(entryIds)
  const files = new Map<string, ExistingTripImportApplyFile>()
  for (const [index, entry] of entries.entries()) {
    const blobRecord = blobs[index]
    if (!entry || !blobRecord?.blob) continue
    files.set(entry.id, {
      blob: blobRecord.blob,
      fileName: entry.fileName || entry.label || entry.id,
      mimeType: entry.mimeType || blobRecord.blob.type || 'application/octet-stream',
      size: entry.size ?? blobRecord.blob.size,
    })
  }
  return files
}

export async function saveTravelInboxPreview({
  cloudSourceId,
  checkedDiffIds,
  entryIds,
  preview,
  tripId,
}: {
  cloudSourceId?: string
  checkedDiffIds: string[]
  entryIds: string[]
  preview: ExistingTripImportPreview
  tripId: string
}) {
  const now = Date.now()
  const record: TravelInboxPreviewRecord = {
    checkedDiffIds,
    cloudSourceId,
    createdAt: now,
    entryIds,
    id: createId('inbox_preview'),
    preview,
    status: 'ready',
    tripId,
    updatedAt: now,
  }
  await db.transaction('rw', db.travelInboxPreviews, db.travelInboxEntries, async () => {
    const existing = await db.travelInboxPreviews.where('tripId').equals(tripId).toArray()
    const replaceIds = existing.filter((item) => item.status === 'ready' && item.cloudSourceId === cloudSourceId).map((item) => item.id)
    if (replaceIds.length > 0) await db.travelInboxPreviews.bulkDelete(replaceIds)
    await db.travelInboxPreviews.add(record)
    await db.travelInboxEntries.bulkPut((await db.travelInboxEntries.bulkGet(entryIds))
      .filter((entry): entry is TravelInboxEntry => Boolean(entry))
      .map((entry) => ({ ...entry, status: 'previewed', updatedAt: now })))
  })
  return record
}

export function buildTravelInboxProviderRequest({
  allItems,
  days,
  sourceSummaries,
  ticketSummaries,
  trip,
}: {
  allItems: ItineraryItem[]
  days: Day[]
  sourceSummaries: ExistingTripImportSourceSummary[]
  ticketSummaries: ExistingTripImportTicketSummary[]
  trip: Trip
}): ProviderProxyExistingTripImportRequest {
  const dayById = new Map(days.map((day) => [day.id, day]))
  return {
    days: days.map((day) => ({ date: day.date, id: day.id, sortOrder: day.sortOrder, timeZone: day.timeZone, title: day.title })),
    existingTicketSummaries: buildTravelInboxProviderTicketSummaries(ticketSummaries),
    items: allItems.map((item) => ({
      address: item.address,
      date: dayById.get(item.dayId)?.date ?? trip.startDate,
      dayId: item.dayId,
      endDate: item.endDate,
      endTime: item.endTime,
      endTimeZone: item.endTimeZone,
      id: item.id,
      locationName: item.locationName,
      previousTransportDurationMinutes: item.previousTransportDurationMinutes,
      previousTransportMode: item.previousTransportMode,
      previousTransportNote: item.previousTransportNote,
      startTime: item.startTime,
      startTimeZone: item.startTimeZone,
      ticketCount: item.ticketIds.length,
      title: item.title,
      transportMode: item.transportMode,
    })),
    locale: 'zh-CN',
    operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
    sources: buildExistingTripImportRequestSources(sourceSummaries),
    trip: { destination: trip.destination, endDate: trip.endDate, id: trip.id, startDate: trip.startDate, timeZone: trip.timeZone, title: trip.title },
  }
}

export async function updateTravelInboxPreviewRecord(record: TravelInboxPreviewRecord) {
  await db.travelInboxPreviews.put({ ...record, updatedAt: Date.now() })
}

export async function markTravelInboxEntriesRecognizing(entryIds: string[], recognizing: boolean) {
  const now = Date.now()
  const entries = (await db.travelInboxEntries.bulkGet(entryIds))
    .filter((entry): entry is TravelInboxEntry => Boolean(entry))
    .map((entry) => ({
      ...entry,
      status: recognizing ? 'recognizing' as const : 'ready' as const,
      updatedAt: now,
    }))
  if (entries.length > 0) await db.travelInboxEntries.bulkPut(entries)
}

export async function markTravelInboxEntriesError(entryIds: string[], error: string) {
  const now = Date.now()
  const entries = (await db.travelInboxEntries.bulkGet(entryIds))
    .filter((entry): entry is TravelInboxEntry => Boolean(entry))
    .map((entry) => ({
      ...entry,
      error,
      status: 'error' as const,
      updatedAt: now,
    }))
  if (entries.length > 0) await db.travelInboxEntries.bulkPut(entries)
}

export async function deleteTravelInboxEntries(entryIds: string[]) {
  if (entryIds.length === 0) return
  await db.transaction('rw', db.travelInboxEntries, db.travelInboxBlobs, db.travelInboxPreviews, async () => {
    await db.travelInboxEntries.bulkDelete(entryIds)
    await db.travelInboxBlobs.bulkDelete(entryIds)
    const previews = await db.travelInboxPreviews.toArray()
    const touchedPreviewIds = previews
      .filter((preview) => preview.entryIds.some((entryId) => entryIds.includes(entryId)))
      .map((preview) => preview.id)
    if (touchedPreviewIds.length > 0) await db.travelInboxPreviews.bulkDelete(touchedPreviewIds)
  })
}

export async function deleteTravelInboxPreview(previewId: string) {
  await db.travelInboxPreviews.delete(previewId)
}

export function summarizeTravelInboxPreview(preview: ExistingTripImportPreview) {
  return preview.diffs.reduce((summary, diff) => {
    if (diff.type === 'create_day') summary.createDays += 1
    if (diff.type === 'update_trip_dates') summary.updateDates += 1
    if (diff.type === 'create_item') summary.createItems += 1
    if (diff.type === 'merge_item_fields') summary.mergeItems += 1
    if (diff.type === 'append_item_note' || diff.type === 'append_trip_note') summary.notes += 1
    if (diff.type === 'create_ticket') summary.createTickets += 1
    if (diff.type === 'merge_ticket_meta') summary.createTickets += 1
    if (diff.type === 'bind_ticket' || diff.type === 'bind_existing_ticket') summary.bindTickets += 1
    return summary
  }, {
    bindTickets: 0,
    createDays: 0,
    createItems: 0,
    createTickets: 0,
    mergeItems: 0,
    notes: 0,
    updateDates: 0,
  })
}

export function describeTravelInboxSourceKind(kind: TravelInboxSourceKind) {
  if (kind === 'pasted_text') return '粘贴文本'
  if (kind === 'text_file') return '文本文件'
  if (kind === 'email') return '邮件'
  if (kind === 'html') return 'HTML'
  if (kind === 'pdf') return 'PDF'
  if (kind === 'image') return '图片'
  if (kind === 'trip_plan') return '行程包'
  return '票据文件'
}

export function inferTravelInboxSourceKind(fileName: string, mimeType = ''): TravelInboxSourceKind {
  const name = fileName.toLowerCase()
  const mime = mimeType.toLowerCase()
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (name.endsWith('.zip') || name.endsWith('.json')) return 'trip_plan'
  if (mime.includes('html') || /\.html?$/i.test(name)) return 'html'
  if (name.endsWith('.eml') || mime.includes('message/rfc822')) return 'email'
  if (mime.startsWith('text/') || /\.(txt|md|csv)$/i.test(name)) return 'text_file'
  return 'ticket_file'
}

function inferTravelInboxCategory(kind: ExistingTripImportSourceKind): TravelInboxEntryCategory {
  if (kind === 'ticket_file' || kind === 'image') return 'ticket'
  if (kind === 'trip_plan') return 'mixed'
  if (kind === 'pasted_text' || kind === 'email' || kind === 'html' || kind === 'pdf' || kind === 'text_file') return 'unclassified'
  return 'unclassified'
}

function readStorageValue(key: string) {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function writeStorageValue(key: string, value: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Local preference persistence is best effort.
  }
}
