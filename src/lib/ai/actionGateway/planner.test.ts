import { describe, expect, it } from 'vitest'
import { defaultAiPrivacySettings } from '../aiPrivacy'
import {
  buildAiActionPlanProviderRequest,
  buildDeterministicAiActionPlan,
  shouldRequestAiActionPlan,
} from './planner'

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
    expect(buildDeterministicAiActionPlan('删除伦敦眼门票')).toBeNull()
    expect(buildDeterministicAiActionPlan('取消伦敦眼预订')).toBeNull()
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
    expect(buildDeterministicAiActionPlan('补全第一站地点信息')?.steps[0]).toMatchObject({
      actionId: 'place.enrich@1',
      args: { target: 'first_item' },
    })
    expect(buildDeterministicAiActionPlan('把缺失地点、路线和建议全部修复')?.steps[0]).toMatchObject({
      actionId: 'trip.repair@1',
    })
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
  })
})
