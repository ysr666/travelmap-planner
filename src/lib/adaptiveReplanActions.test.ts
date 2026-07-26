// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/database'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  TicketMeta,
  Trip,
} from '../types'
import {
  assertAdaptiveReplanActionApplied,
  buildAdaptiveReplanActionPreview,
  executeAdaptiveReplanAction,
  loadAdaptiveReplanActionContext,
} from './adaptiveReplanActions'

beforeEach(async () => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  db.close()
  await db.delete()
  await db.open()
})

describe('adaptive replan action transaction', () => {
  it('previews locally and atomically applies one reversible replan once', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'late',
      item: seed.items[0],
      now: 100,
      operationFingerprint: 'ai-action:run-1:replan',
      strategy: 'least_change',
    })

    expect(prepared.selectedOption.diff.itemChanges).toHaveLength(2)
    await expect(db.tripReplanEvents.count()).resolves.toBe(0)
    await expect(db.tripReplanRecords.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)

    const results = await Promise.all([
      executeAdaptiveReplanAction(prepared),
      executeAdaptiveReplanAction(prepared),
    ])

    expect(results.filter((result) => result.changed)).toHaveLength(1)
    expect(results.filter((result) => !result.changed)).toHaveLength(1)
    const items = await db.itineraryItems.orderBy('id').toArray()
    expect(items.map((item) => [item.id, item.startTime, item.endTime]))
      .toEqual([
        ['item-1', '10:30', '11:30'],
        ['item-2', '12:30', '13:30'],
        ['item-3', '09:00', '10:00'],
      ])
    await expect(db.tripReplanEvents.get(prepared.eventId)).resolves.toMatchObject({
      evidence: [],
      id: prepared.eventId,
      notes: '用户报告晚到 30 分钟',
      status: 'applied',
    })
    await expect(db.tripReplanRecords.get(prepared.recordId)).resolves.toMatchObject({
      id: prepared.recordId,
      operationFingerprint: prepared.operationFingerprint,
      operationKind: 'adaptive_replan',
      selectedDiff: expect.any(Object),
      status: 'applied',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    expect(await db.syncOutbox.count()).toBeGreaterThanOrEqual(5)
    await expect(assertAdaptiveReplanActionApplied(prepared)).resolves.toMatchObject({
      status: 'applied',
    })
    await expect(db.ticketMetas.get(seed.ticket.id)).resolves.toEqual(seed.ticket)
    await expect(db.ledgerExpenses.get(seed.expense.id)).resolves.toEqual(seed.expense)
  })

  it('rejects a stale preview when ticket or ledger context changes', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'delay',
      item: seed.items[0],
      operationFingerprint: 'ai-action:run-2:replan',
    })
    await db.ticketMetas.put({
      ...seed.ticket,
      title: '票据时间已更新',
      updatedAt: 2,
    })

    await expect(executeAdaptiveReplanAction(prepared))
      .rejects.toThrow('旅行、票据或账本内容已变化')
    await expect(db.tripReplanEvents.count()).resolves.toBe(0)
    await expect(db.tripReplanRecords.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
    expect((await db.itineraryItems.get('item-1'))?.startTime).toBe('10:00')
  })

  it('rejects stale trip, day, preference, and ledger state independently', async () => {
    for (const target of ['trip', 'day', 'preference', 'ledger'] as const) {
      db.close()
      await db.delete()
      await db.open()
      const seed = buildSeed()
      await seedDatabase(seed)
      const context = await loadAdaptiveReplanActionContext(seed.trip.id)
      const prepared = buildAdaptiveReplanActionPreview({
        context,
        day: seed.days[0],
        delayMinutes: 30,
        disruptionKind: 'late',
        item: seed.items[0],
        operationFingerprint: `ai-action:stale-${target}:replan`,
      })
      if (target === 'trip') {
        await db.trips.put({
          ...seed.trip,
          title: '用户更新的旅行',
          updatedAt: 2,
        })
      } else if (target === 'day') {
        await db.days.put({
          ...seed.days[0],
          title: '用户更新的日期',
        })
      } else if (target === 'preference') {
        await db.itineraryItems.put({
          ...seed.items[0],
          replanPreference: { priority: 'must_keep' },
          updatedAt: 2,
        })
      } else {
        await db.ledgerExpenses.put({
          ...seed.expense,
          title: '用户更新的费用',
          updatedAt: 2,
        })
      }

      await expect(executeAdaptiveReplanAction(prepared))
        .rejects.toThrow('旅行、票据或账本内容已变化')
      await expect(db.tripReplanEvents.count()).resolves.toBe(0)
      await expect(db.tripReplanRecords.count()).resolves.toBe(0)
    }
  })

  it('rolls back every object when the sync outbox write fails', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'late',
      item: seed.items[0],
      operationFingerprint: 'ai-action:run-3:replan',
    })
    const outboxAdd = vi.spyOn(db.syncOutbox, 'add')
      .mockRejectedValueOnce(new Error('outbox unavailable'))

    await expect(executeAdaptiveReplanAction(prepared))
      .rejects.toThrow('outbox unavailable')
    expect((await db.itineraryItems.get('item-1'))?.startTime).toBe('10:00')
    await expect(db.tripReplanEvents.count()).resolves.toBe(0)
    await expect(db.tripReplanRecords.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
    await expect(db.syncOutbox.count()).resolves.toBe(0)

    outboxAdd.mockRestore()
    await expect(executeAdaptiveReplanAction(prepared)).resolves.toMatchObject({
      changed: true,
      changedItemCount: 2,
    })
  })

  it('does not accept a replay marker when the final snapshot was changed', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'late',
      item: seed.items[0],
      operationFingerprint: 'ai-action:run-4:replan',
    })
    await executeAdaptiveReplanAction(prepared)
    const item = await db.itineraryItems.get('item-1')
    await db.itineraryItems.put({
      ...item!,
      startTime: '15:00',
      updatedAt: item!.updatedAt + 1,
    })

    await expect(executeAdaptiveReplanAction(prepared))
      .rejects.toThrow('突发重排后的行程已变化')
  })

  it('does not accept a replay marker when the event audit fields were changed', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'late',
      item: seed.items[0],
      operationFingerprint: 'ai-action:run-4b:replan',
    })
    await executeAdaptiveReplanAction(prepared)
    await db.tripReplanEvents.update(prepared.eventId, {
      delayMinutes: 90,
    })

    await expect(executeAdaptiveReplanAction(prepared))
      .rejects.toThrow('突发重排记录不完整')
  })

  it('changes only explicit rain-sensitive items for a weather report', async () => {
    const seed = buildSeed()
    seed.items[0].replanPreference = {
      weatherSuitability: 'avoid_rain',
    }
    await seedDatabase(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      disruptionKind: 'weather_unsuitable',
      operationFingerprint: 'ai-action:run-5:replan',
      strategy: 'least_change',
    })

    expect(prepared.selectedOption.diff.itemChanges).toMatchObject([{
      changeType: 'skipped',
      itemId: 'item-1',
    }])
    await executeAdaptiveReplanAction(prepared)
    await expect(db.itineraryItems.get('item-1')).resolves.toMatchObject({
      executionState: { status: 'skipped' },
    })
    await expect(db.itineraryItems.get('item-2')).resolves.not.toHaveProperty(
      'executionState',
    )
    await expect(db.itineraryItems.get('item-3')).resolves.not.toHaveProperty(
      'executionState',
    )
  })

  it('does not write patches whose business state is already unchanged', async () => {
    const seed = buildSeed()
    seed.items[0].executionState = {
      status: 'skipped',
      updatedAt: 1,
    }
    seed.items[0].replanPreference = {
      weatherSuitability: 'avoid_rain',
    }
    seed.items[1].replanPreference = {
      weatherSuitability: 'avoid_rain',
    }
    await seedDatabase(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      disruptionKind: 'weather_unsuitable',
      operationFingerprint: 'ai-action:run-6:replan',
      strategy: 'least_change',
    })

    expect(prepared.selectedOption.diff.itemChanges).toMatchObject([
      { changeType: 'unchanged', itemId: 'item-1' },
      { changeType: 'skipped', itemId: 'item-2' },
    ])
    expect(prepared.selectedOption.itemPatches.map((entry) => entry.itemId))
      .toEqual(['item-2'])
    await expect(executeAdaptiveReplanAction(prepared)).resolves.toMatchObject({
      changed: true,
      changedItemCount: 1,
    })
    await expect(db.itineraryItems.get('item-1')).resolves.toMatchObject({
      executionState: { status: 'skipped', updatedAt: 1 },
      updatedAt: 1,
    })
    await expect(db.itineraryItems.get('item-2')).resolves.toMatchObject({
      executionState: { status: 'skipped' },
    })
  })
})

function buildSeed() {
  const trip: Trip = {
    createdAt: 1,
    destination: '英国',
    endDate: '2026-07-11',
    id: 'trip-1',
    startDate: '2026-07-10',
    title: '英国旅行',
    updatedAt: 1,
  }
  const days: Day[] = [
    {
      date: '2026-07-10',
      id: 'day-1',
      sortOrder: 1,
      title: '伦敦',
      tripId: trip.id,
    },
    {
      date: '2026-07-11',
      id: 'day-2',
      sortOrder: 2,
      title: '爱丁堡',
      tripId: trip.id,
    },
  ]
  const items: ItineraryItem[] = [
    {
      createdAt: 1,
      dayId: days[0].id,
      endTime: '11:00',
      id: 'item-1',
      sortOrder: 1,
      startTime: '10:00',
      ticketIds: [],
      title: '伦敦眼',
      tripId: trip.id,
      updatedAt: 1,
    },
    {
      createdAt: 1,
      dayId: days[0].id,
      endTime: '13:00',
      id: 'item-2',
      sortOrder: 2,
      startTime: '12:00',
      ticketIds: ['ticket-1'],
      title: '大本钟',
      tripId: trip.id,
      updatedAt: 1,
    },
    {
      createdAt: 1,
      dayId: days[1].id,
      endTime: '10:00',
      id: 'item-3',
      sortOrder: 1,
      startTime: '09:00',
      ticketIds: [],
      title: '爱丁堡城堡',
      tripId: trip.id,
      updatedAt: 1,
    },
  ]
  const ticket: TicketMeta = {
    createdAt: 1,
    fileName: 'big-ben.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    itemId: 'item-2',
    mimeType: 'application/pdf',
    scope: 'item',
    size: 100,
    storageMode: 'reference',
    title: '大本钟门票',
    tripId: trip.id,
    updatedAt: 1,
  }
  const expense: LedgerExpense = {
    amountMinor: 5000,
    category: 'admission',
    createdAt: 1,
    currency: 'GBP',
    date: days[0].date,
    id: 'expense-1',
    itemIds: ['item-2'],
    source: { kind: 'ticket', sourceId: ticket.id },
    splitMode: 'equal',
    splitShares: [],
    status: 'confirmed',
    title: '大本钟门票',
    tripId: trip.id,
    updatedAt: 1,
  }
  return { days, expense, items, ticket, trip }
}

async function seedDatabase(seed: ReturnType<typeof buildSeed>) {
  await db.transaction(
    'rw',
    [
      db.trips,
      db.days,
      db.itineraryItems,
      db.ticketMetas,
      db.ledgerExpenses,
    ],
    async () => {
      await db.trips.put(seed.trip)
      await db.days.bulkPut(seed.days)
      await db.itineraryItems.bulkPut(seed.items)
      await db.ticketMetas.put(seed.ticket)
      await db.ledgerExpenses.put(seed.expense)
    },
  )
}
