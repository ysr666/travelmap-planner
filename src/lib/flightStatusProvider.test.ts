import { describe, expect, it } from 'vitest'
import { createDisabledFlightStatusProvider, createMockFlightStatusProvider } from './flightStatusProvider'
import type { TransportSegment } from '../types'

const segment = { arrivalTime: '12:00', departureTime: '10:00', gate: 'A1', kind: 'flight', status: 'scheduled', terminal: '2' } as TransportSegment

describe('flight status provider boundary', () => {
  it('does not make a real request when disabled', async () => {
    const result = await createDisabledFlightStatusProvider().getStatus(segment, new Date('2026-06-11T00:00:00Z'))
    expect(result.provider).toBe('disabled')
    expect(result.status).toBe('unknown')
  })

  it('returns an expiring mock snapshot without changing ticket data', async () => {
    const result = await createMockFlightStatusProvider('delayed').getStatus(segment, new Date('2026-06-11T00:00:00Z'))
    expect(result).toMatchObject({ departureTime: '10:00', expiresAt: '2026-06-11T00:05:00.000Z', provider: 'mock', status: 'delayed' })
    expect(segment.status).toBe('scheduled')
  })
})
