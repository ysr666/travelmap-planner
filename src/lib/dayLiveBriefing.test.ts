import { describe, expect, it } from 'vitest'
import { buildDayLiveBriefing } from './dayLiveBriefing'
import type { RoutePreparationDay } from './routePreparation'
import type { ContentEnrichmentSource, Day, ItineraryItem, Trip } from '../types'

const trip: Trip = {
  createdAt: 1,
  destination: '杭州',
  endDate: '2026-06-05',
  id: 'trip-1',
  startDate: '2026-06-05',
  title: '杭州旅行',
  updatedAt: 1,
}

const day: Day = {
  date: '2026-06-05',
  id: 'day-1',
  sortOrder: 1,
  title: '西湖一日',
  tripId: trip.id,
}

function makeItem(input: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: 1,
    dayId: day.id,
    id: input.id ?? 'item-1',
    sortOrder: input.sortOrder ?? 1,
    ticketIds: input.ticketIds ?? [],
    title: input.title ?? '西湖',
    tripId: trip.id,
    updatedAt: 1,
    ...input,
  }
}

function at(hour: number, minute: number) {
  return new Date(2026, 5, 5, hour, minute)
}

describe('buildDayLiveBriefing', () => {
  it('selects the first item before the day starts', () => {
    const first = makeItem({ id: 'first', startTime: '09:00', title: '早餐' })
    const second = makeItem({ id: 'second', sortOrder: 2, startTime: '11:00', title: '西湖' })

    const briefing = buildDayLiveBriefing({ day, items: [second, first], now: at(8, 20), trip })

    expect(briefing.status).toBe('not_started')
    expect(briefing.targetItem?.id).toBe('first')
    expect(briefing.title).toContain('早餐')
    expect(briefing.timeLine.text).toContain('40 分钟')
  })

  it('marks the current item when now is within its time range', () => {
    const item = makeItem({ endTime: '10:30', startTime: '09:00', title: '西湖游船' })

    const briefing = buildDayLiveBriefing({ day, items: [item], now: at(9, 45), trip })

    expect(briefing.status).toBe('in_progress')
    expect(briefing.currentItem?.id).toBe(item.id)
    expect(briefing.timeLine.text).toContain('45 分钟')
  })

  it('selects the next item between scheduled stops', () => {
    const first = makeItem({ endTime: '09:30', id: 'first', startTime: '08:30', title: '酒店早餐' })
    const second = makeItem({ id: 'second', sortOrder: 2, startTime: '10:00', title: '灵隐寺' })

    const briefing = buildDayLiveBriefing({ day, items: [first, second], now: at(9, 40), trip })

    expect(briefing.status).toBe('next_up')
    expect(briefing.previousItem?.id).toBe('first')
    expect(briefing.targetItem?.id).toBe('second')
  })

  it('marks start-only items as late after the grace window', () => {
    const item = makeItem({ startTime: '10:00', title: '门票预约入场' })

    const briefing = buildDayLiveBriefing({ day, items: [item], now: at(10, 25), trip })

    expect(briefing.status).toBe('late')
    expect(briefing.title).toContain('可能已经迟到')
    expect(briefing.ticketLine.text).toContain('当前未绑定票据')
  })

  it('uses a completed state after the selected day has ended', () => {
    const briefing = buildDayLiveBriefing({
      day,
      items: [makeItem({ endTime: '11:00', startTime: '10:00' })],
      now: at(12, 0),
      trip,
    })

    expect(briefing.status).toBe('completed')
    expect(briefing.title).toBe('今日行程已结束')
    expect(briefing.timeLine.text).toContain('今日行程已结束')
    expect(briefing.targetItem).toBeUndefined()
  })

  it('returns an empty-day state without target actions', () => {
    const briefing = buildDayLiveBriefing({ day, items: [], now: at(9, 0), trip })

    expect(briefing.status).toBe('empty_day')
    expect(briefing.title).toBe('今天暂无行程点')
    expect(briefing.targetItem).toBeUndefined()
  })

  it('aggregates local tickets, sourced content, coordinates, buffer, and route status', () => {
    const source: ContentEnrichmentSource = {
      confidence: 'high',
      id: 'source-1',
      label: '官网',
      retrievedAt: '2026-06-01T00:00:00.000Z',
      sourceType: 'official',
      title: '西湖公告',
      url: 'https://example.com',
    }
    const previous = makeItem({
      endTime: '10:00',
      id: 'previous',
      lat: 30.24,
      lng: 120.15,
      startTime: '09:00',
      title: '酒店',
    })
    const target = makeItem({
      contentEnrichment: {
        baselineFingerprint: 'base',
        generatedAt: '2026-06-01T00:00:00.000Z',
        introduction: { sourceIds: [source.id], text: '西湖介绍' },
        notices: [{ sourceIds: [source.id], text: '旺季请提前预约。' }],
        openingHours: { sourceIds: [source.id], text: '08:00-18:00' },
        recommendedStay: { basis: 'ai_estimate', durationMinutes: 120, reason: '本地估算', text: '建议停留 2 小时' },
        schemaVersion: 1,
        sources: [source],
        ticketPrice: { kind: 'admission', sourceIds: [source.id], text: '免费开放' },
        warnings: [],
      },
      id: 'target',
      lat: 30.25,
      lng: 120.16,
      previousTransportDurationMinutes: 20,
      sortOrder: 2,
      startTime: '10:20',
      ticketIds: ['ticket-1', 'ticket-2'],
      title: '西湖',
    })
    const routeDay = makeRouteDay('ready_to_generate')

    const briefing = buildDayLiveBriefing({ day, items: [previous, target], now: at(10, 5), routeDay, trip })

    expect(briefing.status).toBe('next_up')
    expect(briefing.locationLine.text).toContain('坐标已填写')
    expect(briefing.ticketLine.text).toContain('2 张票据')
    expect(briefing.openingHoursLine.text).toBe('08:00-18:00')
    expect(briefing.ticketPriceLine.text).toBe('免费开放')
    expect(briefing.noticeLines.map((line) => line.text)).toContain('旺季请提前预约。')
    expect(briefing.routeRiskLines.map((line) => line.text).join('\n')).toContain('缓冲偏短')
    expect(briefing.routeRiskLines.map((line) => line.text).join('\n')).toContain('尚未生成')
  })

  it('does not surface factual content when source ids are missing', () => {
    const item = makeItem({
      contentEnrichment: {
        baselineFingerprint: 'base',
        generatedAt: '2026-06-01T00:00:00.000Z',
        notices: [{ sourceIds: ['missing-source'], text: '没有来源的注意事项' }],
        openingHours: { sourceIds: ['missing-source'], text: '没有来源的开放时间' },
        schemaVersion: 1,
        sources: [],
        ticketPrice: { kind: 'admission', sourceIds: ['missing-source'], text: '没有来源的票价' },
        warnings: [],
      },
      startTime: '09:00',
    })

    const briefing = buildDayLiveBriefing({ day, items: [item], now: at(8, 30), trip })

    expect(briefing.openingHoursLine.text).toBe('待核对开放时间')
    expect(briefing.ticketPriceLine.text).toBe('待核对票价')
    expect(briefing.noticeLines[0].text).toBe('待核对注意事项')
  })
})

function makeRouteDay(status: RoutePreparationDay['status']): RoutePreparationDay {
  return {
    cacheEntry: null,
    coordinateCount: status === 'no_coordinates' ? 0 : 2,
    day,
    eligible: status !== 'no_coordinates' && status !== 'not_enough_points',
    identity: null,
    provider: 'google',
    staleCacheEntries: [],
    status,
  }
}
