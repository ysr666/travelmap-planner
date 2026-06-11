import { describe, expect, it } from 'vitest'
import { isDeterministicTripMatch } from './travelInboxOrganization'
import type { Trip } from '../../types'

const trip: Trip = {
  createdAt: 1,
  destination: '东京',
  endDate: '2026-07-12',
  id: 'trip-tokyo',
  startDate: '2026-07-10',
  title: '东京旅行',
  updatedAt: 1,
}

describe('travel inbox automatic organization gate', () => {
  it('requires a deterministic title, destination, or overlapping date match', () => {
    expect(isDeterministicTripMatch('东京旅行酒店确认', trip)).toBe(true)
    expect(isDeterministicTripMatch('Hotel in 东京', trip)).toBe(true)
    expect(isDeterministicTripMatch('Check-in 2026-07-11', trip)).toBe(true)
    expect(isDeterministicTripMatch('大阪 2026-08-01 rail pass', trip)).toBe(false)
  })
})
