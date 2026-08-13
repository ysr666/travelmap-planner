import type { TicketMeta } from '../../types'
import type { RedactedTicketMetaV1 } from './models'

export function redactTicketMetaForAccountCloud(ticket: TicketMeta): RedactedTicketMetaV1 {
  return {
    bookingId: ticket.bookingId,
    createdAt: ticket.createdAt,
    fileType: ticket.fileType,
    id: ticket.id,
    itemId: ticket.itemId,
    mimeType: ticket.mimeType,
    scope: ticket.scope ?? (ticket.itemId ? 'item' : 'unassigned'),
    sharedVisibility: ticket.sharedVisibility,
    size: ticket.size,
    storageMode: ticket.storageMode,
    ticketCategory: ticket.ticketCategory,
    title: ticket.title,
    tripId: ticket.tripId,
    updatedAt: ticket.updatedAt,
  }
}
