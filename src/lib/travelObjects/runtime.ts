import { buildTicketStatusFact } from '../realtime/factAdapters'
import type { RealtimeFactV1 } from '../realtime/realtimeFact'
import { validateTravelMediaAssetV1, type TravelMediaAssetV1 } from '../media/travelMedia'
import type { InsurancePolicyV1, LodgingReservationV1 } from './contracts'
import type { TicketMeta } from '../../types'

export const TRAVEL_OBJECT_MEDIA_CACHE_KEY = 'tripmap:media:travel-object-v1'
export const TRAVEL_OBJECT_REALTIME_CACHE_KEY = 'tripmap:realtime:travel-object-v1'

export type TravelObjectRuntimeSupplementsV1 = {
  insurancePolicies: InsurancePolicyV1[]
  lodgingReservations: LodgingReservationV1[]
  mediaAssets: TravelMediaAssetV1[]
  realtimeFacts: RealtimeFactV1[]
}

export function createEmptyTravelObjectRuntimeSupplements(): TravelObjectRuntimeSupplementsV1 {
  return {
    insurancePolicies: [],
    lodgingReservations: [],
    mediaAssets: [],
    realtimeFacts: [],
  }
}

export function buildTicketBlobMediaAssets(tickets: TicketMeta[], now: Date | number | string = Date.now()) {
  const nowMs = toTimestamp(now)
  const expiresAt = new Date(nowMs + 10 * 365 * 24 * 60 * 60_000).toISOString()
  return tickets.flatMap((ticket) => {
    if (ticket.storageMode !== 'copy' || ticket.fileType !== 'image') return []
    const observedAt = new Date(Math.min(nowMs, normalizeTicketTimestamp(ticket.updatedAt, nowMs))).toISOString()
    const validation = validateTravelMediaAssetV1({
      aspectRatio: 0.75,
      attribution: [],
      expiresAt,
      height: 1200,
      id: `media_ticket_${controlledPart(ticket.id)}_v1`.slice(0, 160),
      kind: 'document_preview',
      observedAt,
      providerRef: ticket.id,
      renderRef: { ticketId: ticket.id, type: 'ticket_blob' },
      schemaVersion: 1,
      source: 'ticket_blob',
      subjectId: ticket.id,
      subjectType: 'ticket',
      tripId: ticket.tripId,
      width: 900,
    })
    return validation.ok ? [validation.value] : []
  })
}

export function buildLocalTicketRealtimeFacts(tickets: TicketMeta[]) {
  return tickets.flatMap((ticket) => {
    const fact = buildTicketStatusFact(ticket)
    return fact ? [fact] : []
  })
}

function controlledPart(value: string) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9_:-]/g, '_').replace(/^_+/, '').slice(0, 112) || 'ticket'
}

function normalizeTicketTimestamp(value: number | string, fallback: number) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : fallback
}

function toTimestamp(value: Date | number | string) {
  const timestamp = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}
