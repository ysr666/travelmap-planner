import { describe, expect, it } from 'vitest'
import {
  mergeObjectPayloadFields,
  resolveObjectSyncConflictPayload,
} from './objectSyncMerge'
import type { ItineraryItem, ObjectSyncConflict, Trip } from '../types'

describe('object sync field merge', () => {
  it('auto merges different fields from the same base', () => {
    const base = buildItem({ title: '涩谷散步', startTime: '09:00' })
    const local = buildItem({ ...base, title: '涩谷街区散步' })
    const remote = buildItem({ ...base, startTime: '10:00' })

    const result = mergeObjectPayloadFields({
      basePayload: base,
      localPayload: local,
      now: 300,
      objectType: 'item',
      remotePayload: remote,
    })

    expect(result.status).toBe('merged')
    if (result.status === 'merged') {
      expect(result.payload).toMatchObject({
        startTime: '10:00',
        title: '涩谷街区散步',
        updatedAt: 300,
      })
    }
  })

  it('creates a field conflict for same-field divergent edits', () => {
    const base = buildItem({ title: '涩谷散步' })
    const local = buildItem({ ...base, title: '涩谷购物' })
    const remote = buildItem({ ...base, title: '涩谷夜景' })

    const result = mergeObjectPayloadFields({
      basePayload: base,
      localPayload: local,
      objectType: 'item',
      remotePayload: remote,
    })

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.conflicts).toEqual([
        expect.objectContaining({
          fieldPath: 'title',
          label: '标题',
          localValue: '涩谷购物',
          remoteValue: '涩谷夜景',
        }),
      ])
    }
  })

  it('tracks item time zone fields during conflict detection', () => {
    const base = buildItem({ startTimeZone: 'Europe/London' })
    const local = buildItem({ ...base, startTimeZone: 'Europe/Paris', endDate: '2026-06-11' })
    const remote = buildItem({ ...base, startTimeZone: 'Asia/Shanghai' })

    const result = mergeObjectPayloadFields({
      basePayload: base,
      localPayload: local,
      objectType: 'item',
      remotePayload: remote,
    })

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.conflicts.map((field) => field.fieldPath)).toEqual(['startTimeZone'])
    }
  })

  it('treats execution state and its timestamp as one atomic conflict field', () => {
    const base = buildItem()
    const local = buildItem({ executionState: { status: 'completed', updatedAt: 200 } })
    const remote = buildItem({ executionState: { status: 'skipped', updatedAt: 300 } })
    const result = mergeObjectPayloadFields({ basePayload: base, localPayload: local, objectType: 'item', remotePayload: remote })

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.conflicts).toEqual([expect.objectContaining({ fieldPath: 'executionState', label: '旅行执行状态' })])
    }
  })

  it('clears execution state when a remote merge moves an item to another day', () => {
    const base = buildItem({ executionState: { status: 'completed', updatedAt: 100 } })
    const local = buildItem({ ...base })
    const remote = buildItem({ ...base, dayId: 'day_2' })
    const result = mergeObjectPayloadFields({ basePayload: base, localPayload: local, objectType: 'item', remotePayload: remote })

    expect(result.status).toBe('merged')
    if (result.status === 'merged') {
      expect((result.payload as ItineraryItem).dayId).toBe('day_2')
      expect((result.payload as ItineraryItem).executionState).toBeUndefined()
    }
  })

  it('auto merges append-only notes', () => {
    const base: Trip = {
      createdAt: 1,
      destination: '东京',
      endDate: '2026-04-03',
      id: 'trip_1',
      notes: '基础备注',
      startDate: '2026-04-01',
      title: '东京',
      updatedAt: 10,
    }
    const local = { ...base, notes: '基础备注\n此设备新增' }
    const remote = { ...base, notes: '基础备注\n账号新增' }

    const result = mergeObjectPayloadFields({
      basePayload: base,
      localPayload: local,
      now: 500,
      objectType: 'trip',
      remotePayload: remote,
    })

    expect(result.status).toBe('merged')
    if (result.status === 'merged') {
      expect((result.payload as Trip).notes).toBe('基础备注\n此设备新增\n账号新增')
    }
  })

  it('resolves a notes conflict by merging both versions', () => {
    const conflict: ObjectSyncConflict = {
      conflictType: 'field_conflict',
      createdAt: 1,
      fields: [{
        allowNotesMerge: true,
        defaultResolution: 'local',
        fieldPath: 'notes',
        label: '备注',
        localValue: '此设备备注',
        remoteValue: '账号备注',
      }],
      id: 'conflict_1',
      localPayload: buildItem({ notes: '此设备备注' }),
      objectId: 'item_1',
      objectKey: 'item:item_1',
      objectLabel: '行程点',
      objectType: 'item',
      remotePayload: buildItem({ notes: '账号备注' }),
      status: 'pending',
      tripId: 'trip_1',
      updatedAt: 1,
    }

    const result = resolveObjectSyncConflictPayload(conflict, {
      fieldResolutions: { notes: 'merge_notes' },
    }, 900)

    expect(result).toMatchObject({ operation: 'upsert' })
    if (result.operation === 'upsert') {
      expect((result.payload as ItineraryItem).notes).toBe('此设备备注\n账号备注')
      expect((result.payload as ItineraryItem).updatedAt).toBe(900)
    }
  })
})

function buildItem(patch: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day_1',
    id: 'item_1',
    ticketIds: [],
    sortOrder: 1,
    title: '涩谷散步',
    tripId: 'trip_1',
    updatedAt: 100,
    ...patch,
  }
}
