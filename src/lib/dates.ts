import { createDay, listDaysByTrip } from '../db'
import {
  formatPlainDateChinese,
  formatPlainShortDateChinese,
  formatPlainShortDateWithWeekdayChinese,
  isValidPlainDate,
  listPlainDateRangeInclusive,
} from './plainDate'
import type { Day, Trip } from '../types'

export function formatDate(date: string) {
  return formatPlainDateChinese(date) ?? '日期无效'
}

export function formatShortDate(date: string) {
  return formatPlainShortDateChinese(date) ?? '未定'
}

export function formatDateRange(startDate: string, endDate: string) {
  if (!isValidPlainDate(startDate) || !isValidPlainDate(endDate)) {
    return '日期未定'
  }

  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`
}

export function formatShortDateWithWeekday(date: string) {
  return formatPlainShortDateWithWeekdayChinese(date) ?? '日期未定'
}

export function formatDateKey(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseTimeMinutes(value: string | undefined) {
  if (!value) {
    return null
  }
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) {
    return null
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    return null
  }
  return hours * 60 + minutes
}

export function listExpectedTripDates(trip: Trip) {
  return listPlainDateRangeInclusive(trip.startDate, trip.endDate)
}

export function getDayGenerationState(trip: Trip, days: Day[]) {
  const expectedDates = listExpectedTripDates(trip)
  const existingDates = new Set(days.map((day) => day.date))
  const missingDates = expectedDates.filter((date) => !existingDates.has(date))

  if (expectedDates.length === 0) {
    return {
      expectedDates,
      missingDates,
      label: '日期范围无效',
      disabled: true,
    }
  }

  if (days.length === 0) {
    return {
      expectedDates,
      missingDates,
      label: '生成日期范围',
      disabled: false,
    }
  }

  if (missingDates.length > 0) {
    return {
      expectedDates,
      missingDates,
      label: '补全缺失日期',
      disabled: false,
    }
  }

  return {
    expectedDates,
    missingDates,
    label: '每日行程已生成',
    disabled: true,
  }
}

export async function ensureDaysForTrip(trip: Trip) {
  const expectedDates = listExpectedTripDates(trip)
  const existingDays = await listDaysByTrip(trip.id)
  const existingDates = new Set(existingDays.map((day) => day.date))
  const missingDates = expectedDates.filter((date) => !existingDates.has(date))

  for (const date of missingDates) {
    const sortOrder = expectedDates.indexOf(date) + 1
    await createDay({
      tripId: trip.id,
      date,
      title: `第 ${sortOrder} 天`,
      sortOrder,
    })
  }

  return listDaysByTrip(trip.id)
}
