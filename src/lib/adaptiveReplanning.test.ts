import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDay,
  createItineraryItem,
  createTicketMeta,
  createTrip,
  createTripDisruptionEvent,
  db,
  getItineraryItem,
  updateItineraryItem,
} from '../db'
import { createLedgerExpense } from '../db/ledgerTrackedMutations'
import {
  applyTripReplanOption,
  buildTripReplanPreview,
  classifyReplanItem,
  createTripReplanPreviewForEvent,
  undoTripReplan,
} from './adaptiveReplanning'
import type { Day, ItineraryItem, Trip, TripDisruptionEvent } from '../types'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('adaptive replanning', () => {
  it('classifies fixed, movable, and optional itinerary items', async () => {
    const seed = await seedTrip()
    const fixedTicket = await createTicketMeta({
      fileName: 'train.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 10,
      ticketCategory: 'train_ticket',
      tripId: seed.trip.id,
      itemId: seed.fixed.id,
    })

    expect(classifyReplanItem(seed.fixed, [fixedTicket]).flexibility).toBe('fixed')
    expect(classifyReplanItem(seed.movable, []).flexibility).toBe('movable')
    expect(classifyReplanItem(seed.optional, []).flexibility).toBe('optional')
  })

  it('generates three options with time, ticket, ledger, and companion impacts', async () => {
    const seed = await seedTrip()
    const event = disruption(seed.trip, seed.day, seed.movable, { delayMinutes: 45, kind: 'late' })
    const preview = buildTripReplanPreview({
      days: [seed.day],
      event,
      items: [seed.fixed, seed.movable, seed.optional],
      ledgerExpenses: [await createLedgerExpense({
        amountMinor: 1000,
        category: 'admission',
        currency: 'JPY',
        date: seed.day.date,
        itemIds: [seed.movable.id],
        source: { kind: 'manual' },
        splitMode: 'equal',
        splitShares: [],
        status: 'confirmed',
        title: '门票',
        tripId: seed.trip.id,
      })],
      tickets: [await createTicketMeta({
        fileName: 'museum.pdf',
        fileType: 'pdf',
        mimeType: 'application/pdf',
        size: 10,
        ticketCategory: 'admission_ticket',
        tripId: seed.trip.id,
        itemId: seed.movable.id,
      })],
      trip: seed.trip,
    })

    expect(preview.options.map((option) => option.strategy)).toEqual(['least_change', 'preserve_most', 'shortest_route'])
    const leastChange = preview.options[0]
    expect(leastChange.itemPatches.find((patch) => patch.itemId === seed.movable.id)?.patch.startTime).toBe('11:45')
    expect(leastChange.diff.ticketImpacts[0].impact).toBe('time_warning')
    expect(leastChange.diff.ledgerImpacts[0].impact).toBe('review_needed')
    expect(leastChange.diff.companionImpacts[0].summary).toContain('集合时间更新')
  })

  it('applies and undoes a whole replan transaction', async () => {
    const seed = await seedTrip()
    const event = await createTripDisruptionEvent({
      dayId: seed.day.id,
      delayMinutes: 30,
      evidence: [],
      itemId: seed.movable.id,
      kind: 'late',
      occurredAt: '2026-06-13T02:00:00.000Z',
      reportedByRole: 'owner',
      status: 'reported',
      tripId: seed.trip.id,
    })
    const record = await createTripReplanPreviewForEvent(event.id)
    const applied = await applyTripReplanOption(record.id, record.options[0].id)

    expect(applied.status).toBe('applied')
    expect((await getItineraryItem(seed.movable.id))?.startTime).toBe('11:30')

    const undone = await undoTripReplan(record.id)

    expect(undone.status).toBe('undone')
    expect((await getItineraryItem(seed.movable.id))?.startTime).toBe('11:00')
  })

  it('blocks stale apply when affected itinerary changed after preview', async () => {
    const seed = await seedTrip()
    const event = await createTripDisruptionEvent({
      dayId: seed.day.id,
      delayMinutes: 30,
      evidence: [],
      itemId: seed.movable.id,
      kind: 'late',
      occurredAt: '2026-06-13T02:00:00.000Z',
      reportedByRole: 'owner',
      status: 'reported',
      tripId: seed.trip.id,
    })
    const record = await createTripReplanPreviewForEvent(event.id)
    await updateItineraryItem(seed.movable.id, { title: '用户已改名' })

    await expect(applyTripReplanOption(record.id, record.options[0].id)).rejects.toThrow('行程已变化')
  })
})

async function seedTrip() {
  const trip = await createTrip({ destination: '东京', endDate: '2026-06-13', startDate: '2026-06-13', title: '东京' })
  const day = await createDay({ date: '2026-06-13', sortOrder: 1, title: '第一天', tripId: trip.id })
  const fixed = await createItineraryItem(itemInput(trip, day, {
    replanPreference: { flexibility: 'fixed', priority: 'must_keep' },
    sortOrder: 1,
    startTime: '09:00',
    title: '固定预约',
  }))
  const movable = await createItineraryItem(itemInput(trip, day, {
    lat: 35.2,
    lng: 139.2,
    sortOrder: 2,
    startTime: '11:00',
    endTime: '12:00',
    title: '博物馆',
  }))
  const optional = await createItineraryItem(itemInput(trip, day, {
    replanPreference: { flexibility: 'optional', priority: 'low' },
    sortOrder: 3,
    startTime: '13:00',
    title: '商店',
  }))
  return { day, fixed, movable, optional, trip }
}

function itemInput(
  trip: Trip,
  day: Day,
  input: Partial<ItineraryItem> & { sortOrder: number; title: string },
): Omit<ItineraryItem, 'createdAt' | 'id' | 'updatedAt'> {
  return {
    dayId: day.id,
    ticketIds: [],
    tripId: trip.id,
    ...input,
  }
}

function disruption(
  trip: Trip,
  day: Day,
  item: ItineraryItem,
  input: Partial<TripDisruptionEvent>,
): TripDisruptionEvent {
  return {
    createdAt: 1,
    evidence: [],
    id: 'event_1',
    itemId: item.id,
    occurredAt: '2026-06-13T02:00:00.000Z',
    reportedByRole: 'owner',
    status: 'reported',
    tripId: trip.id,
    updatedAt: 1,
    dayId: day.id,
    kind: 'late',
    ...input,
  }
}
