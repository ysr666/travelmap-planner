import { Temporal } from '@js-temporal/polyfill'
import { parsePlainDate } from './plainDate'

declare const timeSemanticBrand: unique symbol

export type PlainDate = string & { readonly [timeSemanticBrand]: 'PlainDate' }
export type WallClockTime = string & { readonly [timeSemanticBrand]: 'WallClockTime' }
export type Instant = number & { readonly [timeSemanticBrand]: 'Instant' }
export type IanaTimeZone = string & { readonly [timeSemanticBrand]: 'IanaTimeZone' }

export type WallClockAdjustment = 'none' | 'nonexistent_shifted_forward' | 'ambiguous_earlier'

export type WallClockResolution = {
  adjustment: WallClockAdjustment
  instant: Instant
  requestedDate: PlainDate
  requestedTime: WallClockTime
  resolvedDate: PlainDate
  resolvedTime: WallClockTime
  timeZone: IanaTimeZone
}

const WALL_CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function toPlainDate(value: string | null | undefined): PlainDate | null {
  return parsePlainDate(value) ? value as PlainDate : null
}

export function toWallClockTime(value: string | null | undefined): WallClockTime | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return WALL_CLOCK_PATTERN.test(trimmed) ? trimmed as WallClockTime : null
}

export function toInstant(value: number): Instant | null {
  return Number.isFinite(value) ? value as Instant : null
}

export function toIanaTimeZone(value: string | null | undefined): IanaTimeZone | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date(0))
    return trimmed as IanaTimeZone
  } catch {
    return null
  }
}

export function todayInTimeZone(timeZone: string, now: Date | number = Date.now()): PlainDate {
  const zone = requireTimeZone(timeZone)
  const epochMs = typeof now === 'number' ? now : now.getTime()
  const instant = toInstant(epochMs)
  if (instant === null) throw new Error('Instant 无效。')
  return Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone).toPlainDate().toString() as PlainDate
}

export function resolveWallClockToInstant(input: {
  date: string
  time: string
  timeZone: string
}): WallClockResolution | null {
  const date = toPlainDate(input.date)
  const time = toWallClockTime(input.time)
  const timeZone = toIanaTimeZone(input.timeZone)
  if (!date || !time || !timeZone) return null

  const parts = parsePlainDate(date)!
  const [hour, minute] = time.split(':').map(Number)
  const fields = {
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
  }
  const compatible = Temporal.ZonedDateTime.from(fields, { disambiguation: 'compatible' })
  const wallClockChanged = compatible.year !== parts.year
    || compatible.month !== parts.month
    || compatible.day !== parts.day
    || compatible.hour !== hour
    || compatible.minute !== minute
  let adjustment: WallClockAdjustment = wallClockChanged ? 'nonexistent_shifted_forward' : 'none'
  let resolved = compatible

  if (!wallClockChanged) {
    const earlier = Temporal.ZonedDateTime.from(fields, { disambiguation: 'earlier' })
    const later = Temporal.ZonedDateTime.from(fields, { disambiguation: 'later' })
    if (earlier.epochMilliseconds !== later.epochMilliseconds) {
      adjustment = 'ambiguous_earlier'
      resolved = earlier
    }
  }

  return {
    adjustment,
    instant: resolved.epochMilliseconds as Instant,
    requestedDate: date,
    requestedTime: time,
    resolvedDate: resolved.toPlainDate().toString() as PlainDate,
    resolvedTime: `${pad(resolved.hour)}:${pad(resolved.minute)}` as WallClockTime,
    timeZone,
  }
}

export function formatInstantInTimeZone(
  instant: number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  const value = toInstant(instant)
  if (value === null) return null
  const zone = requireTimeZone(timeZone)
  return new Intl.DateTimeFormat('zh-CN', { timeZone: zone, ...options }).format(new Date(value))
}

export function addPlainDateDays(value: string, days: number): PlainDate | null {
  const parts = parsePlainDate(value)
  if (!parts || !Number.isInteger(days)) return null
  return Temporal.PlainDate.from(parts).add({ days }).toString() as PlainDate
}

export function plainDateDaysBetween(first: string, second: string) {
  const firstParts = parsePlainDate(first)
  const secondParts = parsePlainDate(second)
  if (!firstParts || !secondParts) return null
  return Temporal.PlainDate.from(firstParts).until(Temporal.PlainDate.from(secondParts), { largestUnit: 'day' }).days
}

export function describeWallClockAdjustment(resolution: WallClockResolution | null) {
  if (!resolution || resolution.adjustment === 'none') return null
  if (resolution.adjustment === 'nonexistent_shifted_forward') {
    return `${resolution.requestedTime} 遇到夏令时跳时，已按 ${resolution.resolvedTime} 计算。`
  }
  return `${resolution.requestedTime} 在夏令时切换中出现两次，已按较早时刻计算。`
}

function requireTimeZone(value: string) {
  const timeZone = toIanaTimeZone(value)
  if (!timeZone) throw new Error('IANA 时区无效。')
  return timeZone
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}
