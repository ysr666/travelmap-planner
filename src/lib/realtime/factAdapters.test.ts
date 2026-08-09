import { describe, expect, it } from 'vitest'
import type {
  ProviderProxyPlaceDetailsSuccessResponse,
  ProviderProxyRoutePreviewSuccessResponse,
} from '../ai/providerProxyContract'
import type { FlightStatusSnapshot, TicketMeta, TransportSegment } from '../../types'
import {
  buildPlaceOpeningFact,
  buildRouteEtaFact,
  buildTicketStatusFact,
  buildTransportStatusFact,
} from './factAdapters'

describe('realtime fact adapters', () => {
  it('converts sourced Place Details opening state with a bounded TTL', () => {
    const response: ProviderProxyPlaceDetailsSuccessResponse = {
      details: {
        displayName: '爱丁堡城堡',
        placeId: 'ChIJcastle',
        provider: 'google_places',
        regularOpeningHours: { openNow: true, weekdayDescriptions: [] },
        retrievedAt: '2026-08-18T09:20:00.000Z',
      },
      ok: true,
      operation: 'place_details',
      retrievedAt: '2026-08-18T09:20:00.000Z',
      source: 'google_places',
    }
    expect(buildPlaceOpeningFact({ itemId: 'item_castle', response, tripId: 'trip_1' })).toMatchObject({
      expiresAt: '2026-08-18T10:20:00.000Z',
      kind: 'place_opening_status',
      source: { provider: 'google_places' },
      value: { status: 'open' },
    })
  })

  it('converts road route duration without claiming a failed route is usable', () => {
    const response: ProviderProxyRoutePreviewSuccessResponse = {
      ok: true,
      operation: 'route_preview',
      provider: 'google',
      route: {
        distanceMeters: 1200,
        durationSeconds: 961,
        lineStrings: [[[0, 0], [1, 1]]],
        segments: [],
        status: 'road',
        warnings: [],
      },
    }
    expect(buildRouteEtaFact({
      mode: 'walk',
      observedAt: '2026-08-18T09:31:00Z',
      response,
      subjectId: 'item_castle',
      tripId: 'trip_1',
    })).toMatchObject({
      expiresAt: '2026-08-18T09:36:00.000Z',
      source: { provider: 'google_routes' },
      value: { distanceMeters: 1200, durationMinutes: 17, status: 'road' },
    })
  })

  it('labels mock transport status and drops disabled snapshots', () => {
    const segment = transportSegment()
    const mock: FlightStatusSnapshot = {
      departureTime: '10:20',
      expiresAt: '2026-08-18T09:35:00Z',
      fetchedAt: '2026-08-18T09:30:00Z',
      provider: 'mock',
      status: 'delayed',
      warnings: [],
    }
    expect(buildTransportStatusFact({ segment, snapshot: mock })).toMatchObject({
      confidence: 'low',
      source: { provider: 'mock_transport' },
      value: { mode: 'flight', status: 'delayed' },
    })
    expect(buildTransportStatusFact({
      segment,
      snapshot: { ...mock, expiresAt: mock.fetchedAt, provider: 'disabled', status: 'unknown' },
    })).toBeNull()
  })

  it('derives local ticket readiness without exposing file locations', () => {
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'castle.pdf',
      fileType: 'pdf',
      id: 'ticket_castle',
      mimeType: 'application/pdf',
      referenceLocation: '/private/user/ticket.pdf',
      size: 1,
      storageMode: 'reference',
      structuredFields: { entryTime: '11:00', schemaVersion: 1, serviceDate: '2026-08-18', status: 'ready' },
      tripId: 'trip_1',
      updatedAt: Date.parse('2026-08-18T09:00:00Z'),
    }
    const fact = buildTicketStatusFact(ticket)
    expect(fact).toMatchObject({ source: { provider: 'local_ticket' }, value: { status: 'ready' } })
    expect(JSON.stringify(fact)).not.toContain('/private/user')
    expect(JSON.stringify(fact)).not.toContain('castle.pdf')
  })
})

function transportSegment(): TransportSegment {
  return {
    arrivalDate: '2026-08-18',
    arrivalPlace: '伦敦',
    arrivalTimeZone: 'Europe/London',
    bookingId: 'booking_1',
    createdAt: 1,
    departureDate: '2026-08-18',
    departurePlace: '上海',
    departureTimeZone: 'Asia/Shanghai',
    id: 'segment_1',
    kind: 'flight',
    sortOrder: 0,
    status: 'scheduled',
    tripId: 'trip_1',
    updatedAt: 1,
  }
}
