import type { TransportMode } from '../types'
import { isValidPlainDate } from './plainDate'

export type AiTripDraftInput = {
  title?: unknown
  destination?: unknown
  startDate?: unknown
  endDate?: unknown
  days?: unknown[]
}

export type AiTripDraft = {
  title: string
  destination: string
  startDate: string
  endDate: string
  days: AiTripDraftDay[]
}

export type AiTripDraftDay = {
  date: string
  title?: string
  items: AiTripDraftItem[]
}

export type AiTripDraftItem = {
  title: string
  locationName?: string
  address?: string
  lat?: number
  lng?: number
  startTime?: string
  endTime?: string
  previousTransportMode?: TransportMode
  note?: string
}

export type AiDraftValidationError = {
  path: string
  message: string
}

export type AiDraftValidationResult = {
  valid: boolean
  errors: AiDraftValidationError[]
  draft?: AiTripDraft
}

export type AiDraftSummary = {
  title: string
  destination: string
  startDate: string
  endDate: string
  daysCount: number
  itemsCount: number
}

const TRANSPORT_MODES: TransportMode[] = ['walk', 'transit', 'bus', 'car', 'train', 'flight', 'other']
const TIME_PATTERN = /^\d{2}:\d{2}$/
const MAX_DAYS = 120
const MAX_ITEMS_PER_DAY = 50
const MAX_TOTAL_ITEMS = 1000
const MAX_TITLE_LENGTH = 200
const MAX_DESTINATION_LENGTH = 200
const MAX_NOTE_LENGTH = 5000

export function validateAiTripDraft(input: unknown): AiDraftValidationResult {
  const errors: AiDraftValidationError[] = []

  if (!isRecord(input)) {
    return { valid: false, errors: [{ path: 'root', message: '草稿必须是对象。' }] }
  }

  const title = normalizeText(input.title)
  if (!title) {
    errors.push({ path: 'title', message: '旅行标题不能为空。' })
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push({ path: 'title', message: `旅行标题不能超过 ${MAX_TITLE_LENGTH} 个字符。` })
  }

  const destination = normalizeText(input.destination) ?? ''
  if (destination.length > MAX_DESTINATION_LENGTH) {
    errors.push({ path: 'destination', message: `目的地不能超过 ${MAX_DESTINATION_LENGTH} 个字符。` })
  }

  const startDate = typeof input.startDate === 'string' ? input.startDate : undefined
  const endDate = typeof input.endDate === 'string' ? input.endDate : undefined

  if (!isValidPlainDate(startDate)) {
    errors.push({ path: 'startDate', message: '开始日期格式无效，请使用 YYYY-MM-DD。' })
  }

  if (!isValidPlainDate(endDate)) {
    errors.push({ path: 'endDate', message: '结束日期格式无效，请使用 YYYY-MM-DD。' })
  }

  if (isValidPlainDate(startDate) && isValidPlainDate(endDate)) {
    if (startDate > endDate) {
      errors.push({ path: 'endDate', message: '结束日期不能早于开始日期。' })
    }
  }

  if (!Array.isArray(input.days)) {
    errors.push({ path: 'days', message: 'days 必须是数组。' })
  } else {
    if (input.days.length > MAX_DAYS) {
      errors.push({ path: 'days', message: `天数不能超过 ${MAX_DAYS} 天。` })
    }

    let totalItems = 0
    const tripStartDate = normalizeText(input.startDate)
    const tripEndDate = normalizeText(input.endDate)

    input.days.forEach((day, dayIndex) => {
      const dayPath = `days[${dayIndex}]`
      if (!isRecord(day)) {
        errors.push({ path: dayPath, message: '天必须是对象。' })
        return
      }

      const dayDate = typeof day.date === 'string' ? day.date : undefined
      if (!isValidPlainDate(dayDate)) {
        errors.push({ path: `${dayPath}.date`, message: '日期格式无效，请使用 YYYY-MM-DD。' })
      } else if (tripStartDate && tripEndDate && dayDate && (dayDate < tripStartDate || dayDate > tripEndDate)) {
        errors.push({ path: `${dayPath}.date`, message: '日期不在旅行日期范围内。' })
      }

      if (day.title !== undefined && typeof day.title !== 'string') {
        errors.push({ path: `${dayPath}.title`, message: '标题必须是字符串。' })
      }

      if (!Array.isArray(day.items)) {
        errors.push({ path: `${dayPath}.items`, message: 'items 必须是数组。' })
        return
      }

      if (day.items.length > MAX_ITEMS_PER_DAY) {
        errors.push({ path: `${dayPath}.items`, message: `每天行程点不能超过 ${MAX_ITEMS_PER_DAY} 个。` })
      }

      totalItems += day.items.length
      day.items.forEach((item, itemIndex) => {
        const itemPath = `${dayPath}.items[${itemIndex}]`
        validateItem(item, itemPath, errors)
      })
    })

    if (totalItems > MAX_TOTAL_ITEMS) {
      errors.push({ path: 'days', message: `总行程点不能超过 ${MAX_TOTAL_ITEMS} 个。` })
    }
  }

  return { valid: errors.length === 0, errors, draft: errors.length === 0 ? buildDraft(input) : undefined }
}

export function normalizeAiTripDraft(input: unknown): AiTripDraft | null {
  const result = validateAiTripDraft(input)
  return result.draft ?? null
}

export function summarizeAiTripDraft(draft: AiTripDraft): AiDraftSummary {
  const itemsCount = draft.days.reduce((sum, day) => sum + day.items.length, 0)
  return {
    title: draft.title,
    destination: draft.destination,
    startDate: draft.startDate,
    endDate: draft.endDate,
    daysCount: draft.days.length,
    itemsCount,
  }
}

export function convertAiTripDraftToImportData(draft: AiTripDraft) {
  return {
    trip: {
      title: draft.title,
      destination: draft.destination,
      startDate: draft.startDate,
      endDate: draft.endDate,
    },
    days: draft.days.map((day) => ({
      date: day.date,
      title: day.title,
      items: day.items.map((item) => ({
        title: item.title,
        locationName: item.locationName,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        startTime: item.startTime,
        endTime: item.endTime,
        previousTransportMode: item.previousTransportMode,
        notes: item.note,
      })),
    })),
  }
}

function validateItem(item: unknown, path: string, errors: AiDraftValidationError[]) {
  if (!isRecord(item)) {
    errors.push({ path, message: '行程点必须是对象。' })
    return
  }

  const title = normalizeText(item.title)
  if (!title) {
    errors.push({ path: `${path}.title`, message: '行程点标题不能为空。' })
  }

  if (item.locationName !== undefined && typeof item.locationName !== 'string') {
    errors.push({ path: `${path}.locationName`, message: '地点名称必须是字符串。' })
  }

  if (item.address !== undefined && typeof item.address !== 'string') {
    errors.push({ path: `${path}.address`, message: '地址必须是字符串。' })
  }

  if (item.lat !== undefined) {
    if (!isValidLatitude(item.lat)) {
      errors.push({ path: `${path}.lat`, message: '纬度必须在 -90 到 90 之间。' })
    }
  }

  if (item.lng !== undefined) {
    if (!isValidLongitude(item.lng)) {
      errors.push({ path: `${path}.lng`, message: '经度必须在 -180 到 180 之间。' })
    }
  }

  if (item.startTime !== undefined) {
    if (!isValidTimeString(item.startTime)) {
      errors.push({ path: `${path}.startTime`, message: '开始时间格式无效，请使用 HH:mm。' })
    }
  }

  if (item.endTime !== undefined) {
    if (!isValidTimeString(item.endTime)) {
      errors.push({ path: `${path}.endTime`, message: '结束时间格式无效，请使用 HH:mm。' })
    }
  }

  if (item.previousTransportMode !== undefined) {
    if (!isTransportMode(item.previousTransportMode)) {
      errors.push({ path: `${path}.previousTransportMode`, message: '交通方式不在允许范围内。' })
    }
  }

  if (item.note !== undefined) {
    if (typeof item.note !== 'string') {
      errors.push({ path: `${path}.note`, message: '备注必须是字符串。' })
    } else if (item.note.length > MAX_NOTE_LENGTH) {
      errors.push({ path: `${path}.note`, message: `备注不能超过 ${MAX_NOTE_LENGTH} 个字符。` })
    }
  }
}

function buildDraft(input: Record<string, unknown>): AiTripDraft {
  return {
    title: normalizeText(input.title) ?? '',
    destination: normalizeText(input.destination) ?? '',
    startDate: normalizeText(input.startDate) ?? '',
    endDate: normalizeText(input.endDate) ?? '',
    days: (input.days as unknown[]).map((day) => {
      const d = day as Record<string, unknown>
      return {
        date: normalizeText(d.date) ?? '',
        title: normalizeText(d.title),
        items: (d.items as unknown[]).map((item) => {
          const i = item as Record<string, unknown>
          return {
            title: normalizeText(i.title) ?? '',
            locationName: normalizeText(i.locationName),
            address: normalizeText(i.address),
            lat: normalizeNumber(i.lat),
            lng: normalizeNumber(i.lng),
            startTime: normalizeText(i.startTime),
            endTime: normalizeText(i.endTime),
            previousTransportMode: isTransportMode(i.previousTransportMode) ? i.previousTransportMode : undefined,
            note: normalizeText(i.note),
          }
        }),
      }
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isValidTimeString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (!TIME_PATTERN.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function isValidLatitude(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90
}

function isValidLongitude(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180
}

function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === 'string' && TRANSPORT_MODES.includes(value as TransportMode)
}
