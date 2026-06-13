import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import {
  createDay,
  createItineraryItem,
  createTicketMeta,
  createTrip,
  getDay,
  getItineraryItem,
  getTicketMeta,
  getTrip,
  listDaysByTrip,
  listItemsByDay,
  listItemsByTrip,
  updateItineraryItem,
} from '../../db/repositories'
import {
  applyAiTripEditPatchPlanToDb,
  buildAiTripEditApplyPayload,
  buildAiTripEditLocalStateFingerprint,
} from './aiTripEditApply'
import { buildAiTripEditContext } from './aiTripEditContext'
import {
  getTripAutoSnapshotStatus,
  resetAutoSnapshotBackupForTests,
} from '../autoSnapshotBackup'
import type { AiTripEditPatchPlan } from './aiTripEditPatch'

beforeEach(async () => {
  resetAutoSnapshotBackupForTests()
  await db.delete()
  await db.open()
})

describe('applyAiTripEditPatchPlanToDb', () => {
  it('transactionally updates, moves, removes, adds, reorders, and updates day titles', async () => {
    const seed = await seedTrip()
    const beforeFingerprint = buildAiTripEditLocalStateFingerprint({
      days: await listDaysByTrip(seed.trip.id),
      items: await listItemsByTrip(seed.trip.id),
      trip: seed.trip,
    })
    const plan: AiTripEditPatchPlan = {
      operations: [
        { itemId: seed.item1.id, reason: '调整标题。', title: '西湖深度散步', type: 'update_item_title' },
        { itemId: seed.item1.id, reason: '调整时间。', startTime: '09:30', type: 'update_item_time' },
        { address: '西湖区', itemId: seed.item1.id, locationName: '西湖景区', reason: '补充地点。', type: 'update_item_location_text' },
        { itemId: seed.item1.id, note: '记得慢慢走。', reason: '补充备注。', type: 'update_item_note' },
        { itemId: seed.item1.id, previousTransportDurationMinutes: 15, previousTransportMode: 'walk', reason: '补充交通。', type: 'update_item_transport' },
        { itemId: seed.item2.id, reason: '移到第二天。', targetDayId: seed.day2.id, targetStartTime: '15:00', type: 'move_item' },
        { itemId: seed.item3.id, reason: '减少密度。', type: 'remove_item' },
        { item: { endTime: '16:30', startTime: '16:00', title: '咖啡休息' }, reason: '增加休息。', targetDayId: seed.day2.id, type: 'add_item' },
        { dayId: seed.day2.id, reason: '调整标题。', title: '轻松第二天', type: 'update_day_title' },
      ],
      summary: '调整行程',
    }

    const result = await applyAiTripEditPatchPlanToDb(seed.trip.id, plan, {
      expectedBaselineFingerprint: beforeFingerprint,
      now: 12345,
    })

    expect(result.ok).toBe(true)
    expect((await getItineraryItem(seed.item1.id))?.title).toBe('西湖深度散步')
    expect((await getItineraryItem(seed.item1.id))?.startTime).toBe('09:30')
    expect((await getItineraryItem(seed.item1.id))?.locationName).toBe('西湖景区')
    expect((await getItineraryItem(seed.item1.id))?.notes).toBe('记得慢慢走。')
    expect((await getItineraryItem(seed.item1.id))?.previousTransportMode).toBe('walk')
    expect((await getItineraryItem(seed.item2.id))?.dayId).toBe(seed.day2.id)
    expect((await getItineraryItem(seed.item2.id))?.startTime).toBe('15:00')
    expect(await getItineraryItem(seed.item3.id)).toBeUndefined()
    expect((await getDay(seed.day2.id))?.title).toBe('轻松第二天')
    const day2Items = await listItemsByDay(seed.day2.id)
    expect(day2Items.map((item) => item.title)).toContain('咖啡休息')
    expect(day2Items.find((item) => item.title === '咖啡休息')?.id).toMatch(/^item_/)
    expect(day2Items.find((item) => item.title === '咖啡休息')?.ticketIds).toEqual([])
    expect(day2Items.map((item) => item.sortOrder)).toEqual([1, 2])
    expect((await getTrip(seed.trip.id))?.updatedAt).toBe(12345)
    expect(getTripAutoSnapshotStatus(seed.trip.id)?.reason).toBe('ai-trip-edit-applied')
  })

  it('reorders a day while preserving item IDs and normalized sortOrder', async () => {
    const seed = await seedTrip()

    const result = await applyAiTripEditPatchPlanToDb(seed.trip.id, {
      operations: [{
        dayId: seed.day1.id,
        orderedItemIds: [seed.item3.id, seed.item2.id, seed.item1.id],
        reason: '调整顺序。',
        type: 'reorder_day_items',
      }],
      summary: '调整顺序',
    }, { now: 12345 })

    expect(result.ok).toBe(true)
    const day1Items = await listItemsByDay(seed.day1.id)
    expect(day1Items.map((item) => item.id)).toEqual([seed.item3.id, seed.item2.id, seed.item1.id])
    expect(day1Items.map((item) => item.sortOrder)).toEqual([1, 2, 3])
  })

  it('refuses ticket-bound removes and leaves earlier operations unwritten', async () => {
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
        { itemId: seed.item1.id, reason: '不应写入。', title: '不应写入', type: 'update_item_title' },
        { itemId: seed.item3.id, reason: '尝试删除票据项目。', type: 'remove_item' },
      ],
      summary: '尝试删除票据项目',
    }, { now: 12345 })

    expect(result.ok).toBe(false)
    expect((await getItineraryItem(seed.item1.id))?.title).toBe('西湖')
    expect((await getItineraryItem(seed.item3.id))?.ticketIds).toEqual([ticket.id])
    expect(await getTicketMeta(ticket.id)).toBeTruthy()
  })

  it('stops when local state changed since preview', async () => {
    const seed = await seedTrip()
    const beforeFingerprint = buildAiTripEditLocalStateFingerprint({
      days: await listDaysByTrip(seed.trip.id),
      items: await listItemsByTrip(seed.trip.id),
      trip: seed.trip,
    })
    await updateItineraryItem(seed.item1.id, { title: '用户手动修改' })

    const result = await applyAiTripEditPatchPlanToDb(seed.trip.id, {
      operations: [{ itemId: seed.item1.id, reason: '调整标题。', title: 'AI 修改', type: 'update_item_title' }],
      summary: '调整标题',
    }, { expectedBaselineFingerprint: beforeFingerprint, now: 12345 })

    expect(result.ok).toBe(false)
    expect((await getItineraryItem(seed.item1.id))?.title).toBe('用户手动修改')
    expect(getTripAutoSnapshotStatus(seed.trip.id)).toBeNull()
  })

  it('invalidates an AI preview when live execution state changes', async () => {
    const seed = await seedTrip()
    const beforeFingerprint = buildAiTripEditLocalStateFingerprint({ days: await listDaysByTrip(seed.trip.id), items: await listItemsByTrip(seed.trip.id), trip: seed.trip })
    await updateItineraryItem(seed.item1.id, { executionState: { status: 'completed', updatedAt: 500 } })

    const result = await applyAiTripEditPatchPlanToDb(seed.trip.id, {
      operations: [{ itemId: seed.item1.id, reason: '调整标题。', title: 'AI 修改', type: 'update_item_title' }],
      summary: '调整标题',
    }, { expectedBaselineFingerprint: beforeFingerprint })

    expect(result.ok).toBe(false)
  })

  it('clears execution state when an item moves to another day', async () => {
    const seed = await seedTrip()
    await updateItineraryItem(seed.item2.id, { executionState: { status: 'completed', updatedAt: 500 } })
    const result = await applyAiTripEditPatchPlanToDb(seed.trip.id, {
      operations: [{ itemId: seed.item2.id, reason: '改到第二天。', targetDayId: seed.day2.id, type: 'move_item' }],
      summary: '移动行程点',
    })

    expect(result.ok).toBe(true)
    expect((await getItineraryItem(seed.item2.id))?.executionState).toBeUndefined()
  })

  it('builds zero-write payload for valid no-op plans', async () => {
    const seed = await seedTrip()
    const contextResult = buildAiTripEditContext({
      days: await listDaysByTrip(seed.trip.id),
      items: await listItemsByTrip(seed.trip.id),
      trip: seed.trip,
    })
    expect(contextResult.ok).toBe(true)
    if (!contextResult.ok) return

    const payload = buildAiTripEditApplyPayload({
      operations: [],
      summary: '未生成可写入修改',
      warnings: ['暂未识别可安全自动转换的修改。'],
    }, contextResult.context)

    expect(payload.ok).toBe(true)
    if (payload.ok) {
      expect(payload.payload.writeOperationCount).toBe(0)
      expect(payload.payload.preview.hasWritePayload).toBe(false)
    }
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
