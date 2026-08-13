import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  createDay,
  createItineraryItem,
  createTicketMeta,
  createTrip,
  deleteDayCascade,
  deleteItineraryItemReversible,
  deleteTicket,
  deleteTripCascade,
  getDay,
  getItineraryItem,
  getTicketBlob,
  getTicketMeta,
  getTrip,
  importTripPlanRecords,
  prepareTripPlanImport,
  applyTripPlanImportPlan,
  listDaysByTrip,
  listItemsByDay,
  listItemsByTrip,
  listTicketsByItem,
  listTicketsByTrip,
  moveItineraryItemBetweenDays,
  prepareDayItemsReorder,
  prepareItineraryItemMove,
  prepareTicketMetaUpdate,
  applyDayItemsReorderPlan,
  applyItineraryItemMovePlan,
  applyTicketMetaUpdatePlan,
  replaceTripPlanRecords,
  reorderDayItems,
  restoreItineraryItemDeletion,
  listTrips,
  saveTicketBlob,
  updateTicketMeta,
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

  it('reorders a complete day atomically and rejects stale or duplicate orders', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const first = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'First', sortOrder: 1, ticketIds: [] })
    const second = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Second', sortOrder: 2, ticketIds: [] })
    const third = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Third', sortOrder: 3, ticketIds: [] })

    const changed = await reorderDayItems(day.id, [third.id, first.id, second.id])

    expect(changed).toHaveLength(3)
    await expect(listItemsByDay(day.id)).resolves.toMatchObject([
      { id: third.id, sortOrder: 1 },
      { id: first.id, sortOrder: 2 },
      { id: second.id, sortOrder: 3 },
    ])
    await expect(reorderDayItems(day.id, [third.id, third.id, second.id])).rejects.toThrow('重复行程点')
    await expect(reorderDayItems(day.id, [third.id, first.id])).rejects.toThrow('当前行程不一致')
    await expect(reorderDayItems(
      day.id,
      [first.id, second.id, third.id],
      [first.id, second.id, third.id],
    )).rejects.toThrow('已在其他位置更新')
    await expect(listItemsByDay(day.id)).resolves.toMatchObject([
      { id: third.id, sortOrder: 1 },
      { id: first.id, sortOrder: 2 },
      { id: second.id, sortOrder: 3 },
    ])
  })

  it('moves an item between days atomically and rejects either stale day baseline', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const firstDay = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const secondDay = await createDay({ tripId: trip.id, date: '2025-04-02', title: 'Day 2', sortOrder: 2 })
    const sourceFirst = await createItineraryItem({ tripId: trip.id, dayId: firstDay.id, title: 'Source first', sortOrder: 1, ticketIds: [] })
    const target = await createItineraryItem({
      dayId: firstDay.id,
      executionState: { status: 'completed', updatedAt: 1 },
      sortOrder: 2,
      ticketIds: [],
      title: 'Target',
      tripId: trip.id,
    })
    const sourceLast = await createItineraryItem({ tripId: trip.id, dayId: firstDay.id, title: 'Source last', sortOrder: 3, ticketIds: [] })
    const destinationFirst = await createItineraryItem({ tripId: trip.id, dayId: secondDay.id, title: 'Destination first', sortOrder: 1, ticketIds: [] })
    const destinationLast = await createItineraryItem({ tripId: trip.id, dayId: secondDay.id, title: 'Destination last', sortOrder: 2, ticketIds: [] })
    const sourceBaseline = [sourceFirst.id, target.id, sourceLast.id]
    const destinationBaseline = [destinationFirst.id, destinationLast.id]
    const nextDestination = [destinationFirst.id, target.id, destinationLast.id]

    await expect(moveItineraryItemBetweenDays(
      target.id,
      secondDay.id,
      nextDestination,
      {
        expectedDestinationItemIds: destinationBaseline,
        expectedSourceItemIds: [target.id, sourceFirst.id, sourceLast.id],
        sourceDayId: firstDay.id,
      },
    )).rejects.toThrow('来源日期行程已变化')
    await expect(moveItineraryItemBetweenDays(
      target.id,
      secondDay.id,
      nextDestination,
      {
        expectedDestinationItemIds: [destinationLast.id, destinationFirst.id],
        expectedSourceItemIds: sourceBaseline,
        sourceDayId: firstDay.id,
      },
    )).rejects.toThrow('目标日期行程已变化')

    const result = await moveItineraryItemBetweenDays(
      target.id,
      secondDay.id,
      nextDestination,
      {
        expectedDestinationItemIds: destinationBaseline,
        expectedSourceItemIds: sourceBaseline,
        sourceDayId: firstDay.id,
      },
    )

    expect(result.changedItems.map((item) => item.id).sort()).toEqual(
      [target.id, sourceLast.id, destinationLast.id].sort(),
    )
    await expect(listItemsByDay(firstDay.id)).resolves.toMatchObject([
      { id: sourceFirst.id, sortOrder: 1 },
      { id: sourceLast.id, sortOrder: 2 },
    ])
    await expect(listItemsByDay(secondDay.id)).resolves.toMatchObject([
      { id: destinationFirst.id, sortOrder: 1 },
      { dayId: secondDay.id, id: target.id, sortOrder: 2 },
      { id: destinationLast.id, sortOrder: 3 },
    ])
    await expect(getItineraryItem(target.id)).resolves.toMatchObject({
      dayId: secondDay.id,
      executionState: undefined,
    })
  })

  it('rejects a prepared reorder after any sibling changes without a partial write', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const first = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'First', sortOrder: 1, ticketIds: [] })
    const second = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Second', sortOrder: 2, ticketIds: [] })
    const plan = await prepareDayItemsReorder(
      day.id,
      [second.id, first.id],
      [first.id, second.id],
      50,
    )
    await updateItineraryItem(first.id, { title: 'Changed elsewhere' })

    await expect(applyDayItemsReorderPlan(plan)).rejects.toThrow('当天顺序已在其他位置更新')
    await expect(listItemsByDay(day.id)).resolves.toMatchObject([
      { id: first.id, sortOrder: 1, title: 'Changed elsewhere' },
      { id: second.id, sortOrder: 2, title: 'Second' },
    ])
  })

  it('rejects a prepared reorder after the owning day changes', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const first = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'First', sortOrder: 1, ticketIds: [] })
    const second = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Second', sortOrder: 2, ticketIds: [] })
    const plan = await prepareDayItemsReorder(
      day.id,
      [second.id, first.id],
      [first.id, second.id],
      50,
    )
    await updateDay(day.id, { title: 'Changed day' })

    await expect(applyDayItemsReorderPlan(plan)).rejects.toThrow('当天顺序已在其他位置更新')
    await expect(listItemsByDay(day.id)).resolves.toMatchObject([
      { id: first.id, sortOrder: 1 },
      { id: second.id, sortOrder: 2 },
    ])
  })

  it('rejects a prepared cross-day move after a destination sibling changes', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const sourceDay = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const destinationDay = await createDay({ tripId: trip.id, date: '2025-04-02', title: 'Day 2', sortOrder: 2 })
    const target = await createItineraryItem({ tripId: trip.id, dayId: sourceDay.id, title: 'Target', sortOrder: 1, ticketIds: [] })
    const destination = await createItineraryItem({ tripId: trip.id, dayId: destinationDay.id, title: 'Destination', sortOrder: 1, ticketIds: [] })
    const plan = await prepareItineraryItemMove(
      target.id,
      destinationDay.id,
      [destination.id, target.id],
      {
        expectedDestinationItemIds: [destination.id],
        expectedSourceItemIds: [target.id],
        sourceDayId: sourceDay.id,
      },
      50,
    )
    await updateItineraryItem(destination.id, { title: 'Changed elsewhere' })

    await expect(applyItineraryItemMovePlan(plan)).rejects.toThrow(
      '来源日期或目标日期行程已变化',
    )
    await expect(getItineraryItem(target.id)).resolves.toMatchObject({
      dayId: sourceDay.id,
      sortOrder: 1,
    })
    await expect(getItineraryItem(destination.id)).resolves.toMatchObject({
      dayId: destinationDay.id,
      sortOrder: 1,
      title: 'Changed elsewhere',
    })
  })

  it('rejects a prepared cross-day move after either day changes', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const sourceDay = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const destinationDay = await createDay({ tripId: trip.id, date: '2025-04-02', title: 'Day 2', sortOrder: 2 })
    const target = await createItineraryItem({ tripId: trip.id, dayId: sourceDay.id, title: 'Target', sortOrder: 1, ticketIds: [] })
    const destination = await createItineraryItem({ tripId: trip.id, dayId: destinationDay.id, title: 'Destination', sortOrder: 1, ticketIds: [] })
    const plan = await prepareItineraryItemMove(
      target.id,
      destinationDay.id,
      [destination.id, target.id],
      {
        expectedDestinationItemIds: [destination.id],
        expectedSourceItemIds: [target.id],
        sourceDayId: sourceDay.id,
      },
      50,
    )
    await updateDay(destinationDay.id, { title: 'Changed destination' })

    await expect(applyItineraryItemMovePlan(plan)).rejects.toThrow(
      '来源日期或目标日期行程已变化',
    )
    await expect(getItineraryItem(target.id)).resolves.toMatchObject({
      dayId: sourceDay.id,
      sortOrder: 1,
    })
    await expect(getItineraryItem(destination.id)).resolves.toMatchObject({
      dayId: destinationDay.id,
      sortOrder: 1,
    })
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

  it('updates ticket metadata and atomically rebinds item references', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const first = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    const second = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'B', sortOrder: 2, ticketIds: [] })
    const ticket = await createTicketMeta({
      tripId: trip.id,
      itemId: first.id,
      scope: 'item',
      title: '旧票据',
      fileName: 'a.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 1,
    })
    await updateItineraryItem(first.id, { ticketIds: [ticket.id] })

    const rebound = await updateTicketMeta(ticket.id, {
      itemId: second.id,
      note: '改到第二站',
      scope: 'item',
      structuredFields: {
        entryTime: '09:30',
        fieldEvidence: {
          entryTime: { confidence: 'high', sourceType: 'manual' },
          serviceDate: { confidence: 'high', sourceType: 'ticket' },
        },
        schemaVersion: 1,
        serviceDate: '2025-04-02',
        status: 'ready',
      },
      ticketCategory: 'train_ticket',
      title: '新票据',
    })

    expect(rebound?.ticket).toMatchObject({
      id: ticket.id,
      itemId: second.id,
      note: '改到第二站',
      scope: 'item',
      structuredFields: {
        entryTime: '09:30',
        schemaVersion: 1,
        serviceDate: '2025-04-02',
        status: 'ready',
      },
      ticketCategory: 'train_ticket',
      title: '新票据',
    })
    await expect(getItineraryItem(first.id)).resolves.toMatchObject({ ticketIds: [] })
    await expect(getItineraryItem(second.id)).resolves.toMatchObject({ ticketIds: [ticket.id] })

    const unassigned = await updateTicketMeta(ticket.id, {
      note: undefined,
      scope: 'unassigned',
      ticketCategory: 'other',
      title: undefined,
    })
    expect(unassigned?.ticket.itemId).toBeUndefined()
    expect(unassigned?.ticket.note).toBeUndefined()
    expect(unassigned?.ticket.title).toBeUndefined()
    expect(unassigned?.ticket).toMatchObject({
      id: ticket.id,
      scope: 'unassigned',
      ticketCategory: 'other',
    })
    expect((await getTicketMeta(ticket.id))?.structuredFields).toMatchObject({
      entryTime: '09:30',
      schemaVersion: 1,
      serviceDate: '2025-04-02',
      status: 'ready',
    })
    await expect(getItineraryItem(second.id)).resolves.toMatchObject({ ticketIds: [] })

    await updateTicketMeta(ticket.id, {
      scope: 'unassigned',
      structuredFields: undefined,
    })
    expect((await getTicketMeta(ticket.id))?.structuredFields).toBeUndefined()
  })

  it('treats a legacy item without ticketIds as an empty relationship list', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Legacy', sortOrder: 1, ticketIds: [] })
    const ticket = await createTicketMeta({
      fileName: 'legacy.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 1,
      tripId: trip.id,
    })
    await db.itineraryItems.put({ ...item, ticketIds: undefined as never })
    await expect(db.itineraryItems.get(item.id)).resolves.toMatchObject({ ticketIds: undefined })

    await expect(updateTicketMeta(ticket.id, {
      itemId: item.id,
      scope: 'item',
    })).resolves.toMatchObject({
      changedItems: [{ id: item.id, ticketIds: [ticket.id] }],
      ticket: { itemId: item.id, scope: 'item' },
    })
  })

  it('rejects ticket rebinds to items outside the ticket trip without mutating metadata', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const otherTrip = await createTrip({ title: 'Other', destination: 'B', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: otherTrip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const otherItem = await createItineraryItem({ tripId: otherTrip.id, dayId: day.id, title: 'Other item', sortOrder: 1, ticketIds: [] })
    const ticket = await createTicketMeta({
      tripId: trip.id,
      scope: 'trip',
      title: '机票',
      fileName: 'flight.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 1,
    })

    await expect(updateTicketMeta(ticket.id, {
      itemId: otherItem.id,
      scope: 'item',
      ticketCategory: 'flight_ticket',
      title: '不应保存',
    })).rejects.toThrow('绑定的行程点不存在')

    const unchanged = await getTicketMeta(ticket.id)
    expect(unchanged?.itemId).toBeUndefined()
    expect(unchanged).toMatchObject({
      scope: 'trip',
      title: '机票',
    })
    await expect(getItineraryItem(otherItem.id)).resolves.toMatchObject({ ticketIds: [] })
  })

  it('rejects a stale ticket binding baseline without changing either side', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    const ticket = await createTicketMeta({
      fileName: 'a.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 1,
      title: 'A ticket',
      tripId: trip.id,
    })
    await updateTicketMeta(ticket.id, {
      scope: 'unassigned',
      title: 'User changed title',
    })
    await db.ticketMetas.update(ticket.id, { updatedAt: ticket.updatedAt + 100 })

    await expect(updateTicketMeta(ticket.id, {
      expectedBinding: {
        itemId: undefined,
        targetItem: {
          id: item.id,
          ticketIds: [...item.ticketIds],
          updatedAt: item.updatedAt,
        },
        ticketUpdatedAt: ticket.updatedAt,
      },
      itemId: item.id,
      scope: 'item',
      title: ticket.title,
    })).rejects.toThrow('票据绑定已变化')
    await expect(getTicketMeta(ticket.id)).resolves.toMatchObject({
      itemId: undefined,
      scope: 'unassigned',
      title: 'User changed title',
    })
    await expect(getItineraryItem(item.id)).resolves.toMatchObject({ ticketIds: [] })
  })

  it('rejects a stale target-item binding baseline without changing the ticket', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    const ticket = await createTicketMeta({
      fileName: 'a.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 1,
      title: 'A ticket',
      tripId: trip.id,
    })
    await db.itineraryItems.update(item.id, {
      ticketIds: ['ticket-added-elsewhere'],
      updatedAt: item.updatedAt + 100,
    })

    await expect(updateTicketMeta(ticket.id, {
      expectedBinding: {
        itemId: undefined,
        targetItem: {
          id: item.id,
          ticketIds: [...item.ticketIds],
          updatedAt: item.updatedAt,
        },
        ticketUpdatedAt: ticket.updatedAt,
      },
      itemId: item.id,
      scope: 'item',
      title: ticket.title,
    })).rejects.toThrow('票据关联目标已变化')
    const unchangedTicket = await getTicketMeta(ticket.id)
    expect(unchangedTicket?.itemId).toBeUndefined()
    expect(unchangedTicket?.scope).toBe('unassigned')
    await expect(getItineraryItem(item.id)).resolves.toMatchObject({ ticketIds: ['ticket-added-elsewhere'] })
  })

  it('rejects a prepared rebind when a hidden reverse link appears before commit', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const first = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 1, ticketIds: [] })
    const second = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'B', sortOrder: 2, ticketIds: [] })
    const hidden = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'C', sortOrder: 3, ticketIds: [] })
    const ticket = await createTicketMeta({
      tripId: trip.id,
      itemId: first.id,
      scope: 'item',
      fileName: 'a.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 1,
    })
    await updateItineraryItem(first.id, { ticketIds: [ticket.id] })
    const plan = await prepareTicketMetaUpdate(ticket.id, {
      itemId: second.id,
      scope: 'item',
      title: 'Rebound',
    })
    if (!plan) throw new Error('Missing Ticket update plan.')
    await updateItineraryItem(hidden.id, { ticketIds: [ticket.id] })

    await expect(applyTicketMetaUpdatePlan(plan)).rejects.toThrow('票据关联目标已变化')

    await expect(getTicketMeta(ticket.id)).resolves.toMatchObject({ itemId: first.id, scope: 'item' })
    await expect(getItineraryItem(first.id)).resolves.toMatchObject({ ticketIds: [ticket.id] })
    await expect(getItineraryItem(second.id)).resolves.toMatchObject({ ticketIds: [] })
    await expect(getItineraryItem(hidden.id)).resolves.toMatchObject({ ticketIds: [ticket.id] })
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

  it('deleteItineraryItemReversible removes only the item and preserves its ticket', async () => {
    const trip = await createTrip({ title: 'Trip', destination: 'A', startDate: '2025-04-01', endDate: '2025-04-03' })
    const day = await createDay({ tripId: trip.id, date: '2025-04-01', title: 'Day 1', sortOrder: 1 })
    const first = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'First', sortOrder: 1, ticketIds: [] })
    const item = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'A', sortOrder: 2, ticketIds: [] })
    const last = await createItineraryItem({ tripId: trip.id, dayId: day.id, title: 'Last', sortOrder: 3, ticketIds: [] })
    const ticket = await createTicketMeta({ tripId: trip.id, itemId: item.id, fileName: 'a.pdf', fileType: 'pdf', mimeType: 'application/pdf', size: 1 })
    await saveTicketBlob(ticket.id, new Blob(['test']))

    const result = await deleteItineraryItemReversible(item.id, {
      expectedCurrentItemIds: [first.id, item.id, last.id],
      expectedItemUpdatedAt: item.updatedAt,
      operationFingerprint: 'test-item-delete',
      operationRecordId: 'replan-record-delete',
      tripId: trip.id,
    })

    expect(await getItineraryItem(item.id)).toBeUndefined()
    expect(await getTicketMeta(ticket.id)).toMatchObject({ id: ticket.id, itemId: item.id })
    expect(await getTicketBlob(ticket.id)).toBeDefined()
    expect((await listItemsByDay(day.id)).map((entry) => [entry.title, entry.sortOrder])).toEqual([
      ['First', 1],
      ['Last', 2],
    ])
    expect(result).toMatchObject({
      deleted: true,
      operationRecord: {
        id: 'replan-record-delete',
        operationFingerprint: 'test-item-delete',
        operationKind: 'item_delete',
        scopeItemIds: [first.id, item.id, last.id],
        status: 'applied',
      },
    })
    expect(result?.operationRecord.beforeSnapshot.items).toHaveLength(3)
    expect(result?.operationRecord.afterSnapshot?.items).toHaveLength(2)

    const restored = await restoreItineraryItemDeletion('replan-record-delete', {
      expectedAppliedFingerprint: result?.operationRecord.appliedFingerprint,
      tripId: trip.id,
    })

    expect(restored).toMatchObject({
      restored: true,
      restoredItem: { id: item.id, title: 'A' },
      operationRecord: { status: 'undone' },
    })
    expect((await listItemsByDay(day.id)).map((entry) => [entry.title, entry.sortOrder])).toEqual([
      ['First', 1],
      ['A', 2],
      ['Last', 3],
    ])
    expect(await getTicketMeta(ticket.id)).toMatchObject({ id: ticket.id, itemId: item.id })
    expect(await getTicketBlob(ticket.id)).toBeDefined()
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

  it('rejects orphaned references before creating any record', async () => {
    const now = Date.now()
    await expect(importTripPlanRecords({
      days: [],
      itineraryItems: [{
        createdAt: now,
        dayId: 'missing-day',
        id: 'orphan-item',
        sortOrder: 0,
        ticketIds: [],
        title: 'Orphan',
        tripId: 'invalid-import',
        updatedAt: now,
      }],
      ticketBlobs: [],
      ticketMetas: [],
      trip: {
        createdAt: now,
        destination: 'A',
        endDate: '2026-08-11',
        id: 'invalid-import',
        startDate: '2026-08-11',
        title: 'Invalid',
        updatedAt: now,
      },
    })).rejects.toThrow('未导入的日期')
    await expect(getTrip('invalid-import')).resolves.toBeUndefined()
  })

  it('rechecks the empty trip baseline inside the import transaction', async () => {
    const now = Date.now()
    const input = {
      days: [{ date: '2026-08-11', id: 'planned-day', sortOrder: 0, title: 'Day 1', tripId: 'planned-trip' }],
      itineraryItems: [],
      ticketBlobs: [],
      ticketMetas: [],
      trip: {
        createdAt: now,
        destination: 'A',
        endDate: '2026-08-11',
        id: 'planned-trip',
        startDate: '2026-08-11',
        title: 'Planned',
        updatedAt: now,
      },
    }
    const plan = await prepareTripPlanImport(input)
    await db.tripIntelligenceSuggestionStates.add({
      createdAt: now,
      id: 'concurrent-suggestion',
      status: 'later',
      suggestionKey: 'concurrent-suggestion',
      tripId: input.trip.id,
      updatedAt: now,
    })

    await expect(applyTripPlanImportPlan(plan)).rejects.toThrow('旅行数据已变化')
    await expect(getTrip(input.trip.id)).resolves.toBeUndefined()
    await expect(getDay('planned-day')).resolves.toBeUndefined()
    await expect(db.tripIntelligenceSuggestionStates.get('concurrent-suggestion')).resolves.toBeDefined()
  })

  it('rejects a prepared import whose graph changed before apply', async () => {
    const now = Date.now()
    const plan = await prepareTripPlanImport({
      days: [],
      itineraryItems: [],
      ticketBlobs: [],
      ticketMetas: [],
      trip: {
        createdAt: now,
        destination: 'A',
        endDate: '2026-08-11',
        id: 'stale-import',
        startDate: '2026-08-11',
        title: 'Prepared',
        updatedAt: now,
      },
    })
    plan.trip.title = 'Changed after preview'

    await expect(applyTripPlanImportPlan(plan)).rejects.toThrow('导入计划已变化')
    await expect(getTrip(plan.trip.id)).resolves.toBeUndefined()
  })
})

describe('replaceTripPlanRecords', () => {
  it('replaces an existing trip graph in place without changing ids', async () => {
    const trip = await createTrip({
      destination: 'Tokyo',
      endDate: '2025-05-02',
      startDate: '2025-05-01',
      title: 'Old title',
    })
    const oldDay = await createDay({
      date: '2025-05-01',
      sortOrder: 1,
      title: 'Old day',
      tripId: trip.id,
    })
    const oldItem = await createItineraryItem({
      dayId: oldDay.id,
      sortOrder: 1,
      ticketIds: [],
      title: 'Old item',
      tripId: trip.id,
    })

    const result = await replaceTripPlanRecords({
      days: [
        {
          date: '2025-05-01',
          id: 'cloud-day',
          sortOrder: 1,
          title: 'Cloud day',
          tripId: trip.id,
        },
      ],
      itineraryItems: [
        {
          createdAt: 300,
          dayId: 'cloud-day',
          id: 'cloud-item',
          sortOrder: 1,
          ticketIds: ['cloud-ticket'],
          title: 'Cloud item',
          tripId: trip.id,
          updatedAt: 300,
        },
      ],
      ticketBlobs: [{ blob: new Blob(['pdf'], { type: 'application/pdf' }), ticketId: 'cloud-ticket' }],
      ticketMetas: [
        {
          createdAt: 300,
          fileName: 'cloud.pdf',
          fileType: 'pdf',
          id: 'cloud-ticket',
          itemId: 'cloud-item',
          mimeType: 'application/pdf',
          size: 3,
          storageMode: 'copy',
          title: 'Cloud ticket',
          tripId: trip.id,
          updatedAt: 300,
        },
      ],
      trip: {
        ...trip,
        title: 'Cloud title',
        updatedAt: 300,
      },
    })

    expect(result.tripId).toBe(trip.id)
    expect((await getTrip(trip.id))?.title).toBe('Cloud title')
    expect(await getDay(oldDay.id)).toBeUndefined()
    expect(await getItineraryItem(oldItem.id)).toBeUndefined()
    expect(await getDay('cloud-day')).toBeTruthy()
    expect(await getItineraryItem('cloud-item')).toBeTruthy()
    expect(await getTicketMeta('cloud-ticket')).toBeTruthy()
    expect(await getTicketBlob('cloud-ticket')).toBeTruthy()
  })

  it('rejects incoming record ids that belong to another local trip', async () => {
    const first = await createTrip({
      destination: 'Tokyo',
      endDate: '2025-05-02',
      startDate: '2025-05-01',
      title: 'First',
    })
    const second = await createTrip({
      destination: 'Kyoto',
      endDate: '2025-05-04',
      startDate: '2025-05-03',
      title: 'Second',
    })
    const foreignDay = await createDay({
      date: '2025-05-03',
      sortOrder: 1,
      title: 'Foreign',
      tripId: second.id,
    })

    await expect(
      replaceTripPlanRecords({
        days: [{ ...foreignDay, tripId: first.id }],
        itineraryItems: [],
        ticketBlobs: [],
        ticketMetas: [],
        trip: first,
      }),
    ).rejects.toThrow('记录 ID 与其他本地旅行冲突')
  })
})
