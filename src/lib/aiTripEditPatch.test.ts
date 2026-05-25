import { describe, expect, it } from 'vitest'
import { buildAiTripEditPatchPreview, validateAiTripEditPatchPlan } from './aiTripEditPatch'
import type { AiTripEditContext } from './aiTripEditContext'

describe('aiTripEditPatch', () => {
  it('accepts valid update, move, delete, and add operations', () => {
    const result = validateAiTripEditPatchPlan({
      operations: [
        { changes: { title: '西湖深度散步', startTime: '09:30', endTime: '10:30' }, itemId: 'item_1', type: 'update_item' },
        { itemId: 'item_2', targetDayId: 'day_2', targetSortOrder: 1, targetStartTime: '15:00', type: 'move_item' },
        { itemId: 'item_3', type: 'delete_item' },
        { item: { title: '咖啡休息', startTime: '16:00', endTime: '16:30' }, targetDayId: 'day_1', type: 'add_item' },
      ],
      summary: '调整行程节奏',
    }, context())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.operations).toHaveLength(4)
    }
  })

  it('rejects unknown operations, bad IDs, invalid times, and forbidden fields', () => {
    expect(validateAiTripEditPatchPlan({
      operations: [{ type: 'rewrite_all' }],
      summary: 'bad',
    }, context()).ok).toBe(false)

    expect(validateAiTripEditPatchPlan({
      operations: [{ changes: { title: 'A' }, itemId: 'missing', type: 'update_item' }],
      summary: 'bad',
    }, context()).ok).toBe(false)

    expect(validateAiTripEditPatchPlan({
      operations: [{ item: { endTime: '09:00', startTime: '10:00', title: 'A' }, targetDayId: 'day_1', type: 'add_item' }],
      summary: 'bad',
    }, context()).ok).toBe(false)

    const forbidden = validateAiTripEditPatchPlan({
      operations: [{ changes: { title: 'A', ticketIds: ['ticket_1'] }, itemId: 'item_1', type: 'update_item' }],
      summary: 'bad',
    }, context())
    expect(forbidden.ok).toBe(false)
    if (!forbidden.ok) {
      expect(forbidden.errors.some((error) => error.path.includes('ticketIds'))).toBe(true)
    }
  })

  it('rejects script-like strings', () => {
    const result = validateAiTripEditPatchPlan({
      operations: [{ changes: { title: '<script>alert(1)</script>' }, itemId: 'item_1', type: 'update_item' }],
      summary: 'bad',
    }, context())

    expect(result.ok).toBe(false)
  })

  it('builds Chinese diff preview and ticket-bound delete warning', () => {
    const plan = {
      operations: [
        { changes: { title: '西湖深度散步' }, itemId: 'item_1', type: 'update_item' as const },
        { itemId: 'item_2', targetDayId: 'day_2', type: 'move_item' as const },
        { itemId: 'item_3', type: 'delete_item' as const },
        { item: { title: '咖啡休息' }, targetDayId: 'day_1', type: 'add_item' as const },
      ],
      summary: '调整行程',
    }

    const preview = buildAiTripEditPatchPreview(plan, context())

    expect(preview.lines.join('\n')).toContain('修改：西湖')
    expect(preview.lines.join('\n')).toContain('移动：灵隐寺')
    expect(preview.lines.join('\n')).toContain('删除：演出票')
    expect(preview.lines.join('\n')).toContain('新增')
    expect(preview.warnings[0]).toContain('票据绑定')
  })
})

function context(): AiTripEditContext {
  return {
    days: [
      {
        date: '2026-07-10',
        id: 'day_1',
        items: [
          { dayId: 'day_1', id: 'item_1', title: '西湖', startTime: '09:00' },
          { dayId: 'day_1', id: 'item_2', title: '灵隐寺', startTime: '11:00' },
          { dayId: 'day_1', hasTicketBindings: true, id: 'item_3', title: '演出票', startTime: '19:00' },
        ],
        title: '第一天',
      },
      {
        date: '2026-07-11',
        id: 'day_2',
        items: [],
        title: '第二天',
      },
    ],
    trip: {
      destination: '杭州',
      endDate: '2026-07-11',
      id: 'trip_1',
      startDate: '2026-07-10',
      title: '杭州两日',
    },
  }
}
