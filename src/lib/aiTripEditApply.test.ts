import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/database'
import {
  createDay,
  createItineraryItem,
  createTicketMeta,
  createTrip,
  getItineraryItem,
  getTicketMeta,
  getTrip,
  listItemsByDay,
  updateItineraryItem,
} from '../db/repositories'
import { applyAiTripEditPatchPlanToDb } from './aiTripEditApply'
import type { AiTripEditPatchPlan } from './aiTripEditPatch'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('applyAiTripEditPatchPlanToDb', () => {
  it('transactionally updates, moves, deletes, and adds safe items', async () => {
    const seed = await seedTrip()
    const plan: AiTripEditPatchPlan = {
      operations: [
        { changes: { title: '西湖深度散步' }, itemId: seed.item1.id, type: 'update_item' },
        { itemId: seed.item2.id, targetDayId: seed.day2.id, targetStartTime: '15:00', type: 'move_item' },
        { itemId: seed.item3.id, type: 'delete_item' },
        { item: { endTime: '16:30', startTime: '16:00', title: '咖啡休息' }, targetDayId: seed.day2.id, type: 'add_item' },
      ],
      summary: '调整行程',
    }

    const result = await applyAiTripEditPatchPlanToDb(seed.trip.id, plan, { now: 12345 })

    expect(result.ok).toBe(true)
    expect((await getItineraryItem(seed.item1.id))?.title).toBe('西湖深度散步')
    expect((await getItineraryItem(seed.item2.id))?.dayId).toBe(seed.day2.id)
    expect((await getItineraryItem(seed.item2.id))?.startTime).toBe('15:00')
    expect(await getItineraryItem(seed.item3.id)).toBeUndefined()
    const day2Items = await listItemsByDay(seed.day2.id)
    expect(day2Items.map((item) => item.title)).toContain('咖啡休息')
    expect(day2Items.find((item) => item.title === '咖啡休息')?.ticketIds).toEqual([])
    expect((await getTrip(seed.trip.id))?.updatedAt).toBe(12345)
  })

  it('refuses ticket-bound deletes and leaves earlier operations unwritten', async () => {
    const seed = await seedTrip()
    const ticket = await createTicketMeta({
      fileName: 'ticket.pdf',
      fileType: 'pdf',
      itemId: seed.item3.id,
      mimeType: 'application/pdf',
      size: 1,
      tripId: seed.trip.id,
    })
    await updateItineraryItem(seed.item3.id, { ticketIds: [ticket.id] })

    const result = await applyAiTripEditPatchPlanToDb(seed.trip.id, {
      operations: [
        { changes: { title: '不应写入' }, itemId: seed.item1.id, type: 'update_item' },
        { itemId: seed.item3.id, type: 'delete_item' },
      ],
      summary: '尝试删除票据项目',
    }, { now: 12345 })

    expect(result.ok).toBe(false)
    expect((await getItineraryItem(seed.item1.id))?.title).toBe('西湖')
    expect((await getItineraryItem(seed.item3.id))?.ticketIds).toEqual([ticket.id])
    expect(await getTicketMeta(ticket.id)).toBeTruthy()
  })
})

async function seedTrip() {
  const trip = await createTrip({
    destination: '杭州',
    endDate: '2026-07-11',
    startDate: '2026-07-10',
    title: '杭州两日',
  })
  const day1 = await createDay({ date: '2026-07-10', sortOrder: 1, title: '第一天', tripId: trip.id })
  const day2 = await createDay({ date: '2026-07-11', sortOrder: 2, title: '第二天', tripId: trip.id })
  const item1 = await createItineraryItem({ dayId: day1.id, sortOrder: 1, ticketIds: [], title: '西湖', tripId: trip.id })
  const item2 = await createItineraryItem({ dayId: day1.id, sortOrder: 2, ticketIds: [], title: '灵隐寺', tripId: trip.id })
  const item3 = await createItineraryItem({ dayId: day1.id, sortOrder: 3, ticketIds: [], title: '商场', tripId: trip.id })
  return { day1, day2, item1, item2, item3, trip }
}
