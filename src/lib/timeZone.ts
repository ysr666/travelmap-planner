import { Temporal } from '@js-temporal/polyfill'
import { parsePlainDate } from './plainDate'
import type { Day, ItineraryItem, TimeZoneSource, Trip } from '../types'

export type { TimeZoneSource }

export type ItemTimeRange = {
  endDate: string
  endEpochMs?: number
  endMinutes: number | null
  endTime?: string
  endTimeZone: string
  startDate: string
  startEpochMs?: number
  startMinutes: number | null
  startTime?: string
  startTimeZone: string
}

type TzLookupFn = (lat: number, lng: number) => string

const FALLBACK_TIME_ZONE = 'UTC'
const COMMON_TIME_ZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Madrid',
  'America/New_York',
  'America/Los_Angeles',
  'America/Toronto',
  'Australia/Sydney',
] as const

let cachedTzLookup: Promise<TzLookupFn> | null = null

export function getDeviceTimeZone() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return normalizeTimeZone(timeZone) ?? FALLBACK_TIME_ZONE
}

export function normalizeTimeZone(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return isValidTimeZone(trimmed) ? trimmed : undefined
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

export function getSupportedTimeZones() {
  const supported = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : []
  return [...new Set([getDeviceTimeZone(), ...COMMON_TIME_ZONES, ...supported])]
}

export function getZonedPlainDate(now: Date, timeZone: string) {
  const zoned = getZonedDateTime(now, timeZone)
  return `${pad(zoned.year)}-${pad(zoned.month)}-${pad(zoned.day)}`
}

export function getZonedMinuteOfDay(now: Date, timeZone: string) {
  const zoned = getZonedDateTime(now, timeZone)
  return zoned.hour * 60 + zoned.minute
}

export function formatZonedTimeLabel(now: Date, timeZone: string) {
  const zoned = getZonedDateTime(now, timeZone)
  return `${pad(zoned.hour)}:${pad(zoned.minute)}`
}

export function resolveTripTimeZone(trip: Pick<Trip, 'timeZone'> | null | undefined) {
  return normalizeTimeZone(trip?.timeZone) ?? getDeviceTimeZone()
}

export function resolveDayTimeZone(
  trip: Pick<Trip, 'timeZone'> | null | undefined,
  day: Pick<Day, 'timeZone'> | null | undefined,
) {
  return normalizeTimeZone(day?.timeZone) ?? resolveTripTimeZone(trip)
}

export function resolveItemTimeRange({
  day,
  item,
  trip,
}: {
  day: Pick<Day, 'date' | 'timeZone'>
  item: Pick<ItineraryItem, 'startTime' | 'endTime' | 'startTimeZone' | 'endDate' | 'endTimeZone'>
  trip: Pick<Trip, 'timeZone'>
}): ItemTimeRange {
  const dayTimeZone = resolveDayTimeZone(trip, day)
  const startTimeZone = normalizeTimeZone(item.startTimeZone) ?? dayTimeZone
  const endTimeZone = normalizeTimeZone(item.endTimeZone) ?? startTimeZone
  const normalizedEndDate = item.endDate && parsePlainDate(item.endDate) ? item.endDate : undefined
  const endDate = normalizedEndDate ?? day.date
  const startMinutes = parseTimeMinutes(item.startTime)
  const endMinutes = parseTimeMinutes(item.endTime)

  return {
    endDate,
    endEpochMs: endMinutes === null ? undefined : wallClockToEpochMs(endDate, endMinutes, endTimeZone),
    endMinutes,
    endTime: normalizeTimeText(item.endTime),
    endTimeZone,
    startDate: day.date,
    startEpochMs: startMinutes === null ? undefined : wallClockToEpochMs(day.date, startMinutes, startTimeZone),
    startMinutes,
    startTime: normalizeTimeText(item.startTime),
    startTimeZone,
  }
}

export async function lookupTimeZoneFromCoordinates(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }
  try {
    const tzLookup = await loadTzLookup()
    return normalizeTimeZone(tzLookup(lat, lng)) ?? null
  } catch {
    return null
  }
}

export function formatTimeZoneSource(source: TimeZoneSource | undefined) {
  if (source === 'manual') return '手动'
  if (source === 'provider') return '自动推断'
  if (source === 'imported') return '导入'
  return '设备'
}

function getZonedDateTime(now: Date, timeZone: string) {
  const normalized = normalizeTimeZone(timeZone) ?? getDeviceTimeZone()
  return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(normalized)
}

function wallClockToEpochMs(date: string, minuteOfDay: number, timeZone: string) {
  const parts = parsePlainDate(date)
  if (!parts) {
    return undefined
  }
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return Temporal.ZonedDateTime.from({
    day: parts.day,
    hour,
    microsecond: 0,
    millisecond: 0,
    minute,
    month: parts.month,
    nanosecond: 0,
    second: 0,
    timeZone,
    year: parts.year,
  }).epochMilliseconds
}

function parseTimeMinutes(value: string | undefined) {
  const normalized = normalizeTimeText(value)
  if (!normalized) {
    return null
  }
  const [hoursText, minutesText] = normalized.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)
  return hours * 60 + minutes
}

function normalizeTimeText(value: string | undefined) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value?.trim() ?? '')
  return match ? `${match[1]}:${match[2]}` : undefined
}

async function loadTzLookup() {
  if (!cachedTzLookup) {
    cachedTzLookup = import('tz-lookup').then((module) => {
      const candidate = ((module as unknown as { default?: unknown }).default ?? module) as unknown
      if (typeof candidate !== 'function') {
        throw new Error('tz-lookup did not expose a lookup function.')
      }
      return candidate as TzLookupFn
    })
  }
  return cachedTzLookup
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}
