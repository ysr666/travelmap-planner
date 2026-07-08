import { createId } from '../../db/ids'
import { db } from '../../db/database'
import { safeFileName } from '../backup'
import { enqueueObjectUpsert, markTicketBlobPendingUpload } from '../objectSyncLocal'
import { isValidPlainDate } from '../plainDate'
import { normalizeTimeZone } from '../timeZone'
import { recordTripWriteForSync } from '../tripSyncQueue'
import type { Day, ItineraryItem, TicketBlob, TicketCategory, TicketMeta, TicketScope, TransportMode, Trip } from '../../types'

export type ExistingTripImportConfidence = 'high' | 'medium' | 'low'
export type ExistingTripImportSourceKind = 'pasted_text' | 'text_file' | 'email' | 'html' | 'pdf' | 'image' | 'spreadsheet' | 'trip_plan' | 'ticket_file'

export type ExistingTripImportSourceSummary = {
  id: string
  kind: ExistingTripImportSourceKind
  label: string
  fileName?: string
  mimeType?: string
  size?: number
  text: string
  warnings?: string[]
}

export type ExistingTripImportContext = {
  days: Day[]
  items: ItineraryItem[]
  ticketSummaries?: ExistingTripImportTicketSummary[]
  trip: Trip
}

export type ExistingTripImportTicketSummary = {
  itemId?: string
  scope?: TicketScope
  summaryId: string
  ticketCategory?: TicketCategory
  ticketId: string
  title: string
}

export type ExistingTripImportProviderCandidateItem = {
  address?: string
  candidateId: string
  confidence?: ExistingTripImportConfidence
  date: string
  endDate?: string
  endTime?: string
  endTimeZone?: string
  locationName?: string
  note?: string
  previousTransportDurationMinutes?: number
  previousTransportMode?: TransportMode
  previousTransportNote?: string
  reason?: string
  sourceIds?: string[]
  startTime?: string
  startTimeZone?: string
  targetItemId?: string
  title: string
  transportMode?: TransportMode
}

export type ExistingTripImportProviderCandidateTicket = {
  candidateId: string
  confidence?: ExistingTripImportConfidence
  date?: string
  fileName?: string
  itemTitle?: string
  note?: string
  reason?: string
  sourceFileId?: string
  sourceIds?: string[]
  targetExistingTicketSummaryId?: string
  targetItemId?: string
  ticketCategory?: TicketCategory
  title: string
}

export type ExistingTripImportProviderCandidateDay = {
  candidateId: string
  confidence?: ExistingTripImportConfidence
  date: string
  reason?: string
  sourceIds?: string[]
  targetDayId?: string
  timeZone?: string
  title?: string
}

export type ExistingTripImportProviderCandidateNote = {
  candidateId: string
  confidence?: ExistingTripImportConfidence
  date?: string
  reason?: string
  sourceIds?: string[]
  text: string
}

export type ExistingTripImportProviderResult = {
  days?: ExistingTripImportProviderCandidateDay[]
  items?: ExistingTripImportProviderCandidateItem[]
  notes?: ExistingTripImportProviderCandidateNote[]
  tickets?: ExistingTripImportProviderCandidateTicket[]
  warnings?: string[]
}

export type ExistingTripImportDiffType =
  | 'create_day'
  | 'update_trip_dates'
  | 'create_item'
  | 'merge_item_fields'
  | 'append_item_note'
  | 'create_ticket'
  | 'merge_ticket_meta'
  | 'bind_ticket'
  | 'bind_existing_ticket'
  | 'append_trip_note'

export type ExistingTripImportDiffCategory = 'dates' | 'items' | 'tickets' | 'notes'

export type ExistingTripImportDiffBase = {
  category: ExistingTripImportDiffCategory
  checked: boolean
  confidence: ExistingTripImportConfidence
  id: string
  reason: string
  sourceIds: string[]
  summary: string
  type: ExistingTripImportDiffType
}

export type ExistingTripImportDiff =
  | (ExistingTripImportDiffBase & { data: { date: string; tempDayKey: string; timeZone?: string; title: string }; type: 'create_day' })
  | (ExistingTripImportDiffBase & { data: { endDate: string; startDate: string }; type: 'update_trip_dates' })
  | (ExistingTripImportDiffBase & { data: { date: string; fields: ExistingTripImportItemFields; targetDayId?: string; tempDayKey?: string; tempItemKey: string }; type: 'create_item' })
  | (ExistingTripImportDiffBase & { data: { patch: ExistingTripImportItemPatch; targetItemId: string }; type: 'merge_item_fields' })
  | (ExistingTripImportDiffBase & { data: { note: string; targetItemId: string }; type: 'append_item_note' })
  | (ExistingTripImportDiffBase & { data: { fileName?: string; note?: string; sourceFileId?: string; tempTicketKey: string; ticketCategory?: TicketCategory; title: string }; type: 'create_ticket' })
  | (ExistingTripImportDiffBase & { data: { patch: ExistingTripImportTicketPatch; targetTicketId: string; targetTicketSummaryId?: string }; type: 'merge_ticket_meta' })
  | (ExistingTripImportDiffBase & { data: { targetItemId?: string; targetTempItemKey?: string; tempTicketKey: string }; type: 'bind_ticket' })
  | (ExistingTripImportDiffBase & { data: { targetItemId?: string; targetTempItemKey?: string; targetTicketId: string; targetTicketSummaryId?: string }; type: 'bind_existing_ticket' })
  | (ExistingTripImportDiffBase & { data: { note: string }; type: 'append_trip_note' })

export type ExistingTripImportPreview = {
  baselineFingerprint: string
  diffs: ExistingTripImportDiff[]
  generatedAt: string
  sourceSummaries: ExistingTripImportSourceSummary[]
  warnings: string[]
}

export type ExistingTripImportItemFields = {
  address?: string
  endDate?: string
  endTime?: string
  endTimeZone?: string
  locationName?: string
  notes?: string
  previousTransportDurationMinutes?: number
  previousTransportMode?: TransportMode
  previousTransportNote?: string
  startTime?: string
  startTimeZone?: string
  title: string
  transportMode?: TransportMode
}

export type ExistingTripImportItemPatch = Partial<ExistingTripImportItemFields>
export type ExistingTripImportTicketPatch = {
  note?: string
  ticketCategory?: TicketCategory
  title?: string
}

export type ExistingTripImportAppliedChange = {
  action: 'appended' | 'bound' | 'created' | 'merged' | 'updated'
  dayId?: string
  id: string
  itemId?: string
  kind: 'day' | 'item' | 'note' | 'ticket' | 'trip'
  ticketId?: string
  title: string
}

export type ExistingTripImportApplyResult =
  | { affectedDayIds?: string[]; affectedItemIds?: string[]; affectedTicketIds?: string[]; appliedChanges: ExistingTripImportAppliedChange[]; appliedCount: number; ok: true }
  | { errors: string[]; ok: false }

export type ExistingTripImportApplyFile = {
  blob: Blob
  fileName: string
  mimeType: string
  size: number
}

const validTransportModes = new Set<TransportMode>(['walk', 'transit', 'bus', 'car', 'train', 'flight', 'other'])
const mergeSimilarityThreshold = 0.58

export function buildExistingTripImportBaselineFingerprint(context: ExistingTripImportContext) {
  const days = [...context.days]
    .sort((first, second) => first.sortOrder - second.sortOrder || first.date.localeCompare(second.date))
    .map((day) => [day.id, day.date, day.title, day.sortOrder, day.timeZone ?? '', day.timeZoneSource ?? ''].join(':'))
  const items = [...context.items]
    .sort((first, second) => first.dayId.localeCompare(second.dayId) || first.sortOrder - second.sortOrder)
    .map((item) => [
      item.id,
      item.dayId,
      item.title,
      item.startTime ?? '',
      item.endTime ?? '',
      item.startTimeZone ?? '',
      item.endDate ?? '',
      item.endTimeZone ?? '',
      item.locationName ?? '',
      item.address ?? '',
      item.ticketIds.length,
      item.updatedAt,
    ].join(':'))
  const ticketSummaries = context.ticketSummaries
    ? [...context.ticketSummaries]
      .sort((first, second) => first.ticketId.localeCompare(second.ticketId))
      .map((ticket) => [
        ticket.ticketId,
        ticket.title,
        ticket.ticketCategory ?? '',
        ticket.scope ?? '',
        ticket.itemId ?? '',
      ].join(':'))
    : undefined

  return JSON.stringify({
    days,
    endDate: context.trip.endDate,
    items,
    notes: context.trip.notes ?? '',
    startDate: context.trip.startDate,
    ...(ticketSummaries ? { ticketSummaries } : {}),
    title: context.trip.title,
    tripId: context.trip.id,
    updatedAt: context.trip.updatedAt,
  })
}

export function buildExistingTripImportPreview({
  context,
  providerResult,
  sourceSummaries,
}: {
  context: ExistingTripImportContext
  providerResult: ExistingTripImportProviderResult
  sourceSummaries: ExistingTripImportSourceSummary[]
}): ExistingTripImportPreview {
  const daysByDate = new Map(context.days.map((day) => [day.date, day]))
  const itemsById = new Map(context.items.map((item) => [item.id, item]))
  const ticketSummariesById = new Map((context.ticketSummaries ?? []).map((ticket) => [ticket.summaryId, ticket]))
  const sourceIds = new Set(sourceSummaries.map((source) => source.id))
  const diffs: ExistingTripImportDiff[] = []
  const warnings = [...(providerResult.warnings ?? [])]
  const tempDayByDate = new Map<string, string>()
  const tempItemByCandidateId = new Map<string, string>()
  const tempItemByDateTitle = new Map<string, string>()

  for (const candidate of providerResult.days ?? []) {
    const date = normalizeDate(candidate.date)
    if (!date) {
      warnings.push(`跳过无效日期建议：${candidate.date}`)
      continue
    }
    if (candidate.timeZone && !normalizeTimeZone(candidate.timeZone)) {
      warnings.push(`跳过无效日期时区建议：${candidate.timeZone}`)
    }
    if (daysByDate.has(date)) continue
    const tempDayKey = `temp-day:${date}`
    tempDayByDate.set(date, tempDayKey)
    diffs.push({
      category: 'dates',
      checked: true,
      confidence: normalizeConfidence(candidate.confidence),
      data: {
        date,
        tempDayKey,
        timeZone: normalizeTimeZone(candidate.timeZone),
        title: normalizeText(candidate.title) ?? `导入 ${date}`,
      },
      id: `create-day:${candidate.candidateId}`,
      reason: normalizeText(candidate.reason) ?? '识别到当前旅行中不存在的日期。',
      sourceIds: filterSourceIds(candidate.sourceIds, sourceIds),
      summary: `新增日期 ${date}`,
      type: 'create_day',
    })
  }

  const candidateDates = collectCandidateDates(providerResult)
  const nextStartDate = candidateDates.reduce((current, date) => date < current ? date : current, context.trip.startDate)
  const nextEndDate = candidateDates.reduce((current, date) => date > current ? date : current, context.trip.endDate)
  if (nextStartDate !== context.trip.startDate || nextEndDate !== context.trip.endDate) {
    diffs.push({
      category: 'dates',
      checked: false,
      confidence: 'medium',
      data: { endDate: nextEndDate, startDate: nextStartDate },
      id: 'update-trip-dates',
      reason: '识别内容包含当前旅行日期范围之外的日期，需手动勾选才扩展旅行日期。',
      sourceIds: [],
      summary: `扩展旅行日期为 ${nextStartDate} 至 ${nextEndDate}`,
      type: 'update_trip_dates',
    })
  }

  for (const candidate of providerResult.items ?? []) {
    const date = normalizeDate(candidate.date)
    const title = normalizeText(candidate.title)
    if (!date || !title) {
      warnings.push(`跳过缺少日期或标题的行程点建议：${candidate.candidateId}`)
      continue
    }
    const targetDay = daysByDate.get(date)
    const targetItem = resolveTargetItem({ candidate, context, date, itemsById })
    const fields = normalizeItemFields(candidate)
    if (candidate.startTimeZone && !fields.startTimeZone) {
      warnings.push(`跳过「${title}」无效出发时区：${candidate.startTimeZone}`)
    }
    if (candidate.endDate && !fields.endDate) {
      warnings.push(`跳过「${title}」无效到达日期：${candidate.endDate}`)
    }
    if (candidate.endTimeZone && !fields.endTimeZone) {
      warnings.push(`跳过「${title}」无效到达时区：${candidate.endTimeZone}`)
    }
    const sourceIdList = filterSourceIds(candidate.sourceIds, sourceIds)
    const confidence = normalizeConfidence(candidate.confidence)
    const reason = normalizeText(candidate.reason) ?? 'AI 从导入内容中识别到该行程点。'

    if (targetItem && confidence !== 'low') {
      const patch = buildMergePatch(targetItem, fields)
      if (Object.keys(patch).length > 0) {
        diffs.push({
          category: 'items',
          checked: confidence === 'high',
          confidence,
          data: { patch, targetItemId: targetItem.id },
          id: `merge-item:${candidate.candidateId}`,
          reason,
          sourceIds: sourceIdList,
          summary: `合并到「${targetItem.title}」`,
          type: 'merge_item_fields',
        })
      }
      if (fields.notes) {
        diffs.push({
          category: 'notes',
          checked: true,
          confidence,
          data: { note: fields.notes, targetItemId: targetItem.id },
          id: `append-item-note:${candidate.candidateId}`,
          reason: '导入内容包含该行程点的备注。',
          sourceIds: sourceIdList,
          summary: `追加「${targetItem.title}」备注`,
          type: 'append_item_note',
        })
      }
      tempItemByCandidateId.set(candidate.candidateId, `existing-item:${targetItem.id}`)
      tempItemByDateTitle.set(buildDateTitleKey(date, targetItem.title), `existing-item:${targetItem.id}`)
      continue
    }

    const tempItemKey = `temp-item:${candidate.candidateId}`
    tempItemByCandidateId.set(candidate.candidateId, tempItemKey)
    tempItemByDateTitle.set(buildDateTitleKey(date, fields.title), tempItemKey)
    const tempDayKey = targetDay ? undefined : (tempDayByDate.get(date) ?? `temp-day:${date}`)
    if (!targetDay && !tempDayByDate.has(date)) {
      const newTempDayKey = tempDayKey ?? `temp-day:${date}`
      tempDayByDate.set(date, newTempDayKey)
      diffs.push({
        category: 'dates',
        checked: true,
        confidence,
        data: { date, tempDayKey: newTempDayKey, title: `导入 ${date}` },
        id: `create-day:auto:${date}`,
        reason: '行程点日期在当前旅行中不存在，将先新增该日期。',
        sourceIds: sourceIdList,
        summary: `新增日期 ${date}`,
        type: 'create_day',
      })
    }
    diffs.push({
      category: 'items',
      checked: confidence !== 'low',
      confidence,
      data: { date, fields, targetDayId: targetDay?.id, tempDayKey, tempItemKey },
      id: `create-item:${candidate.candidateId}`,
      reason,
      sourceIds: sourceIdList,
      summary: `新增行程点「${fields.title}」`,
      type: 'create_item',
    })
  }

  for (const candidate of providerResult.tickets ?? []) {
    const title = normalizeText(candidate.title)
    if (!title) {
      warnings.push(`跳过缺少标题的票据建议：${candidate.candidateId}`)
      continue
    }
    const tempTicketKey = `temp-ticket:${candidate.candidateId}`
    const confidence = normalizeConfidence(candidate.confidence)
    const sourceIdList = filterSourceIds(candidate.sourceIds, sourceIds)
    const target = resolveTicketTarget({ candidate, context, tempItemByCandidateId, tempItemByDateTitle })
    const existingTicket = resolveExistingTicketSummary({ candidate, ticketSummariesById })
    if (existingTicket) {
      const patch = buildTicketMergePatch(existingTicket, candidate)
      if (Object.keys(patch).length > 0) {
        diffs.push({
          category: 'tickets',
          checked: confidence !== 'low',
          confidence,
          data: { patch, targetTicketId: existingTicket.ticketId, targetTicketSummaryId: existingTicket.summaryId },
          id: `merge-ticket:${candidate.candidateId}`,
          reason: normalizeText(candidate.reason) ?? '识别内容可补充现有票据。',
          sourceIds: sourceIdList,
          summary: `更新票据「${existingTicket.title}」`,
          type: 'merge_ticket_meta',
        })
      }
      const alreadyBound = Boolean(target.targetItemId && existingTicket.itemId === target.targetItemId)
      if ((target.targetItemId || target.targetTempItemKey) && !alreadyBound) {
        diffs.push({
          category: 'tickets',
          checked: confidence !== 'low',
          confidence,
          data: { targetTicketId: existingTicket.ticketId, targetTicketSummaryId: existingTicket.summaryId, ...target },
          id: `bind-existing-ticket:${candidate.candidateId}`,
          reason: '将现有票据绑定到识别出的行程点。',
          sourceIds: sourceIdList,
          summary: `绑定现有票据「${existingTicket.title}」`,
          type: 'bind_existing_ticket',
        })
      }
      continue
    }
    diffs.push({
      category: 'tickets',
      checked: confidence !== 'low',
      confidence,
      data: {
        fileName: normalizeText(candidate.fileName),
        note: normalizeText(candidate.note),
        sourceFileId: normalizeText(candidate.sourceFileId),
        tempTicketKey,
        ticketCategory: normalizeTicketCategory(candidate.ticketCategory),
        title,
      },
      id: `create-ticket:${candidate.candidateId}`,
      reason: normalizeText(candidate.reason) ?? '识别到票据或订单信息。',
      sourceIds: sourceIdList,
      summary: `新增票据「${title}」`,
      type: 'create_ticket',
    })
    if (target.targetItemId || target.targetTempItemKey) {
      diffs.push({
        category: 'tickets',
        checked: confidence !== 'low',
        confidence,
        data: { tempTicketKey, ...target },
        id: `bind-ticket:${candidate.candidateId}`,
        reason: '将票据绑定到识别出的行程点。',
        sourceIds: sourceIdList,
        summary: '绑定票据到行程点',
        type: 'bind_ticket',
      })
    }
  }

  for (const candidate of providerResult.notes ?? []) {
    const note = normalizeText(candidate.text)
    if (!note) continue
    diffs.push({
      category: 'notes',
      checked: normalizeConfidence(candidate.confidence) !== 'low',
      confidence: normalizeConfidence(candidate.confidence),
      data: { note },
      id: `append-trip-note:${candidate.candidateId}`,
      reason: normalizeText(candidate.reason) ?? '识别到适合作为旅行备注的信息。',
      sourceIds: filterSourceIds(candidate.sourceIds, sourceIds),
      summary: '追加旅行备注',
      type: 'append_trip_note',
    })
  }

  return {
    baselineFingerprint: buildExistingTripImportBaselineFingerprint(context),
    diffs: dedupeDiffs(diffs),
    generatedAt: new Date().toISOString(),
    sourceSummaries,
    warnings,
  }
}

export async function applyExistingTripImportPreview({
  checkedDiffIds,
  expectedBaselineFingerprint,
  filesBySourceId = new Map(),
  preview,
  tripId,
}: {
  checkedDiffIds: Set<string>
  expectedBaselineFingerprint: string
  filesBySourceId?: Map<string, ExistingTripImportApplyFile>
  preview: ExistingTripImportPreview
  tripId: string
}): Promise<ExistingTripImportApplyResult> {
  try {
    const result: ExistingTripImportApplyResult = await db.transaction('rw', [db.trips, db.days, db.itineraryItems, db.ticketMetas, db.ticketBlobs], async () => {
      const trip = await db.trips.get(tripId)
      if (!trip) return { errors: ['当前旅行不存在。'], ok: false as const }
      const [days, items] = await Promise.all([
        db.days.where('tripId').equals(tripId).toArray(),
        db.itineraryItems.where('tripId').equals(tripId).toArray(),
      ])
      const shouldCheckTickets = baselineFingerprintIncludesTicketSummaries(preview.baselineFingerprint)
      const tickets = shouldCheckTickets ? await db.ticketMetas.where('tripId').equals(tripId).toArray() : []
      const currentFingerprint = buildExistingTripImportBaselineFingerprint({
        days,
        items,
        ticketSummaries: shouldCheckTickets ? buildFingerprintTicketSummaries(tickets) : undefined,
        trip,
      })
      if (currentFingerprint !== expectedBaselineFingerprint || currentFingerprint !== preview.baselineFingerprint) {
        return { errors: ['本地行程已变化，请重新识别。'], ok: false as const }
      }

      const checkedDiffs = preview.diffs.filter((diff) => checkedDiffIds.has(diff.id))
      const now = Date.now()
      const dayIdByTemp = new Map<string, string>()
      const itemIdByTemp = new Map<string, string>()
      const ticketIdByTemp = new Map<string, string>()
      const changedItems = new Map(items.map((item) => [item.id, { ...item }]))
      const changedTickets = new Map(tickets.map((ticket) => [ticket.id, { ...ticket }]))
      const changedTicketIds = new Set<string>()
      const newDays: Day[] = []
      const newItems: ItineraryItem[] = []
      const newTicketMetas: TicketMeta[] = []
      const newTicketBlobs: TicketBlob[] = []
      const appliedChanges: ExistingTripImportAppliedChange[] = []
      let nextTrip: Trip = { ...trip }
      let appliedCount = 0

      for (const diff of checkedDiffs) {
        if (diff.type !== 'create_day') continue
        if (days.some((day) => day.date === diff.data.date) || newDays.some((day) => day.date === diff.data.date)) {
          continue
        }
        const id = createId('day')
        dayIdByTemp.set(diff.data.tempDayKey, id)
        newDays.push({
          date: diff.data.date,
          id,
          sortOrder: Math.max(0, ...days.map((day) => day.sortOrder), ...newDays.map((day) => day.sortOrder)) + 1,
          timeZone: diff.data.timeZone,
          timeZoneSource: diff.data.timeZone ? 'imported' : undefined,
          title: diff.data.title,
          tripId,
        })
        appliedChanges.push({ action: 'created', dayId: id, id, kind: 'day', title: diff.data.title })
        appliedCount += 1
      }

      for (const diff of checkedDiffs) {
        if (diff.type !== 'update_trip_dates') continue
        nextTrip = { ...nextTrip, endDate: diff.data.endDate, startDate: diff.data.startDate, updatedAt: now }
        appliedChanges.push({ action: 'updated', id: tripId, kind: 'trip', title: `旅行日期 ${diff.data.startDate} 至 ${diff.data.endDate}` })
        appliedCount += 1
      }

      for (const diff of checkedDiffs) {
        if (diff.type === 'create_item') {
          const dayId = diff.data.targetDayId ?? (diff.data.tempDayKey ? dayIdByTemp.get(diff.data.tempDayKey) : undefined)
          if (!dayId) throw new Error(`新增行程点「${diff.data.fields.title}」缺少目标日期。`)
          const siblingItems = [...items, ...newItems].filter((item) => item.dayId === dayId)
          const id = createId('item')
          itemIdByTemp.set(diff.data.tempItemKey, id)
          const item: ItineraryItem = {
            ...diff.data.fields,
            createdAt: now,
            dayId,
            id,
            sortOrder: Math.max(0, ...siblingItems.map((item) => item.sortOrder)) + 1,
            ticketIds: [],
            tripId,
            updatedAt: now,
          }
          newItems.push(item)
          changedItems.set(item.id, item)
          appliedChanges.push({ action: 'created', dayId, id, itemId: id, kind: 'item', title: item.title })
          appliedCount += 1
        }
        if (diff.type === 'merge_item_fields') {
          const item = changedItems.get(diff.data.targetItemId)
          if (!item) throw new Error('合并目标行程点不存在。')
          const nextItem = { ...item, ...diff.data.patch, updatedAt: now }
          changedItems.set(item.id, nextItem)
          appliedChanges.push({ action: 'merged', dayId: nextItem.dayId, id: nextItem.id, itemId: nextItem.id, kind: 'item', title: nextItem.title })
          appliedCount += 1
        }
        if (diff.type === 'append_item_note') {
          const item = changedItems.get(diff.data.targetItemId)
          if (!item) throw new Error('备注目标行程点不存在。')
          const nextItem = { ...item, notes: appendNote(item.notes, diff.data.note), updatedAt: now }
          changedItems.set(item.id, nextItem)
          appliedChanges.push({ action: 'appended', dayId: nextItem.dayId, id: nextItem.id, itemId: nextItem.id, kind: 'note', title: `${nextItem.title} 备注` })
          appliedCount += 1
        }
      }

      for (const diff of checkedDiffs) {
        if (diff.type !== 'create_ticket') continue
        const id = createId('ticket')
        ticketIdByTemp.set(diff.data.tempTicketKey, id)
        const file = diff.data.sourceFileId ? filesBySourceId.get(diff.data.sourceFileId) : undefined
        const fileName = safeFileName(diff.data.fileName ?? file?.fileName ?? diff.data.title, id)
        const mimeType = file?.mimeType || 'text/plain'
        const meta: TicketMeta = {
          createdAt: now,
          fileName,
          fileType: inferTicketFileType(fileName, mimeType),
          id,
          mimeType,
          note: diff.data.note,
          scope: 'unassigned',
          size: file?.size ?? 0,
          storageMode: file ? 'copy' : 'reference',
          ticketCategory: diff.data.ticketCategory ?? 'other',
          title: diff.data.title,
          tripId,
          updatedAt: now,
        }
        if (!file) {
          meta.referenceLocation = diff.data.fileName ?? diff.data.title
        }
        newTicketMetas.push(meta)
        if (file) newTicketBlobs.push({ blob: file.blob, ticketId: id })
        appliedChanges.push({ action: 'created', id, kind: 'ticket', ticketId: id, title: meta.title ?? meta.fileName })
        appliedCount += 1
      }

      for (const diff of checkedDiffs) {
        if (diff.type !== 'bind_ticket' && diff.type !== 'bind_existing_ticket') continue
        const ticketId = diff.type === 'bind_ticket' ? ticketIdByTemp.get(diff.data.tempTicketKey) : diff.data.targetTicketId
        if (!ticketId) continue
        const targetItemId = diff.data.targetItemId ?? (diff.data.targetTempItemKey ? itemIdByTemp.get(diff.data.targetTempItemKey) : undefined)
        if (!targetItemId) continue
        const item = changedItems.get(targetItemId)
        if (!item) throw new Error('票据绑定目标行程点不存在。')
        const nextItem = { ...item, ticketIds: [...new Set([...item.ticketIds, ticketId])], updatedAt: now }
        changedItems.set(item.id, nextItem)
        const newItemIndex = newItems.findIndex((candidate) => candidate.id === item.id)
        if (newItemIndex >= 0) {
          newItems[newItemIndex] = nextItem
        }
        const ticket = newTicketMetas.find((meta) => meta.id === ticketId) ?? changedTickets.get(ticketId)
        if (ticket) {
          ticket.itemId = item.id
          ticket.scope = 'item'
          ticket.updatedAt = now
          if (!newTicketMetas.some((meta) => meta.id === ticket.id)) {
            changedTickets.set(ticket.id, ticket)
            changedTicketIds.add(ticket.id)
          }
        }
        appliedChanges.push({ action: 'bound', dayId: item.dayId, id: ticketId, itemId: item.id, kind: 'ticket', ticketId, title: ticket?.title ?? ticket?.fileName ?? '票据' })
        appliedCount += 1
      }

      for (const diff of checkedDiffs) {
        if (diff.type !== 'merge_ticket_meta') continue
        const ticket = changedTickets.get(diff.data.targetTicketId)
        if (!ticket) throw new Error('更新目标票据不存在。')
        const nextTicket: TicketMeta = {
          ...ticket,
          note: diff.data.patch.note ? appendNote(ticket.note, diff.data.patch.note) : ticket.note,
          ticketCategory: diff.data.patch.ticketCategory ?? ticket.ticketCategory,
          title: diff.data.patch.title ?? ticket.title,
          updatedAt: now,
        }
        changedTickets.set(ticket.id, nextTicket)
        changedTicketIds.add(ticket.id)
        appliedChanges.push({ action: 'merged', id: ticket.id, itemId: nextTicket.itemId, kind: 'ticket', ticketId: ticket.id, title: nextTicket.title ?? nextTicket.fileName })
        appliedCount += 1
      }

      for (const diff of checkedDiffs) {
        if (diff.type !== 'append_trip_note') continue
        nextTrip = { ...nextTrip, notes: appendNote(nextTrip.notes, diff.data.note), updatedAt: now }
        appliedChanges.push({ action: 'appended', id: tripId, kind: 'note', title: '旅行备注' })
        appliedCount += 1
      }

      if (appliedCount === 0) return { appliedChanges: [], appliedCount: 0, ok: true as const }
      nextTrip = { ...nextTrip, updatedAt: now }
      await db.trips.put(nextTrip)
      if (newDays.length > 0) await db.days.bulkAdd(newDays)
      if (newItems.length > 0) await db.itineraryItems.bulkAdd(newItems)
      const changedExistingItems = Array.from(changedItems.values()).filter((item) => items.some((existing) => existing.id === item.id))
      if (changedExistingItems.length > 0) await db.itineraryItems.bulkPut(changedExistingItems)
      const changedExistingTickets = [...changedTicketIds]
        .map((ticketId) => changedTickets.get(ticketId))
        .filter((ticket): ticket is TicketMeta => Boolean(ticket))
      if (changedExistingTickets.length > 0) await db.ticketMetas.bulkPut(changedExistingTickets)
      if (newTicketMetas.length > 0) await db.ticketMetas.bulkAdd(newTicketMetas)
      if (newTicketBlobs.length > 0) await db.ticketBlobs.bulkAdd(newTicketBlobs)
      return {
        affectedDayIds: newDays.map((day) => day.id),
        affectedItemIds: [...newItems.map((item) => item.id), ...changedExistingItems.map((item) => item.id)],
        affectedTicketIds: [...newTicketMetas.map((ticket) => ticket.id), ...changedExistingTickets.map((ticket) => ticket.id)],
        appliedChanges,
        appliedCount,
        ok: true as const,
      }
    })

    if (result.ok && result.appliedCount > 0) {
      await enqueueExistingTripImportObjectsForSync({
        dayIds: result.affectedDayIds ?? [],
        itemIds: result.affectedItemIds ?? [],
        ticketIds: result.affectedTicketIds ?? [],
        tripId,
      })
      recordTripWriteForSync(tripId, 'existing-trip-imported')
    }
    return result
  } catch (caught) {
    return { errors: [caught instanceof Error ? caught.message : '导入应用失败。'], ok: false }
  }
}

async function enqueueExistingTripImportObjectsForSync({
  dayIds,
  itemIds,
  ticketIds,
  tripId,
}: {
  dayIds: string[]
  itemIds: string[]
  ticketIds: string[]
  tripId: string
}) {
  const trip = await db.trips.get(tripId)
  const days = dayIds.length > 0 ? await db.days.bulkGet(dayIds) : []
  const items = itemIds.length > 0 ? await db.itineraryItems.bulkGet(itemIds) : []
  const tickets = ticketIds.length > 0 ? await db.ticketMetas.bulkGet(ticketIds) : []
  if (trip) await enqueueObjectUpsert({ object: trip, objectType: 'trip' })
  await Promise.all([
    ...days.filter((day): day is Day => Boolean(day)).map((day) => enqueueObjectUpsert({ object: day, objectType: 'day' })),
    ...items.filter((item): item is ItineraryItem => Boolean(item)).map((item) => enqueueObjectUpsert({ object: item, objectType: 'item' })),
    ...tickets.filter((ticket): ticket is TicketMeta => Boolean(ticket)).map(async (ticket) => {
      await enqueueObjectUpsert({ object: ticket, objectType: 'ticket_meta' })
      if ((ticket.storageMode ?? 'copy') === 'copy') {
        const blob = await db.ticketBlobs.get(ticket.id)
        if (blob?.blob) {
          await markTicketBlobPendingUpload({ blob: blob.blob, ticket })
        }
      }
    }),
  ])
}

function resolveTargetItem({
  candidate,
  context,
  date,
  itemsById,
}: {
  candidate: ExistingTripImportProviderCandidateItem
  context: ExistingTripImportContext
  date: string
  itemsById: Map<string, ItineraryItem>
}) {
  const explicit = candidate.targetItemId ? itemsById.get(candidate.targetItemId) : undefined
  if (explicit && explicit.tripId === context.trip.id) return explicit
  const daysById = new Map(context.days.map((day) => [day.id, day]))
  const sameDateItems = context.items.filter((item) => daysById.get(item.dayId)?.date === date)
  const scored = sameDateItems
    .map((item) => ({ item, score: scoreItemMatch(candidate, item) }))
    .sort((first, second) => second.score - first.score)[0]
  return scored && scored.score >= mergeSimilarityThreshold ? scored.item : null
}

function resolveTicketTarget({
  candidate,
  context,
  tempItemByCandidateId,
  tempItemByDateTitle,
}: {
  candidate: ExistingTripImportProviderCandidateTicket
  context: ExistingTripImportContext
  tempItemByCandidateId: Map<string, string>
  tempItemByDateTitle: Map<string, string>
}): { targetItemId?: string; targetTempItemKey?: string } {
  if (candidate.targetItemId && context.items.some((item) => item.id === candidate.targetItemId)) {
    return { targetItemId: candidate.targetItemId }
  }
  const itemTitle = normalizeText(candidate.itemTitle)
  const date = normalizeDate(candidate.date)
  if (!itemTitle || !date) return {}
  const daysById = new Map(context.days.map((day) => [day.id, day]))
  const target = context.items.find((item) => daysById.get(item.dayId)?.date === date && similarity(item.title, itemTitle) >= mergeSimilarityThreshold)
  if (target) return { targetItemId: target.id }
  const tempByTitle = tempItemByDateTitle.get(buildDateTitleKey(date, itemTitle))
  if (tempByTitle?.startsWith('temp-item:')) {
    return { targetTempItemKey: tempByTitle }
  }
  if (tempByTitle?.startsWith('existing-item:')) {
    return { targetItemId: tempByTitle.slice('existing-item:'.length) }
  }
  for (const [candidateId, tempKey] of tempItemByCandidateId.entries()) {
    if (tempKey.startsWith('temp-item:') && candidateId.toLowerCase().includes(itemTitle.toLowerCase().slice(0, 6))) {
      return { targetTempItemKey: tempKey }
    }
  }
  return {}
}

function resolveExistingTicketSummary({
  candidate,
  ticketSummariesById,
}: {
  candidate: ExistingTripImportProviderCandidateTicket
  ticketSummariesById: Map<string, ExistingTripImportTicketSummary>
}) {
  const explicit = candidate.targetExistingTicketSummaryId
    ? ticketSummariesById.get(candidate.targetExistingTicketSummaryId)
    : undefined
  if (explicit) return explicit

  const title = normalizeText(candidate.title)
  if (!title) return undefined
  const scored = [...ticketSummariesById.values()]
    .map((ticket) => ({ score: similarity(title, ticket.title), ticket }))
    .sort((first, second) => second.score - first.score)[0]
  return scored && scored.score >= 0.82 ? scored.ticket : undefined
}

function buildTicketMergePatch(
  target: ExistingTripImportTicketSummary,
  candidate: ExistingTripImportProviderCandidateTicket,
): ExistingTripImportTicketPatch {
  const patch: ExistingTripImportTicketPatch = {}
  const title = normalizeText(candidate.title)
  const category = normalizeTicketCategory(candidate.ticketCategory)
  const note = normalizeText(candidate.note)
  if (title && normalizeForSimilarity(title) !== normalizeForSimilarity(target.title)) {
    patch.title = title
  }
  if (category && category !== (target.ticketCategory ?? 'other')) {
    patch.ticketCategory = category
  }
  if (note) {
    patch.note = note
  }
  return patch
}

function buildFingerprintTicketSummaries(tickets: TicketMeta[]): ExistingTripImportTicketSummary[] {
  return tickets.map((ticket) => ({
    itemId: ticket.itemId,
    scope: ticket.scope,
    summaryId: ticket.id,
    ticketCategory: ticket.ticketCategory ?? 'other',
    ticketId: ticket.id,
    title: ticket.title?.trim() || ticket.note?.trim() || '未命名票据',
  }))
}

function baselineFingerprintIncludesTicketSummaries(fingerprint: string) {
  try {
    const parsed: unknown = JSON.parse(fingerprint)
    return Boolean(parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'ticketSummaries'))
  } catch {
    return false
  }
}

function normalizeItemFields(candidate: ExistingTripImportProviderCandidateItem): ExistingTripImportItemFields {
  return {
    address: normalizeText(candidate.address),
    endDate: isValidPlainDate(candidate.endDate) ? candidate.endDate : undefined,
    endTime: normalizeTime(candidate.endTime),
    endTimeZone: normalizeTimeZone(candidate.endTimeZone),
    locationName: normalizeText(candidate.locationName),
    notes: normalizeText(candidate.note),
    previousTransportDurationMinutes: normalizePositiveInteger(candidate.previousTransportDurationMinutes),
    previousTransportMode: normalizeTransportMode(candidate.previousTransportMode),
    previousTransportNote: normalizeText(candidate.previousTransportNote),
    startTime: normalizeTime(candidate.startTime),
    startTimeZone: normalizeTimeZone(candidate.startTimeZone),
    title: normalizeText(candidate.title) ?? '未命名行程点',
    transportMode: normalizeTransportMode(candidate.transportMode),
  }
}

function buildMergePatch(target: ItineraryItem, fields: ExistingTripImportItemFields): ExistingTripImportItemPatch {
  const patch: ExistingTripImportItemPatch = {}
  for (const key of ['address', 'endDate', 'endTime', 'endTimeZone', 'locationName', 'previousTransportMode', 'previousTransportDurationMinutes', 'previousTransportNote', 'startTime', 'startTimeZone', 'transportMode'] as const) {
    if (fields[key] !== undefined && target[key] === undefined) {
      patch[key] = fields[key] as never
    }
  }
  return patch
}

function scoreItemMatch(candidate: ExistingTripImportProviderCandidateItem, item: ItineraryItem) {
  const titleScore = similarity(candidate.title, item.title)
  const placeScore = Math.max(
    similarity(candidate.locationName ?? '', item.locationName ?? ''),
    similarity(candidate.address ?? '', item.address ?? ''),
  )
  const timeScore = candidate.startTime && item.startTime && candidate.startTime === item.startTime ? 0.25 : 0
  return Math.max(titleScore, placeScore) + timeScore
}

function collectCandidateDates(result: ExistingTripImportProviderResult) {
  return [...new Set([
    ...(result.days ?? []).map((day) => normalizeDate(day.date)),
    ...(result.items ?? []).map((item) => normalizeDate(item.date)),
    ...(result.tickets ?? []).map((ticket) => normalizeDate(ticket.date)),
    ...(result.notes ?? []).map((note) => normalizeDate(note.date)),
  ].filter((date): date is string => Boolean(date)))]
}

function dedupeDiffs(diffs: ExistingTripImportDiff[]) {
  const seen = new Set<string>()
  return diffs.filter((diff) => {
    if (seen.has(diff.id)) return false
    seen.add(diff.id)
    return true
  })
}

function filterSourceIds(sourceIds: string[] | undefined, validSourceIds: Set<string>) {
  return (sourceIds ?? []).filter((sourceId) => validSourceIds.has(sourceId)).slice(0, 6)
}

function normalizeConfidence(value: ExistingTripImportConfidence | undefined): ExistingTripImportConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizeTransportMode(value: TransportMode | undefined) {
  return value && validTransportModes.has(value) ? value : undefined
}

function normalizeTicketCategory(value: TicketCategory | undefined) {
  return value === 'admission_ticket' ||
    value === 'train_ticket' ||
    value === 'flight_ticket' ||
    value === 'hotel_booking' ||
    value === 'restaurant_reservation' ||
    value === 'transport_booking' ||
    value === 'other'
    ? value
    : undefined
}

function normalizePositiveInteger(value: number | undefined) {
  return Number.isInteger(value) && value !== undefined && value >= 0 && value <= 24 * 60 ? value : undefined
}

function normalizeDate(value: string | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value : undefined
}

function normalizeTime(value: string | undefined) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '') ? value : undefined
}

function normalizeText(value: string | undefined) {
  const text = value?.trim().replace(/\s+/g, ' ')
  return text || undefined
}

function appendNote(current: string | undefined, next: string) {
  const normalized = normalizeText(next)
  if (!normalized) return current
  const existing = current?.trim()
  return existing ? `${existing}\n\n${normalized}` : normalized
}

function similarity(first: string, second: string) {
  const a = normalizeForSimilarity(first)
  const b = normalizeForSimilarity(second)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.8
  const aChars = new Set([...a])
  const bChars = new Set([...b])
  const overlap = [...aChars].filter((char) => bChars.has(char)).length
  return overlap / Math.max(aChars.size, bChars.size)
}

function normalizeForSimilarity(value: string) {
  return value.toLowerCase().replace(/[\s·・,，。.!！?？:：—_()（）[\]【】-]/g, '')
}

function buildDateTitleKey(date: string, title: string) {
  return `${date}:${normalizeForSimilarity(title)}`
}

function inferTicketFileType(fileName: string, mimeType: string): TicketMeta['fileType'] {
  const lowerName = fileName.toLowerCase()
  const lowerMime = mimeType.toLowerCase()
  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf'
  if (lowerMime.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(lowerName)) return 'image'
  return 'other'
}
