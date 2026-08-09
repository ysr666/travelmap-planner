import { describe, expect, it } from 'vitest'
import {
  AI_ACTION_PLAN_SCHEMA_VERSION,
  buildDeterministicAiActionPlan,
  listAiActionCatalog,
  shouldRequestAiActionPlan,
  validateAiActionPlan,
} from '.'

describe('AI Action Gateway V1 contract', () => {
  it('builds a versioned deterministic ticket action', () => {
    const plan = buildDeterministicAiActionPlan('找一下爱丁堡的门票')

    expect(plan).toMatchObject({
      requiresConfirmation: false,
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'ticket.open@1',
        args: { query: '爱丁堡' },
        risk: 'read_only',
      }],
    })
  })

  it('keeps ticket binding semantic and confirmation gated', () => {
    expect(buildDeterministicAiActionPlan('把「爱丁堡城堡门票」绑定到「爱丁堡城堡」')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'ticket.bind@1',
        args: { target: '爱丁堡城堡', ticket: '爱丁堡城堡门票' },
        risk: 'local_write',
      }],
    })
    for (const args of [
      { itemId: 'item-secret', target: '爱丁堡城堡', ticket: '爱丁堡城堡门票' },
      { target: 'item_secret', ticket: '爱丁堡城堡门票' },
      { target: '爱丁堡城堡', ticket: 'ticket_secret' },
      { target: '爱丁堡城堡', ticket: 'https://example.com/ticket.pdf' },
    ]) {
      expect(validateAiActionPlan({
        schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
        steps: [{ actionId: 'ticket.bind@1', args, id: 'bind' }],
        summary: '关联票据',
      }).ok).toBe(false)
    }
  })

  it('builds place and broad repair actions without conflating them', () => {
    expect(buildDeterministicAiActionPlan('补全第一站地点信息')).toMatchObject({
      requiresConfirmation: true,
      steps: [{ actionId: 'place.enrich@1', args: { target: 'first_item' } }],
    })
    expect(buildDeterministicAiActionPlan('把缺失地点、路线和建议全部修复')).toMatchObject({
      requiresConfirmation: true,
      steps: [{ actionId: 'trip.repair@1', args: { scope: 'trip' } }],
    })
  })

  it('keeps workspace targets semantic and time updates confirmation gated', () => {
    expect(buildDeterministicAiActionPlan('打开资料中心')).toMatchObject({
      requiresConfirmation: false,
      steps: [{
        actionId: 'workspace.open@1',
        args: { target: 'documents' },
        risk: 'read_only',
      }],
    })
    expect(buildDeterministicAiActionPlan('把第一站改到10点到11点30分')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'item.time.update@1',
        args: { endTime: '11:30', startTime: '10:00', target: 'first_item' },
        risk: 'local_write',
      }],
    })

    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'workspace.open@1',
        args: { target: '#/settings?token=secret' },
        id: 'open',
      }],
      summary: '打开任意路由',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'item.time.update@1',
        args: { endTime: '09:00', startTime: '10:00', target: 'first_item' },
        id: 'time',
      }],
      summary: '写入无效时间',
    }).ok).toBe(false)
  })

  it('keeps item creation and same-day reordering semantic, bounded, and confirmation gated', () => {
    expect(buildDeterministicAiActionPlan('第一天新增伦敦眼，10:00-11:00')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'item.create@1',
        args: {
          day: 'first_day',
          endTime: '11:00',
          startTime: '10:00',
          title: '伦敦眼',
        },
        risk: 'local_write',
      }],
    })
    expect(buildDeterministicAiActionPlan('把伦敦眼移到大本钟前面')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'day.items.reorder@1',
        args: {
          anchor: '大本钟',
          position: 'before',
          target: '伦敦眼',
        },
        risk: 'local_write',
      }],
    })

    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'item.create@1',
        args: {
          coordinates: { lat: 1, lng: 2 },
          day: 'day_internal_secret',
          endTime: '09:00',
          startTime: '10:00',
          title: '非法新增',
        },
        id: 'create',
      }],
      summary: '非法新增',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'day.items.reorder@1',
        args: {
          position: 'before',
          target: 'item_internal_secret',
        },
        id: 'reorder',
      }],
      summary: '非法重排',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        {
          actionId: 'item.create@1',
          args: { day: 'first_day', title: '伦敦眼' },
          id: 'create',
        },
        {
          actionId: 'day.items.reorder@1',
          args: { position: 'last', target: '伦敦眼' },
          dependsOn: ['create'],
          id: 'reorder',
        },
      ],
      summary: '新增后重排',
    }).ok).toBe(false)
  })

  it('keeps cross-day item moves semantic, bounded, and separate from structural edits', () => {
    expect(buildDeterministicAiActionPlan('把第一天的伦敦眼移到第二天大本钟前面')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'item.move@1',
        args: {
          anchor: '大本钟',
          destinationDay: 'day:2',
          position: 'before',
          sourceDay: 'first_day',
          target: '伦敦眼',
        },
        risk: 'local_write',
      }],
    })

    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'item.move@1',
        args: {
          destinationDay: 'day_internal_secret',
          functionName: 'moveAnyRecord',
          position: 'before',
          target: 'item_internal_secret',
        },
        id: 'move',
      }],
      summary: '非法跨日移动',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'item.move@1',
        args: {
          destinationDay: 'first_day',
          position: 'last',
          sourceDay: 'first_day',
          target: '伦敦眼',
        },
        id: 'move',
      }],
      summary: '同日移动',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        {
          actionId: 'item.move@1',
          args: {
            destinationDay: 'day:2',
            position: 'last',
            target: '伦敦眼',
          },
          id: 'move',
        },
        {
          actionId: 'day.items.reorder@1',
          args: { position: 'first', target: '大本钟' },
          id: 'reorder',
        },
      ],
      summary: '跨日移动后重排',
    }).ok).toBe(false)
  })

  it('keeps item deletion reversible and history undo restricted to semantic targets', () => {
    expect(buildDeterministicAiActionPlan('删除第一天的伦敦眼')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'item.delete@1',
        args: { day: 'first_day', target: '伦敦眼' },
        risk: 'local_write',
      }],
    })
    expect(buildDeterministicAiActionPlan('撤销刚才的删除')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'history.undo@1',
        args: { kind: 'item_delete' },
        risk: 'local_write',
      }],
    })

    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'item.delete@1',
        args: {
          recordId: 'replan_record_secret',
          snapshot: { items: [] },
          target: 'item_internal_secret',
        },
        id: 'delete',
      }],
      summary: '非法删除',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'history.undo@1',
        args: {
          kind: 'arbitrary_table',
          recordId: 'replan_record_secret',
          target: 'current_item',
        },
        id: 'undo',
      }],
      summary: '非法撤销',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        {
          actionId: 'item.delete@1',
          args: { target: '伦敦眼' },
          id: 'delete',
        },
        {
          actionId: 'item.move@1',
          args: {
            destinationDay: 'day:2',
            position: 'last',
            target: '大本钟',
          },
          id: 'move',
        },
      ],
      summary: '删除并移动',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        {
          actionId: 'history.undo@1',
          args: { kind: 'item_delete' },
          id: 'undo',
        },
        {
          actionId: 'item.time.update@1',
          args: { startTime: '10:00', target: '伦敦眼' },
          id: 'time',
        },
      ],
      summary: '撤销并修改',
    }).ok).toBe(false)
  })

  it('keeps execution state and replan preferences semantic, bounded, and separately confirmed', () => {
    expect(buildDeterministicAiActionPlan('第一站已完成')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'item.execution.update@1',
        args: { state: 'completed', target: 'first_item' },
        risk: 'local_write',
      }],
    })
    expect(buildDeterministicAiActionPlan('第一天的伦敦眼预留30分钟，下雨别去')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'item.replan.preference.update@1',
        args: {
          bufferMinutes: 30,
          day: 'first_day',
          target: '伦敦眼',
          weatherSuitability: 'avoid_rain',
        },
        risk: 'local_write',
      }],
    })

    for (const args of [
      { itemId: 'item_internal', state: 'completed', target: '伦敦眼' },
      { state: 'deleted', target: '伦敦眼' },
      { state: 'completed', target: '#/item?token=secret' },
    ]) {
      expect(validateAiActionPlan({
        schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
        steps: [{
          actionId: 'item.execution.update@1',
          args,
          id: 'execution',
        }],
        summary: '非法进度更新',
      }).ok).toBe(false)
    }

    for (const args of [
      { patch: { priority: 'must_keep' }, target: '伦敦眼' },
      { priority: 'critical', target: '伦敦眼' },
      { bufferMinutes: 0, target: '伦敦眼' },
      { minimumStayMinutes: 721, target: '伦敦眼' },
      { bufferMinutes: 30.5, target: '伦敦眼' },
      { target: '伦敦眼' },
    ]) {
      expect(validateAiActionPlan({
        schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
        steps: [{
          actionId: 'item.replan.preference.update@1',
          args,
          id: 'preference',
        }],
        summary: '非法偏好更新',
      }).ok).toBe(false)
    }

    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        {
          actionId: 'item.execution.update@1',
          args: { state: 'completed', target: '伦敦眼' },
          id: 'execution',
        },
        {
          actionId: 'item.replan.preference.update@1',
          args: { priority: 'must_keep', target: '伦敦眼' },
          id: 'preference',
        },
      ],
      summary: '同时更新进度与偏好',
    }).ok).toBe(false)
  })

  it('keeps adaptive replans semantic, bounded, stale-safe, and separately confirmed', () => {
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'trip.replan.apply@1',
        args: {
          delayMinutes: 45,
          kind: 'late',
          strategy: 'least_change',
          target: 'current_item',
        },
        id: 'replan',
      }],
      summary: '应用突发重排',
    })).toMatchObject({
      ok: true,
      plan: {
        requiresConfirmation: true,
        steps: [{
          actionId: 'trip.replan.apply@1',
          risk: 'local_write',
        }],
      },
    })

    for (const args of [
      { functionName: 'deleteTrip', kind: 'late' },
      { kind: 'skip' },
      { delayMinutes: 0, kind: 'late' },
      { delayMinutes: 241, kind: 'delay' },
      { delayMinutes: 30, kind: 'closure', target: '伦敦眼' },
      { kind: 'late', strategy: 'provider_selected' },
      { itemId: 'item_internal', kind: 'closure', target: '伦敦眼' },
      { kind: 'closure', target: '#/item?token=secret' },
    ]) {
      expect(validateAiActionPlan({
        schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
        steps: [{
          actionId: 'trip.replan.apply@1',
          args,
          id: 'replan',
        }],
        summary: '非法突发重排',
      }).ok).toBe(false)
    }

    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        {
          actionId: 'trip.replan.apply@1',
          args: { kind: 'late' },
          id: 'replan',
        },
        {
          actionId: 'item.execution.update@1',
          args: { state: 'completed', target: '伦敦眼' },
          id: 'execution',
        },
      ],
      summary: '重排并更新进度',
    }).ok).toBe(false)
  })

  it('keeps route generation and expense drafts bounded and confirmation gated', () => {
    expect(buildDeterministicAiActionPlan('生成第一天路线预览')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'route.preview@1',
        args: { scope: 'day', target: 'first_day' },
        risk: 'local_write',
      }],
    })
    expect(buildDeterministicAiActionPlan('记一笔午餐 32.50 GBP')).toMatchObject({
      requiresConfirmation: true,
      steps: [{
        actionId: 'ledger.expense.draft@1',
        args: {
          amount: '32.50',
          category: 'food',
          currency: 'GBP',
          title: '午餐',
        },
        risk: 'local_write',
      }],
    })

    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'route.preview@1',
        args: { scope: 'trip', target: '#/day?token=secret' },
        id: 'route',
      }],
      summary: '生成任意路线',
    }).ok).toBe(false)
    expect(validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'ledger.expense.draft@1',
        args: {
          amount: '-32.50',
          category: 'payment',
          currency: 'gbp',
          status: 'confirmed',
          title: '非法费用',
        },
        id: 'expense',
      }],
      summary: '写入非法费用',
    }).ok).toBe(false)
  })

  it('rejects unknown actions, fields, sensitive payloads and dependency cycles', () => {
    const unknown = validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{ actionId: 'database.run@1', args: {}, id: 'bad' }],
      summary: '执行任意函数',
    })
    expect(unknown.ok).toBe(false)

    const sensitive = validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: 'place.enrich@1',
        args: { target: 'current_item', token: 'secret' },
        id: 'place',
      }],
      summary: '补地点',
    })
    expect(sensitive.ok).toBe(false)

    const cyclic = validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        { actionId: 'ticket.open@1', args: {}, dependsOn: ['second'], id: 'first' },
        { actionId: 'ticket.open@1', args: {}, dependsOn: ['first'], id: 'second' },
      ],
      summary: '循环',
    })
    expect(cyclic.ok).toBe(false)
  })

  it('limits plan size, orders dependencies, and keeps idempotency stable', () => {
    const oversized = validateAiActionPlan({
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: Array.from({ length: 7 }, (_, index) => ({
        actionId: 'ticket.open@1',
        args: { query: String(index) },
        dependsOn: [],
        id: `ticket-${index}`,
      })),
      summary: '过长计划',
    })
    expect(oversized.ok).toBe(false)

    const input = {
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [
        { actionId: 'ticket.open@1', args: { query: '爱丁堡' }, dependsOn: ['repair'], id: 'ticket' },
        { actionId: 'trip.repair@1', args: { scope: 'trip' }, dependsOn: [], id: 'repair' },
      ],
      summary: '修复后打开票据',
    }
    const first = validateAiActionPlan(input)
    const second = validateAiActionPlan(input)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.plan.steps.map((step) => step.id)).toEqual(['repair', 'ticket'])
    expect(first.plan.steps.map((step) => step.idempotencyKey))
      .toEqual(second.plan.steps.map((step) => step.idempotencyKey))

    const changed = validateAiActionPlan({
      ...input,
      steps: [
        { actionId: 'ticket.open@1', args: { query: '伦敦' }, dependsOn: ['repair'], id: 'ticket' },
        input.steps[1],
      ],
    })
    expect(changed.ok).toBe(true)
    if (changed.ok) {
      expect(changed.plan.planId).not.toBe(first.plan.planId)
    }
  })

  it('publishes only the supported action catalog and detects likely provider plans', () => {
    expect(listAiActionCatalog().map((action) => action.id)).toEqual([
      'day.items.reorder@1',
      'history.undo@1',
      'item.create@1',
      'item.delete@1',
      'item.execution.update@1',
      'item.move@1',
      'item.replan.preference.update@1',
      'item.time.update@1',
      'ledger.expense.draft@1',
      'place.enrich@1',
      'route.preview@1',
      'ticket.bind@1',
      'ticket.open@1',
      'trip.replan.apply@1',
      'trip.repair@1',
      'workspace.open@1',
    ])
    expect(shouldRequestAiActionPlan('帮我完成这趟旅行的地点资料')).toBe(true)
    expect(shouldRequestAiActionPlan('今天应该注意什么？')).toBe(false)
  })
})
