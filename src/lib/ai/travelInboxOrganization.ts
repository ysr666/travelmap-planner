import { db } from '../../db/database'
import { listDaysByTrip, listItemsByTrip, listTicketsByTrip, listTrips, getTrip } from '../../db/repositories'
import {
  buildExistingTripImportPreview,
  type ExistingTripImportApplyFile,
  type ExistingTripImportProviderResult,
} from './existingTripImport'
import {
  addTravelInboxExtraction,
  buildTravelInboxProviderRequest,
  buildTravelInboxSourceSummaries,
  buildTravelInboxTicketSummaries,
  deleteTravelInboxEntries,
  saveTravelInboxPreview,
} from './travelInbox'
import {
  DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  EXISTING_TRIP_IMPORT_MAX_FILE_COUNT,
  type ExistingTripImportExtractionResult,
} from './existingTripImportExtraction'
import { PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION } from './providerProxyContract'
import { fetchProviderProxyExistingTripImport, fetchProviderProxyTravelInboxClassify, getProviderProxyConfig } from '../providerProxyClient'
import { extractTravelInboxBlob } from '../travelInboxMime'
import {
  claimCloudTravelInboxSource,
  completeCloudTravelInboxSource,
  downloadCloudTravelInboxSource,
  listCloudTravelInboxSources,
  updateCloudTravelInboxSource,
  type CloudTravelInboxSource,
} from '../travelInboxConnectors'
import type { TravelInboxAccountSource, TravelInboxClassification, TravelInboxSourceKind, Trip } from '../../types'

export type TravelInboxBatchProcessResult = {
  failedCount: number
  needsAssignmentCount: number
  previewCount: number
  processedCount: number
}

export const TRAVEL_INBOX_BATCH_MAX_SOURCE_COUNT = EXISTING_TRIP_IMPORT_MAX_FILE_COUNT * 2
const TRAVEL_INBOX_BATCH_MAX_PROVIDER_CALLS = 2

export async function refreshCloudTravelInboxSources() {
  const cloudSources = await listCloudTravelInboxSources()
  const existing = new Map((await db.travelInboxAccountSources.toArray()).filter((source) => source.cloudSourceId).map((source) => [source.cloudSourceId, source]))
  const rows = cloudSources.map((source) => mapCloudSource(source, existing.get(source.id)))
  if (rows.length > 0) await db.travelInboxAccountSources.bulkPut(rows)
  return rows
}

export function listTravelInboxAccountSources() {
  return db.travelInboxAccountSources.orderBy('receivedAt').reverse().toArray()
}

export async function processTravelInboxAccountSource(sourceId: string, claimant = getClaimantId()) {
  let source = await db.travelInboxAccountSources.get(sourceId)
  if (!source) throw new Error('未找到待处理来源。')
  source = await ensureAccountSourceBlob(source, claimant)
  source = await updateLocalSource(source, { error: undefined, status: 'extracting' })
  await updateCloudStatus(source, { status: 'extracting' })
  try {
    const extraction = await extractSource(source)
    const extractedText = extraction.sources.map((item) => item.text).join('\n\n').slice(0, 12_000)
    if (!extractedText) throw new Error('没有提取到可识别文本。')
    source = await updateLocalSource(source, { extractedText, status: 'classifying', warnings: extraction.warnings })
    await updateCloudStatus(source, { status: 'classifying', warnings: extraction.warnings })
    const deterministicTrip = findUniqueDeterministicTrip(extractedText, await listTrips())
    const classification = deterministicTrip
      ? deterministicClassification(deterministicTrip, '本地日期或目的地与旅行唯一匹配。')
      : await classifySource(source, extraction)
    const trip = classification.targetTripId ? await getTrip(classification.targetTripId) : undefined
    if (classification.confidence === 'high' && trip && isDeterministicTripMatch(extractedText, trip)) {
      await buildAccountSourcePreview(source, trip, extraction, classification)
      return
    }
    await updateLocalSource(source, { classification, status: 'needs_assignment', targetTripId: classification.targetTripId })
    await updateCloudStatus(source, { classification, status: 'needs_assignment', target_trip_id: classification.targetTripId ?? null })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '处理来源失败。'
    await updateLocalSource(source, { error: message, status: 'error' })
    await updateCloudStatus(source, { error_code: 'processing_failed', status: 'error' }).catch(() => undefined)
    throw caught
  }
}

export async function processTravelInboxAccountSourceBatch(
  sourceIds: string[],
  targetTripId?: string,
  claimant = getClaimantId(),
): Promise<TravelInboxBatchProcessResult> {
  const ids = Array.from(new Set(sourceIds)).slice(0, TRAVEL_INBOX_BATCH_MAX_SOURCE_COUNT)
  const sources = (await db.travelInboxAccountSources.bulkGet(ids))
    .filter((source): source is TravelInboxAccountSource => Boolean(source))
  if (sources.length === 0) throw new Error('未找到待处理来源。')

  const explicitTrip = targetTripId ? await getTrip(targetTripId) : undefined
  if (targetTripId && !explicitTrip) throw new Error('目标旅行不存在。')
  const trips = explicitTrip ? [explicitTrip] : await listTrips()
  const grouped = new Map<string, Array<{
    classification: TravelInboxClassification
    extraction: ExistingTripImportExtractionResult
    source: TravelInboxAccountSource
  }>>()
  let failedCount = 0
  let needsAssignmentCount = 0
  let processedCount = 0

  for (const initialSource of sources) {
    let source = initialSource
    try {
      source = await ensureAccountSourceBlob(source, claimant)
      source = await updateLocalSource(source, { error: undefined, status: 'extracting' })
      await updateCloudStatus(source, { status: 'extracting' })
      const extraction = namespaceExtraction(await extractSource(source), source)
      const extractedText = extraction.sources.map((item) => item.text).join('\n\n').slice(0, 12_000)
      if (!extractedText) throw new Error('没有提取到可识别文本。')
      source = await updateLocalSource(source, {
        extractedText,
        status: 'classifying',
        warnings: extraction.warnings,
      })
      await updateCloudStatus(source, { status: 'classifying', warnings: extraction.warnings })

      const trip = explicitTrip ?? findUniqueDeterministicTrip(extractedText, trips)
      if (!trip) {
        const classification: TravelInboxClassification = {
          category: 'unclassified',
          confidence: 'low',
          reason: '未找到唯一匹配的旅行，请选择目标旅行。',
        }
        await updateLocalSource(source, { classification, status: 'needs_assignment', targetTripId: undefined })
        await updateCloudStatus(source, { classification, status: 'needs_assignment', target_trip_id: null })
        needsAssignmentCount += 1
        processedCount += 1
        continue
      }

      const classification = deterministicClassification(
        trip,
        explicitTrip ? '由用户批量选择目标旅行。' : '本地日期或目的地与旅行唯一匹配。',
      )
      const entries = grouped.get(trip.id) ?? []
      entries.push({ classification, extraction, source })
      grouped.set(trip.id, entries)
      processedCount += 1
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '处理来源失败。'
      await updateLocalSource(source, { error: message, status: 'error' })
      await updateCloudStatus(source, { error_code: 'processing_failed', status: 'error' }).catch(() => undefined)
      failedCount += 1
    }
  }

  let previewCount = 0
  let providerCalls = 0
  for (const [tripId, entries] of grouped) {
    const trip = trips.find((candidate) => candidate.id === tripId)
    if (!trip) continue
    const requiredProviderCalls = Math.ceil(
      entries.reduce((count, entry) => count + entry.extraction.sources.length, 0)
      / EXISTING_TRIP_IMPORT_MAX_FILE_COUNT,
    )
    if (
      requiredProviderCalls > TRAVEL_INBOX_BATCH_MAX_PROVIDER_CALLS
      || providerCalls + requiredProviderCalls > TRAVEL_INBOX_BATCH_MAX_PROVIDER_CALLS
    ) {
      const classification: TravelInboxClassification = {
        category: 'unclassified',
        confidence: 'low',
        reason: '批量来源过多或涉及多个旅行，请确认目标旅行后分批整理。',
        targetTripId: trip.id,
      }
      for (const entry of entries) {
        await updateLocalSource(entry.source, {
          classification,
          status: 'needs_assignment',
          targetTripId: trip.id,
        })
        await updateCloudStatus(entry.source, {
          classification,
          status: 'needs_assignment',
          target_trip_id: trip.id,
        })
      }
      needsAssignmentCount += entries.length
      continue
    }
    providerCalls += requiredProviderCalls
    try {
      await buildAccountSourceBatchPreview(entries, trip)
      previewCount += 1
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '生成批量整理预览失败。'
      for (const entry of entries) {
        await updateLocalSource(entry.source, { error: message, status: 'error' })
        await updateCloudStatus(entry.source, { error_code: 'processing_failed', status: 'error' }).catch(() => undefined)
      }
      failedCount += entries.length
    }
  }

  return { failedCount, needsAssignmentCount, previewCount, processedCount }
}

export async function assignTravelInboxAccountSource(sourceId: string, tripId: string) {
  const source = await db.travelInboxAccountSources.get(sourceId)
  const trip = await getTrip(tripId)
  if (!source || !trip) throw new Error('来源或目标旅行不存在。')
  const extraction = await extractSource(source)
  const classification: TravelInboxClassification = {
    category: source.classification?.category ?? 'unclassified',
    confidence: 'high',
    reason: '由用户选择目标旅行。',
    targetTripId: trip.id,
  }
  await buildAccountSourcePreview(source, trip, extraction, classification)
}

export async function discardTravelInboxAccountSource(source: TravelInboxAccountSource) {
  if (source.cloudSourceId) await completeCloudTravelInboxSource(source.cloudSourceId, 'discarded')
  await db.transaction('rw', db.travelInboxAccountSources, db.travelInboxAccountSourceBlobs, async () => {
    await db.travelInboxAccountSources.delete(source.id)
    await db.travelInboxAccountSourceBlobs.delete(source.id)
  })
}

export async function completeTravelInboxAccountSource(reference: string, resultSummary: unknown) {
  const source = reference.startsWith('cloud:')
    ? await db.travelInboxAccountSources.where('cloudSourceId').equals(reference.slice(6)).first()
    : await db.travelInboxAccountSources.get(reference.replace(/^local:/, ''))
  if (!source) return
  if (source.cloudSourceId) await completeCloudTravelInboxSource(source.cloudSourceId, 'applied', resultSummary)
  await db.transaction('rw', db.travelInboxAccountSources, db.travelInboxAccountSourceBlobs, async () => {
    await db.travelInboxAccountSources.delete(source.id)
    await db.travelInboxAccountSourceBlobs.delete(source.id)
  })
}

export async function resetTravelInboxAccountSourcePreview(reference: string) {
  const source = reference.startsWith('cloud:')
    ? await db.travelInboxAccountSources.where('cloudSourceId').equals(reference.slice(6)).first()
    : await db.travelInboxAccountSources.get(reference.replace(/^local:/, ''))
  if (!source) return
  await updateLocalSource(source, { error: undefined, status: 'needs_assignment' })
  await updateCloudStatus(source, { error_code: null, status: 'needs_assignment' })
}

async function buildAccountSourcePreview(
  source: TravelInboxAccountSource,
  trip: Trip,
  extraction: ExistingTripImportExtractionResult,
  classification: TravelInboxClassification,
) {
  const proxyUrl = getProviderProxyConfig().proxyUrl
  if (!proxyUrl) throw new Error('当前未配置 provider proxy。')
  source = await updateLocalSource(source, { classification, status: 'building_preview', targetTripId: trip.id })
  await updateCloudStatus(source, { classification, status: 'building_preview', target_trip_id: trip.id })
  const { entries } = await addTravelInboxExtraction({ extraction, tripId: trip.id })
  const [days, items, tickets] = await Promise.all([listDaysByTrip(trip.id), listItemsByTrip(trip.id), listTicketsByTrip(trip.id)])
  const sourceSummaries = buildTravelInboxSourceSummaries(entries)
  const ticketSummaries = buildTravelInboxTicketSummaries(tickets)
  const response = await fetchProviderProxyExistingTripImport(buildTravelInboxProviderRequest({ allItems: items, days, sourceSummaries, ticketSummaries, trip }), proxyUrl)
  const preview = buildExistingTripImportPreview({ context: { days, items, ticketSummaries, trip }, providerResult: response.result, sourceSummaries })
  const reference = source.cloudSourceId ? `cloud:${source.cloudSourceId}` : `local:${source.id}`
  await saveTravelInboxPreview({
    checkedDiffIds: preview.diffs.filter((diff) => diff.checked).map((diff) => diff.id),
    cloudSourceId: reference,
    entryIds: entries.map((entry) => entry.id),
    preview,
    tripId: trip.id,
  })
  await updateLocalSource(source, { classification, status: 'preview_ready', targetTripId: trip.id })
  await updateCloudStatus(source, { classification, status: 'preview_ready', target_trip_id: trip.id })
}

async function buildAccountSourceBatchPreview(
  entries: Array<{
    classification: TravelInboxClassification
    extraction: ExistingTripImportExtractionResult
    source: TravelInboxAccountSource
  }>,
  trip: Trip,
) {
  const proxyUrl = getProviderProxyConfig().proxyUrl
  if (!proxyUrl) throw new Error('当前未配置 provider proxy。')
  for (const entry of entries) {
    await updateLocalSource(entry.source, {
      classification: entry.classification,
      status: 'building_preview',
      targetTripId: trip.id,
    })
    await updateCloudStatus(entry.source, {
      classification: entry.classification,
      status: 'building_preview',
      target_trip_id: trip.id,
    })
  }

  const extraction = mergeExtractions(entries.map((entry) => entry.extraction))
  const { entries: inboxEntries } = await addTravelInboxExtraction({ extraction, tripId: trip.id })
  const inboxEntryIds = inboxEntries.map((entry) => entry.id)
  try {
    const [days, items, tickets] = await Promise.all([
      listDaysByTrip(trip.id),
      listItemsByTrip(trip.id),
      listTicketsByTrip(trip.id),
    ])
    const sourceSummaries = buildTravelInboxSourceSummaries(inboxEntries)
    const ticketSummaries = buildTravelInboxTicketSummaries(tickets)
    const sourceBatches = chunk(sourceSummaries, EXISTING_TRIP_IMPORT_MAX_FILE_COUNT)
    if (sourceBatches.length > TRAVEL_INBOX_BATCH_MAX_PROVIDER_CALLS) {
      throw new Error(`单次最多整理 ${TRAVEL_INBOX_BATCH_MAX_SOURCE_COUNT} 项来源，请分批处理。`)
    }
    const providerResults: ExistingTripImportProviderResult[] = []
    for (const [batchIndex, batchSourceSummaries] of sourceBatches.entries()) {
      const response = await fetchProviderProxyExistingTripImport(
        buildTravelInboxProviderRequest({
          allItems: items,
          days,
          sourceSummaries: batchSourceSummaries,
          ticketSummaries,
          trip,
        }),
        proxyUrl,
      )
      providerResults.push(namespaceProviderResult(response.result, batchIndex))
    }
    const preview = buildExistingTripImportPreview({
      context: { days, items, ticketSummaries, trip },
      providerResult: mergeProviderResults(providerResults),
      sourceSummaries,
    })
    const accountSourceRefs = entries.map((entry) => accountSourceReference(entry.source))
    await saveTravelInboxPreview({
      accountSourceRefs,
      checkedDiffIds: preview.diffs.filter((diff) => diff.checked).map((diff) => diff.id),
      cloudSourceId: accountSourceRefs[0],
      entryIds: inboxEntryIds,
      preview,
      tripId: trip.id,
    })
    for (const entry of entries) {
      await updateLocalSource(entry.source, {
        classification: entry.classification,
        status: 'preview_ready',
        targetTripId: trip.id,
      })
      await updateCloudStatus(entry.source, {
        classification: entry.classification,
        status: 'preview_ready',
        target_trip_id: trip.id,
      })
    }
  } catch (caught) {
    await deleteTravelInboxEntries(inboxEntryIds).catch(() => undefined)
    throw caught
  }
}

async function classifySource(source: TravelInboxAccountSource, extraction: ExistingTripImportExtractionResult) {
  const proxyUrl = getProviderProxyConfig().proxyUrl
  if (!proxyUrl) throw new Error('当前未配置 provider proxy。')
  const trips = (await listTrips()).slice(0, 30)
  const first = extraction.sources[0]
  if (!first) throw new Error('没有可分类的文本。')
  const response = await fetchProviderProxyTravelInboxClassify({
    operation: PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION,
    source: {
      fileName: source.fileName,
      id: first.id,
      kind: first.kind,
      label: source.label,
      mimeType: source.mimeType,
      size: source.size,
      text: extraction.sources.map((item) => item.text).join('\n\n').slice(0, 4_000),
      warnings: extraction.warnings.slice(0, 5),
    },
    trips: trips.map((trip) => ({ destination: trip.destination, endDate: trip.endDate, id: trip.id, startDate: trip.startDate, title: trip.title })),
  }, proxyUrl)
  return response.classification
}

async function extractSource(source: TravelInboxAccountSource) {
  const record = await db.travelInboxAccountSourceBlobs.get(source.id)
  if (!record?.blob) throw new Error('来源原件不可用。')
  return extractTravelInboxBlob({
    blob: record.blob,
    fileName: source.fileName || source.label,
    languages: DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
    mimeType: source.mimeType || record.blob.type,
  })
}

async function ensureAccountSourceBlob(source: TravelInboxAccountSource, claimant: string) {
  if (!source.cloudSourceId) return source
  const claimed = await claimCloudTravelInboxSource(source.cloudSourceId, claimant)
  if (!claimed) throw new Error('此来源正在其他设备处理。')
  if (!(await db.travelInboxAccountSourceBlobs.get(source.id))) {
    const blob = await downloadCloudTravelInboxSource(claimed.storage_path)
    await db.travelInboxAccountSourceBlobs.put({ blob, sourceId: source.id })
  }
  return source
}

function findUniqueDeterministicTrip(text: string, trips: Trip[]) {
  const matches = trips.filter((trip) => isDeterministicTripMatch(text, trip))
  return matches.length === 1 ? matches[0] : undefined
}

function deterministicClassification(trip: Trip, reason: string): TravelInboxClassification {
  return {
    category: 'unclassified',
    confidence: 'high',
    reason,
    targetTripId: trip.id,
  }
}

function namespaceExtraction(
  extraction: ExistingTripImportExtractionResult,
  accountSource: TravelInboxAccountSource,
): ExistingTripImportExtractionResult {
  const idMap = new Map(extraction.sources.map((source) => [
    source.id,
    `${accountSource.id}:${source.id}`,
  ]))
  const filesBySourceId = new Map<string, ExistingTripImportApplyFile>()
  for (const [fileId, file] of extraction.filesBySourceId) {
    const sourceId = extraction.sources.find((source) =>
      fileId === source.id || fileId.startsWith(`${source.id}:`),
    )?.id
    const nextFileId = sourceId
      ? `${idMap.get(sourceId)}${fileId.slice(sourceId.length)}`
      : `${accountSource.id}:${fileId}`
    filesBySourceId.set(nextFileId, file)
  }
  return {
    filesBySourceId,
    sources: extraction.sources.map((source) => ({
      ...source,
      fileName: extraction.sources.length === 1 ? accountSource.fileName ?? source.fileName : source.fileName,
      id: idMap.get(source.id) ?? `${accountSource.id}:${source.id}`,
      label: extraction.sources.length === 1 ? accountSource.label : source.label,
    })),
    warnings: extraction.warnings,
  }
}

function mergeExtractions(extractions: ExistingTripImportExtractionResult[]): ExistingTripImportExtractionResult {
  const filesBySourceId = new Map<string, ExistingTripImportApplyFile>()
  for (const extraction of extractions) {
    for (const [sourceId, file] of extraction.filesBySourceId) filesBySourceId.set(sourceId, file)
  }
  return {
    filesBySourceId,
    sources: extractions.flatMap((extraction) => extraction.sources),
    warnings: Array.from(new Set(extractions.flatMap((extraction) => extraction.warnings))),
  }
}

function namespaceProviderResult(
  result: ExistingTripImportProviderResult,
  batchIndex: number,
): ExistingTripImportProviderResult {
  const namespaceCandidates = <Candidate extends { candidateId: string }>(candidates: Candidate[] | undefined) =>
    candidates?.map((candidate) => ({
      ...candidate,
      candidateId: `batch-${batchIndex + 1}:${candidate.candidateId}`,
    }))
  return {
    days: namespaceCandidates(result.days),
    items: namespaceCandidates(result.items),
    notes: namespaceCandidates(result.notes),
    tickets: namespaceCandidates(result.tickets),
    warnings: result.warnings,
  }
}

function mergeProviderResults(results: ExistingTripImportProviderResult[]): ExistingTripImportProviderResult {
  return {
    days: results.flatMap((result) => result.days ?? []),
    items: results.flatMap((result) => result.items ?? []),
    notes: results.flatMap((result) => result.notes ?? []),
    tickets: results.flatMap((result) => result.tickets ?? []),
    warnings: Array.from(new Set(results.flatMap((result) => result.warnings ?? []))),
  }
}

function chunk<Value>(values: Value[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  )
}

function accountSourceReference(source: TravelInboxAccountSource) {
  return source.cloudSourceId ? `cloud:${source.cloudSourceId}` : `local:${source.id}`
}

function mapCloudSource(source: CloudTravelInboxSource, existing?: TravelInboxAccountSource): TravelInboxAccountSource {
  const status = source.status === 'preview_ready' && existing?.status !== 'preview_ready'
    ? 'needs_assignment'
    : normalizeStatus(source.status, existing?.status)
  return {
    classification: isClassification(source.classification) ? source.classification : existing?.classification,
    cloudSourceId: source.id,
    connectorId: source.connector_id ?? undefined,
    connectorKind: source.connector_kind,
    createdAt: Date.parse(source.created_at),
    error: source.error_code ? describeCloudSourceError(source.error_code) : existing?.error,
    extractedText: existing?.extractedText,
    fileName: source.file_name ?? undefined,
    id: existing?.id ?? `cloud_${source.id}`,
    label: source.label,
    mimeType: source.mime_type,
    receivedAt: Date.parse(source.received_at),
    size: source.size,
    sourceKind: normalizeSourceKind(source.source_kind),
    status,
    targetTripId: source.target_trip_id ?? existing?.targetTripId,
    updatedAt: Date.parse(source.updated_at),
    warnings: Array.isArray(source.warnings) ? source.warnings.filter((item): item is string => typeof item === 'string') : existing?.warnings ?? [],
  }
}

async function updateLocalSource(source: TravelInboxAccountSource, patch: Partial<TravelInboxAccountSource>) {
  const next = { ...source, ...patch, updatedAt: Date.now() }
  await db.travelInboxAccountSources.put(next)
  return next
}

function updateCloudStatus(source: TravelInboxAccountSource, patch: Record<string, unknown>) {
  return source.cloudSourceId ? updateCloudTravelInboxSource(source.cloudSourceId, patch) : Promise.resolve()
}

export function isDeterministicTripMatch(text: string, trip: Trip) {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, '')
  const title = trip.title.toLocaleLowerCase().replace(/\s+/g, '')
  const destination = trip.destination.toLocaleLowerCase().replace(/\s+/g, '')
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []
  return (title.length >= 2 && normalized.includes(title)) || (destination.length >= 2 && normalized.includes(destination)) || dates.some((date) => date >= trip.startDate && date <= trip.endDate)
}

function normalizeSourceKind(value: string): TravelInboxSourceKind {
  return ['pasted_text', 'text_file', 'email', 'html', 'pdf', 'image', 'spreadsheet', 'trip_plan', 'ticket_file'].includes(value) ? value as TravelInboxSourceKind : 'email'
}
function normalizeStatus(value: string, fallback?: TravelInboxAccountSource['status']): TravelInboxAccountSource['status'] {
  return ['queued', 'extracting', 'classifying', 'needs_assignment', 'building_preview', 'preview_ready', 'error'].includes(value) ? value as TravelInboxAccountSource['status'] : fallback ?? 'queued'
}
function isClassification(value: unknown): value is TravelInboxClassification {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.reason === 'string' && ['low', 'medium', 'high'].includes(String(record.confidence))
}
function describeCloudSourceError(code: string) {
  const messages: Record<string, string> = {
    processing_failed: '本地提取或 AI 整理失败，可重试。',
    source_too_large: '邮件原文超过 20 MB 上限，无法处理。',
    too_many_attachments: '邮件附件超过 8 个上限，无法处理。',
  }
  return messages[code] ?? '来源处理失败。'
}
function getClaimantId() {
  const key = 'tripmap:travel-inbox:claimant'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const next = crypto.randomUUID()
  window.localStorage.setItem(key, next)
  return next
}
