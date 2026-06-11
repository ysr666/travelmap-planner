import { describe, expect, it } from 'vitest'
import { pickSelectedDay } from './useTripData'
import type { Day, Trip } from '../types'

const trip: Trip = {
  createdAt: 1,
  destination: '英国伦敦',
  endDate: '2026-06-11',
  id: 'trip_1',
  startDate: '2026-06-10',
  timeZone: 'Europe/London',
  timeZoneSource: 'manual',
  title: 'London',
  updatedAt: 1,
}

const days: Day[] = [
  { date: '2026-06-10', id: 'day_1', sortOrder: 1, title: 'Day 1', tripId: trip.id },
  { date: '2026-06-11', id: 'day_2', sortOrder: 2, title: 'Day 2', tripId: trip.id },
]

describe('pickSelectedDay', () => {
  it('uses the trip time zone instead of the device-local calendar date', () => {
    const chinaAlreadyTomorrow = new Date('2026-06-10T16:30:00.000Z')

    expect(pickSelectedDay(trip, days, null, chinaAlreadyTomorrow)?.id).toBe('day_1')
  })

  it('uses day-level time zone overrides when selecting today', () => {
    const mixedDays: Day[] = [
      { ...days[0], timeZone: 'Europe/London' },
      { ...days[1], timeZone: 'Asia/Shanghai' },
    ]

    expect(pickSelectedDay({ ...trip, timeZone: 'Asia/Shanghai' }, mixedDays, null, new Date('2026-06-10T16:30:00.000Z'))?.id).toBe('day_1')
  })
})
