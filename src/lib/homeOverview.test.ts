import { describe, expect, it } from 'vitest'
import { buildHomePortfolioModel, buildHomeTripOverview, type HomeTripSnapshot } from './homeOverview'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

describe('Home portfolio model', () => {
  it('prefers an ongoing trip over a recently edited completed trip', () => {
    const model = buildHomePortfolioModel([
      snapshot(trip({ id: 'completed', startDate: '2026-01-01', endDate: '2026-01-05', updatedAt: 999 })),
      snapshot(trip({ id: 'ongoing', startDate: '2026-06-19', endDate: '2026-06-24', updatedAt: 1 })),
    ], { now: new Date('2026-06-20T03:00:00.000Z') })

    expect(model.primary?.trip.id).toBe('ongoing')
    expect(model.completed.map((entry) => entry.trip.id)).toEqual(['completed'])
  })

  it('selects the nearest upcoming trip and removes it from the secondary list', () => {
    const model = buildHomePortfolioModel([
      snapshot(trip({ id: 'later', startDate: '2026-07-10', endDate: '2026-07-12' })),
      snapshot(trip({ id: 'next', startDate: '2026-06-25', endDate: '2026-06-28' })),
    ], { now: new Date('2026-06-20T03:00:00.000Z') })

    expect(model.primary?.trip.id).toBe('next')
    expect(model.activeAndUpcoming.map((entry) => entry.trip.id)).toEqual(['later'])
  })

  it('uses the preferred trip only among simultaneous ongoing trips', () => {
    const model = buildHomePortfolioModel([
      snapshot(trip({ id: 'first', startDate: '2026-06-18', endDate: '2026-06-25' })),
      snapshot(trip({ id: 'preferred', startDate: '2026-06-19', endDate: '2026-06-24' })),
    ], {
      now: new Date('2026-06-20T03:00:00.000Z'),
      preferredTripId: 'first',
    })

    expect(model.primary?.trip.id).toBe('first')
  })

  it('chooses the next uncompleted item in the trip day timezone', () => {
    const currentTrip = trip({ id: 'tokyo', startDate: '2026-06-20', endDate: '2026-06-20', timeZone: 'Asia/Tokyo' })
    const currentDay = day({ date: '2026-06-20', id: 'day_tokyo', tripId: currentTrip.id })
    const overview = buildHomeTripOverview({
      days: [currentDay],
      items: [
        item({ dayId: currentDay.id, id: 'past', startTime: '09:00', tripId: currentTrip.id }),
        item({ dayId: currentDay.id, id: 'done', startTime: '13:00', tripId: currentTrip.id, executionState: { status: 'completed', updatedAt: 1 } }),
        item({ dayId: currentDay.id, id: 'next', startTime: '14:00', tripId: currentTrip.id }),
      ],
      tickets: [],
      trip: currentTrip,
    }, new Date('2026-06-20T04:30:00.000Z'))

    expect(overview.today).toBe('2026-06-20')
    expect(overview.nextItem?.id).toBe('next')
  })

  it('summarizes local map and ticket preparation without remote data', () => {
    const currentTrip = trip({ id: 'trip_1' })
    const currentDay = day({ id: 'day_1', tripId: currentTrip.id })
    const overview = buildHomeTripOverview({
      days: [currentDay],
      items: [
        item({ dayId: currentDay.id, id: 'mapped', lat: 35, lng: 139, tripId: currentTrip.id }),
        item({ dayId: currentDay.id, id: 'missing', tripId: currentTrip.id }),
      ],
      tickets: [ticket({ id: 'ticket_1', tripId: currentTrip.id })],
      trip: currentTrip,
    }, new Date('2026-01-01T00:00:00.000Z'))

    expect(overview.stats).toMatchObject({ dayCount: 1, itemCount: 2, mappedItemCount: 1, ticketCount: 1 })
    expect(overview.preparationLabel).toBe('1 个行程点待补坐标')
  })
})

function snapshot(currentTrip: Trip): HomeTripSnapshot {
  return { days: [], items: [], tickets: [], trip: currentTrip }
}

function trip(patch: Partial<Trip>): Trip {
  return {
    createdAt: 1,
    destination: '东京',
    endDate: '2026-06-22',
    id: 'trip_1',
    startDate: '2026-06-20',
    title: '旅行',
    updatedAt: 1,
    ...patch,
  }
}

function day(patch: Partial<Day>): Day {
  return {
    date: '2026-06-20',
    id: 'day_1',
    sortOrder: 0,
    title: '第一天',
    tripId: 'trip_1',
    ...patch,
  }
}

function item(patch: Partial<ItineraryItem>): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day_1',
    id: 'item_1',
    sortOrder: 0,
    ticketIds: [],
    title: '行程点',
    tripId: 'trip_1',
    updatedAt: 1,
    ...patch,
  }
}

function ticket(patch: Partial<TicketMeta>): TicketMeta {
  return {
    createdAt: 1,
    fileName: 'ticket.pdf',
    fileType: 'pdf',
    id: 'ticket_1',
    mimeType: 'application/pdf',
    size: 100,
    storageMode: 'copy',
    tripId: 'trip_1',
    updatedAt: 1,
    ...patch,
  }
}
