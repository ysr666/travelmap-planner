import { describe, expect, it } from 'vitest'
import type { Day, ItineraryItem, TicketMeta } from '../../../types'
import { buildSuggestedTicketBindingPlan } from './ticketBindingPlan'

describe('ticket binding plan', () => {
  it('builds at most six semantic registered writes under one confirmation', () => {
    const days: Day[] = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${String(index + 10).padStart(2, '0')}`,
      id: `day-${index}`,
      sortOrder: index,
      title: `第 ${index + 1} 天`,
      tripId: 'trip-safe',
    }))
    const items: ItineraryItem[] = days.map((day, index) => ({
      createdAt: 1,
      dayId: day.id,
      id: `item-${index}`,
      sortOrder: 1,
      startTime: '10:00',
      ticketIds: [],
      title: `景点 ${index + 1}`,
      tripId: day.tripId,
      updatedAt: 1,
    }))
    const tickets: TicketMeta[] = items.map((item, index) => ({
      createdAt: 1,
      fileName: `景点-${index + 1}.pdf`,
      fileType: 'pdf',
      id: `ticket-${index}`,
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 1,
      structuredFields: {
        entryTime: '10:00',
        schemaVersion: 1,
        serviceDate: days[index].date,
      },
      ticketCategory: 'admission_ticket',
      title: `景点 ${index + 1} 门票`,
      tripId: item.tripId,
      updatedAt: 1,
    }))

    const preview = buildSuggestedTicketBindingPlan({ days, items, tickets, tripId: 'trip-safe' })

    expect(preview.suggested).toHaveLength(6)
    expect(preview.plan).toMatchObject({ requiresConfirmation: true, summary: '关联 6 份旅行资料' })
    expect(preview.plan?.steps).toHaveLength(6)
    expect(preview.plan?.steps.every((step) => step.actionId === 'ticket.bind@1')).toBe(true)
    for (const step of preview.plan?.steps ?? []) {
      expect(JSON.stringify(step.args)).not.toContain('item-')
      expect(JSON.stringify(step.args)).not.toContain('ticket-')
    }
  })

  it('does not plan ambiguous duplicate semantic names', () => {
    const day: Day = { date: '2026-08-10', id: 'day', sortOrder: 1, title: '第一天', tripId: 'trip' }
    const items: ItineraryItem[] = [1, 2].map((index) => ({
      createdAt: 1,
      dayId: day.id,
      id: `item-${index}`,
      sortOrder: index,
      startTime: '10:00',
      ticketIds: [],
      title: '同名景点',
      tripId: day.tripId,
      updatedAt: 1,
    }))
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'same.pdf',
      fileType: 'pdf',
      id: 'ticket',
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 1,
      structuredFields: { entryTime: '10:00', schemaVersion: 1, serviceDate: day.date },
      ticketCategory: 'admission_ticket',
      title: '同名景点门票',
      tripId: day.tripId,
      updatedAt: 1,
    }

    const preview = buildSuggestedTicketBindingPlan({ days: [day], items, tickets: [ticket], tripId: day.tripId })
    expect(preview.plan).toBeNull()
    expect(preview.conflicts).toHaveLength(2)
  })

  it('does not schedule two writes against the same item baseline', () => {
    const day: Day = { date: '2026-08-10', id: 'day', sortOrder: 1, title: '第一天', tripId: 'trip' }
    const item: ItineraryItem = {
      createdAt: 1,
      dayId: day.id,
      id: 'item-castle',
      sortOrder: 1,
      startTime: '10:00',
      ticketIds: [],
      title: '爱丁堡城堡',
      tripId: day.tripId,
      updatedAt: 1,
    }
    const tickets: TicketMeta[] = ['门票', '讲解票'].map((suffix, index) => ({
      createdAt: index + 1,
      fileName: `爱丁堡城堡${suffix}.pdf`,
      fileType: 'pdf',
      id: `ticket-${index}`,
      mimeType: 'application/pdf',
      scope: 'unassigned',
      size: 1,
      structuredFields: { entryTime: '10:00', schemaVersion: 1, serviceDate: day.date },
      ticketCategory: 'admission_ticket',
      title: `爱丁堡城堡${suffix}`,
      tripId: day.tripId,
      updatedAt: 1,
    }))

    const preview = buildSuggestedTicketBindingPlan({ days: [day], items: [item], tickets, tripId: day.tripId })

    expect(preview.suggested).toHaveLength(1)
    expect(preview.plan?.steps).toHaveLength(1)
  })
})
