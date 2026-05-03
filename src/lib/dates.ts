import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { createDay, listDaysByTrip } from '../db'
import type { Day, Trip } from '../types'

dayjs.locale('zh-cn')

export function formatDate(date: string) {
  return dayjs(date).isValid() ? dayjs(date).format('YYYY年M月D日') : '日期无效'
}

export function formatShortDate(date: string) {
  return dayjs(date).isValid() ? dayjs(date).format('M月D日') : '未定'
}

export function formatDateRange(startDate: string, endDate: string) {
  if (!dayjs(startDate).isValid() || !dayjs(endDate).isValid()) {
    return '日期未定'
  }

  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`
}

export function listExpectedTripDates(trip: Trip) {
  const start = dayjs(trip.startDate)
  const end = dayjs(trip.endDate)
  if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
    return []
  }

  const dates: string[] = []
  let cursor = start.startOf('day')
  const last = end.startOf('day')

  while (cursor.isBefore(last, 'day') || cursor.isSame(last, 'day')) {
    dates.push(cursor.format('YYYY-MM-DD'))
    cursor = cursor.add(1, 'day')
  }

  return dates
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
