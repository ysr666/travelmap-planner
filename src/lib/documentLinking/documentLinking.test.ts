import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Day, ItineraryItem, TicketMeta, TransportBooking, TransportSegment } from '../../types'
import { validateInsurancePolicyV1, validateLodgingReservationV1 } from '../travelObjects'
import { buildTravelDocumentLinks, scoreTicketItemCandidate } from './matcher'
import { validateTravelDocumentLinkV1 } from './contracts'

type FixtureRecords = {
  days: Day[]
  documentLinks: unknown[]
  insurancePolicies: unknown[]
  itineraryItems: ItineraryItem[]
  lodgingReservations: unknown[]
  ticketMetas: TicketMeta[]
  transportBookings: TransportBooking[]
  transportSegments: TransportSegment[]
}

function loadFixtureRecords() {
  return (JSON.parse(readFileSync(
    new URL('../../../e2e/fixtures/product-fidelity-v1.json', import.meta.url),
    'utf8',
  )) as { records: FixtureRecords }).records
}

describe('travel document linking', () => {
  it('validates the canonical explainable links and derives the same confirmed subjects', () => {
    const records = loadFixtureRecords()
    const fixtureLinks = records.documentLinks.map(validateTravelDocumentLinkV1)
    expect(fixtureLinks.every(Boolean)).toBe(true)
    const derived = buildTravelDocumentLinks({
      days: records.days,
      insurancePolicies: records.insurancePolicies.map(validateInsurancePolicyV1).filter((value) => value !== null),
      items: records.itineraryItems,
      lodgingReservations: records.lodgingReservations.map(validateLodgingReservationV1).filter((value) => value !== null),
      now: 1785830400000,
      tickets: records.ticketMetas,
      transportBookings: records.transportBookings,
      transportSegments: records.transportSegments,
      tripId: 'trip_uk_product_fidelity',
    })

    for (const expected of fixtureLinks.filter((value) => value !== null)) {
      expect(derived).toContainEqual(expect.objectContaining({
        status: 'confirmed',
        subjectId: expected.subjectId,
        subjectType: expected.subjectType,
        ticketId: expected.ticketId,
      }))
    }
  })

  it('suggests one high-confidence item from metadata and marks close candidates as conflicts', () => {
    const records = loadFixtureRecords()
    const original = records.ticketMetas.find((ticket) => ticket.id === 'ticket_edinburgh_castle')!
    const ticket = { ...original, itemId: undefined, scope: 'unassigned' as const }
    const suggested = buildTravelDocumentLinks({
      days: records.days,
      items: records.itineraryItems,
      now: 1,
      tickets: [ticket],
      tripId: ticket.tripId,
    })
    expect(suggested).toEqual([expect.objectContaining({
      confidence: 1,
      evidence: ['text_match', 'date_match', 'time_match', 'category_match'],
      status: 'suggested',
      subjectId: 'item_edinburgh_castle',
      subjectType: 'item',
    })])

    const duplicate: ItineraryItem = {
      ...records.itineraryItems.find((item) => item.id === 'item_edinburgh_castle')!,
      id: 'item_edinburgh_castle_duplicate',
      sortOrder: 2,
    }
    const conflicts = buildTravelDocumentLinks({
      days: records.days,
      items: [...records.itineraryItems, duplicate],
      now: 1,
      tickets: [ticket],
      tripId: ticket.tripId,
    })
    expect(conflicts.filter((link) => link.status === 'conflict')).toHaveLength(2)
  })

  it('does not read private ticket content and rejects unknown or sensitive contract fields', () => {
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'castle.pdf',
      fileType: 'pdf',
      id: 'ticket_safe',
      mimeType: 'application/pdf',
      note: 'PRIVATE-PASSPORT-123',
      size: 1,
      title: '城堡门票',
      tripId: 'trip_safe',
      updatedAt: 1,
    }
    const item: ItineraryItem = {
      createdAt: 1,
      dayId: 'day_safe',
      id: 'item_safe',
      sortOrder: 1,
      ticketIds: [],
      title: '城堡',
      tripId: 'trip_safe',
      updatedAt: 1,
    }
    expect(scoreTicketItemCandidate(ticket, item).reason).not.toContain('PRIVATE')
    expect(validateTravelDocumentLinkV1({
      authorization: 'Bearer secret',
      confidence: 1,
      createdAt: 1,
      evidence: ['text_match'],
      id: 'link_safe',
      reason: '名称匹配',
      schemaVersion: 1,
      status: 'suggested',
      subjectId: 'item_safe',
      subjectType: 'item',
      ticketId: 'ticket_safe',
      tripId: 'trip_safe',
      updatedAt: 1,
    })).toBeNull()
  })
})
