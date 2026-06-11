import { describe, expect, it } from 'vitest'
import type { TransportSegment } from '../types'
import { isDuplicateTransportBooking, isSafeExternalAction } from './travelDocumentCenter'

describe('travel document center helpers', () => {
  it('detects the same carrier service and route without using file names', () => {
    const segment = {
      arrivalPlace: 'Shanghai', carrier: 'British Airways', departureDate: '2026-08-01', departurePlace: 'London', serviceNumber: 'BA169',
    }
    expect(isDuplicateTransportBooking(segment, [segment as TransportSegment])).toBe(true)
    expect(isDuplicateTransportBooking({ ...segment, serviceNumber: 'BA168' }, [segment as TransportSegment])).toBe(false)
  })

  it('allows HTTPS actions and rejects credential-like custom schemes', () => {
    expect(isSafeExternalAction({ url: 'https://www.12306.cn/' })).toBe(true)
    expect(isSafeExternalAction({ url: 'javascript:alert(1)' })).toBe(false)
    expect(isSafeExternalAction({ url: 'umetrip://login?token=secret' })).toBe(false)
  })
})
