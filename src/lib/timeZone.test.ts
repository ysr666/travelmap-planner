import { describe, expect, it } from 'vitest'
import {
  getZonedMinuteOfDay,
  getZonedPlainDate,
  isValidTimeZone,
  lookupTimeZoneFromCoordinates,
  resolveDayTimeZone,
  resolveItemTimeRange,
} from './timeZone'
import type { Day, ItineraryItem, Trip } from '../types'

const trip: Trip = {
  createdAt: 1,
  destination: 'London',
  endDate: '2026-06-11',
  id: 'trip_1',
  startDate: '2026-06-10',
  timeZone: 'Europe/London',
  timeZoneSource: 'manual',
  title: 'London',
  updatedAt: 1,
}

const day: Day = {
  date: '2026-06-10',
  id: 'day_1',
  sortOrder: 1,
  title: 'Day 1',
  tripId: trip.id,
}

describe('time zone helpers', () => {
  it('validates IANA time zone identifiers', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
  })

  it('computes plain date and minute of day across DST boundaries', () => {
    const now = new Date('2026-03-29T23:30:00.000Z')

    expect(getZonedPlainDate(now, 'Europe/London')).toBe('2026-03-30')
    expect(getZonedMinuteOfDay(new Date('2026-03-29T01:30:00.000Z'), 'Europe/London')).toBe(150)
  })

  it('resolves day overrides before trip defaults', () => {
    expect(resolveDayTimeZone(trip, { ...day, timeZone: 'Europe/Paris' })).toBe('Europe/Paris')
    expect(resolveDayTimeZone(trip, day)).toBe('Europe/London')
  })

  it('converts cross-time-zone transport wall-clock times into instants', () => {
    const item: ItineraryItem = {
      createdAt: 1,
      dayId: day.id,
      endDate: '2026-06-11',
      endTime: '17:20',
      endTimeZone: 'Asia/Shanghai',
      id: 'flight_1',
      sortOrder: 1,
      startTime: '22:30',
      startTimeZone: 'Europe/London',
      ticketIds: [],
      title: 'London to Shanghai',
      transportMode: 'flight',
      tripId: trip.id,
      updatedAt: 1,
    }

    const range = resolveItemTimeRange({ day, item, trip })

    expect(range.startEpochMs).toBe(Date.parse('2026-06-10T21:30:00.000Z'))
    expect(range.endEpochMs).toBe(Date.parse('2026-06-11T09:20:00.000Z'))
    expect(range.isChronologicallyValid).toBe(true)
  })

  it('compares cross-date transport by instant instead of local clock order', () => {
    const range = resolveItemTimeRange({
      day: { ...day, date: '2026-06-10', timeZone: 'Asia/Tokyo' },
      item: {
        endDate: '2026-06-10',
        endTime: '17:00',
        endTimeZone: 'America/Los_Angeles',
        startTime: '16:00',
        startTimeZone: 'Asia/Tokyo',
      },
      trip: { ...trip, timeZone: 'Asia/Tokyo' },
    })

    expect(range.startEpochMs).toBe(Date.parse('2026-06-10T07:00:00.000Z'))
    expect(range.endEpochMs).toBe(Date.parse('2026-06-11T00:00:00.000Z'))
    expect(range.isChronologicallyValid).toBe(true)
  })

  it('looks up IANA time zones from coordinates', async () => {
    await expect(lookupTimeZoneFromCoordinates(51.5074, -0.1278)).resolves.toBe('Europe/London')
  })
})
