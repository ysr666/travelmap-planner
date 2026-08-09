import { getTicketDisplayTitle } from '../tickets'
import { normalizeTicketStructuredFieldsV1, type InsurancePolicyV1, type LodgingReservationV1 } from '../travelObjects/contracts'
import type {
  Day,
  ItineraryItem,
  TicketCategory,
  TicketMeta,
  TransportBooking,
  TransportSegment,
} from '../../types'
import {
  TRAVEL_DOCUMENT_LINK_SCHEMA_VERSION,
  type TravelDocumentLinkEvidence,
  type TravelDocumentLinkSubjectType,
  type TravelDocumentLinkV1,
} from './contracts'

export type BuildTravelDocumentLinksInput = {
  days: Day[]
  insurancePolicies?: InsurancePolicyV1[]
  items: ItineraryItem[]
  lodgingReservations?: LodgingReservationV1[]
  now?: number
  tickets: TicketMeta[]
  transportBookings?: TransportBooking[]
  transportSegments?: TransportSegment[]
  tripId: string
}

export type TicketItemMatchScore = {
  confidence: number
  evidence: TravelDocumentLinkEvidence[]
  reason: string
}

type ScoredSubject = TicketItemMatchScore & {
  subjectId: string
  subjectType: Exclude<TravelDocumentLinkSubjectType, 'day' | 'trip'>
}

const SUGGESTION_THRESHOLD = 0.68
const CONFLICT_THRESHOLD = 0.48
const UNIQUE_MARGIN = 0.12

export function buildTravelDocumentLinks(input: BuildTravelDocumentLinksInput): TravelDocumentLinkV1[] {
  const days = input.days.filter((day) => day.tripId === input.tripId)
  const items = input.items.filter((item) => item.tripId === input.tripId)
  const tickets = input.tickets.filter((ticket) => ticket.tripId === input.tripId)
  const bookings = (input.transportBookings ?? []).filter((booking) => booking.tripId === input.tripId)
  const segments = (input.transportSegments ?? []).filter((segment) => segment.tripId === input.tripId)
  const lodging = (input.lodgingReservations ?? []).filter((record) => record.tripId === input.tripId)
  const insurance = (input.insurancePolicies ?? []).filter((record) => record.tripId === input.tripId)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]))
  const dayById = new Map(days.map((day) => [day.id, day]))
  const now = input.now ?? Date.now()
  const links: TravelDocumentLinkV1[] = []

  for (const ticket of tickets) {
    const confirmed: TravelDocumentLinkV1[] = []
    if (ticket.itemId && itemById.has(ticket.itemId)) {
      confirmed.push(createLink(ticket, 'item', ticket.itemId, 1, 'confirmed', ['existing_reference'], '已由票据元数据关联到行程点', now))
    }
    if (ticket.bookingId && bookingById.has(ticket.bookingId)) {
      confirmed.push(createLink(ticket, 'booking', ticket.bookingId, 1, 'confirmed', ['existing_reference'], '已由票据元数据关联到交通订单', now))
    }
    for (const reservation of lodging) {
      if (reservation.ticketId === ticket.id) {
        confirmed.push(createLink(ticket, 'lodging', reservation.id, 1, 'confirmed', ['existing_reference'], '住宿记录已引用该资料', now))
      }
    }
    for (const policy of insurance) {
      if (policy.ticketId === ticket.id) {
        confirmed.push(createLink(ticket, 'insurance', policy.id, 1, 'confirmed', ['existing_reference'], '保险记录已引用该资料', now))
      }
    }
    if (confirmed.length > 0) {
      links.push(...confirmed)
      continue
    }
    if (ticket.scope === 'trip') {
      links.push(createLink(ticket, 'trip', input.tripId, 1, 'confirmed', ['existing_reference'], '已归入整趟旅行资料', now))
      continue
    }

    const scored = [
      ...items.map((item) => ({ ...scoreTicketItemCandidate(ticket, item, dayById.get(item.dayId)), subjectId: item.id, subjectType: 'item' as const })),
      ...bookings.map((booking) => scoreBookingCandidate(ticket, booking, segments.filter((segment) => segment.bookingId === booking.id))),
      ...lodging.map((reservation) => scoreLodgingCandidate(ticket, reservation)),
      ...insurance.map((policy) => scoreInsuranceCandidate(ticket, policy)),
    ].filter((candidate) => candidate.confidence >= CONFLICT_THRESHOLD)
      .sort((left, right) => right.confidence - left.confidence || left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId))

    const top = scored[0]
    if (!top) {
      const serviceDate = normalizeTicketStructuredFieldsV1(ticket.structuredFields)?.serviceDate
      const matchingDay = serviceDate ? days.find((day) => day.date === serviceDate) : undefined
      if (matchingDay) {
        links.push(createLink(ticket, 'day', matchingDay.id, 0.45, 'conflict', ['date_match'], '日期匹配，但无法确定具体行程点', now))
      }
      continue
    }
    const runnerUp = scored[1]
    if (top.confidence >= SUGGESTION_THRESHOLD && (!runnerUp || top.confidence - runnerUp.confidence >= UNIQUE_MARGIN)) {
      links.push(createLink(ticket, top.subjectType, top.subjectId, top.confidence, 'suggested', top.evidence, top.reason, now))
      continue
    }
    const conflictCutoff = Math.max(CONFLICT_THRESHOLD, top.confidence - UNIQUE_MARGIN)
    links.push(...scored.filter((candidate) => candidate.confidence >= conflictCutoff).slice(0, 3).map((candidate) =>
      createLink(ticket, candidate.subjectType, candidate.subjectId, candidate.confidence, 'conflict', candidate.evidence, '找到多个接近候选，需要确认', now),
    ))
  }

  return links.sort((left, right) =>
    left.ticketId.localeCompare(right.ticketId)
    || linkStatusRank(left.status) - linkStatusRank(right.status)
    || right.confidence - left.confidence
    || left.subjectType.localeCompare(right.subjectType)
    || left.subjectId.localeCompare(right.subjectId),
  )
}

export function scoreTicketItemCandidate(
  ticket: TicketMeta,
  item: ItineraryItem,
  day?: Day,
): TicketItemMatchScore {
  const structured = normalizeTicketStructuredFieldsV1(ticket.structuredFields)
  const evidence: TravelDocumentLinkEvidence[] = []
  let confidence = 0
  const textScore = bestTextSimilarity(
    ticketSearchValues(ticket),
    [item.title, item.locationName, item.address].filter((value): value is string => Boolean(value)),
  )
  if (textScore >= 0.2) {
    confidence += Math.min(0.4, textScore * 0.4)
    evidence.push('text_match')
  }
  if (structured?.serviceDate && day?.date === structured.serviceDate) {
    confidence += 0.34
    evidence.push('date_match')
  }
  if (structured?.entryTime && item.startTime === structured.entryTime) {
    confidence += 0.18
    evidence.push('time_match')
  }
  if (isTicketCategoryCompatibleWithItem(ticket.ticketCategory, item)) {
    confidence += 0.08
    evidence.push('category_match')
  }
  confidence = roundConfidence(confidence)
  return {
    confidence,
    evidence,
    reason: describeEvidence(evidence),
  }
}

function scoreBookingCandidate(
  ticket: TicketMeta,
  booking: TransportBooking,
  segments: TransportSegment[],
): ScoredSubject {
  const structured = normalizeTicketStructuredFieldsV1(ticket.structuredFields)
  const evidence: TravelDocumentLinkEvidence[] = []
  let confidence = bestTextSimilarity(
    ticketSearchValues(ticket),
    [booking.title, booking.providerName].filter((value): value is string => Boolean(value)),
  ) * 0.46
  if (confidence >= 0.12) evidence.push('text_match')
  if (structured?.serviceDate && segments.some((segment) => segment.departureDate === structured.serviceDate)) {
    confidence += 0.28
    evidence.push('date_match')
  }
  if (structured?.entryTime && segments.some((segment) => segment.departureTime === structured.entryTime)) {
    confidence += 0.16
    evidence.push('time_match')
  }
  if (isTicketCategoryCompatibleWithBooking(ticket.ticketCategory, booking)) {
    confidence += 0.1
    evidence.push('category_match')
  }
  return {
    confidence: roundConfidence(confidence),
    evidence,
    reason: describeEvidence(evidence),
    subjectId: booking.id,
    subjectType: 'booking',
  }
}

function scoreLodgingCandidate(ticket: TicketMeta, reservation: LodgingReservationV1): ScoredSubject {
  const structured = normalizeTicketStructuredFieldsV1(ticket.structuredFields)
  const evidence: TravelDocumentLinkEvidence[] = []
  let confidence = bestTextSimilarity(ticketSearchValues(ticket), [reservation.name, reservation.address].filter((value): value is string => Boolean(value))) * 0.48
  if (confidence >= 0.12) evidence.push('text_match')
  if (structured?.serviceDate === reservation.checkInDate) {
    confidence += 0.32
    evidence.push('date_match')
  }
  if (ticket.ticketCategory === 'hotel_booking') {
    confidence += 0.12
    evidence.push('category_match')
  }
  return {
    confidence: roundConfidence(confidence),
    evidence,
    reason: describeEvidence(evidence),
    subjectId: reservation.id,
    subjectType: 'lodging',
  }
}

function scoreInsuranceCandidate(ticket: TicketMeta, policy: InsurancePolicyV1): ScoredSubject {
  const evidence: TravelDocumentLinkEvidence[] = []
  let confidence = bestTextSimilarity(ticketSearchValues(ticket), [policy.providerName, policy.productName].filter((value): value is string => Boolean(value))) * 0.6
  if (confidence >= 0.12) evidence.push('text_match')
  if (ticket.ticketCategory === 'other' && /保险|保单|insurance|policy/i.test(ticketSearchValues(ticket).join(' '))) {
    confidence += 0.28
    evidence.push('category_match')
  }
  return {
    confidence: roundConfidence(confidence),
    evidence,
    reason: describeEvidence(evidence),
    subjectId: policy.id,
    subjectType: 'insurance',
  }
}

function createLink(
  ticket: TicketMeta,
  subjectType: TravelDocumentLinkSubjectType,
  subjectId: string,
  confidence: number,
  status: TravelDocumentLinkV1['status'],
  evidence: TravelDocumentLinkEvidence[],
  reason: string,
  now: number,
): TravelDocumentLinkV1 {
  return {
    confidence: roundConfidence(confidence),
    createdAt: now,
    evidence,
    id: `document-link:${hashString(`${ticket.tripId}:${ticket.id}:${subjectType}:${subjectId}`)}`,
    reason,
    schemaVersion: TRAVEL_DOCUMENT_LINK_SCHEMA_VERSION,
    status,
    subjectId,
    subjectType,
    ticketId: ticket.id,
    tripId: ticket.tripId,
    updatedAt: now,
  }
}

function ticketSearchValues(ticket: TicketMeta) {
  return [getTicketDisplayTitle(ticket), ticket.fileName]
}

function bestTextSimilarity(leftValues: string[], rightValues: string[]) {
  let best = 0
  for (const left of leftValues) {
    for (const right of rightValues) best = Math.max(best, textSimilarity(left, right))
  }
  return best
}

function textSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeSearchText(left)
  const normalizedRight = normalizeSearchText(right)
  if (!normalizedLeft || !normalizedRight) return 0
  if (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 3
    && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) return 1
  const leftBigrams = toBigrams(normalizedLeft)
  const rightBigrams = toBigrams(normalizedRight)
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0
  let intersection = 0
  for (const value of leftBigrams) if (rightBigrams.has(value)) intersection += 1
  return 2 * intersection / (leftBigrams.size + rightBigrams.size)
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.(?:pdf|png|jpe?g|webp|heic)$/i, '')
    .replace(/(?:电子)?(?:门票|票据|客票|车票|机票|预订|预约|确认|订单|凭证|ticket|tickets|booking|reservation|confirmation)/gi, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function toBigrams(value: string) {
  const output = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) output.add(value.slice(index, index + 2))
  return output
}

function isTicketCategoryCompatibleWithItem(category: TicketCategory | undefined, item: ItineraryItem) {
  const text = `${item.title} ${item.locationName ?? ''} ${item.address ?? ''}`
  if (category === 'admission_ticket') return true
  if (category === 'flight_ticket') return /机场|航班|抵达|出发|airport|flight/i.test(text)
  if (category === 'train_ticket') return item.previousTransportMode === 'train' || /火车|铁路|车站|train|station/i.test(text)
  if (category === 'hotel_booking') return /酒店|住宿|入住|hotel|hostel|inn/i.test(text)
  if (category === 'restaurant_reservation') return /餐|restaurant|cafe|bar/i.test(text)
  if (category === 'transport_booking') return Boolean(item.previousTransportMode)
  return false
}

function isTicketCategoryCompatibleWithBooking(category: TicketCategory | undefined, booking: TransportBooking) {
  return category === 'flight_ticket' && booking.kind === 'flight'
    || category === 'train_ticket' && booking.kind === 'train'
    || category === 'transport_booking' && booking.kind !== 'flight' && booking.kind !== 'train'
}

function describeEvidence(evidence: TravelDocumentLinkEvidence[]) {
  const labels = [
    evidence.includes('text_match') ? '名称' : '',
    evidence.includes('date_match') ? '日期' : '',
    evidence.includes('time_match') ? '时间' : '',
    evidence.includes('category_match') ? '类型' : '',
  ].filter(Boolean)
  return labels.length > 0 ? `${labels.join('、')}匹配` : '匹配依据不足'
}

function roundConfidence(value: number) {
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000))
}

function linkStatusRank(status: TravelDocumentLinkV1['status']) {
  if (status === 'confirmed') return 0
  if (status === 'suggested') return 1
  return 2
}

function hashString(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
