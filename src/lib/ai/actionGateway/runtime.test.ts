// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/database'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../../../types'
import { clearRouteCache, getRouteCacheStats } from '../../routeCache'
import * as routeGeneration from '../../routeGeneration'
import {
  buildDeterministicAiActionPlan,
  executeAiActionPlan,
  prepareAiActionPlan,
  validateAiActionPlan,
  type AiActionGatewayRuntimeContext,
} from '.'

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  db.close()
  await db.delete()
  await db.open()
  await clearRouteCache()
})

describe('AI Action Gateway runtime', () => {
  it('opens a matching ticket without a provider request', async () => {
    const seed = buildSeed()
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'edinburgh.pdf',
      fileType: 'pdf',
      id: 'ticket-1',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 100,
      storageMode: 'reference',
      title: '爱丁堡城堡门票',
      tripId: seed.trip.id,
      updatedAt: 1,
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed, { tickets: [ticket] })
    const plan = buildDeterministicAiActionPlan('找一下爱丁堡的门票')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)
    const result = await executeAiActionPlan(prepared, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.effects).toEqual([expect.objectContaining({
      kind: 'navigate',
      params: expect.objectContaining({ ticketId: ticket.id }),
      route: 'documents',
    })])
  })

  it('opens a registered semantic workspace target without a provider request', async () => {
    const seed = buildSeed()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('打开资料中心')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)
    const result = await executeAiActionPlan(prepared, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(false)
    expect(result).toMatchObject({
      status: 'completed',
      effects: [{
        kind: 'navigate',
        params: { tab: 'documents', tripId: seed.trip.id },
        route: 'documents',
      }],
    })
  })

  it('creates one itinerary item only after confirmation and reuses it on retry', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('第一天新增伦敦眼，10:00-11:00')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
      preview: '抵达伦敦：将在末尾新增「伦敦眼」 · 10:00-11:00。',
    })
    await expect(db.itineraryItems.count()).resolves.toBe(1)

    const [firstRun, concurrentRun] = await Promise.all([
      executeAiActionPlan(prepared, context),
      executeAiActionPlan(prepared, context),
    ])

    expect(firstRun.status).toBe('completed')
    expect(concurrentRun.status).toBe('completed')
    const items = (await db.itineraryItems.toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({
      dayId: seed.day.id,
      endTime: '11:00',
      sortOrder: 2,
      startTime: '10:00',
      ticketIds: [],
      title: '伦敦眼',
      tripId: seed.trip.id,
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)

    const freshTrip = await db.trips.get(seed.trip.id)
    expect(freshTrip).toBeTruthy()
    const retryContext = runtimeContext({ ...seed, trip: freshTrip! })
    retryContext.commandContext.items = items
    const retryPrepared = await prepareAiActionPlan(plan, retryContext, {
      executionId: prepared.executionId,
    })

    expect(retryPrepared.plan.requiresConfirmation).toBe(false)
    const retryRun = await executeAiActionPlan(retryPrepared, retryContext)
    expect(retryRun.steps[0].message).toContain('未重复创建')
    await expect(db.itineraryItems.count()).resolves.toBe(2)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('rolls back item creation when its sync outbox cannot be committed', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('第一天新增伦敦眼')!
    const prepared = await prepareAiActionPlan(plan, context)
    const outboxAdd = vi.spyOn(db.syncOutbox, 'add')
      .mockRejectedValueOnce(new Error('outbox unavailable'))

    const firstRun = await executeAiActionPlan(prepared, context)

    expect(firstRun.status).toBe('failed')
    await expect(db.itineraryItems.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)

    outboxAdd.mockRestore()
    const retryRun = await executeAiActionPlan(prepared, context)
    expect(retryRun.status).toBe('completed')
    await expect(db.itineraryItems.count()).resolves.toBe(2)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('deletes one item with one confirmation, preserves related data, and restores the exact order', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    seed.item.sortOrder = 2
    const hotel: ItineraryItem = {
      ...seed.item,
      id: 'item-hotel',
      sortOrder: 1,
      title: '伦敦酒店',
    }
    const dinner: ItineraryItem = {
      ...seed.item,
      id: 'item-dinner',
      sortOrder: 3,
      title: '晚餐',
    }
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'london-eye.pdf',
      fileType: 'pdf',
      id: 'ticket-london-eye',
      itemId: seed.item.id,
      mimeType: 'application/pdf',
      scope: 'item',
      size: 100,
      storageMode: 'copy',
      title: '伦敦眼门票',
      tripId: seed.trip.id,
      updatedAt: 1,
    }
    await seedDatabase(seed)
    await db.transaction(
      'rw',
      [db.itineraryItems, db.ticketMetas, db.ticketBlobs, db.ledgerExpenses],
      async () => {
        await db.itineraryItems.bulkPut([hotel, dinner])
        await db.ticketMetas.put(ticket)
        await db.ticketBlobs.put({ blob: new Blob(['ticket']), ticketId: ticket.id })
        await db.ledgerExpenses.put({
          amountMinor: 4200,
          category: 'admission',
          createdAt: 1,
          currency: 'GBP',
          date: seed.day.date,
          id: 'expense-london-eye',
          itemIds: [seed.item.id],
          source: { kind: 'ticket', sourceId: ticket.id },
          splitMode: 'equal',
          splitShares: [],
          status: 'confirmed',
          title: '伦敦眼',
          tripId: seed.trip.id,
          updatedAt: 1,
        })
      },
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed, { tickets: [ticket] })
    context.commandContext.items = [hotel, seed.item, dinner]
    const plan = buildDeterministicAiActionPlan('删除第一天的伦敦眼')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
      preview: '抵达伦敦：移除「伦敦眼」（第 2 位）；保留 1 张票据、1 笔账本关联和订单，可撤销。',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toBeDefined()

    const [firstRun, concurrentRun] = await Promise.all([
      executeAiActionPlan(prepared, context),
      executeAiActionPlan(prepared, context),
    ])

    expect(firstRun.status).toBe('completed')
    expect(concurrentRun.status).toBe('completed')
    expect((await db.itineraryItems.where('dayId').equals(seed.day.id).sortBy('sortOrder'))
      .map((item) => [item.title, item.sortOrder]))
      .toEqual([['伦敦酒店', 1], ['晚餐', 2]])
    await expect(db.ticketMetas.get(ticket.id)).resolves.toMatchObject({
      id: ticket.id,
      itemId: seed.item.id,
    })
    await expect(db.ticketBlobs.get(ticket.id)).resolves.toBeDefined()
    await expect(db.ledgerExpenses.get('expense-london-eye')).resolves.toMatchObject({
      itemIds: [seed.item.id],
      status: 'confirmed',
    })
    await expect(db.tripReplanRecords.where('tripId').equals(seed.trip.id).count())
      .resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)

    const freshTrip = await db.trips.get(seed.trip.id)
    const remainingItems = await db.itineraryItems.where('tripId').equals(seed.trip.id).toArray()
    const undoContext = runtimeContext({ ...seed, item: hotel, trip: freshTrip! }, { tickets: [ticket] })
    undoContext.commandContext.items = remainingItems
    const undoPlan = buildDeterministicAiActionPlan('撤销刚才的删除')!
    const undoPrepared = await prepareAiActionPlan(undoPlan, undoContext)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(undoPrepared.plan.requiresConfirmation).toBe(true)
    expect(undoPrepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
      preview: '抵达伦敦：恢复「伦敦眼」到第 2 位；关联资料保持不变。',
    })

    const undoRun = await executeAiActionPlan(undoPrepared, undoContext)

    expect(undoRun.status).toBe('completed')
    expect((await db.itineraryItems.where('dayId').equals(seed.day.id).sortBy('sortOrder'))
      .map((item) => [item.title, item.sortOrder]))
      .toEqual([['伦敦酒店', 1], ['伦敦眼', 2], ['晚餐', 3]])
    await expect(db.ticketMetas.get(ticket.id)).resolves.toMatchObject({
      id: ticket.id,
      itemId: seed.item.id,
    })
    await expect(db.ticketBlobs.get(ticket.id)).resolves.toBeDefined()
    await expect(db.ledgerExpenses.get('expense-london-eye')).resolves.toMatchObject({
      itemIds: [seed.item.id],
      status: 'confirmed',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(2)

    const retryUndo = await executeAiActionPlan(undoPrepared, undoContext)
    expect(retryUndo.status).toBe('completed')
    expect(retryUndo.steps[0].message).toContain('未重复执行')
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(2)
  })

  it('blocks a stale deletion undo without restoring the removed item', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    const second: ItineraryItem = {
      ...seed.item,
      id: 'item-second',
      sortOrder: 2,
      title: '晚餐',
    }
    await seedDatabase(seed)
    await db.itineraryItems.put(second)
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, second]
    const deletePlan = buildDeterministicAiActionPlan('删除伦敦眼')!
    const deletePrepared = await prepareAiActionPlan(deletePlan, context)
    await executeAiActionPlan(deletePrepared, context)

    const freshTrip = await db.trips.get(seed.trip.id)
    const remainingItems = await db.itineraryItems.where('tripId').equals(seed.trip.id).toArray()
    const undoContext = runtimeContext({ ...seed, item: second, trip: freshTrip! })
    undoContext.commandContext.items = remainingItems
    const undoPlan = buildDeterministicAiActionPlan('撤销刚才的删除')!
    const undoPrepared = await prepareAiActionPlan(undoPlan, undoContext)

    await db.itineraryItems.update(second.id, { notes: '用户刚刚补充', updatedAt: 99 })
    const result = await executeAiActionPlan(undoPrepared, undoContext)

    expect(result).toMatchObject({
      message: '旅行内容已变化，请重新生成预览。',
      requiresFreshConfirmation: true,
      status: 'failed',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toBeUndefined()
    await expect(db.tripReplanRecords.where('tripId').equals(seed.trip.id).first())
      .resolves.toMatchObject({ status: 'applied' })
  })

  it('rolls back a reversible deletion when its sync outbox cannot be committed', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('删除伦敦眼')!
    const prepared = await prepareAiActionPlan(plan, context)
    const outboxAdd = vi.spyOn(db.syncOutbox, 'add')
      .mockRejectedValueOnce(new Error('outbox unavailable'))

    const failed = await executeAiActionPlan(prepared, context)

    expect(failed.status).toBe('failed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toBeDefined()
    await expect(db.tripReplanRecords.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)

    outboxAdd.mockRestore()
    const retry = await executeAiActionPlan(prepared, context)
    expect(retry.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toBeUndefined()
    await expect(db.tripReplanRecords.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('allows only one independently prepared deletion from the same baseline', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('删除伦敦眼')!
    const firstPrepared = await prepareAiActionPlan(plan, context)
    const secondPrepared = await prepareAiActionPlan(plan, context)

    const results = await Promise.all([
      executeAiActionPlan(firstPrepared, context),
      executeAiActionPlan(secondPrepared, context),
    ])

    expect(results.filter((result) => result.status === 'completed')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'failed')).toHaveLength(1)
    expect(results.find((result) => result.status === 'failed')).toMatchObject({
      requiresFreshConfirmation: true,
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toBeUndefined()
    await expect(db.tripReplanRecords.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('reorders one semantic item within its day only after confirmation', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    seed.item.sortOrder = 3
    const hotel: ItineraryItem = {
      ...seed.item,
      id: 'item-hotel',
      sortOrder: 1,
      title: '伦敦酒店',
    }
    const bigBen: ItineraryItem = {
      ...seed.item,
      id: 'item-big-ben',
      sortOrder: 2,
      title: '大本钟',
    }
    await seedDatabase(seed)
    await db.itineraryItems.bulkPut([hotel, bigBen])
    const context = runtimeContext(seed)
    context.commandContext.items = [hotel, bigBen, seed.item]
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const plan = buildDeterministicAiActionPlan('把伦敦眼移到大本钟前面')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
      preview: '伦敦眼：第 3 位 → 第 2 位。',
    })
    expect((await db.itineraryItems.toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map((item) => item.title))
      .toEqual(['伦敦酒店', '大本钟', '伦敦眼'])

    const result = await executeAiActionPlan(prepared, context)

    expect(result.status).toBe('completed')
    expect((await db.itineraryItems.toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map((item) => item.title))
      .toEqual(['伦敦酒店', '伦敦眼', '大本钟'])
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)

    await db.itineraryItems.put({
      ...bigBen,
      id: 'item-new-stop',
      sortOrder: 4,
      title: '新加入的站点',
      updatedAt: 2,
    })
    prepared.baselineFingerprint = undefined
    const staleRetry = await executeAiActionPlan(prepared, context)
    expect(staleRetry).toMatchObject({
      message: '当天顺序已变化，请重新生成预览。',
      requiresFreshConfirmation: true,
      status: 'failed',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('rejects a concurrent reorder prepared from the same stale baseline', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    seed.item.sortOrder = 3
    const hotel: ItineraryItem = {
      ...seed.item,
      id: 'item-hotel',
      sortOrder: 1,
      title: '伦敦酒店',
    }
    const bigBen: ItineraryItem = {
      ...seed.item,
      id: 'item-big-ben',
      sortOrder: 2,
      title: '大本钟',
    }
    await seedDatabase(seed)
    await db.itineraryItems.bulkPut([hotel, bigBen])
    const context = runtimeContext(seed)
    context.commandContext.items = [hotel, bigBen, seed.item]
    const plan = buildDeterministicAiActionPlan('把伦敦眼移到大本钟前面')!
    const firstPrepared = await prepareAiActionPlan(plan, context)
    const secondPrepared = await prepareAiActionPlan(plan, context)
    expect(firstPrepared.executionId).not.toBe(secondPrepared.executionId)

    const runs = await Promise.all([
      executeAiActionPlan(firstPrepared, context),
      executeAiActionPlan(secondPrepared, context),
    ])

    expect(runs.filter((run) => run.status === 'completed')).toHaveLength(1)
    expect(runs.filter((run) => run.status === 'failed')).toHaveLength(1)
    expect(runs.find((run) => run.status === 'failed')).toMatchObject({
      requiresFreshConfirmation: true,
    })
    expect((await db.itineraryItems.toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map((item) => item.title))
      .toEqual(['伦敦酒店', '伦敦眼', '大本钟'])
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('rejects a same-day reorder when its anchor belongs to another day', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    const secondDay: Day = {
      ...seed.day,
      date: '2026-07-11',
      id: 'day-2',
      sortOrder: 2,
      title: '伦敦市区',
    }
    const otherDayItem: ItineraryItem = {
      ...seed.item,
      dayId: secondDay.id,
      id: 'item-big-ben',
      title: '大本钟',
    }
    await seedDatabase(seed)
    await db.days.put(secondDay)
    await db.itineraryItems.put(otherDayItem)
    const context = runtimeContext(seed)
    context.commandContext.days = [seed.day, secondDay]
    context.commandContext.items = [seed.item, otherDayItem]
    const plan = buildDeterministicAiActionPlan('第一天把伦敦眼移到大本钟前面')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(prepared.steps[0]).toMatchObject({
      error: '所选日期没有找到目标行程点。',
      status: 'failed',
    })
    expect(prepared.plan.requiresConfirmation).toBe(false)
    expect((await db.itineraryItems.toArray()).map((item) => item.sortOrder)).toEqual([1, 1])
  })

  it('moves one semantic item across days only after confirmation and does not repeat it', async () => {
    const seed = buildSeed()
    seed.item.executionState = { status: 'completed', updatedAt: 1 }
    seed.item.title = '伦敦眼'
    seed.item.sortOrder = 2
    const sourceFirst: ItineraryItem = {
      ...seed.item,
      id: 'item-hotel',
      sortOrder: 1,
      title: '伦敦酒店',
    }
    const secondDay: Day = {
      ...seed.day,
      date: '2026-07-11',
      id: 'day-2',
      sortOrder: 2,
      title: '伦敦市区',
    }
    const bigBen: ItineraryItem = {
      ...seed.item,
      dayId: secondDay.id,
      id: 'item-big-ben',
      sortOrder: 1,
      title: '大本钟',
    }
    const museum: ItineraryItem = {
      ...seed.item,
      dayId: secondDay.id,
      id: 'item-museum',
      sortOrder: 2,
      title: '大英博物馆',
    }
    await seedDatabase(seed)
    await db.days.put(secondDay)
    await db.itineraryItems.bulkPut([sourceFirst, bigBen, museum])
    const context = runtimeContext(seed)
    context.commandContext.days = [seed.day, secondDay]
    context.commandContext.items = [sourceFirst, seed.item, bigBen, museum]
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const plan = buildDeterministicAiActionPlan(
      '把第一天的伦敦眼移到第二天大本钟后面',
    )!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
      preview: '伦敦眼：「抵达伦敦」第 2 位 → 「伦敦市区」第 2 位。',
    })
    expect((await db.itineraryItems.where('dayId').equals(seed.day.id).toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map((item) => item.title))
      .toEqual(['伦敦酒店', '伦敦眼'])

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      effects: [{
        kind: 'navigate',
        params: { dayId: secondDay.id, tripId: seed.trip.id, view: 'schedule' },
        route: 'day',
      }],
      status: 'completed',
    })
    expect((await db.itineraryItems.where('dayId').equals(seed.day.id).toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map((item) => item.title))
      .toEqual(['伦敦酒店'])
    expect((await db.itineraryItems.where('dayId').equals(secondDay.id).toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map((item) => item.title))
      .toEqual(['大本钟', '伦敦眼', '大英博物馆'])
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      executionState: undefined,
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    const itemOutbox = (await db.syncOutbox.toArray())
      .filter((entry) => entry.objectType === 'item')
    const itemOutboxIds = itemOutbox
      .map((entry) => entry.objectId)
      .sort()
    expect(itemOutboxIds).toEqual([seed.item.id, museum.id].sort())
    expect(itemOutbox.find((entry) => entry.objectId === seed.item.id)?.payload)
      .toMatchObject({
        dayId: secondDay.id,
        executionState: undefined,
      })

    const retry = await executeAiActionPlan(prepared, context)
    expect(retry.status).toBe('completed')
    expect(retry.steps[0].message).toContain('未重复移动')
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    expect((await db.itineraryItems.where('dayId').equals(secondDay.id).toArray())
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map((item) => item.title))
      .toEqual(['大本钟', '伦敦眼', '大英博物馆'])
  })

  it('rejects a cross-day move when either prepared day order is stale', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    const secondDay: Day = {
      ...seed.day,
      date: '2026-07-11',
      id: 'day-2',
      sortOrder: 2,
      title: '伦敦市区',
    }
    const bigBen: ItineraryItem = {
      ...seed.item,
      dayId: secondDay.id,
      id: 'item-big-ben',
      title: '大本钟',
    }
    await seedDatabase(seed)
    await db.days.put(secondDay)
    await db.itineraryItems.put(bigBen)
    const context = runtimeContext(seed)
    context.commandContext.days = [seed.day, secondDay]
    context.commandContext.items = [seed.item, bigBen]
    const plan = buildDeterministicAiActionPlan('把伦敦眼移到第二天')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.itineraryItems.put({
      ...bigBen,
      id: 'item-new-destination',
      sortOrder: 2,
      title: '刚加入目标日期',
      updatedAt: 2,
    })
    prepared.baselineFingerprint = undefined

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '目标日期行程已变化，请重新生成预览。',
      requiresFreshConfirmation: true,
      status: 'failed',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      dayId: seed.day.id,
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('rolls back a cross-day move when its sync outbox cannot be committed', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    const secondDay: Day = {
      ...seed.day,
      date: '2026-07-11',
      id: 'day-2',
      sortOrder: 2,
      title: '伦敦市区',
    }
    const bigBen: ItineraryItem = {
      ...seed.item,
      dayId: secondDay.id,
      id: 'item-big-ben',
      title: '大本钟',
    }
    await seedDatabase(seed)
    await db.days.put(secondDay)
    await db.itineraryItems.put(bigBen)
    const context = runtimeContext(seed)
    context.commandContext.days = [seed.day, secondDay]
    context.commandContext.items = [seed.item, bigBen]
    const plan = buildDeterministicAiActionPlan('把伦敦眼移到第二天最前面')!
    const prepared = await prepareAiActionPlan(plan, context)
    const outboxAdd = vi.spyOn(db.syncOutbox, 'add')
      .mockRejectedValueOnce(new Error('outbox unavailable'))

    const firstRun = await executeAiActionPlan(prepared, context)

    expect(firstRun.status).toBe('failed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      dayId: seed.day.id,
      sortOrder: 1,
    })
    await expect(db.itineraryItems.get(bigBen.id)).resolves.toMatchObject({
      dayId: secondDay.id,
      sortOrder: 1,
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)

    outboxAdd.mockRestore()
    const retryRun = await executeAiActionPlan(prepared, context)
    expect(retryRun.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      dayId: secondDay.id,
      sortOrder: 1,
    })
    await expect(db.itineraryItems.get(bigBen.id)).resolves.toMatchObject({
      dayId: secondDay.id,
      sortOrder: 2,
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('previews an item time change and preserves duration until confirmed execution', async () => {
    const seed = buildSeed()
    seed.item.startTime = '09:00'
    seed.item.endTime = '10:30'
    await seedDatabase(seed)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('把第一站改到11点')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: [seed.item.title],
      hasWrite: true,
      preview: `${seed.item.title}：09:00-10:30 → 11:00-12:30。`,
      status: 'prepared',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      endTime: '10:30',
      startTime: '09:00',
    })

    const result = await executeAiActionPlan(prepared, context)

    expect(result.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      endTime: '12:30',
      startTime: '11:00',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('blocks a prepared item time change after the trip state becomes stale', async () => {
    const seed = buildSeed()
    seed.item.startTime = '09:00'
    seed.item.endTime = '10:00'
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('把第一站改到11点')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.itineraryItems.update(seed.item.id, { startTime: '08:30', updatedAt: 2 })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '旅行内容已变化，请重新生成预览。',
      status: 'failed',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      endTime: '10:00',
      startTime: '08:30',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('updates one item execution state only after confirmation and reuses the persisted result', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    await seedDatabase(seed)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('第一站已完成')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
      preview: '抵达伦敦：「伦敦眼」将标记为已完成。',
    })
    expect(await db.itineraryItems.get(seed.item.id)).not.toHaveProperty('executionState')

    const [firstRun, retryRun] = await Promise.all([
      executeAiActionPlan(prepared, context),
      executeAiActionPlan(prepared, context),
    ])

    expect(firstRun.status).toBe('completed')
    expect(retryRun.status).toBe('completed')
    expect([firstRun, retryRun].map((run) => run.steps[0].message).join(' '))
      .toContain('未重复执行')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      executionState: { status: 'completed' },
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('prefers an explicit quoted item over conflicting positional words', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦酒店'
    const londonEye: ItineraryItem = {
      ...seed.item,
      id: 'item-london-eye',
      sortOrder: 2,
      title: '伦敦眼',
    }
    await seedDatabase(seed)
    await db.itineraryItems.put(londonEye)
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, londonEye]
    const plan = buildDeterministicAiActionPlan(
      '把“伦敦眼”标记为完成，不是第一站',
    )!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
    })
    const result = await executeAiActionPlan(prepared, context)

    expect(result.status).toBe('completed')
    expect((await db.itineraryItems.get(seed.item.id))?.executionState)
      .toBeUndefined()
    await expect(db.itineraryItems.get(londonEye.id)).resolves.toMatchObject({
      executionState: { status: 'completed' },
    })
  })

  it('merges bounded item replan preferences only after confirmation', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    seed.item.replanPreference = { flexibility: 'movable', priority: 'normal' }
    await seedDatabase(seed)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan(
      '第一站不能动，必须保留，下雨别去，预留30分钟',
    )!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
    })
    expect(prepared.steps[0].preview).toContain('缓冲 30 分钟')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      replanPreference: { flexibility: 'movable', priority: 'normal' },
    })

    const result = await executeAiActionPlan(prepared, context)

    expect(result.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      replanPreference: {
        bufferMinutes: 30,
        flexibility: 'fixed',
        priority: 'must_keep',
        weatherSuitability: 'avoid_rain',
      },
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('blocks a prepared execution update after the target item changes', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('第一站已完成')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.itineraryItems.update(seed.item.id, {
      notes: '用户刚刚补充',
      updatedAt: 2,
    })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '旅行内容已变化，请重新生成预览。',
      requiresFreshConfirmation: true,
      status: 'failed',
    })
    const item = await db.itineraryItems.get(seed.item.id)
    expect(item).not.toHaveProperty('executionState')
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('blocks a prepared preference update after the target item changes', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan(
      '第一站不能动，必须保留，下雨别去',
    )!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.itineraryItems.update(seed.item.id, {
      notes: '用户刚刚补充',
      updatedAt: 2,
    })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '旅行内容已变化，请重新生成预览。',
      requiresFreshConfirmation: true,
      status: 'failed',
    })
    const item = await db.itineraryItems.get(seed.item.id)
    expect(item?.replanPreference).toBeUndefined()
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('applies an adaptive disruption replan through one confirmation without a provider call', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    seed.item.startTime = '10:00'
    seed.item.endTime = '11:00'
    const secondItem: ItineraryItem = {
      ...seed.item,
      endTime: '13:00',
      id: 'item-2',
      sortOrder: 2,
      startTime: '12:00',
      title: '大本钟',
    }
    await seedDatabase(seed)
    await db.itineraryItems.put(secondItem)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, secondItem]
    const plan = buildDeterministicAiActionPlan(
      '我晚到30分钟，按最少改动调整',
    )!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼', '大本钟'],
      hasWrite: true,
      preview: '抵达伦敦：伦敦眼将改为 10:30，共 2 项；按最少改动调整 2 项。',
    })
    await expect(db.tripReplanEvents.count()).resolves.toBe(0)
    await expect(db.tripReplanRecords.count()).resolves.toBe(0)

    const [firstRun, retryRun] = await Promise.all([
      executeAiActionPlan(prepared, context),
      executeAiActionPlan(prepared, context),
    ])

    expect(firstRun.status).toBe('completed')
    expect(retryRun.status).toBe('completed')
    expect([firstRun, retryRun].map((run) => run.steps[0].message).join(' '))
      .toContain('未重复执行')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      endTime: '11:30',
      startTime: '10:30',
    })
    await expect(db.itineraryItems.get(secondItem.id)).resolves.toMatchObject({
      endTime: '13:30',
      startTime: '12:30',
    })
    await expect(db.tripReplanEvents.count()).resolves.toBe(1)
    await expect(db.tripReplanRecords.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces a cross-midnight delay as a manual item instead of a no-op', async () => {
    const seed = buildSeed()
    seed.item.startTime = '23:30'
    seed.item.endTime = '23:55'
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('我晚到45分钟')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(prepared.plan.requiresConfirmation).toBe(false)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: [],
      hasWrite: false,
      preview: '抵达伦敦：顺延后会跨日，需手动安排。',
    })
  })

  it('requires a fresh confirmation when ticket metadata changes after replan preview', async () => {
    const seed = buildSeed()
    seed.item.startTime = '10:00'
    seed.item.endTime = '11:00'
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('我晚到30分钟')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.ticketMetas.put({
      createdAt: 2,
      fileName: 'updated-ticket.pdf',
      fileType: 'pdf',
      id: 'ticket-stale',
      itemId: seed.item.id,
      mimeType: 'application/pdf',
      scope: 'item',
      size: 100,
      storageMode: 'reference',
      title: '刚更新的票据',
      tripId: seed.trip.id,
      updatedAt: 2,
    })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '旅行、票据或账本内容已变化，请重新生成预览。',
      requiresFreshConfirmation: true,
      status: 'failed',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      startTime: '10:00',
    })
    await expect(db.tripReplanEvents.count()).resolves.toBe(0)
    await expect(db.tripReplanRecords.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('uses an explicit disruption day instead of an unrelated current item', async () => {
    const seed = buildSeed()
    seed.item.title = '伦敦眼'
    seed.item.replanPreference = { weatherSuitability: 'avoid_rain' }
    const secondDay: Day = {
      date: '2026-07-11',
      id: 'day-2',
      sortOrder: 2,
      title: '爱丁堡',
      tripId: seed.trip.id,
    }
    const secondItem: ItineraryItem = {
      ...seed.item,
      dayId: secondDay.id,
      id: 'item-2',
      replanPreference: undefined,
      title: '爱丁堡城堡',
    }
    await seedDatabase(seed)
    await db.days.put(secondDay)
    await db.itineraryItems.put(secondItem)
    const context = runtimeContext({
      day: secondDay,
      item: secondItem,
      trip: seed.trip,
    })
    context.commandContext.days = [seed.day, secondDay]
    context.commandContext.items = [seed.item, secondItem]
    const plan = buildDeterministicAiActionPlan(
      '7月10日下雨，按最少改动调整',
    )!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['伦敦眼'],
      hasWrite: true,
    })
    const result = await executeAiActionPlan(prepared, context)
    expect(result.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      executionState: { status: 'skipped' },
    })
    expect((await db.itineraryItems.get(secondItem.id))?.executionState)
      .toBeUndefined()
  })

  it('waits for confirmation before requesting and caching a route preview', async () => {
    const seed = buildSeed()
    seed.item.lat = 51.47
    seed.item.lng = -0.4543
    const secondItem: ItineraryItem = {
      ...seed.item,
      id: 'item-2',
      lat: 51.501,
      lng: -0.158,
      sortOrder: 2,
      title: '伦敦酒店入住',
    }
    await seedDatabase(seed)
    await db.itineraryItems.put(secondItem)
    window.localStorage.setItem('tripmap:dev:route-proxy-provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '/api/provider-proxy')
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        coordinates: Array<[number, number]>
        segments: Array<{
          fromCoordinateIndex: number
          fromItemId: string
          segmentIndex: number
          toCoordinateIndex: number
          toItemId: string
        }>
      }
      const segments = body.segments.map((segment) => ({
        coordinates: [
          body.coordinates[segment.fromCoordinateIndex],
          body.coordinates[segment.toCoordinateIndex],
        ],
        distanceMeters: 24000,
        durationSeconds: 2700,
        fromItemId: segment.fromItemId,
        segmentIndex: segment.segmentIndex,
        toItemId: segment.toItemId,
      }))
      return new Response(JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: segments.map((segment) => segment.coordinates),
          segments,
          status: 'road',
          warnings: [],
        },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, secondItem]
    const plan = buildDeterministicAiActionPlan('生成第一天路线预览')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: [seed.day.title],
      hasWrite: true,
      preview: '将为 1 天生成路线预览；确认后才调用路线服务。',
    })
    await expect(getRouteCacheStats()).resolves.toMatchObject({ count: 0 })

    const result = await executeAiActionPlan(prepared, context)

    expect(result.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(getRouteCacheStats()).resolves.toMatchObject({ count: 1 })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    expect(result.effects).toEqual([{
      kind: 'navigate',
      params: { dayId: seed.day.id, tripId: seed.trip.id, view: 'map' },
      route: 'day',
    }])
  })

  it('blocks a prepared route preview when the route configuration changes', async () => {
    const seed = buildSeed()
    seed.item.lat = 51.47
    seed.item.lng = -0.4543
    const secondItem: ItineraryItem = {
      ...seed.item,
      id: 'item-2',
      lat: 51.501,
      lng: -0.158,
      sortOrder: 2,
      title: '伦敦酒店入住',
    }
    await seedDatabase(seed)
    await db.itineraryItems.put(secondItem)
    window.localStorage.setItem('tripmap:dev:route-proxy-provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '/api/provider-proxy')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, secondItem]
    const prepared = await prepareAiActionPlan(
      buildDeterministicAiActionPlan('生成第一天路线预览')!,
      context,
    )
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '/api/changed-provider-proxy')

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '路线服务配置已变化，请重新生成预览。',
      requiresFreshConfirmation: true,
      status: 'failed',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(getRouteCacheStats()).resolves.toMatchObject({ count: 0 })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('treats an unsaved generated route as retryable failure', async () => {
    const seed = buildSeed()
    seed.item.lat = 51.47
    seed.item.lng = -0.4543
    const secondItem: ItineraryItem = {
      ...seed.item,
      id: 'item-2',
      lat: 51.501,
      lng: -0.158,
      sortOrder: 2,
      title: '伦敦酒店入住',
    }
    await seedDatabase(seed)
    await db.itineraryItems.put(secondItem)
    window.localStorage.setItem('tripmap:dev:route-proxy-provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '/api/provider-proxy')
    vi.spyOn(routeGeneration, 'generateRoutePreviewsForTrip').mockResolvedValue({
      failedCount: 0,
      generatedCount: 0,
      outcomes: [{
        day: seed.day,
        lineStrings: [[[0, 0], [1, 1]]],
        message: '单条道路路线超过当前缓存上限，已显示但未写入本地缓存。',
        provider: 'openrouteservice',
        saved: false,
        status: 'generated',
        warnings: ['单条道路路线超过当前缓存上限，已显示但未写入本地缓存。'],
      }],
      previewCacheSaved: false,
      provider: 'openrouteservice',
      skippedCount: 0,
    })
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, secondItem]
    const prepared = await prepareAiActionPlan(
      buildDeterministicAiActionPlan('生成第一天路线预览')!,
      context,
    )

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      failedStepIds: ['generate-route-preview'],
      requiresFreshConfirmation: false,
      status: 'failed',
    })
    expect(result.steps[0].message).toContain('路线未保存')
    await expect(getRouteCacheStats()).resolves.toMatchObject({ count: 0 })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('creates only a review-required expense draft after confirmation', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    await seedLedger(seed.trip.id)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('记一笔午餐 32.50 GBP')!

    const prepared = await prepareAiActionPlan(plan, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: ['午餐'],
      hasWrite: true,
      preview: '午餐：£32.50 · 餐饮 · 2026-07-10；将创建待审核草稿。',
    })
    await expect(db.ledgerExpenses.count()).resolves.toBe(0)

    const result = await executeAiActionPlan(prepared, context)
    const expense = await db.ledgerExpenses.toCollection().first()

    expect(result.status).toBe('completed')
    expect(expense).toMatchObject({
      amountMinor: 3250,
      category: 'food',
      currency: 'GBP',
      date: '2026-07-10',
      paymentStatus: 'unknown',
      reviewStatus: 'needs_review',
      status: 'draft',
      title: '午餐',
    })
    expect(expense?.payerParticipantId).toBeUndefined()
    expect(result.effects).toEqual([expect.objectContaining({
      kind: 'navigate',
      params: { expenseId: expense?.id, tripId: seed.trip.id },
      route: 'ledger/expense',
    })])
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('reuses the same expense draft for one execution but allows a new command run', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    await seedLedger(seed.trip.id)
    const plan = buildDeterministicAiActionPlan('记一笔午餐 32.50 GBP')!
    const firstContext = runtimeContext(seed)
    const firstPrepared = await prepareAiActionPlan(plan, firstContext)

    const [firstRun, concurrentRun] = await Promise.all([
      executeAiActionPlan(firstPrepared, firstContext),
      executeAiActionPlan(firstPrepared, firstContext),
    ])

    expect(firstRun.status).toBe('completed')
    expect(concurrentRun.status).toBe('completed')
    await expect(db.ledgerExpenses.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    const freshTrip = await db.trips.get(seed.trip.id)
    expect(freshTrip).toBeTruthy()
    const retrySeed = { ...seed, trip: freshTrip! }
    const retryContext = runtimeContext(retrySeed)
    const retryPrepared = await prepareAiActionPlan(plan, retryContext, {
      executionId: firstPrepared.executionId,
    })
    expect(retryPrepared.plan.requiresConfirmation).toBe(false)

    const retryRun = await executeAiActionPlan(retryPrepared, retryContext)

    expect(retryRun).toMatchObject({
      requiresFreshConfirmation: false,
      status: 'completed',
    })
    expect(retryRun.steps[0].message).toContain('未重复创建')
    await expect(db.ledgerExpenses.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)

    const secondContext = runtimeContext({ ...seed, trip: (await db.trips.get(seed.trip.id))! })
    const secondPrepared = await prepareAiActionPlan(plan, secondContext)
    expect(secondPrepared.executionId).not.toBe(firstPrepared.executionId)
    expect(secondPrepared.plan.requiresConfirmation).toBe(true)
    await executeAiActionPlan(secondPrepared, secondContext)
    await expect(db.ledgerExpenses.count()).resolves.toBe(2)
  })

  it('blocks an expense draft when ledger participants changed after preview', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    await seedLedger(seed.trip.id)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('记一笔午餐 32.50 GBP')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.ledgerParticipants.update('ledger-person-1', { updatedAt: 2 })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '账本设置或同行人已变化，请重新生成预览。',
      status: 'failed',
    })
    await expect(db.ledgerExpenses.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('previews a sourced place candidate and writes only after execution', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'place_lookup',
      results: [{
        displayName: '伦敦希思罗机场',
        formattedAddress: 'Hounslow, United Kingdom',
        location: { lat: 51.47, lng: -0.4543 },
        placeId: 'places/heathrow',
        provider: 'google_places',
        retrievedAt: '2026-07-25T00:00:00.000Z',
      }],
      retrievedAt: '2026-07-25T00:00:00.000Z',
      source: 'mock',
    }), { status: 200 })) as unknown as typeof fetch)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('补全第一站地点信息')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)
    await expect(db.itineraryItems.get(seed.item.id)).resolves.not.toMatchObject({ lat: 51.47 })
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: [seed.item.title],
      status: 'prepared',
    })

    const result = await executeAiActionPlan(prepared, context)
    expect(result.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      address: 'Hounslow, United Kingdom',
      lat: 51.47,
      lng: -0.4543,
      locationName: '伦敦希思罗机场',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('blocks a prepared write when the trip changed before confirmation', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'place_lookup',
      results: [{
        displayName: '伦敦希思罗机场',
        formattedAddress: 'Hounslow, United Kingdom',
        location: { lat: 51.47, lng: -0.4543 },
        placeId: 'places/heathrow',
        provider: 'google_places',
        retrievedAt: '2026-07-25T00:00:00.000Z',
      }],
      retrievedAt: '2026-07-25T00:00:00.000Z',
      source: 'mock',
    }), { status: 200 })) as unknown as typeof fetch)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('补全第一站地点信息')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.itineraryItems.update(seed.item.id, { title: '用户刚刚修改的标题', updatedAt: 2 })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({ status: 'failed', message: '旅行内容已变化，请重新生成预览。' })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.not.toMatchObject({ lat: 51.47 })
  })

  it('preserves completed step ids when a retry preview becomes stale', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'place_lookup',
      results: [{
        displayName: '伦敦希思罗机场',
        formattedAddress: 'Hounslow, United Kingdom',
        location: { lat: 51.47, lng: -0.4543 },
        placeId: 'places/heathrow',
        provider: 'google_places',
        retrievedAt: '2026-07-25T00:00:00.000Z',
      }],
      retrievedAt: '2026-07-25T00:00:00.000Z',
      source: 'mock',
    }), { status: 200 })) as unknown as typeof fetch)
    const context = runtimeContext(seed)
    const validation = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [
        { actionId: 'ticket.open@1', args: {}, dependsOn: [], id: 'ticket' },
        { actionId: 'place.enrich@1', args: { target: 'first_item' }, dependsOn: [], id: 'place' },
      ],
      summary: '打开票据并补全地点',
    })
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const prepared = await prepareAiActionPlan(validation.plan, context, {
      completedStepIds: ['ticket'],
    })
    await db.itineraryItems.update(seed.item.id, { title: '旅行已变化', updatedAt: 2 })

    const result = await executeAiActionPlan(prepared, context, {
      completedStepIds: ['ticket'],
    })

    expect(result).toMatchObject({
      completedStepIds: ['ticket'],
      failedStepIds: ['place'],
      status: 'partial',
      steps: [
        { id: 'ticket', status: 'skipped' },
        { id: 'place', status: 'failed' },
      ],
    })
  })

  it('rejects an ambiguous place target before calling the provider', async () => {
    const seed = buildSeed()
    const secondItem: ItineraryItem = {
      ...seed.item,
      id: 'item-2',
      sortOrder: 2,
      title: '伦敦塔',
    }
    seed.item.title = '伦敦眼'
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, secondItem]
    const validation = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [{
        actionId: 'place.enrich@1',
        args: { target: '伦敦' },
        dependsOn: [],
        id: 'place',
      }],
      summary: '补全地点',
    })
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const prepared = await prepareAiActionPlan(validation.plan, context)

    expect(prepared.steps[0]).toMatchObject({
      error: '找到多个匹配行程点，请写清楚名称。',
      status: 'failed',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exposes high-risk issues as a manual entry without requesting write confirmation', async () => {
    const seed = buildSeed()
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'passport.pdf',
      fileType: 'pdf',
      id: 'ticket-risk',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 100,
      storageMode: 'reference',
      title: '护照复印件',
      tripId: seed.trip.id,
      updatedAt: 1,
    }
    await db.transaction('rw', [db.trips, db.ticketMetas, db.ticketBlobSyncStates], async () => {
      await db.trips.put(seed.trip)
      await db.ticketMetas.put(ticket)
      await db.ticketBlobSyncStates.put({
        cacheStatus: 'missing',
        fileName: ticket.fileName,
        ticketId: ticket.id,
        tripId: seed.trip.id,
        updatedAt: 1,
        uploadStatus: 'missing',
      })
    })
    const context = runtimeContext(seed, { tickets: [ticket] })
    context.commandContext.currentDay = undefined
    context.commandContext.currentItem = undefined
    context.commandContext.days = []
    context.commandContext.items = []
    const plan = buildDeterministicAiActionPlan('修复所有问题')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)

    expect(prepared.plan.requiresConfirmation).toBe(false)
    expect(prepared.steps[0]).toMatchObject({
      hasWrite: false,
      manualEntry: {
        kind: 'navigate',
        params: { tripId: seed.trip.id },
        route: 'trip',
        scrollTargetId: 'trip-readiness-details-section',
      },
      status: 'prepared',
    })
    const result = await executeAiActionPlan(prepared, context)
    expect(result).toMatchObject({ status: 'completed' })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('retries only failed steps and does not repeat completed navigation', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'edinburgh.pdf',
      fileType: 'pdf',
      id: 'ticket-1',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 100,
      storageMode: 'reference',
      title: '爱丁堡城堡门票',
      tripId: seed.trip.id,
      updatedAt: 1,
    }
    let lookupCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      lookupCount += 1
      if (lookupCount === 1) throw new Error('temporary provider failure')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'place_lookup',
        results: [{
          displayName: '伦敦希思罗机场',
          formattedAddress: 'Hounslow, United Kingdom',
          location: { lat: 51.47, lng: -0.4543 },
          placeId: 'places/heathrow',
          provider: 'google_places',
          retrievedAt: '2026-07-25T00:00:00.000Z',
        }],
        retrievedAt: '2026-07-25T00:00:00.000Z',
        source: 'mock',
      }), { status: 200 })
    }) as unknown as typeof fetch)
    const context = runtimeContext(seed, { tickets: [ticket] })
    const validation = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [
        { actionId: 'ticket.open@1', args: { query: '爱丁堡' }, dependsOn: [], id: 'ticket' },
        { actionId: 'place.enrich@1', args: { target: 'first_item' }, dependsOn: [], id: 'place' },
      ],
      summary: '打开票据并补全地点',
    })
    expect(validation.ok).toBe(true)
    if (!validation.ok) return

    const firstPrepared = await prepareAiActionPlan(validation.plan, context)
    const firstRun = await executeAiActionPlan(firstPrepared, context)
    expect(firstRun).toMatchObject({
      completedStepIds: ['ticket'],
      failedStepIds: ['place'],
      status: 'partial',
    })
    expect(firstRun.effects).toHaveLength(1)

    const retryPrepared = await prepareAiActionPlan(
      validation.plan,
      context,
      {
        completedStepIds: firstRun.completedStepIds,
        executionId: firstPrepared.executionId,
      },
    )
    const retryRun = await executeAiActionPlan(
      retryPrepared,
      context,
      { completedStepIds: firstRun.completedStepIds },
    )

    expect(retryRun.status).toBe('completed')
    expect(retryRun.effects).toHaveLength(0)
    expect(retryRun.steps[0]).toMatchObject({ id: 'ticket', status: 'skipped' })
    expect(lookupCount).toBe(2)
  })
})

function buildSeed() {
  const trip: Trip = {
    createdAt: 1,
    destination: '英国',
    endDate: '2026-07-21',
    id: 'trip-1',
    startDate: '2026-07-10',
    title: '英国旅行',
    updatedAt: 1,
  }
  const day: Day = {
    date: '2026-07-10',
    id: 'day-1',
    sortOrder: 1,
    title: '抵达伦敦',
    tripId: trip.id,
  }
  const item: ItineraryItem = {
    createdAt: 1,
    dayId: day.id,
    id: 'item-1',
    sortOrder: 1,
    ticketIds: [],
    title: '抵达伦敦',
    tripId: trip.id,
    updatedAt: 1,
  }
  return { day, item, trip }
}

function runtimeContext(
  seed: ReturnType<typeof buildSeed>,
  overrides: { tickets?: TicketMeta[] } = {},
): AiActionGatewayRuntimeContext {
  return {
    command: '测试',
    commandContext: {
      activeRoute: 'item',
      currentDay: seed.day,
      currentItem: seed.item,
      days: [seed.day],
      hash: `#/item?tripId=${seed.trip.id}&dayId=${seed.day.id}&itemId=${seed.item.id}`,
      items: [seed.item],
      ledgerExpenses: [],
      params: new URLSearchParams(`tripId=${seed.trip.id}&dayId=${seed.day.id}&itemId=${seed.item.id}`),
      tickets: overrides.tickets ?? [],
      trip: seed.trip,
    },
    providerConfig: {
      configured: true,
      provider: 'google',
      proxyUrl: '/api/provider-proxy',
      source: 'proxy',
    },
  }
}

async function seedDatabase(seed: ReturnType<typeof buildSeed>) {
  await db.transaction('rw', [db.trips, db.days, db.itineraryItems], async () => {
    await db.trips.put(seed.trip)
    await db.days.put(seed.day)
    await db.itineraryItems.put(seed.item)
  })
}

async function seedLedger(tripId: string) {
  await db.transaction('rw', [db.ledgerSettings, db.ledgerParticipants], async () => {
    await db.ledgerSettings.put({
      createdAt: 1,
      homeCurrency: 'CNY',
      id: 'ledger-settings-1',
      settlementCurrency: 'CNY',
      tripCurrency: 'GBP',
      tripId,
      updatedAt: 1,
    })
    await db.ledgerParticipants.put({
      createdAt: 1,
      displayName: '我',
      id: 'ledger-person-1',
      isSelf: true,
      source: 'manual',
      tripId,
      updatedAt: 1,
    })
  })
}
