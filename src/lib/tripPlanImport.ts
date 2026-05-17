import type JSZip from 'jszip'
import { createId } from '../db/ids'
import { importTripPlanRecords } from '../db'
import { safeFileName } from './backup'
import { isValidPlainDate } from './plainDate'
import { isValidExternalUrl } from './tickets'
import type { Day, ItineraryItem, TicketBlob, TicketMeta, TicketStorageMode, TransportMode, Trip } from '../types'

const SCHEMA_VERSION = 1
const TRIP_PLAN_TYPE = 'trip-plan'
const MAX_SOFT_ATTACHMENT_SIZE = 20 * 1024 * 1024
const MAX_IMPORT_FILE_SIZE = 100 * 1024 * 1024
const MAX_TRIP_PLAN_JSON_SIZE = 2 * 1024 * 1024
const MAX_ZIP_ENTRY_COUNT = 300
const MAX_COPY_ATTACHMENT_COUNT = 50
const MAX_DAYS_COUNT = 120
const MAX_ITEMS_COUNT = 1000
const MAX_TICKETS_COUNT = 500
const TIME_PATTERN = /^\d{2}:\d{2}$/
const TRANSPORT_MODES: TransportMode[] = ['walk', 'transit', 'bus', 'car', 'train', 'flight', 'other']

export type TripPlanImportPackage = {
  schemaVersion: 1
  type: 'trip-plan'
  source?: string
  trip: {
    title: string
    destination?: string
    startDate: string
    endDate: string
    notes?: string
  }
  days: TripPlanImportDay[]
  tickets?: TripPlanImportTicket[]
}

export type TripPlanImportDay = {
  date: string
  title?: string
  items: TripPlanImportItem[]
}

export type TripPlanImportItem = {
  title: string
  startTime?: string
  endTime?: string
  locationName?: string
  address?: string
  lat?: number
  lng?: number
  transportMode?: TransportMode
  notes?: string
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
  previousTransportNote?: string
}

export type TripPlanImportTicket = {
  title: string
  storageMode: TicketStorageMode
  note?: string
  filePath?: string
  fileName?: string
  mimeType?: string
  referenceLocation?: string
  externalUrl?: string
  bindTo?: {
    date?: string
    itemTitle?: string
  }
}

export type TripPlanSourceKind = 'json' | 'zip'

export type TripPlanAttachment = {
  blob: Blob
  fileName: string
  mimeType: string
  path: string
  size: number
}

export type TripPlanPreviewSummary = {
  daysCount: number
  itemsCount: number
  geocodedItemsCount: number
  missingCoordinateCount: number
  ticketCount: number
  copyTicketCount: number
  referenceTicketCount: number
  externalTicketCount: number
  attachmentCount: number
}

export type TripPlanValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
  summary: TripPlanPreviewSummary
}

export type ParsedTripPlanFile = {
  fileName: string
  package: TripPlanImportPackage
  sourceKind: TripPlanSourceKind
  attachments: Map<string, TripPlanAttachment>
  validation: TripPlanValidationResult
}

export type ImportTripPlanResult = {
  tripId: string
  title: string
  warnings: string[]
}

export type TripPlanRecords = {
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  ticketBlobs: TicketBlob[]
  warnings: string[]
}

type ValidateOptions = {
  sourceKind: TripPlanSourceKind
  attachments?: Map<string, TripPlanAttachment>
}

type BuildTripPlanRecordsOptions = ValidateOptions & {
  now?: number
  createIdFn?: typeof createId
}

export async function parseTripPlanFile(file: File): Promise<ParsedTripPlanFile> {
  if (!file || file.size <= 0) {
    throw new Error('请选择一个有效的 JSON 或 zip 行程包。')
  }
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    throw new Error('行程包文件超过 100MB，请拆分附件后重新导入。')
  }

  if (await looksLikeZip(file)) {
    return parseTripPlanZip(file)
  }

  try {
    return parseTripPlanJson(file, await file.text())
  } catch (jsonError) {
    try {
      return await parseTripPlanZip(file)
    } catch {
      throw jsonError instanceof Error ? jsonError : new Error('无法解析行程包文件。')
    }
  }
}

export function validateTripPlanPackage(
  pkg: TripPlanImportPackage,
  options: ValidateOptions,
): TripPlanValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const summary = createEmptySummary()

  if (!isRecord(pkg)) {
    return {
      errors: ['trip-plan.json 必须是一个 JSON 对象。'],
      summary,
      valid: false,
      warnings,
    }
  }

  if (pkg.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`不支持的行程包版本：${String(pkg.schemaVersion)}`)
  }

  if (pkg.type !== TRIP_PLAN_TYPE) {
    errors.push('这不是旅图 AI 行程包：type 必须是 "trip-plan"。')
  }

  if (!isRecord(pkg.trip)) {
    errors.push('trip 字段缺失或格式不正确。')
  } else {
    if (!normalizeText(pkg.trip.title)) {
      errors.push('trip.title 不能为空。')
    }
    if (!isValidDateString(pkg.trip.startDate)) {
      errors.push('trip.startDate 必须是 YYYY-MM-DD。')
    }
    if (!isValidDateString(pkg.trip.endDate)) {
      errors.push('trip.endDate 必须是 YYYY-MM-DD。')
    }
    if (
      isValidDateString(pkg.trip.startDate) &&
      isValidDateString(pkg.trip.endDate) &&
      pkg.trip.endDate < pkg.trip.startDate
    ) {
      errors.push('trip.endDate 不能早于 startDate。')
    }
  }

  if (!Array.isArray(pkg.days)) {
    errors.push('days 必须是数组。')
  } else {
    summary.daysCount = pkg.days.length
    if (pkg.days.length > MAX_DAYS_COUNT) {
      errors.push(`days 数量不能超过 ${MAX_DAYS_COUNT}。`)
    }
    validateDays(pkg, errors, warnings, summary)
  }

  if (pkg.tickets !== undefined && !Array.isArray(pkg.tickets)) {
    errors.push('tickets 必须是数组。')
  } else if (Array.isArray(pkg.tickets)) {
    if (pkg.tickets.length > MAX_TICKETS_COUNT) {
      errors.push(`tickets 数量不能超过 ${MAX_TICKETS_COUNT}。`)
    }
    validateTickets(pkg.tickets, options, errors, warnings, summary)
  }

  if (summary.itemsCount > MAX_ITEMS_COUNT) {
    errors.push(`行程点数量不能超过 ${MAX_ITEMS_COUNT}。`)
  }

  return {
    errors,
    summary,
    valid: errors.length === 0,
    warnings,
  }
}

export function buildTripPlanPreviewSummary(validation: TripPlanValidationResult) {
  return validation.summary
}

export async function importTripPlanPackage(
  pkg: TripPlanImportPackage,
  options: ValidateOptions,
): Promise<ImportTripPlanResult> {
  const records = buildTripPlanRecords(pkg, options)
  const result = await importTripPlanRecords({
    days: records.days,
    itineraryItems: records.itineraryItems,
    ticketBlobs: records.ticketBlobs,
    ticketMetas: records.ticketMetas,
    trip: records.trip,
  })

  return { ...result, warnings: records.warnings }
}

export function buildTripPlanRecords(
  pkg: TripPlanImportPackage,
  options: BuildTripPlanRecordsOptions,
): TripPlanRecords {
  const validation = validateTripPlanPackage(pkg, options)
  if (!validation.valid) {
    throw new Error(validation.errors[0] ?? '行程包校验失败。')
  }

  const warnings = [...validation.warnings]
  const now = options.now ?? Date.now()
  const createIdFn = options.createIdFn ?? createId
  const tripId = createIdFn('trip')
  const trip: Trip = {
    createdAt: now,
    destination: normalizeText(pkg.trip.destination) ?? '',
    endDate: pkg.trip.endDate,
    id: tripId,
    notes: normalizeText(pkg.trip.notes),
    startDate: pkg.trip.startDate,
    title: normalizeText(pkg.trip.title) ?? '未命名旅行',
    updatedAt: now,
  }

  const days: Day[] = []
  const items: ItineraryItem[] = []
  const itemByBindKey = new Map<string, ItineraryItem[]>()

  pkg.days.forEach((inputDay, dayIndex) => {
    const dayId = createIdFn('day')
    const day: Day = {
      date: inputDay.date,
      id: dayId,
      sortOrder: dayIndex + 1,
      title: normalizeText(inputDay.title) ?? `第 ${dayIndex + 1} 天`,
      tripId,
    }
    days.push(day)

    inputDay.items.forEach((inputItem, itemIndex) => {
      const item: ItineraryItem = {
        address: normalizeText(inputItem.address),
        createdAt: now,
        dayId,
        endTime: normalizeText(inputItem.endTime),
        id: createIdFn('item'),
        lat: normalizeNumber(inputItem.lat),
        lng: normalizeNumber(inputItem.lng),
        locationName: normalizeText(inputItem.locationName),
        notes: normalizeText(inputItem.notes),
        previousTransportDurationMinutes: normalizeNumber(inputItem.previousTransportDurationMinutes),
        previousTransportMode: inputItem.previousTransportMode,
        previousTransportNote: normalizeText(inputItem.previousTransportNote),
        sortOrder: itemIndex + 1,
        startTime: normalizeText(inputItem.startTime),
        ticketIds: [],
        title: normalizeText(inputItem.title) ?? '未命名行程点',
        transportMode: inputItem.transportMode,
        tripId,
        updatedAt: now,
      }
      items.push(item)

      const key = buildBindKey(day.date, item.title)
      const existingItems = itemByBindKey.get(key) ?? []
      existingItems.push(item)
      itemByBindKey.set(key, existingItems)
    })
  })

  const ticketMetas: TicketMeta[] = []
  const ticketBlobs: TicketBlob[] = []

  for (const ticketInput of pkg.tickets ?? []) {
    const ticketId = createIdFn('ticket')
    const boundItem = resolveTicketBinding(ticketInput, itemByBindKey, warnings)
    const storageMode = ticketInput.storageMode
    const title = normalizeText(ticketInput.title) ?? '未命名票据'
    const baseMeta = {
      createdAt: now,
      id: ticketId,
      itemId: boundItem?.id,
      note: normalizeText(ticketInput.note),
      scope: boundItem ? 'item' as const : 'unassigned' as const,
      storageMode,
      title,
      tripId,
      updatedAt: now,
    }

    if (storageMode === 'copy') {
      const path = safeZipPath(ticketInput.filePath)
      const attachment = path ? options.attachments?.get(path) : undefined
      if (!attachment) {
        throw new Error(`票据「${title}」缺少 zip 附件，无法导入。`)
      }

      const mimeType = normalizeText(ticketInput.mimeType) ?? attachment.mimeType
      const fileName = safeFileName(ticketInput.fileName ?? attachment.fileName ?? title, ticketId)
      ticketMetas.push({
        ...baseMeta,
        fileName,
        fileType: inferFileType(mimeType),
        mimeType,
        size: attachment.size,
      })
      ticketBlobs.push({ blob: attachment.blob, ticketId })
    } else if (storageMode === 'reference') {
      ticketMetas.push({
        ...baseMeta,
        fileName: safeFileName(ticketInput.fileName ?? title, ticketId),
        fileType: 'other',
        mimeType: 'text/plain',
        referenceLocation: normalizeText(ticketInput.referenceLocation),
        size: 0,
      })
    } else {
      ticketMetas.push({
        ...baseMeta,
        externalUrl: normalizeText(ticketInput.externalUrl),
        fileName: safeFileName(ticketInput.fileName ?? title, ticketId),
        fileType: 'other',
        mimeType: 'text/uri-list',
        size: 0,
      })
    }

    if (boundItem) {
      boundItem.ticketIds = [...new Set([...boundItem.ticketIds, ticketId])]
      boundItem.updatedAt = now
    }
  }

  const records: TripPlanRecords = {
    days,
    itineraryItems: items,
    ticketBlobs,
    ticketMetas,
    trip,
    warnings,
  }
  validateTripPlanRecordGraph(records)

  return records
}

function validateTripPlanRecordGraph(records: TripPlanRecords) {
  const dayIds = new Set(records.days.map((day) => day.id))
  const itemIds = new Set(records.itineraryItems.map((item) => item.id))
  const ticketIds = new Set(records.ticketMetas.map((ticket) => ticket.id))
  const blobTicketIds = new Set(records.ticketBlobs.map((ticketBlob) => ticketBlob.ticketId))

  for (const day of records.days) {
    if (day.tripId !== records.trip.id) {
      throw new Error('AI 行程包导入数据中存在不属于当前旅行的 Day。')
    }
  }

  for (const item of records.itineraryItems) {
    if (item.tripId !== records.trip.id || !dayIds.has(item.dayId)) {
      throw new Error('AI 行程包导入数据中存在无效的行程点引用。')
    }
    for (const ticketId of item.ticketIds) {
      if (!ticketIds.has(ticketId)) {
        throw new Error('AI 行程包导入数据中存在无效的票据绑定。')
      }
    }
  }

  for (const ticket of records.ticketMetas) {
    if (ticket.tripId !== records.trip.id || (ticket.itemId && !itemIds.has(ticket.itemId))) {
      throw new Error('AI 行程包导入数据中存在无效的票据引用。')
    }
    if (ticket.storageMode === 'copy' && !blobTicketIds.has(ticket.id)) {
      throw new Error(`copy 票据「${ticket.title || ticket.fileName}」缺少文件内容。`)
    }
    if (ticket.storageMode !== 'copy' && blobTicketIds.has(ticket.id)) {
      throw new Error(`非 copy 票据「${ticket.title || ticket.fileName}」不应包含文件内容。`)
    }
  }

  for (const ticketBlob of records.ticketBlobs) {
    if (!ticketIds.has(ticketBlob.ticketId)) {
      throw new Error('AI 行程包导入数据中存在孤立的票据文件。')
    }
  }
}

export function safeZipPath(value: string | undefined) {
  const normalized = value?.replace(/\\/g, '/').trim()
  if (
    !normalized ||
    normalized.startsWith('/') ||
    !normalized.startsWith('files/') ||
    hasControlCharacter(normalized) ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    return null
  }

  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    return null
  }

  return parts.join('/')
}

function hasControlCharacter(value: string) {
  return value.split('').some((char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127
  })
}

export function inferMimeType(fileName: string | undefined) {
  const lower = fileName?.toLowerCase() ?? ''
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

async function parseTripPlanJson(file: File, text: string): Promise<ParsedTripPlanFile> {
  if (text.length > MAX_TRIP_PLAN_JSON_SIZE) {
    throw new Error('trip-plan.json 超过 2MB，请精简行程内容后重新导入。')
  }

  const pkg = parsePackageJson(text, '选择的 JSON 无法解析。')
  if (!isRecord(pkg) || pkg.type !== TRIP_PLAN_TYPE) {
    throw new Error('选择的 JSON 不是旅图 AI 行程包。请确认 type 为 "trip-plan"。')
  }

  const typedPackage = pkg as TripPlanImportPackage
  const validation = validateTripPlanPackage(typedPackage, { sourceKind: 'json' })
  return {
    attachments: new Map(),
    fileName: file.name,
    package: typedPackage,
    sourceKind: 'json',
    validation,
  }
}

async function parseTripPlanZip(file: File): Promise<ParsedTripPlanFile> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  if (Object.keys(zip.files).length > MAX_ZIP_ENTRY_COUNT) {
    throw new Error(`zip 文件条目不能超过 ${MAX_ZIP_ENTRY_COUNT} 个。`)
  }

  const hasTripPlan = Boolean(zip.file('trip-plan.json'))
  const hasBackup = Boolean(zip.file('manifest.json') && zip.file('data/trip.json'))

  if (hasTripPlan && hasBackup) {
    throw new Error('该 zip 同时包含 AI 行程包和完整备份结构。请拆分后重新导入。')
  }

  if (hasBackup) {
    throw new Error('这是旅图完整备份 zip，请使用“导入备份 zip”入口。')
  }

  if (!hasTripPlan) {
    throw new Error('zip 中缺少 trip-plan.json，无法作为 AI 行程包导入。')
  }

  const tripPlanFile = zip.file('trip-plan.json')
  if (!tripPlanFile) {
    throw new Error('zip 中缺少 trip-plan.json。')
  }

  const rawTripPlanJson = await tripPlanFile.async('string')
  if (rawTripPlanJson.length > MAX_TRIP_PLAN_JSON_SIZE) {
    throw new Error('trip-plan.json 超过 2MB，请精简行程内容后重新导入。')
  }

  const rawPackage = parsePackageJson(rawTripPlanJson, 'trip-plan.json 无法解析。')
  const pkg = rawPackage as TripPlanImportPackage
  const attachments = isRecord(rawPackage) ? await readReferencedAttachments(zip, pkg) : new Map()
  const validation = validateTripPlanPackage(pkg, { attachments, sourceKind: 'zip' })

  return {
    attachments,
    fileName: file.name,
    package: pkg,
    sourceKind: 'zip',
    validation,
  }
}

async function readReferencedAttachments(zip: JSZip, pkg: TripPlanImportPackage) {
  const attachments = new Map<string, TripPlanAttachment>()
  let copyTicketCount = 0

  for (const ticket of Array.isArray(pkg.tickets) ? pkg.tickets : []) {
    if (!isRecord(ticket) || ticket.storageMode !== 'copy') {
      continue
    }

    copyTicketCount += 1
    if (copyTicketCount > MAX_COPY_ATTACHMENT_COUNT) {
      throw new Error(`copy 票据数量不能超过 ${MAX_COPY_ATTACHMENT_COUNT}。`)
    }

    const path = safeZipPath(typeof ticket.filePath === 'string' ? ticket.filePath : undefined)
    if (!path || attachments.has(path)) {
      continue
    }

    const zipFile = zip.file(path)
    if (!zipFile) {
      continue
    }

    const blob = await zipFile.async('blob')
    attachments.set(path, {
      blob,
      fileName: path.split('/').at(-1) || 'file',
      mimeType: normalizeText(typeof ticket.mimeType === 'string' ? ticket.mimeType : undefined) ?? inferMimeType(path),
      path,
      size: blob.size,
    })
  }

  return attachments
}

function validateDays(
  pkg: TripPlanImportPackage,
  errors: string[],
  warnings: string[],
  summary: TripPlanPreviewSummary,
) {
  const dayDates: string[] = []
  const tripStartDate = isRecord(pkg.trip) && typeof pkg.trip.startDate === 'string' ? pkg.trip.startDate : ''
  const tripEndDate = isRecord(pkg.trip) && typeof pkg.trip.endDate === 'string' ? pkg.trip.endDate : ''
  pkg.days.forEach((day, dayIndex) => {
    if (!isRecord(day)) {
      errors.push(`days[${dayIndex}] 必须是对象。`)
      return
    }

    if (!isValidDateString(day.date)) {
      errors.push(`days[${dayIndex}].date 必须是 YYYY-MM-DD。`)
    } else {
      dayDates.push(day.date)
      if (
        isValidDateString(tripStartDate) &&
        isValidDateString(tripEndDate) &&
        (day.date < tripStartDate || day.date > tripEndDate)
      ) {
        warnings.push(`Day ${dayIndex + 1} 的日期 ${day.date} 超出旅行日期范围。`)
      }
    }

    if (!Array.isArray(day.items)) {
      errors.push(`days[${dayIndex}].items 必须是数组。`)
      return
    }

    summary.itemsCount += day.items.length
    day.items.forEach((item, itemIndex) => {
      validateItem(item, dayIndex, itemIndex, errors, warnings, summary)
    })
  })

  const sortedDates = [...dayDates].sort()
  if (dayDates.some((date, index) => date !== sortedDates[index])) {
    warnings.push('days 数组顺序与日期顺序不一致，导入会保留原数组顺序作为 Day 顺序。')
  }
}

function validateItem(
  item: TripPlanImportItem,
  dayIndex: number,
  itemIndex: number,
  errors: string[],
  warnings: string[],
  summary: TripPlanPreviewSummary,
) {
  const prefix = `days[${dayIndex}].items[${itemIndex}]`
  if (!isRecord(item)) {
    errors.push(`${prefix} 必须是对象。`)
    return
  }

  if (!normalizeText(item.title)) {
    errors.push(`${prefix}.title 不能为空。`)
  }

  if (item.startTime && !isValidTimeString(item.startTime)) {
    errors.push(`${prefix}.startTime 应为 HH:mm。`)
  }
  if (item.endTime && !isValidTimeString(item.endTime)) {
    errors.push(`${prefix}.endTime 应为 HH:mm。`)
  }
  if (item.transportMode && !isTransportMode(item.transportMode)) {
    errors.push(`${prefix}.transportMode 不在允许范围内。`)
  }
  if (item.previousTransportMode && !isTransportMode(item.previousTransportMode)) {
    errors.push(`${prefix}.previousTransportMode 不在允许范围内。`)
  }
  if (
    item.previousTransportDurationMinutes !== undefined &&
    (!Number.isFinite(item.previousTransportDurationMinutes) || item.previousTransportDurationMinutes < 0)
  ) {
    errors.push(`${prefix}.previousTransportDurationMinutes 必须大于或等于 0。`)
  }

  const hasLat = item.lat !== undefined
  const hasLng = item.lng !== undefined
  if (hasLat || hasLng) {
    if (!isValidLatitude(item.lat)) {
      errors.push(`${prefix}.lat 必须在 -90 到 90 之间。`)
    }
    if (!isValidLongitude(item.lng)) {
      errors.push(`${prefix}.lng 必须在 -180 到 180 之间。`)
    }
    if (isValidLatitude(item.lat) && isValidLongitude(item.lng)) {
      summary.geocodedItemsCount += 1
    }
  } else {
    summary.missingCoordinateCount += 1
    warnings.push(`${normalizeText(item.title) ?? `第 ${itemIndex + 1} 个行程点`} 缺少经纬度，地图中不会显示 marker。`)
  }
}

function validateTickets(
  tickets: TripPlanImportTicket[],
  options: ValidateOptions,
  errors: string[],
  warnings: string[],
  summary: TripPlanPreviewSummary,
) {
  summary.ticketCount = tickets.length
  tickets.forEach((ticket, index) => {
    const prefix = `tickets[${index}]`
    if (!isRecord(ticket)) {
      errors.push(`${prefix} 必须是对象。`)
      return
    }

    if (!normalizeText(ticket.title)) {
      errors.push(`${prefix}.title 不能为空。`)
    }

    if (!isTicketStorageMode(ticket.storageMode)) {
      errors.push(`${prefix}.storageMode 不在允许范围内。`)
      return
    }

    if (ticket.storageMode === 'copy') {
      summary.copyTicketCount += 1
      if (options.sourceKind === 'json') {
        errors.push('JSON 单文件不支持 copy 模式票据。请使用 zip 行程包，并在 files/ 目录提供附件。')
        return
      }

      const path = safeZipPath(ticket.filePath)
      if (!path) {
        errors.push(`${prefix}.filePath 必须是 files/ 目录下的安全相对路径。`)
        return
      }

      const attachment = options.attachments?.get(path)
      if (!attachment) {
        errors.push(`${prefix}.filePath 指向的 zip 附件不存在：${path}`)
        return
      }

      summary.attachmentCount += 1
      if (attachment.size > MAX_SOFT_ATTACHMENT_SIZE) {
        warnings.push(`票据「${ticket.title}」附件超过 20MB，可能占用较多本地空间。`)
      }
    } else if (ticket.storageMode === 'reference') {
      summary.referenceTicketCount += 1
      if (!normalizeText(ticket.referenceLocation)) {
        errors.push(`${prefix}.referenceLocation 不能为空。`)
      }
    } else {
      summary.externalTicketCount += 1
      const externalUrl = normalizeText(ticket.externalUrl)
      if (!externalUrl || !isValidExternalUrl(externalUrl)) {
        errors.push(`${prefix}.externalUrl 必须是 http:// 或 https:// 链接。`)
      }
    }
  })
}

function resolveTicketBinding(
  ticket: TripPlanImportTicket,
  itemByBindKey: Map<string, ItineraryItem[]>,
  warnings: string[],
) {
  const date = normalizeText(ticket.bindTo?.date)
  const itemTitle = normalizeText(ticket.bindTo?.itemTitle)
  if (!date && !itemTitle) {
    return undefined
  }

  if (!date || !itemTitle) {
    warnings.push(`票据「${ticket.title}」绑定信息不完整，已作为未绑定票据导入。`)
    return undefined
  }

  const matches = itemByBindKey.get(buildBindKey(date, itemTitle)) ?? []
  if (matches.length === 0) {
    warnings.push(`票据「${ticket.title}」未找到可绑定的行程点，已作为未绑定票据导入。`)
    return undefined
  }

  if (matches.length > 1) {
    warnings.push(`票据「${ticket.title}」匹配到多个同名行程点，已绑定到第一个。`)
  }

  return matches[0]
}

function createEmptySummary(): TripPlanPreviewSummary {
  return {
    attachmentCount: 0,
    copyTicketCount: 0,
    daysCount: 0,
    externalTicketCount: 0,
    geocodedItemsCount: 0,
    itemsCount: 0,
    missingCoordinateCount: 0,
    referenceTicketCount: 0,
    ticketCount: 0,
  }
}

function parsePackageJson(text: string, errorMessage: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(errorMessage)
  }
}

async function looksLikeZip(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

function buildBindKey(date: string, title: string) {
  return `${date.trim()}\u0000${title.trim()}`
}

function normalizeText(value: string | undefined | null) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function normalizeNumber(value: number | undefined) {
  return Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidDateString(value: string | undefined) {
  return isValidPlainDate(value)
}

function isValidTimeString(value: string) {
  if (!TIME_PATTERN.test(value)) {
    return false
  }
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function isValidLatitude(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90
}

function isValidLongitude(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180
}

function isTransportMode(value: string): value is TransportMode {
  return TRANSPORT_MODES.includes(value as TransportMode)
}

function isTicketStorageMode(value: string): value is TicketStorageMode {
  return value === 'copy' || value === 'reference' || value === 'external'
}

function inferFileType(mimeType: string): TicketMeta['fileType'] {
  if (mimeType.startsWith('image/')) {
    return 'image'
  }
  if (mimeType === 'application/pdf') {
    return 'pdf'
  }
  return 'other'
}
