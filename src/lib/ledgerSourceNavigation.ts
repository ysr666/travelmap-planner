import type { ItineraryItem, LedgerExpenseSourceLink, RouteId } from '../types'

export type LedgerSourceNavigationTarget = {
  route: RouteId
  params: Record<string, string>
}

export function buildLedgerSourceNavigationTarget(
  source: Pick<LedgerExpenseSourceLink, 'kind' | 'sourceId'>,
  tripId: string,
  items: Pick<ItineraryItem, 'id' | 'dayId'>[] = [],
): LedgerSourceNavigationTarget | undefined {
  if (!source.sourceId) return undefined
  if (source.kind === 'ticket') return { params: { tab: 'attachments', ticketId: source.sourceId, tripId }, route: 'documents' }
  if (source.kind === 'transport_booking') return { params: { bookingId: source.sourceId, tab: 'transport', tripId }, route: 'documents' }
  if (source.kind === 'inbox') return { params: { inboxEntryId: source.sourceId, tripId }, route: 'inbox' }
  if (source.kind === 'itinerary_note') {
    const item = items.find((candidate) => candidate.id === source.sourceId)
    return item ? { params: { dayId: item.dayId, itemId: item.id, tripId }, route: 'item' } : undefined
  }
  return undefined
}
