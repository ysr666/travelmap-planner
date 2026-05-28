import { describe, expect, it } from 'vitest'
import { buildAiTripEditPatchPreview, deriveAiTripEditPatchImpact, validateAiTripEditPatchPlan } from './aiTripEditPatch'
import type { AiTripEditContext } from './aiTripEditContext'

describe('aiTripEditPatch', () => {
  it('accepts valid granular operations', () => {
    const result = validateAiTripEditPatchPlan({
      operations: [
        { itemId: 'item_1', reason: '调整标题。', title: '西湖深度散步', type: 'update_item_title' },
        { endTime: '10:30', itemId: 'item_1', reason: '调整时间。', startTime: '09:30', type: 'update_item_time' },
        { address: '西湖区', itemId: 'item_1', locationName: '西湖景区', reason: '补充地点。', type: 'update_item_location_text' },
        { itemId: 'item_1', note: '缺少地址，请补充。', reason: '标记缺失信息。', type: 'update_item_note' },
        { itemId: 'item_1', previousTransportDurationMinutes: 15, previousTransportMode: 'walk', reason: '补充交通。', type: 'update_item_transport' },
        { itemId: 'item_2', reason: '移动到第二天。', targetDayId: 'day_2', targetSortOrder: 1, targetStartTime: '15:00', type: 'move_item' },
        { itemId: 'item_3', reason: '减少安排密度。', type: 'remove_item' },
        { item: { endTime: '16:30', startTime: '16:00', title: '咖啡休息' }, reason: '增加休息。', targetDayId: 'day_1', type: 'add_item' },
        { dayId: 'day_2', reason: '调整日期标题。', title: '轻松第二天', type: 'update_day_title' },
      ],
      summary: '调整行程节奏',
    }, context())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.operations).toHaveLength(9)
    }
  })

  it('accepts no-op only with a clear warning', () => {
    const result = validateAiTripEditPatchPlan({
      operations: [],
      summary: '未生成可写入修改',
      warnings: ['暂未识别可安全自动转换的修改。'],
    }, context())

    expect(result.ok).toBe(true)
    expect(validateAiTripEditPatchPlan({ operations: [], summary: 'bad' }, context()).ok).toBe(false)
  })

  it('rejects unknown operations, bad IDs, invalid times, too many operations, and forbidden fields', () => {
    expect(validateAiTripEditPatchPlan({
      operations: [{ reason: 'bad', type: 'rewrite_all' }],
      summary: 'bad',
    }, context()).ok).toBe(false)

    expect(validateAiTripEditPatchPlan({
      operations: [{ itemId: 'missing', reason: 'bad', title: 'A', type: 'update_item_title' }],
      summary: 'bad',
    }, context()).ok).toBe(false)

    expect(validateAiTripEditPatchPlan({
      operations: [{ item: { endTime: '09:00', startTime: '10:00', title: 'A' }, reason: 'bad', targetDayId: 'day_1', type: 'add_item' }],
      summary: 'bad',
    }, context()).ok).toBe(false)

    expect(validateAiTripEditPatchPlan({
      operations: Array.from({ length: 21 }, (_, index) => ({
        itemId: 'item_1',
        reason: `原因 ${index}`,
        title: `标题 ${index}`,
        type: 'update_item_title',
      })),
      summary: 'bad',
    }, context()).ok).toBe(false)

    const forbidden = validateAiTripEditPatchPlan({
      operations: [{ itemId: 'item_1', reason: 'bad', ticketIds: ['ticket_1'], title: 'A', type: 'update_item_title' }],
      summary: 'bad',
    }, context())
    expect(forbidden.ok).toBe(false)
    if (!forbidden.ok) {
      expect(forbidden.errors.some((error) => error.path.includes('ticketIds'))).toBe(true)
    }
  })

  it('rejects unknown operation fields instead of passing metadata through', () => {
    const result = validateAiTripEditPatchPlan({
      affectedItemIds: ['item_1'],
      operations: [{ itemId: 'item_1', metadata: { unsafe: true }, reason: 'bad', title: 'A', type: 'update_item_title' }],
      summary: 'bad',
    }, context())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === 'affectedItemIds')).toBe(true)
      expect(result.errors.some((error) => error.path.includes('metadata'))).toBe(true)
    }
  })

  it('rejects unsafe reorder lists', () => {
    expect(validateAiTripEditPatchPlan({
      operations: [{ dayId: 'day_1', orderedItemIds: ['item_1', 'item_1'], reason: 'bad', type: 'reorder_day_items' }],
      summary: 'bad',
    }, context()).ok).toBe(false)

    expect(validateAiTripEditPatchPlan({
      operations: [{ dayId: 'day_1', orderedItemIds: ['item_1', 'item_2'], reason: 'bad', type: 'reorder_day_items' }],
      summary: 'bad',
    }, context()).ok).toBe(false)
  })

  it('rejects script-like strings', () => {
    const result = validateAiTripEditPatchPlan({
      operations: [{ itemId: 'item_1', reason: 'bad', title: '<script>alert(1)</script>', type: 'update_item_title' }],
      summary: 'bad',
    }, context())

    expect(result.ok).toBe(false)
  })

  it('builds Chinese diff preview, route warning, and locally derived affected IDs', () => {
    const plan = {
      operations: [
        { itemId: 'item_1', reason: '调整标题。', title: '西湖深度散步', type: 'update_item_title' as const },
        { itemId: 'item_2', reason: '移动到第二天。', targetDayId: 'day_2', type: 'move_item' as const },
        { itemId: 'item_3', reason: '减少密度。', type: 'remove_item' as const },
        { item: { title: '咖啡休息' }, reason: '增加休息。', targetDayId: 'day_1', type: 'add_item' as const },
      ],
      summary: '调整行程',
    }

    const preview = buildAiTripEditPatchPreview(plan, context())
    const impact = deriveAiTripEditPatchImpact(plan, context())

    expect(preview.lines.join('\n')).toContain('修改标题：西湖')
    expect(preview.lines.join('\n')).toContain('移动：灵隐寺')
    expect(preview.lines.join('\n')).toContain('移除：演出票')
    expect(preview.lines.join('\n')).toContain('新增')
    expect(preview.warnings.join('\n')).toContain('票据绑定')
    expect(preview.warnings.join('\n')).toContain('路线缓存')
    expect(impact.affectedItemIds).toEqual(['item_1', 'item_2', 'item_3'])
    expect(impact.affectedDayIds).toEqual(['day_1', 'day_2'])
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
          { dayId: 'day_1', hasTicketBindings: true, id: 'item_3', ticketBoundState: 'item_bound', ticketCount: 1, title: '演出票', startTime: '19:00' },
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
