import { describe, expect, it } from 'vitest'
import {
  parseGlobalAiCommandIntent,
  resolveGlobalAiCommand,
  type GlobalAiCommandContext,
} from './globalAiCommandRouter'
import type { Day, ItineraryItem, Trip } from '../../types'

describe('globalAiCommandRouter', () => {
  it('detects what-if late replanning without persistence', async () => {
    const intent = parseGlobalAiCommandIntent('如果我晚到 45 分钟怎么办？')
    expect(intent).toMatchObject({ delayMinutes: 45, disruptionKind: 'late', hypothetical: true, kind: 'replan' })

    const result = await resolveGlobalAiCommand('如果我晚到 45 分钟怎么办？', buildContext())
    expect(result.kind).toBe('replan_preview')
    if (result.kind !== 'replan_preview') return
    expect(result.hypothetical).toBe(true)
    expect(result.eventDraft).toMatchObject({ delayMinutes: 45, kind: 'late', status: 'reported' })
    expect(result.record.status).toBe('preview')
    expect(result.record.id).toContain('global_ai_replan_record_preview')
  })

  it('keeps rainy-day execution requests as replanning commands', () => {
    const intent = parseGlobalAiCommandIntent('今天下雨，户外少一点')
    expect(intent).toMatchObject({ disruptionKind: 'weather_unsuitable', kind: 'replan' })
  })

  it('detects explicit item replan preferences', async () => {
    const intent = parseGlobalAiCommandIntent('这个预约不能动，必须保留')
    expect(intent).toMatchObject({
      kind: 'preference_update',
      preference: { flexibility: 'fixed', priority: 'must_keep' },
    })

    const result = await resolveGlobalAiCommand('这个预约不能动，必须保留', buildContext())
    expect(result.kind).toBe('preference_preview')
    if (result.kind !== 'preference_preview') return
    expect(result.item.id).toBe('item_1')
    expect(result.nextPreference).toMatchObject({ flexibility: 'fixed', priority: 'must_keep' })
  })

  it('routes ledger and smart workspace commands into existing surfaces', async () => {
    const newTripIntent = parseGlobalAiCommandIntent('帮我新建一个英国行程')
    expect(newTripIntent).toEqual({ kind: 'new_trip' })

    const ledger = await resolveGlobalAiCommand('这趟旅行一共花了多少钱？', buildContext())
    expect(ledger.kind).toBe('ledger_summary')
    if (ledger.kind === 'ledger_summary') {
      expect(ledger.lines.join(' ')).toContain('已确认费用')
    }

    const smart = await resolveGlobalAiCommand('帮我智能整理行程', buildContext())
    expect(smart).toMatchObject({
      kind: 'navigation',
      route: 'trip',
      scrollTargetId: 'smart-trip-workspace-panel',
    })
  })

  it('routes ticket lookup commands straight into the ticket gallery with a matched ticket', async () => {
    const context = buildContext()
    context.tickets = [
      {
        createdAt: 1,
        fileName: 'edinburgh-castle-ticket.pdf',
        fileType: 'pdf',
        id: 'ticket_castle',
        mimeType: 'application/pdf',
        scope: 'item',
        size: 1024,
        storageMode: 'copy',
        ticketCategory: 'admission_ticket',
        title: '爱丁堡城堡门票',
        tripId: context.trip!.id,
        updatedAt: 1,
      },
    ]

    const intent = parseGlobalAiCommandIntent('找一下爱丁堡的门票')
    expect(intent).toMatchObject({ kind: 'ticket_lookup' })

    const result = await resolveGlobalAiCommand('找一下爱丁堡的门票', context)
    expect(result).toMatchObject({
      autoExecute: true,
      kind: 'navigation',
      params: {
        tab: 'attachments',
        ticketId: 'ticket_castle',
        tripId: context.trip!.id,
      },
      route: 'documents',
      title: '票据已定位',
    })
  })

  it('opens the full gallery for a broad ticket command without applying the command as a filter', async () => {
    const context = buildContext()
    context.tickets = [{
      createdAt: 1,
      fileName: 'ticket.pdf',
      fileType: 'pdf',
      id: 'ticket_1',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 1024,
      storageMode: 'copy',
      tripId: context.trip!.id,
      updatedAt: 1,
    }]

    const result = await resolveGlobalAiCommand('打开票据', context)

    expect(result).toMatchObject({
      autoExecute: true,
      kind: 'navigation',
      params: {
        tab: 'attachments',
        tripId: context.trip!.id,
      },
      route: 'documents',
      scrollTargetId: 'ticket-gallery',
    })
    if (result.kind === 'navigation') {
      expect(result.params).not.toHaveProperty('ticketId')
      expect(result.params).not.toHaveProperty('ticketQuery')
    }
  })

  it('keeps ordinary questions in a read-only local consultation lane', async () => {
    const intent = parseGlobalAiCommandIntent('今天接下来应该先确认什么？')
    expect(intent).toEqual({ kind: 'consultation' })

    const result = await resolveGlobalAiCommand('今天接下来应该先确认什么？', buildContext())
    expect(result.kind).toBe('consultation')
    if (result.kind !== 'consultation') return
    expect(result.title).toBe('只读旅行咨询')
    expect(result.lines.join(' ')).toContain('只基于「东京旅行」的本地行程数据')
    expect(result.lines.join(' ')).toContain('如果你要我实际改行程')
    expect(result.warnings.join(' ')).toContain('没有调用外部 AI')
  })

  it('keeps explicit trip edit requests on the provider-backed patch-plan lane', async () => {
    const intent = parseGlobalAiCommandIntent('帮我把户外公园移到下午')
    expect(intent).toEqual({ kind: 'ai_trip_edit' })

    const result = await resolveGlobalAiCommand('帮我把户外公园移到下午', buildContext())
    expect(result).toMatchObject({
      kind: 'ai_trip_edit',
      title: '生成 AI 修改预览',
    })
  })
})

function buildContext(): GlobalAiCommandContext {
  const trip: Trip = {
    createdAt: 1,
    destination: '东京',
    endDate: '2026-06-20',
    id: 'trip_1',
    startDate: '2026-06-18',
    title: '东京旅行',
    updatedAt: 1,
  }
  const day: Day = {
    date: '2026-06-18',
    id: 'day_1',
    sortOrder: 1,
    title: '第一天',
    tripId: trip.id,
  }
  const currentItem: ItineraryItem = {
    createdAt: 1,
    dayId: day.id,
    endTime: '10:00',
    id: 'item_1',
    sortOrder: 1,
    startTime: '09:00',
    ticketIds: [],
    title: '预约美术馆',
    tripId: trip.id,
    updatedAt: 1,
  }
  const nextItem: ItineraryItem = {
    createdAt: 1,
    dayId: day.id,
    endTime: '12:00',
    id: 'item_2',
    sortOrder: 2,
    startTime: '11:00',
    ticketIds: [],
    title: '户外公园',
    tripId: trip.id,
    updatedAt: 1,
  }
  return {
    activeRoute: 'item',
    currentDay: day,
    currentItem,
    days: [day],
    hash: '#/item?tripId=trip_1&dayId=day_1&itemId=item_1',
    items: [currentItem, nextItem],
    ledgerExpenses: [{
      amountMinor: 12000,
      category: 'admission',
      createdAt: 1,
      date: '2026-06-18',
      currency: 'CNY',
      id: 'expense_1',
      source: { kind: 'manual' },
      splitMode: 'equal',
      splitShares: [],
      status: 'confirmed',
      title: '门票',
      tripId: trip.id,
      updatedAt: 1,
    }],
    params: new URLSearchParams('tripId=trip_1&dayId=day_1&itemId=item_1'),
    tickets: [],
    trip,
  }
}
