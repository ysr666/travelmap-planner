import { describe, expect, it } from 'vitest'
import { buildItemFieldContext } from './itemFieldContext'
import type { Day, ItineraryItem, TicketMeta } from '../types'

const day: Day = {
  id: 'day-1',
  sortOrder: 1,
  title: '第 1 天',
  tripId: 'trip-1',
  date: '2026-04-01',
}

function makeItem(overrides: Partial<ItineraryItem>): ItineraryItem {
  return {
    id: 'item-1',
    tripId: 'trip-1',
    dayId: 'day-1',
    title: '浅草寺',
    ticketIds: [],
    sortOrder: 1,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}

function makeTicket(overrides: Partial<TicketMeta>): TicketMeta {
  return {
    id: 'ticket-1',
    tripId: 'trip-1',
    itemId: 'item-1',
    fileName: 'ticket.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    size: 1024,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}

describe('buildItemFieldContext', () => {
  it('derives neighboring stops, route links, place links, and ticket summary', () => {
    const previous = makeItem({
      id: 'item-0',
      title: '酒店',
      locationName: 'Hotel Metropolitan Tokyo',
      lat: 35.7289,
      lng: 139.7101,
      sortOrder: 0,
      startTime: '09:00',
    })
    const current = makeItem({
      id: 'item-1',
      title: '浅草寺',
      locationName: '浅草寺',
      lat: 35.7148,
      lng: 139.7967,
      previousTransportMode: 'transit',
      previousTransportDurationMinutes: 35,
      sortOrder: 1,
      startTime: '10:00',
      endTime: '11:30',
    })
    const next = makeItem({
      id: 'item-2',
      title: '东京塔',
      sortOrder: 2,
      startTime: '13:00',
    })

    const context = buildItemFieldContext({
      day,
      dayItems: [next, current, previous],
      item: current,
      tickets: [makeTicket({ title: '门票二维码', ticketCategory: 'admission_ticket' })],
    })

    expect(context.positionLabel).toBe('第 1 天 · 第 2/3 项')
    expect(context.timeLabel).toBe('10:00 - 11:30')
    expect(context.previousStop?.label).toBe('酒店')
    expect(context.nextStop?.label).toBe('东京塔')
    expect(context.transportDescription).toBe('公共交通 35 分钟')
    expect(context.routeAction.isAvailable).toBe(true)
    expect(context.routeAction.detail).toBe('酒店 到 浅草寺')
    expect(context.routeAction.appleUrl).toContain('maps.apple.com')
    expect(context.placeAction.googleUrl).toContain('google.com/maps')
    expect(context.ticketAction.label).toBe('1 张票据')
    expect(context.ticketAction.summary).toBe('门票 · 门票二维码')
  })

  it('keeps external actions unavailable when the current item lacks coordinates', () => {
    const previous = makeItem({
      id: 'item-0',
      title: '酒店',
      locationName: 'Hotel Metropolitan Tokyo',
      lat: 35.7289,
      lng: 139.7101,
      sortOrder: 0,
    })
    const current = makeItem({
      id: 'item-1',
      title: '浅草寺',
      locationName: '浅草寺',
      sortOrder: 1,
    })

    const context = buildItemFieldContext({
      day,
      dayItems: [previous, current],
      item: current,
      tickets: [],
    })

    expect(context.coordinateLabel).toBe('待补坐标')
    expect(context.routeAction.isAvailable).toBe(false)
    expect(context.routeAction.appleUrl).toBeNull()
    expect(context.placeAction.isAvailable).toBe(false)
    expect(context.placeAction.googleUrl).toBeNull()
    expect(context.ticketAction.summary).toBe('暂无绑定票据。')
  })
})
