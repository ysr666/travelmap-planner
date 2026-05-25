import { sortItineraryItems } from './itinerary'
import { defaultAiPrivacySettings, type AiPrivacySettings } from './aiPrivacy'
import type { Day, ItineraryItem, TransportMode, Trip } from '../types'

export const AI_TRIP_EDIT_MAX_DAYS = 30
export const AI_TRIP_EDIT_MAX_ITEMS = 300
export const AI_TRIP_EDIT_MAX_TITLE_LENGTH = 120
export const AI_TRIP_EDIT_MAX_LOCATION_LENGTH = 120
export const AI_TRIP_EDIT_MAX_ADDRESS_LENGTH = 200
export const AI_TRIP_EDIT_MAX_NOTE_SUMMARY_LENGTH = 80

export type AiTripEditContextItem = {
  id: string
  dayId: string
  title: string
  startTime?: string
  endTime?: string
  locationName?: string
  address?: string
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
  noteSummary?: string
  hasTicketBindings?: boolean
}

export type AiTripEditContextDay = {
  id: string
  date: string
  title?: string
  items: AiTripEditContextItem[]
}

export type AiTripEditContext = {
  trip: {
    id: string
    title: string
    destination?: string
    startDate: string
    endDate: string
  }
  days: AiTripEditContextDay[]
  warnings?: string[]
}

export type BuildAiTripEditContextResult =
  | { ok: true; context: AiTripEditContext; warnings: string[] }
  | { ok: false; errors: string[] }

export type ValidateAiTripEditContextResult =
  | { ok: true; context: AiTripEditContext }
  | { ok: false; errors: string[] }

export type BuildAiTripEditContextInput = {
  trip: Trip
  days: Day[]
  items: ItineraryItem[]
  privacy?: AiPrivacySettings
  maxDays?: number
  maxItems?: number
}

const VALID_TRANSPORT_MODES = new Set<TransportMode>([
  'walk',
  'transit',
  'bus',
  'car',
  'train',
  'flight',
  'other',
])

export function buildAiTripEditContext({
  trip,
  days,
  items,
  privacy = defaultAiPrivacySettings,
  maxDays = AI_TRIP_EDIT_MAX_DAYS,
  maxItems = AI_TRIP_EDIT_MAX_ITEMS,
}: BuildAiTripEditContextInput): BuildAiTripEditContextResult {
  const errors: string[] = []
  const warnings: string[] = []
  const tripDays = [...days]
    .filter((day) => day.tripId === trip.id)
    .sort((first, second) => first.sortOrder - second.sortOrder)

  if (tripDays.length > maxDays) {
    errors.push(`AI 修改上下文最多支持 ${maxDays} 天。`)
  }
  if (tripDays.length === 0) {
    errors.push('AI 修改上下文至少需要一天。')
  }

  const tripItems = items.filter((item) => item.tripId === trip.id)
  if (tripItems.length > maxItems) {
    errors.push(`AI 修改上下文最多支持 ${maxItems} 个行程项。`)
  }

  if (errors.length > 0) {
    return { errors, ok: false }
  }

  const itemsByDay = new Map<string, ItineraryItem[]>()
  for (const item of tripItems) {
    const bucket = itemsByDay.get(item.dayId) ?? []
    bucket.push(item)
    itemsByDay.set(item.dayId, bucket)
  }

  const contextDays = tripDays.map((day) => ({
    id: clampText(day.id, 128),
    date: clampText(day.date, 16),
    title: optionalText(day.title, AI_TRIP_EDIT_MAX_TITLE_LENGTH),
    items: sortItineraryItems(itemsByDay.get(day.id) ?? []).map((item) => sanitizeItem(item, privacy, warnings)),
  }))

  const context: AiTripEditContext = {
    days: contextDays,
    trip: {
      destination: optionalText(trip.destination, AI_TRIP_EDIT_MAX_TITLE_LENGTH),
      endDate: clampText(trip.endDate, 16),
      id: clampText(trip.id, 128),
      startDate: clampText(trip.startDate, 16),
      title: clampText(trip.title, AI_TRIP_EDIT_MAX_TITLE_LENGTH),
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  }

  return { context, ok: true, warnings }
}

export function validateAiTripEditContext(input: unknown): ValidateAiTripEditContextResult {
  const record = readRecord(input)
  const errors: string[] = []
  const trip = readRecord(record.trip)
  const rawDays = Array.isArray(record.days) ? record.days : null

  const normalizedTrip = {
    destination: optionalText(trip.destination, AI_TRIP_EDIT_MAX_TITLE_LENGTH),
    endDate: readRequiredString(trip.endDate, 'trip.endDate', 16, errors),
    id: readRequiredString(trip.id, 'trip.id', 128, errors),
    startDate: readRequiredString(trip.startDate, 'trip.startDate', 16, errors),
    title: readRequiredString(trip.title, 'trip.title', AI_TRIP_EDIT_MAX_TITLE_LENGTH, errors),
  }

  if (!rawDays) {
    errors.push('context.days 必须是数组。')
    return { errors, ok: false }
  }
  if (rawDays.length === 0) {
    errors.push('context.days 至少需要一天。')
  }
  if (rawDays.length > AI_TRIP_EDIT_MAX_DAYS) {
    errors.push(`context.days 不能超过 ${AI_TRIP_EDIT_MAX_DAYS} 天。`)
  }

  let itemCount = 0
  const dayIds = new Set<string>()
  const contextDays: AiTripEditContextDay[] = []
  for (const [dayIndex, rawDay] of rawDays.entries()) {
    const day = readRecord(rawDay)
    const id = readRequiredString(day.id, `days[${dayIndex}].id`, 128, errors)
    const items = Array.isArray(day.items) ? day.items : []
    if (id) {
      dayIds.add(id)
    }
    itemCount += items.length
    contextDays.push({
      date: readRequiredString(day.date, `days[${dayIndex}].date`, 16, errors),
      id,
      items: items.map((rawItem, itemIndex) => normalizeContextItem(rawItem, dayIndex, itemIndex, errors)),
      title: optionalText(day.title, AI_TRIP_EDIT_MAX_TITLE_LENGTH),
    })
  }

  if (itemCount > AI_TRIP_EDIT_MAX_ITEMS) {
    errors.push(`context.items 不能超过 ${AI_TRIP_EDIT_MAX_ITEMS} 个。`)
  }

  for (const day of contextDays) {
    for (const item of day.items) {
      if (item.dayId && !dayIds.has(item.dayId)) {
        errors.push(`行程项 ${item.id || '(unknown)'} 的 dayId 不存在。`)
      }
    }
  }

  if (errors.length > 0) {
    return { errors, ok: false }
  }

  return {
    context: {
      days: contextDays,
      trip: normalizedTrip,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter((warning): warning is string => typeof warning === 'string').map((warning) => clampText(warning, 200)).slice(0, 10)
        : undefined,
    },
    ok: true,
  }
}

function sanitizeItem(
  item: ItineraryItem,
  privacy: AiPrivacySettings,
  warnings: string[],
): AiTripEditContextItem {
  const sanitized: AiTripEditContextItem = {
    dayId: clampText(item.dayId, 128),
    endTime: optionalText(item.endTime, 16),
    hasTicketBindings: item.ticketIds.length > 0 ? true : undefined,
    id: clampText(item.id, 128),
    startTime: optionalText(item.startTime, 16),
    title: clampText(item.title, AI_TRIP_EDIT_MAX_TITLE_LENGTH),
  }

  if (privacy.allowLocationText) {
    sanitized.locationName = optionalText(item.locationName, AI_TRIP_EDIT_MAX_LOCATION_LENGTH)
    sanitized.address = optionalText(item.address, AI_TRIP_EDIT_MAX_ADDRESS_LENGTH)
  }

  if (privacy.allowTransportInfo) {
    if (item.previousTransportMode) {
      sanitized.previousTransportMode = item.previousTransportMode
    }
    if (typeof item.previousTransportDurationMinutes === 'number' && Number.isFinite(item.previousTransportDurationMinutes)) {
      sanitized.previousTransportDurationMinutes = Math.max(0, Math.round(item.previousTransportDurationMinutes))
    }
  }

  const note = item.notes?.trim()
  if (note && (privacy.allowFullNotes || privacy.allowNotesSummary)) {
    sanitized.noteSummary = clampText(note, AI_TRIP_EDIT_MAX_NOTE_SUMMARY_LENGTH)
    if (note.length > AI_TRIP_EDIT_MAX_NOTE_SUMMARY_LENGTH) {
      sanitized.noteSummary = `${sanitized.noteSummary.slice(0, AI_TRIP_EDIT_MAX_NOTE_SUMMARY_LENGTH - 1)}…`
      warnings.push('部分备注已按 AI 隐私设置截断为摘要。')
    }
  }

  return sanitized
}

function normalizeContextItem(
  rawItem: unknown,
  dayIndex: number,
  itemIndex: number,
  errors: string[],
): AiTripEditContextItem {
  const item = readRecord(rawItem)
  const path = `days[${dayIndex}].items[${itemIndex}]`
  const transportMode = item.previousTransportMode
  const duration = item.previousTransportDurationMinutes

  if (transportMode !== undefined && !VALID_TRANSPORT_MODES.has(transportMode as TransportMode)) {
    errors.push(`${path}.previousTransportMode 无效。`)
  }
  if (duration !== undefined && (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 1440)) {
    errors.push(`${path}.previousTransportDurationMinutes 无效。`)
  }

  return {
    address: optionalText(item.address, AI_TRIP_EDIT_MAX_ADDRESS_LENGTH),
    dayId: readRequiredString(item.dayId, `${path}.dayId`, 128, errors),
    endTime: optionalText(item.endTime, 16),
    hasTicketBindings: typeof item.hasTicketBindings === 'boolean' ? item.hasTicketBindings : undefined,
    id: readRequiredString(item.id, `${path}.id`, 128, errors),
    locationName: optionalText(item.locationName, AI_TRIP_EDIT_MAX_LOCATION_LENGTH),
    noteSummary: optionalText(item.noteSummary, AI_TRIP_EDIT_MAX_NOTE_SUMMARY_LENGTH),
    previousTransportDurationMinutes: typeof duration === 'number' && Number.isInteger(duration) ? duration : undefined,
    previousTransportMode: VALID_TRANSPORT_MODES.has(transportMode as TransportMode) ? transportMode as TransportMode : undefined,
    startTime: optionalText(item.startTime, 16),
    title: readRequiredString(item.title, `${path}.title`, AI_TRIP_EDIT_MAX_TITLE_LENGTH, errors),
  }
}

function readRequiredString(value: unknown, path: string, maxLength: number, errors: string[]) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${path} 必须是非空字符串。`)
    return ''
  }
  return clampText(value, maxLength)
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? clampText(trimmed, maxLength) : undefined
}

function clampText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength)
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}
