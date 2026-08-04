import { resolveItemTimeRange } from './timeZone'
import type { Day, ItineraryItem, Trip } from '../types'

export type HomeDeparturePresentation = {
  accessibleLabel: string
  footer: string
  label: string
  value: string
}

const COUNTDOWN_WINDOW_MS = 24 * 60 * 60 * 1000

export function getHomeDeparturePresentation({
  day,
  item,
  now,
  status,
  trip,
}: {
  day: Pick<Day, 'date' | 'timeZone'>
  item: Pick<ItineraryItem, 'startTime' | 'endTime' | 'startTimeZone' | 'endDate' | 'endTimeZone'>
  now: Date
  status: 'ongoing' | 'upcoming' | 'completed'
  trip: Pick<Trip, 'timeZone'>
}): HomeDeparturePresentation | null {
  if (!item.startTime) return null

  const startEpochMs = resolveItemTimeRange({ day, item, trip }).startEpochMs
  const remainingMs = startEpochMs === undefined ? Number.NaN : startEpochMs - now.getTime()

  if (
    status !== 'completed'
    && Number.isFinite(remainingMs)
    && remainingMs > 0
    && remainingMs <= COUNTDOWN_WINDOW_MS
  ) {
    const remainingSeconds = Math.ceil(remainingMs / 1000)
    const hours = Math.floor(remainingSeconds / 3600)
    const minutes = Math.floor((remainingSeconds % 3600) / 60)
    const seconds = remainingSeconds % 60
    const value = hours > 0
      ? `${hours}:${pad(minutes)}`
      : `${pad(minutes)}:${pad(seconds)}`
    const accessibleDuration = hours > 0
      ? `${hours} 小时 ${minutes} 分钟`
      : `${minutes} 分钟 ${seconds} 秒`

    return {
      accessibleLabel: `距离出发还有 ${accessibleDuration}`,
      footer: '出发',
      label: '出发倒计时',
      value,
    }
  }

  return {
    accessibleLabel: `出发时间 ${item.startTime}`,
    footer: status === 'completed' ? '已结束' : '出发',
    label: '出发时间',
    value: item.startTime,
  }
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}
