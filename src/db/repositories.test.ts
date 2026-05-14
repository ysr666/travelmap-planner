import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  createDay,
  createItineraryItem,
  createTicketMeta,
  createTrip,
  deleteDayCascade,
  deleteItineraryItemCascade,
  deleteTicket,
  deleteTripCascade,
  getDay,
  getItineraryItem,
  getTicketBlob,
  getTicketMeta,
  getTrip,
  importTripPlanRecords,
  listDaysByTrip,
  listItemsByDay,
  listItemsByTrip,
  listTicketsByItem,
  listTicketsByTrip,
  listTrips,
  saveTicketBlob,
  updateDay,
  updateItineraryItem,
  updateTrip,
} from './repositories'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('Trip CRUD', () => {
  it('creates and retrieves a trip', async () => {
    const trip = await createTrip({ title: 'Tokyo', destination: 'Japan', startDate: '2025-04-01', endDate: '2025-04-03' })
    expect(trip.id).toBeTruthy()
    expect(trip.title).toBe('Tokyo')

    const found = await getTrip(trip.id)
    expect(found?.title).toBe('Tokyo')
  })

  it('lists trips ordered by updatedAt descending', async () => {
    const tripA = await createTrip({ title: 'Trip A', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    await updateTrip(tripA.id, { title: 'Trip A Updated' })
    await createTrip({ title: 'Trip B', destination: 'B', startDate: '2025-05-01', endDate: '2025-05-03' })

    const trips = await listTrips()
    expect(trips[0].title).toBe('Trip B')
    expect(trips[1].title).toBe('Trip A Updated')
  })

  it('updates a trip', async () => {
    const trip = await createTrip({ title: 'Old', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const updated = await updateTrip(trip.id, { title: 'New' })
    expect(updated?.title).toBe('New')
  })
})

describe('Day CRUD', () => {
  it('creates and lists days by trip', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    await createDay({ tripId: trip.id, date: '2025-04-02', title: 'Day 2', sortOrder: 2 })

    const days = await listDaysByTrip(trip.id)
    expect(days).toHaveLength(2)
    expect(days[0].title).toBe('Day 1')
  })

  it('updates a day', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Old', sortOrder: 1 })
    const updated = await updateDay(day.id, { title: 'New' })
    expect(updated?.title).toBe('New')
  })
})

describe('ItineraryItem CRUD', () => {
  it('creates and lists items by day', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Shibuya', sortOrder: 1, ticketIds: [] })
    await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Shinjuku', sortOrder: 2, ticketIds: [] })

    const items = await listItemsByDay(day.id)
    expect(items).toHaveLength(2)
  })

  it('lists items by trip', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day1 = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const day2 = await createDay({ tripId: trip.id, date: '2025-04-02', title: 'Day 2', sortOrder: 2 })
    await createItineraryItem({ tripId: trip.id, dayId: day1.id, title: 'A', sortOrder: 1, ticketIds: [] })
    await createItineraryItem({ tripId: trip.id, dayId: day2.id, title: 'B', sortOrder: 1, ticketIds: [] })

    const items = await listItemsByTrip(trip.id)
    expect(items).toHaveLength(2)
  })

  it('updates an item', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Old', sortOrder: 1, ticketIds: [] })
    const updated = await updateItineraryItem(item.id, { title: 'New' })
    expect(updated?.title).toBe('New')
  })
})

describe('Ticket CRUD', () => {
  it('creates and retrieves ticket meta', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const ticket = await createTicketMeta({
      tripId: trip.id,
      fileName: 'pass.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 1024,
    })

    const found = await getTicketMeta(ticket.id)
    expect(found?.fileName).toBe('pass.pdf')
  })

  it('saves and retrieves ticket blob', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const ticket = await createTicketMeta({
      tripId: trip.id,
      fileName: 'pass.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 4,
    })
    const blob = new Blob(['test'], { type: 'application/pdf' })
    await saveTicketBlob(ticket.id, blob)

    const found = await getTicketBlob(ticket.id)
    expect(found?.ticketId).toBe(ticket.id)
  })

  it('lists tickets by trip', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    await createTicketMeta({ tripId: trip.id, fileName: 'a.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })
    await createTicketMeta({ tripId: trip.id, fileName: 'b.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })

    const tickets = await listTicketsByTrip(trip.id)
    expect(tickets).toHaveLength(2)
  })

  it('lists tickets by item', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    await createTicketMeta({ tripId: trip.id, itemId: item.id, fileName: 'a.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })

    const tickets = await listTicketsByItem(item.id)
    expect(tickets).toHaveLength(1)
  })
})

describe('Cascade deletes', () => {
  it('deleteTripCascade removes all related data', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    const ticket = await createTicketMeta({ tripId: trip.id, itemId: item.id, fileName: 'a.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })
    await saveTicketBlob(ticket.id, new Blob(['test']))

    await deleteTripCascade(trip.id)

    expect(await getTrip(trip.id)).toBeUndefined()
    expect(await listDaysByTrip(trip.id)).toHaveLength(0)
    expect(await listItemsByTrip(trip.id)).toHaveLength(0)
    expect(await listTicketsByTrip(trip.id)).toHaveLength(0)
    expect(await getTicketBlob(ticket.id)).toBeUndefined()
  })

  it('deleteDayCascade removes day and its items with tickets', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    const ticket = await createTicketMeta({ tripId: trip.id, itemId: item.id, fileName: 'a.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })

    await deleteDayCascade(day.id)

    expect(await getDay(day.id)).toBeUndefined()
    expect(await getItineraryItem(item.id)).toBeUndefined()
    expect(await getTicketMeta(ticket.id)).toBeUndefined()
  })

  it('deleteItineraryItemCascade removes item and its tickets', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    const ticket = await createTicketMeta({ tripId: trip.id, itemId: item.id, fileName: 'a.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })
    await saveTicketBlob(ticket.id, new Blob(['test']))

    await deleteItineraryItemCascade(item.id)

    expect(await getItineraryItem(item.id)).toBeUndefined()
    expect(await getTicketMeta(ticket.id)).toBeUndefined()
    expect(await getTicketBlob(ticket.id)).toBeUndefined()
  })

  it('deleteTicket removes ticket and cleans up item references', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const ticket = await createTicketMeta({ tripId: trip.id, fileName: 'a.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })
    const item = await createItineraryItem({
      tripId: trip.id,
      dayId: day.id,
      title: 'A',
      sortOrder: 1,
      ticketIds: [ticket.id],
    })

    await deleteTicket(ticket.id)

    expect(await getTicketMeta(ticket.id)).toBeUndefined()
    const updatedItem = await getItineraryItem(item.id)
    expect(updatedItem?.ticketIds).not.toContain(ticket.id)
  })
})

describe('importTripPlanRecords', () => {
  it('imports all records in a transaction', async () => {
    const trip = {
      id: 'import-trip',
      title: 'Imported',
      destination: 'Kyoto',
      startDate: '2025-05-01',
      endDate: '2025-05-02',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const day = { id: 'import-day', tripId: 'import-trip', date: '2025-05-01', title: 'Day 1', sortOrder: 1 }
    const item = {
      id: 'import-item',
      tripId: 'import-trip',
      dayId: 'import-day',
      title: 'Temple',
      sortOrder: 1,
      ticketIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const result = await importTripPlanRecords({
      trip,
      days: [day],
      itineraryItems: [item],
      ticketMetas: [],
      ticketBlobs: [],
    })

    expect(result.title).toBe('Imported')
    expect(await getTrip('import-trip')).toBeTruthy()
    expect(await getDay('import-day')).toBeTruthy()
    expect(await getItineraryItem('import-item')).toBeTruthy()
  })
})
