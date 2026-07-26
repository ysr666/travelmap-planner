// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/database'
import { ItineraryBaselineConflictError } from '../db/repositories'
import type { ItineraryItem, Trip } from '../types'
import {
  updateItineraryItemExecutionStateAtomically,
  updateItineraryItemReplanPreferenceAtomically,
} from './itemStateUpdates'

beforeEach(async () => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  db.close()
  await db.delete()
  await db.open()
})

describe('item state updates', () => {
  it('atomically updates execution state, sync state, and one stable history record', async () => {
    const { item, trip } = await seedItemState()
    const options = {
      expectedUpdatedAt: item.updatedAt,
      historyTitle: 'AI 更新行程进度',
      now: 100,
      operationFingerprint: 'execution-completed',
      tripId: trip.id,
    }

    const first = await updateItineraryItemExecutionStateAtomically(
      item.id,
      'completed',
      options,
    )
    const retry = await updateItineraryItemExecutionStateAtomically(
      item.id,
      'completed',
      options,
    )

    expect(first).toMatchObject({
      changed: true,
      item: { executionState: { status: 'completed', updatedAt: 100 } },
    })
    expect(retry).toMatchObject({ changed: false })
    await expect(db.itineraryItems.get(item.id)).resolves.toMatchObject({
      executionState: { status: 'completed', updatedAt: 100 },
      updatedAt: 100,
    })
    await expect(db.objectSyncStates.get(`item:${item.id}`)).resolves.toMatchObject({
      objectId: item.id,
      objectType: 'item',
    })
    await expect(db.syncOutbox.count()).resolves.toBe(2)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('merges and persists bounded replan preferences', async () => {
    const { item, trip } = await seedItemState({
      replanPreference: { flexibility: 'movable', priority: 'normal' },
    })

    const result = await updateItineraryItemReplanPreferenceAtomically(
      item.id,
      {
        bufferMinutes: 30,
        flexibility: 'movable',
        priority: 'must_keep',
        weatherSuitability: 'avoid_rain',
      },
      {
        expectedUpdatedAt: item.updatedAt,
        historyTitle: 'AI 更新重排偏好',
        now: 200,
        operationFingerprint: 'preference-update',
        tripId: trip.id,
      },
    )

    expect(result.changed).toBe(true)
    await expect(db.itineraryItems.get(item.id)).resolves.toMatchObject({
      replanPreference: {
        bufferMinutes: 30,
        flexibility: 'movable',
        priority: 'must_keep',
        weatherSuitability: 'avoid_rain',
      },
      updatedAt: 200,
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('restores an item to active by removing its completed state', async () => {
    const { item, trip } = await seedItemState({
      executionState: { status: 'completed', updatedAt: 1 },
    })

    const result = await updateItineraryItemExecutionStateAtomically(
      item.id,
      null,
      {
        expectedUpdatedAt: item.updatedAt,
        historyTitle: 'AI 更新行程进度',
        now: 300,
        operationFingerprint: 'execution-active',
        tripId: trip.id,
      },
    )

    expect(result.changed).toBe(true)
    const restored = await db.itineraryItems.get(item.id)
    expect(restored?.executionState).toBeUndefined()
    expect(restored?.updatedAt).toBe(300)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('rejects a stale item baseline without writing history or sync state', async () => {
    const { item, trip } = await seedItemState()
    await db.itineraryItems.update(item.id, { notes: '用户刚刚修改', updatedAt: 2 })

    await expect(updateItineraryItemExecutionStateAtomically(
      item.id,
      'skipped',
      {
        expectedUpdatedAt: item.updatedAt,
        historyTitle: 'AI 更新行程进度',
        operationFingerprint: 'stale-execution',
        tripId: trip.id,
      },
    )).rejects.toBeInstanceOf(ItineraryBaselineConflictError)
    const staleItem = await db.itineraryItems.get(item.id)
    expect(staleItem).toMatchObject({
      notes: '用户刚刚修改',
      updatedAt: 2,
    })
    expect(staleItem).not.toHaveProperty('executionState')
    await expect(db.syncOutbox.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('rolls back item and history when the second sync outbox write fails', async () => {
    const { item, trip } = await seedItemState()
    const addOutboxEntry = db.syncOutbox.add.bind(db.syncOutbox)
    vi.spyOn(db.syncOutbox, 'add')
      .mockImplementationOnce(addOutboxEntry)
      .mockRejectedValueOnce(new Error('history outbox unavailable'))

    await expect(updateItineraryItemExecutionStateAtomically(
      item.id,
      'completed',
      {
        expectedUpdatedAt: item.updatedAt,
        historyTitle: 'AI 更新行程进度',
        operationFingerprint: 'rollback-execution',
        tripId: trip.id,
      },
    )).rejects.toThrow('history outbox unavailable')
    const rolledBackItem = await db.itineraryItems.get(item.id)
    expect(rolledBackItem).toMatchObject({
      updatedAt: item.updatedAt,
    })
    expect(rolledBackItem).not.toHaveProperty('executionState')
    await expect(db.syncOutbox.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })
})

async function seedItemState(
  itemOverrides: Partial<ItineraryItem> = {},
) {
  const trip: Trip = {
    createdAt: 1,
    destination: '英国',
    endDate: '2026-07-21',
    id: 'trip-item-state',
    startDate: '2026-07-10',
    title: '英国旅行',
    updatedAt: 1,
  }
  const item: ItineraryItem = {
    createdAt: 1,
    dayId: 'day-item-state',
    id: 'item-state',
    sortOrder: 1,
    ticketIds: [],
    title: '伦敦眼',
    tripId: trip.id,
    updatedAt: 1,
    ...itemOverrides,
  }
  await db.transaction('rw', [db.trips, db.itineraryItems], async () => {
    await db.trips.put(trip)
    await db.itineraryItems.put(item)
  })
  return { item, trip }
}
