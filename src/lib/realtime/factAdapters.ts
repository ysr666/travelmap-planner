import type {
  ProviderProxyPlaceDetailsSuccessResponse,
  ProviderProxyRoutePreviewSuccessResponse,
} from '../ai/providerProxyContract'
import type { FlightStatusSnapshot, TicketMeta, TransportMode, TransportSegment } from '../../types'
import { normalizeTicketStructuredFieldsV1 } from '../travelObjects/contracts'
import { validateRealtimeFactV1, type RealtimeFactV1 } from './realtimeFact'

export function buildPlaceOpeningFact(input: {
  itemId: string
  response: ProviderProxyPlaceDetailsSuccessResponse
  tripId: string
}): RealtimeFactV1 | null {
  const opening = input.response.details.regularOpeningHours
  if (typeof opening?.openNow !== 'boolean') return null
  const observedAt = normalizeIso(input.response.retrievedAt)
  if (!observedAt) return null
  return validatedFact({
    confidence: input.response.source === 'mock' ? 'low' : 'high',
    expiresAt: addMilliseconds(observedAt, 60 * 60_000),
    id: buildFactId('place_opening', input.itemId),
    kind: 'place_opening_status',
    observedAt,
    rawRef: buildRawRef(input.response.source === 'mock' ? 'mock_place' : 'google_places', 'opening', input.response.details.placeId),
    schemaVersion: 1,
    source: input.response.source === 'mock'
      ? { label: '模拟地点信息', provider: 'mock_place' }
      : { label: 'Google Maps', provider: 'google_places', url: 'https://www.google.com/maps' },
    subject: { id: input.itemId, type: 'item' },
    tripId: input.tripId,
    value: { status: opening.openNow ? 'open' : 'closed' },
  })
}

export function buildRouteEtaFact(input: {
  isMock?: boolean
  mode: TransportMode
  observedAt: string
  response: ProviderProxyRoutePreviewSuccessResponse
  subjectId: string
  subjectType?: 'day' | 'item'
  tripId: string
}): RealtimeFactV1 | null {
  const observedAt = normalizeIso(input.observedAt)
  const durationSeconds = input.response.route.durationSeconds
  if (!observedAt || !Number.isFinite(durationSeconds) || durationSeconds === undefined || durationSeconds < 0) return null
  const provider = input.isMock
    ? 'mock_route' as const
    : input.response.provider === 'google'
      ? 'google_routes' as const
      : 'openrouteservice' as const
  const source = provider === 'mock_route'
    ? { label: '模拟路线', provider }
    : provider === 'google_routes'
      ? { label: 'Google Maps', provider, url: 'https://www.google.com/maps' }
      : { label: 'openrouteservice', provider, url: 'https://openrouteservice.org' }
  return validatedFact({
    confidence: input.response.route.status === 'road' && !input.isMock ? 'high' : input.response.route.status === 'failed' ? 'low' : 'medium',
    expiresAt: addMilliseconds(observedAt, 5 * 60_000),
    id: buildFactId('route_eta', input.subjectId),
    kind: 'route_eta',
    observedAt,
    rawRef: buildRawRef(provider, 'route', input.subjectId),
    schemaVersion: 1,
    source,
    subject: { id: input.subjectId, type: input.subjectType ?? 'item' },
    tripId: input.tripId,
    value: {
      distanceMeters: input.response.route.distanceMeters,
      durationMinutes: Math.ceil(durationSeconds / 60),
      mode: input.mode,
      status: input.response.route.status === 'failed' ? 'unavailable' : input.response.route.status,
    },
  })
}

export function buildTransportStatusFact(input: {
  segment: TransportSegment
  snapshot: FlightStatusSnapshot
}): RealtimeFactV1 | null {
  if (input.snapshot.provider === 'disabled') return null
  const observedAt = normalizeIso(input.snapshot.fetchedAt)
  const expiresAt = normalizeIso(input.snapshot.expiresAt)
  if (!observedAt || !expiresAt) return null
  return validatedFact({
    confidence: 'low',
    expiresAt,
    id: buildFactId('transport_status', input.segment.id),
    kind: 'transport_status',
    observedAt,
    rawRef: buildRawRef('mock_transport', 'status', input.segment.id),
    schemaVersion: 1,
    source: { label: '模拟交通动态', provider: 'mock_transport' },
    subject: { id: input.segment.id, type: 'transport_segment' },
    tripId: input.segment.tripId,
    value: {
      arrivalTime: input.snapshot.arrivalTime,
      departureTime: input.snapshot.departureTime,
      gate: input.snapshot.gate,
      mode: input.segment.kind === 'train' ? 'rail' : 'flight',
      platform: input.segment.kind === 'train' ? input.segment.platform : undefined,
      status: input.snapshot.status,
      terminal: input.snapshot.terminal,
    },
  })
}

export function buildTicketStatusFact(ticket: TicketMeta): RealtimeFactV1 | null {
  const observedAt = normalizeIso(ticket.updatedAt)
  if (!observedAt) return null
  const structured = normalizeTicketStructuredFieldsV1(ticket.structuredFields)
  const status = structured?.status
    ?? (ticket.storageMode === 'external' && !ticket.externalUrl
      ? 'unavailable'
      : ticket.storageMode === 'reference' && !ticket.referenceLocation
        ? 'unavailable'
        : 'ready')
  return validatedFact({
    confidence: 'high',
    expiresAt: addMilliseconds(observedAt, 24 * 60 * 60_000),
    id: buildFactId('ticket_status', ticket.id),
    kind: 'ticket_status',
    observedAt,
    rawRef: buildRawRef('local_ticket', 'status', ticket.id),
    schemaVersion: 1,
    source: { label: '资料库', provider: 'local_ticket' },
    subject: { id: ticket.id, type: 'ticket' },
    tripId: ticket.tripId,
    value: {
      entryTime: structured?.entryTime,
      serviceDate: structured?.serviceDate,
      status,
    },
  })
}

function validatedFact(input: unknown) {
  const validation = validateRealtimeFactV1(input)
  return validation.ok ? validation.value : null
}

function normalizeIso(input: Date | number | string) {
  const timestamp = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function addMilliseconds(iso: string, milliseconds: number) {
  return new Date(Date.parse(iso) + milliseconds).toISOString()
}

function buildFactId(prefix: string, input: string) {
  return `fact_${prefix}_${controlledPart(input)}`.slice(0, 160)
}

function buildRawRef(provider: string, kind: string, input: string) {
  return `${provider}:${kind}:${controlledPart(input)}`.slice(0, 240)
}

function controlledPart(input: string) {
  return input.replace(/[^A-Za-z0-9:_-]/g, '_').replace(/^_+/, '').slice(0, 120) || 'unknown'
}
