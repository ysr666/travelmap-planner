import { describe, expect, it } from 'vitest'
import { defaultAiPrivacySettings } from '../aiPrivacy'
import {
  buildAiActionPlanProviderRequest,
  buildDeterministicAiActionPlan,
  shouldRequestAiActionPlan,
  validateAiActionPlanCommandBinding,
} from './planner'
import { validateAiActionPlan } from './validation'

function buildProviderPlan(
  actionId: string,
  args: Record<string, unknown>,
) {
  const validation = validateAiActionPlan({
    schemaVersion: 'ai_action_plan.v1',
    steps: [{
      actionId,
      args,
      dependsOn: [],
      id: 'provider-step',
    }],
    summary: '测试动作',
  })
  expect(validation.ok).toBe(true)
  if (!validation.ok) throw new Error(validation.errors.join('；'))
  return validation.plan
}

describe('AI Action Gateway planner', () => {
  it('uses deterministic local planning for registered navigation, itinerary, ledger, ticket, place, and repair commands', () => {
    expect(buildDeterministicAiActionPlan('打开资料中心')?.steps[0]).toMatchObject({
      actionId: 'workspace.open@1',
      args: { target: 'documents' },
    })
    expect(buildDeterministicAiActionPlan('把第一站改到10点30分')?.steps[0]).toMatchObject({
      actionId: 'item.time.update@1',
      args: { startTime: '10:30', target: 'first_item' },
    })
    expect(buildDeterministicAiActionPlan('第一天新增伦敦眼，10:00-11:00')?.steps[0]).toMatchObject({
      actionId: 'item.create@1',
      args: {
        day: 'first_day',
        endTime: '11:00',
        startTime: '10:00',
        title: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('把伦敦眼移到大本钟前面')?.steps[0]).toMatchObject({
      actionId: 'day.items.reorder@1',
      args: {
        anchor: '大本钟',
        position: 'before',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('把第一天的伦敦眼移到第二天大本钟后面')?.steps[0]).toMatchObject({
      actionId: 'item.move@1',
      args: {
        anchor: '大本钟',
        destinationDay: 'day:2',
        position: 'after',
        sourceDay: 'first_day',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('把伦敦眼移到第二天')?.steps[0]).toMatchObject({
      actionId: 'item.move@1',
      args: {
        destinationDay: 'day:2',
        position: 'last',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('删除第一天的伦敦眼')?.steps[0]).toMatchObject({
      actionId: 'item.delete@1',
      args: {
        day: 'first_day',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('把伦敦眼从行程中移除')?.steps[0]).toMatchObject({
      actionId: 'item.delete@1',
      args: { target: '伦敦眼' },
    })
    expect(buildDeterministicAiActionPlan('撤销刚才的删除')?.steps[0]).toMatchObject({
      actionId: 'history.undo@1',
      args: { kind: 'item_delete' },
    })
    expect(buildDeterministicAiActionPlan('恢复刚删除的伦敦眼')?.steps[0]).toMatchObject({
      actionId: 'history.undo@1',
      args: { kind: 'item_delete', target: '伦敦眼' },
    })
    expect(buildDeterministicAiActionPlan('第一站已完成')?.steps[0]).toMatchObject({
      actionId: 'item.execution.update@1',
      args: { state: 'completed', target: 'first_item' },
    })
    expect(buildDeterministicAiActionPlan('跳过伦敦眼')?.steps[0]).toMatchObject({
      actionId: 'item.execution.update@1',
      args: { state: 'skipped', target: '伦敦眼' },
    })
    expect(buildDeterministicAiActionPlan('把伦敦眼恢复为待进行')?.steps[0]).toMatchObject({
      actionId: 'item.execution.update@1',
      args: { state: 'active', target: '伦敦眼' },
    })
    expect(buildDeterministicAiActionPlan('伦敦眼不能动，必须保留')?.steps[0]).toMatchObject({
      actionId: 'item.replan.preference.update@1',
      args: {
        flexibility: 'fixed',
        priority: 'must_keep',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('第一天的伦敦眼预留30分钟，下雨别去')?.steps[0]).toMatchObject({
      actionId: 'item.replan.preference.update@1',
      args: {
        bufferMinutes: 30,
        day: 'first_day',
        target: '伦敦眼',
        weatherSuitability: 'avoid_rain',
      },
    })
    expect(buildDeterministicAiActionPlan('伦敦眼可以跳过')?.steps[0]).toMatchObject({
      actionId: 'item.replan.preference.update@1',
      args: {
        flexibility: 'optional',
        priority: 'low',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('我晚到45分钟，按最少改动调整')?.steps[0]).toMatchObject({
      actionId: 'trip.replan.apply@1',
      args: {
        delayMinutes: 45,
        kind: 'late',
        strategy: 'least_change',
      },
    })
    expect(buildDeterministicAiActionPlan('“伦敦眼”闭馆了，尽量保留')?.steps[0]).toMatchObject({
      actionId: 'trip.replan.apply@1',
      args: {
        kind: 'closure',
        strategy: 'preserve_most',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('伦敦眼闭馆了，必须保留')?.steps[0]).toMatchObject({
      actionId: 'trip.replan.apply@1',
      args: {
        kind: 'closure',
        strategy: 'preserve_most',
        target: '伦敦眼',
      },
    })
    expect(buildDeterministicAiActionPlan('第一天下雨，按最省路程调整')?.steps[0]).toMatchObject({
      actionId: 'trip.replan.apply@1',
      args: {
        day: 'first_day',
        kind: 'weather_unsuitable',
        strategy: 'shortest_route',
      },
    })
    expect(buildDeterministicAiActionPlan('7月10日下雨，按最少改动调整')?.steps[0]).toMatchObject({
      actionId: 'trip.replan.apply@1',
      args: {
        day: '07-10',
        kind: 'weather_unsuitable',
        strategy: 'least_change',
      },
    })
    expect(buildDeterministicAiActionPlan('2026-07-10 下雨，按最少改动调整')?.steps[0]).toMatchObject({
      actionId: 'trip.replan.apply@1',
      args: {
        day: '2026-07-10',
        kind: 'weather_unsuitable',
        strategy: 'least_change',
      },
    })
    expect(buildDeterministicAiActionPlan('当前站取消了')?.steps[0]).toMatchObject({
      actionId: 'trip.replan.apply@1',
      args: {
        kind: 'cancelled',
        target: 'current_item',
      },
    })
    expect(buildDeterministicAiActionPlan('把“伦敦眼”标记为完成，不是第一站')?.steps[0])
      .toMatchObject({
        actionId: 'item.execution.update@1',
        args: { state: 'completed', target: '伦敦眼' },
      })
    expect(buildDeterministicAiActionPlan('把所有问题修复完成')?.steps[0]).toMatchObject({
      actionId: 'trip.repair@1',
    })
    expect(buildDeterministicAiActionPlan('第一站未完成')).toBeNull()
    expect(buildDeterministicAiActionPlan('不要把第一站标记为完成')).toBeNull()
    expect(buildDeterministicAiActionPlan('第一站是不是已完成')).toBeNull()
    expect(buildDeterministicAiActionPlan('伦敦眼可以跳过吗？')).toBeNull()
    expect(buildDeterministicAiActionPlan('不要把伦敦眼固定')).toBeNull()
    expect(buildDeterministicAiActionPlan('删除伦敦眼门票')).toBeNull()
    expect(buildDeterministicAiActionPlan('不要删除伦敦眼')).toBeNull()
    expect(buildDeterministicAiActionPlan('无需生成第一天路线')).toBeNull()
    expect(buildDeterministicAiActionPlan('取消伦敦眼预订')).toBeNull()
    expect(buildDeterministicAiActionPlan('如果我晚到30分钟会怎样')).toBeNull()
    expect(buildDeterministicAiActionPlan('不要因为下雨重排')).toBeNull()
    expect(buildDeterministicAiActionPlan('伦敦眼闭馆了怎么办？')).toBeNull()
    expect(buildDeterministicAiActionPlan('“伦敦眼”没有闭馆，帮我调整行程')).toBeNull()
    expect(buildDeterministicAiActionPlan('“伦敦眼”并未闭馆，请按最少改动调整行程')).toBeNull()
    expect(buildDeterministicAiActionPlan('假设“伦敦眼”闭馆，请调整后续')).toBeNull()
    expect(buildDeterministicAiActionPlan('“伦敦眼”闭馆了吗，请帮我分析后续影响')).toBeNull()
    expect(buildDeterministicAiActionPlan('Is "London Eye" closed?')).toBeNull()
    expect(buildDeterministicAiActionPlan('Do not replan because "London Eye" is closed')).toBeNull()
    expect(buildDeterministicAiActionPlan('伦敦眼可以删除吗？')).toBeNull()
    expect(buildDeterministicAiActionPlan('删除伦敦眼不用')).toBeNull()
    expect(buildDeterministicAiActionPlan('伦敦眼闭馆了，但不是当前站，请按最少改动调整')?.steps[0])
      .toMatchObject({
        actionId: 'trip.replan.apply@1',
        args: {
          kind: 'closure',
          strategy: 'least_change',
          target: '伦敦眼',
        },
      })
    expect(shouldRequestAiActionPlan('如果我晚到30分钟，帮我调整行程')).toBe(false)
    expect(shouldRequestAiActionPlan('不要因为下雨调整行程')).toBe(false)
    expect(shouldRequestAiActionPlan('伦敦眼闭馆了怎么办？')).toBe(false)
    expect(shouldRequestAiActionPlan('能不能帮我处理伦敦眼闭馆')).toBe(false)
    expect(shouldRequestAiActionPlan('“伦敦眼”并未闭馆，请按最少改动调整行程')).toBe(false)
    expect(shouldRequestAiActionPlan('假设“伦敦眼”闭馆，请调整后续')).toBe(false)
    expect(shouldRequestAiActionPlan('“伦敦眼”闭馆了吗，请帮我分析后续影响')).toBe(false)
    expect(shouldRequestAiActionPlan('不要删除伦敦眼')).toBe(false)
    expect(shouldRequestAiActionPlan('无需生成第一天路线')).toBe(false)
    expect(shouldRequestAiActionPlan('Is "London Eye" closed?')).toBe(false)
    expect(shouldRequestAiActionPlan('Do not replan because "London Eye" is closed')).toBe(false)
    expect(shouldRequestAiActionPlan('伦敦眼可以删除吗？')).toBe(false)
    expect(shouldRequestAiActionPlan('删除伦敦眼不用')).toBe(false)
    expect(buildDeterministicAiActionPlan('第一天新增午餐 32 GBP')?.steps).toHaveLength(1)
    expect(buildDeterministicAiActionPlan('生成第一天路线预览')?.steps[0]).toMatchObject({
      actionId: 'route.preview@1',
      args: { scope: 'day', target: 'first_day' },
    })
    expect(buildDeterministicAiActionPlan('记一笔午餐 32.50 GBP')?.steps[0]).toMatchObject({
      actionId: 'ledger.expense.draft@1',
      args: { amount: '32.50', category: 'food', currency: 'GBP', title: '午餐' },
    })
    expect(buildDeterministicAiActionPlan('记一笔 2 人午餐 32.50 GBP')?.steps[0]).toMatchObject({
      actionId: 'ledger.expense.draft@1',
      args: { amount: '32.50', category: 'food', currency: 'GBP', title: '2 人午餐' },
    })
    expect(buildDeterministicAiActionPlan('找一下爱丁堡的门票')?.steps[0]).toMatchObject({
      actionId: 'ticket.open@1',
    })
    expect(buildDeterministicAiActionPlan('把「爱丁堡城堡门票」绑定到「爱丁堡城堡」')?.steps[0]).toMatchObject({
      actionId: 'ticket.bind@1',
      args: { target: '爱丁堡城堡', ticket: '爱丁堡城堡门票' },
    })
    expect(buildDeterministicAiActionPlan('不要把「爱丁堡城堡门票」绑定到「爱丁堡城堡」')).toBeNull()
    expect(buildDeterministicAiActionPlan('能不能把「爱丁堡城堡门票」关联到「爱丁堡城堡」？')).toBeNull()
    expect(buildDeterministicAiActionPlan('补全第一站地点信息')?.steps[0]).toMatchObject({
      actionId: 'place.enrich@1',
      args: { target: 'first_item' },
    })
    expect(buildDeterministicAiActionPlan('把缺失地点、路线和建议全部修复')?.steps[0]).toMatchObject({
      actionId: 'trip.repair@1',
    })
  })

  it('binds every provider-selected write to the affirmative user instruction', () => {
    const positive = buildDeterministicAiActionPlan(
      '“伦敦眼”闭馆了，按最少改动调整',
    )!
    expect(validateAiActionPlanCommandBinding(
      '“伦敦眼”闭馆了，按最少改动调整',
      positive,
    )).toEqual({ ok: true })
    expect(validateAiActionPlanCommandBinding(
      '“伦敦眼”并未闭馆，请按最少改动调整',
      positive,
    )).toMatchObject({ ok: false })

    const injected = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [{
        actionId: 'trip.replan.apply@1',
        args: {
          kind: 'closure',
          target: 'current_item',
        },
        dependsOn: [],
        id: 'replan',
      }],
      summary: '应用突发重排',
    })
    expect(injected.ok).toBe(true)
    if (!injected.ok) return
    expect(validateAiActionPlanCommandBinding(
      '帮我处理行程问题',
      injected.plan,
    )).toMatchObject({ ok: false })

    const partialRepair = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [{
        actionId: 'place.enrich@1',
        args: { target: 'first_item' },
        dependsOn: [],
        id: 'place',
      }],
      summary: '补全地点',
    })
    expect(partialRepair.ok).toBe(true)
    if (!partialRepair.ok) return
    expect(validateAiActionPlanCommandBinding(
      '把缺失地点、路线和建议全部修复',
      partialRepair.plan,
    )).toMatchObject({ ok: false })

    const ticketBinding = buildProviderPlan('ticket.bind@1', {
      target: '爱丁堡城堡',
      ticket: '爱丁堡城堡门票',
    })
    expect(validateAiActionPlanCommandBinding(
      '把「爱丁堡城堡门票」绑定到「爱丁堡城堡」',
      ticketBinding,
    )).toEqual({ ok: true })
    expect(validateAiActionPlanCommandBinding(
      '把「大英博物馆门票」绑定到「爱丁堡城堡」',
      ticketBinding,
    )).toMatchObject({ ok: false })
  })

  it('rejects provider-selected legal values that are absent from or conflict with the command', () => {
    expect(validateAiActionPlanCommandBinding(
      '伦敦眼可以删除吗？',
      buildProviderPlan('item.delete@1', { target: '伦敦眼' }),
    )).toMatchObject({ ok: false })

    expect(validateAiActionPlanCommandBinding(
      '2026-07-10 伦敦眼晚到45分钟，按尽量保留调整',
      buildProviderPlan('trip.replan.apply@1', { kind: 'late' }),
    )).toMatchObject({ ok: false })
    expect(validateAiActionPlanCommandBinding(
      '2026-07-10 伦敦眼晚到45分钟，按尽量保留调整',
      buildProviderPlan('trip.replan.apply@1', {
        day: '2026-07-10',
        delayMinutes: 45,
        kind: 'late',
        strategy: 'preserve_most',
        target: '伦敦眼',
      }),
    )).toEqual({ ok: true })

    expect(validateAiActionPlanCommandBinding(
      '记一笔 2 人午餐 32.50',
      buildProviderPlan('ledger.expense.draft@1', {
        amount: '999.99',
        category: 'shopping',
        currency: 'USD',
        date: '2030-12-31',
        title: '午餐',
      }),
    )).toMatchObject({ ok: false })
    expect(validateAiActionPlanCommandBinding(
      '记一笔 2 人午餐 32.50',
      buildProviderPlan('ledger.expense.draft@1', {
        amount: '32.50',
        category: 'food',
        title: '午餐',
      }),
    )).toEqual({ ok: true })

    expect(validateAiActionPlanCommandBinding(
      '新增一个行程点但还没确定哪天',
      buildProviderPlan('item.create@1', {
        day: 'current_day',
        startTime: '22:15',
        title: '行程点',
      }),
    )).toMatchObject({ ok: false })
    expect(validateAiActionPlanCommandBinding(
      '第一天新增伦敦眼',
      buildProviderPlan('item.create@1', {
        day: 'first_day',
        startTime: '22:15',
        title: '伦敦眼',
      }),
    )).toMatchObject({ ok: false })

    expect(validateAiActionPlanCommandBinding(
      '把伦敦眼移动到另一个日期',
      buildProviderPlan('item.move@1', {
        destinationDay: 'current_day',
        position: 'first',
        target: '伦敦眼',
      }),
    )).toMatchObject({ ok: false })
    expect(validateAiActionPlanCommandBinding(
      '把伦敦眼移到第二天',
      buildProviderPlan('item.move@1', {
        destinationDay: 'day:2',
        position: 'first',
        target: '伦敦眼',
      }),
    )).toMatchObject({ ok: false })
    expect(validateAiActionPlanCommandBinding(
      '把伦敦眼移到第二天',
      buildProviderPlan('item.move@1', {
        destinationDay: 'day:2',
        position: 'last',
        target: '伦敦眼',
      }),
    )).toEqual({ ok: true })

    expect(validateAiActionPlanCommandBinding(
      '重新生成第一天路线',
      buildProviderPlan('route.preview@1', { scope: 'trip' }),
    )).toMatchObject({ ok: false })
    expect(validateAiActionPlanCommandBinding(
      '重新生成第一天路线',
      buildProviderPlan('route.preview@1', {
        scope: 'day',
        target: 'first_day',
      }),
    )).toEqual({ ok: true })
  })

  it('builds a redacted provider request by default', () => {
    const request = buildAiActionPlanProviderRequest(
      '请处理当前旅行的问题',
      {
        activeRoute: 'item',
        currentDay: {
          date: '2026-07-10',
          id: 'day-1',
          sortOrder: 1,
          title: '秘密日期标题',
          tripId: 'trip-1',
        },
        currentItem: {
          createdAt: 1,
          dayId: 'day-1',
          id: 'item-1',
          notes: 'passport P12345678',
          sortOrder: 1,
          ticketIds: ['ticket-secret'],
          title: '秘密行程点',
          tripId: 'trip-1',
          updatedAt: 1,
        },
        days: [],
        hash: '#/item',
        items: [],
        ledgerExpenses: [],
        params: new URLSearchParams(),
        scopeLabel: '当前行程点 / 秘密行程点',
        tickets: [{
          createdAt: 1,
          fileName: 'passport-secret.pdf',
          fileType: 'pdf',
          id: 'ticket-secret',
          mimeType: 'application/pdf',
          scope: 'trip',
          size: 100,
          storageMode: 'reference',
          title: '秘密票据',
          tripId: 'trip-1',
          updatedAt: 1,
        }],
        trip: {
          createdAt: 1,
          destination: '秘密目的地',
          endDate: '2026-07-21',
          id: 'trip-1',
          startDate: '2026-07-10',
          title: '秘密旅行',
          updatedAt: 1,
        },
      },
      defaultAiPrivacySettings,
    )
    const serialized = JSON.stringify(request)

    expect(request.context.scopeLabel).toBe('当前行程点')
    expect(serialized).not.toContain('秘密')
    expect(serialized).not.toContain('passport')
    expect(serialized).not.toContain('ticket-secret')
  })

  it('requests structured AI planning only for unresolved action-like commands', () => {
    expect(shouldRequestAiActionPlan('请把这趟行程的问题都处理好')).toBe(true)
    expect(shouldRequestAiActionPlan('伦敦天气怎么样')).toBe(false)
    expect(shouldRequestAiActionPlan('补全第一站地点信息')).toBe(false)
    expect(shouldRequestAiActionPlan('把不确定的开始时间调整好')).toBe(true)
    expect(shouldRequestAiActionPlan('记录一笔金额还不确定的费用')).toBe(true)
    expect(shouldRequestAiActionPlan('记一笔 2 人午餐 32.50')).toBe(true)
    expect(shouldRequestAiActionPlan('记一笔酒店 1,000 GBP')).toBe(true)
    expect(shouldRequestAiActionPlan('新增一个行程点但还没确定哪天')).toBe(true)
    expect(shouldRequestAiActionPlan('把伦敦眼移动到另一个日期')).toBe(true)
    expect(shouldRequestAiActionPlan('删除第一天的伦敦眼')).toBe(false)
    expect(shouldRequestAiActionPlan('撤销刚才的删除')).toBe(false)
    expect(shouldRequestAiActionPlan('第一站已完成')).toBe(false)
    expect(shouldRequestAiActionPlan('伦敦眼不能动，必须保留')).toBe(false)
    expect(shouldRequestAiActionPlan('第一站未完成')).toBe(false)
    expect(shouldRequestAiActionPlan('不要把第一站标记为完成')).toBe(false)
    expect(shouldRequestAiActionPlan('第一站是不是已完成')).toBe(false)
    expect(shouldRequestAiActionPlan('伦敦眼可以跳过吗？')).toBe(false)
  })
})
