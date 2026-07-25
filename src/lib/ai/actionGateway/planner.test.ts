import { describe, expect, it } from 'vitest'
import { defaultAiPrivacySettings } from '../aiPrivacy'
import {
  buildAiActionPlanProviderRequest,
  buildDeterministicAiActionPlan,
  shouldRequestAiActionPlan,
} from './planner'

describe('AI Action Gateway planner', () => {
  it('uses deterministic local planning for registered ticket, place, and repair commands', () => {
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
  })
})
