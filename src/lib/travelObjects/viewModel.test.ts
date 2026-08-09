import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type {
  BookingSecretData,
  Day,
  ItineraryItem,
  TicketMeta,
  TransportBooking,
  TransportSegment,
} from '../../types'
import { validateTravelMediaAssetV1, type TravelMediaAssetV1 } from '../media/travelMedia'
import {
  normalizeTicketStructuredFieldsV1,
  validateInsurancePolicyV1,
  validateLodgingReservationV1,
} from './contracts'
import {
  buildTravelObjectCollection,
  getTravelObjectForItineraryItem,
  getTravelObjectsForDay,
  toProviderSafeTravelObjectSummary,
} from './viewModel'

type FixtureRecords = {
  bookingSecrets: BookingSecretData[]
  days: Day[]
  insurancePolicies: unknown[]
  itineraryItems: ItineraryItem[]
  lodgingReservations: unknown[]
  mediaAssets: unknown[]
  ticketMetas: TicketMeta[]
  transportBookings: TransportBooking[]
  transportSegments: TransportSegment[]
}

function loadFixtureRecords() {
  const fixture = JSON.parse(readFileSync(
    new URL('../../../e2e/fixtures/product-fidelity-v1.json', import.meta.url),
    'utf8',
  )) as { records: FixtureRecords }
  return fixture.records
}

describe('travel object view model', () => {
  it('builds one canonical object collection for all four product surfaces', () => {
    const records = loadFixtureRecords()
    const mediaAssets = records.mediaAssets.map(validateTravelMediaAssetV1).flatMap((result) => result.ok ? [result.value] : [])
    const lodgingReservations = records.lodgingReservations.map(validateLodgingReservationV1).filter((value) => value !== null)
    const insurancePolicies = records.insurancePolicies.map(validateInsurancePolicyV1).filter((value) => value !== null)
    expect(mediaAssets).toHaveLength(records.mediaAssets.length)
    expect(lodgingReservations).toHaveLength(records.lodgingReservations.length)
    expect(insurancePolicies).toHaveLength(records.insurancePolicies.length)
    for (const ticket of records.ticketMetas) {
      expect(normalizeTicketStructuredFieldsV1(ticket.structuredFields)).toEqual(ticket.structuredFields)
    }
    const collection = buildTravelObjectCollection({
      bookingSecrets: records.bookingSecrets,
      days: records.days,
      insurancePolicies,
      items: records.itineraryItems,
      lodgingReservations,
      mediaAssets: mediaAssets satisfies TravelMediaAssetV1[],
      now: '2026-08-18T09:32:00.000Z',
      tickets: records.ticketMetas,
      transportBookings: records.transportBookings,
      transportSegments: records.transportSegments,
      tripId: 'trip_uk_product_fidelity',
    })

    expect(collection.preparation.map((object) => object.kind)).toEqual(['transport', 'lodging', 'insurance'])
    expect(collection.preparation[0]).toMatchObject({
      brand: { canonicalCode: 'CA', namespace: 'airline' },
      title: 'CA849',
    })
    expect(collection.preparation[1]).toMatchObject({
      kind: 'lodging',
      media: { id: 'media_hotel_room_thumb_v1' },
      title: 'Washington Mayfair Hotel',
    })
    expect(collection.preparation[2]).toMatchObject({
      brand: { canonicalCode: 'ALLIANZ', namespace: 'insurance' },
      status: { label: '保障中' },
    })

    const castle = collection.byItemId.get('item_edinburgh_castle')
    expect(castle).toMatchObject({ media: { id: 'media_edinburgh_castle_hero_v1' }, ticketIds: ['ticket_edinburgh_castle'] })
    expect(collection.byTicketId.get('ticket_british_museum')).toMatchObject({
      dateLabel: '2026-08-13',
      documentLink: { label: '已关联行程', status: 'confirmed' },
      media: { id: 'media_british_museum_thumb_v1' },
      status: { label: '已就绪' },
      timeLabel: '09:00',
    })
    expect(collection.byTicketId.get('ticket_ca849')).toMatchObject({
      brand: { canonicalCode: 'CA', namespace: 'airline' },
    })
    const railItem = records.itineraryItems.find((item) => item.id === 'item_lner_to_edinburgh')!
    expect(getTravelObjectForItineraryItem(collection, railItem)).toMatchObject({
      brand: { canonicalCode: 'LNER', namespace: 'rail' },
      media: { id: 'media_lner_azuma_thumb_v1' },
    })
    expect(getTravelObjectsForDay(collection, '2026-08-13').map((object) => object.kind)).toContain('transport')
  })

  it('keeps encrypted booking values in private UI fields and strips them from Provider summaries', () => {
    const records = loadFixtureRecords()
    const collection = buildTravelObjectCollection({
      bookingSecrets: records.bookingSecrets,
      days: records.days,
      items: records.itineraryItems,
      tickets: records.ticketMetas,
      transportBookings: records.transportBookings,
      transportSegments: records.transportSegments,
      tripId: 'trip_uk_product_fidelity',
    })
    const rail = collection.all.find((object) => object.id === 'transport:segment_lner')
    expect(rail?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '座位', value: '45A', visibility: 'private' }),
      expect.objectContaining({ label: '订单号', value: 'LNER-0813-1700', visibility: 'private' }),
    ]))
    expect(rail).toBeDefined()
    if (!rail) return

    const safe = toProviderSafeTravelObjectSummary(rail)
    expect(JSON.stringify(safe)).not.toContain('45A')
    expect(JSON.stringify(safe)).not.toContain('LNER-0813-1700')
    expect(JSON.stringify(safe)).not.toContain('segment_lner')
    expect(JSON.stringify(safe)).not.toContain('ticket_lner')
    expect(JSON.stringify(safe)).not.toContain('booking_lner')
  })

  it('tolerates old records without structured fields or media', () => {
    const collection = buildTravelObjectCollection({
      days: [{ date: '2026-01-01', id: 'day', sortOrder: 0, timeZone: 'Asia/Shanghai', title: '第一天', tripId: 'trip' }],
      items: [{ createdAt: 1, dayId: 'day', id: 'item', sortOrder: 0, ticketIds: [], title: '旧行程点', tripId: 'trip', updatedAt: 1 }],
      tickets: [{ createdAt: 1, fileName: 'old.pdf', fileType: 'pdf', id: 'ticket', mimeType: 'application/pdf', size: 1, tripId: 'trip', updatedAt: 1 }],
      tripId: 'trip',
    })

    expect(collection.byItemId.get('item')?.title).toBe('旧行程点')
    expect(collection.byTicketId.get('ticket')).toMatchObject({ status: { label: '已就绪' }, title: 'old.pdf' })
  })

  it('surfaces one explainable suggestion without mutating an unbound ticket', () => {
    const records = loadFixtureRecords()
    const source = records.ticketMetas.find((ticket) => ticket.id === 'ticket_edinburgh_castle')!
    const ticket = { ...source, itemId: undefined, scope: 'unassigned' as const }
    const collection = buildTravelObjectCollection({
      days: records.days,
      items: records.itineraryItems,
      tickets: [ticket],
      tripId: ticket.tripId,
    })

    expect(collection.byTicketId.get(ticket.id)?.documentLink).toMatchObject({
      confidence: 1,
      label: '建议关联',
      status: 'suggested',
      subjectId: 'item_edinburgh_castle',
      subjectType: 'item',
    })
    expect(ticket.itemId).toBeUndefined()
  })
})
