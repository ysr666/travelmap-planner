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
      'item.time.update@1',
      'ledger.expense.draft@1',
      'place.enrich@1',
      'route.preview@1',
      'ticket.open@1',
      'trip.repair@1',
      'workspace.open@1',
    ])
    expect(shouldRequestAiActionPlan('帮我完成这趟旅行的地点资料')).toBe(true)
    expect(shouldRequestAiActionPlan('今天应该注意什么？')).toBe(false)
  })
})
