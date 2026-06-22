import { describe, expect, it } from 'vitest'
import { getTripStatus } from './tripVisuals'
import type { Trip } from '../types'

const baseTrip: Trip = {
  createdAt: 1,
  destination: '东京',
  endDate: '2026-06-11',
  id: 'trip_1',
  startDate: '2026-06-11',
  title: '东京旅行',
  updatedAt: 1,
}

describe('getTripStatus', () => {
  it('uses the trip time zone when deciding whether the trip is active', () => {
    const sameInstant = new Date('2026-06-10T16:30:00.000Z')

    expect(getTripStatus({ ...baseTrip, timeZone: 'Asia/Tokyo' }, sameInstant).status).toBe('active')
    expect(getTripStatus({ ...baseTrip, timeZone: 'America/Los_Angeles' }, sameInstant).status).toBe('planned')
  })

  it('keeps invalid date ranges as draft instead of inferring a status', () => {
    expect(getTripStatus({ ...baseTrip, endDate: '2026-06-10' }).status).toBe('draft')
  })
})
