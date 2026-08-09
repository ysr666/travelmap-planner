import { getTicketDisplayTitle } from '../tickets'
import { buildTravelDocumentLinks, type TravelDocumentLinkV1 } from '../documentLinking'
import { isTravelMediaAssetCurrent, selectTravelMediaAsset, type TravelMediaAssetV1 } from '../media/travelMedia'
import { normalizeTicketStructuredFieldsV1, type InsurancePolicyV1, type LodgingReservationV1 } from './contracts'
import type { BrandIdentityInput, BrandNamespace } from '../media/brandRegistry'
import type {
  BookingSecretData,
  Day,
  ItineraryItem,
  TicketCategory,
  TicketMeta,
  TicketReadinessStatus,
  TransportBooking,
  TransportBookingKind,
  TransportSegment,
} from '../../types'

export const TRAVEL_OBJECT_VIEW_MODEL_VERSION = 1 as const

export type TravelObjectKind = 'place' | 'transport' | 'lodging' | 'insurance' | 'ticket'
export type TravelObjectSubjectType = 'item' | 'booking' | 'lodging' | 'insurance' | 'ticket'
export type TravelObjectStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export type TravelObjectDisplayField = {
  id: string
  label: string
  value: string
  visibility: 'standard' | 'private'
}

export type TravelObjectSourceRef = {
  confidence: 'high' | 'medium' | 'low'
  id: string
  kind: 'itinerary_item' | 'ticket_meta' | 'transport_booking' | 'transport_segment' | 'lodging' | 'insurance' | 'vault_secret'
}

export type TravelObjectViewModelV1 = {
  schemaVersion: typeof TRAVEL_OBJECT_VIEW_MODEL_VERSION
  id: string
  tripId: string
  kind: TravelObjectKind
  subjectType: TravelObjectSubjectType
  subjectId: string
  title: string
  subtitle?: string
  dateLabel?: string
  timeLabel?: string
  locationLabel?: string
  status?: {
    code: string
    label: string
    tone: TravelObjectStatusTone
  }
  brand?: BrandIdentityInput
  media?: TravelMediaAssetV1
  fields: TravelObjectDisplayField[]
  documentLink?: {
    confidence: number
    label: string
    status: TravelDocumentLinkV1['status']
    subjectId: string
    subjectType: TravelDocumentLinkV1['subjectType']
  }
  ticketIds: string[]
  sourceRefs: TravelObjectSourceRef[]
  sortKey: string
}

export type TravelObjectCollectionV1 = {
  schemaVersion: typeof TRAVEL_OBJECT_VIEW_MODEL_VERSION
  all: TravelObjectViewModelV1[]
  byId: ReadonlyMap<string, TravelObjectViewModelV1>
  byItemId: ReadonlyMap<string, TravelObjectViewModelV1>
  byTicketId: ReadonlyMap<string, TravelObjectViewModelV1>
  preparation: TravelObjectViewModelV1[]
}

export type BuildTravelObjectCollectionInput = {
  tripId: string
  bookingSecrets?: BookingSecretData[]
  days: Day[]
  insurancePolicies?: InsurancePolicyV1[]
  items: ItineraryItem[]
  lodgingReservations?: LodgingReservationV1[]
  mediaAssets?: TravelMediaAssetV1[]
  now?: Date | number | string
  tickets: TicketMeta[]
  transportBookings?: TransportBooking[]
  transportSegments?: TransportSegment[]
}

export type ProviderSafeTravelObjectSummary = {
  fields: Array<{ label: string; value: string }>
  kind: TravelObjectKind
  status?: string
  subtitle?: string
  title: string
}

export function buildTravelObjectCollection(input: BuildTravelObjectCollectionInput): TravelObjectCollectionV1 {
  const days = input.days.filter((day) => day.tripId === input.tripId)
  const items = input.items.filter((item) => item.tripId === input.tripId)
  const tickets = input.tickets.filter((ticket) => ticket.tripId === input.tripId)
  const bookings = (input.transportBookings ?? []).filter((booking) => booking.tripId === input.tripId)
  const segments = (input.transportSegments ?? []).filter((segment) => segment.tripId === input.tripId)
  const mediaAssets = (input.mediaAssets ?? []).filter((asset) => !asset.tripId || asset.tripId === input.tripId)
  const dayById = new Map(days.map((day) => [day.id, day]))
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]))
  const secretByBookingId = new Map((input.bookingSecrets ?? []).map((secret) => [secret.bookingId, secret]))
  const ticketsByItemId = groupBy(tickets.filter((ticket) => ticket.itemId), (ticket) => ticket.itemId as string)
  const ticketsByBookingId = groupBy(tickets.filter((ticket) => ticket.bookingId), (ticket) => ticket.bookingId as string)
  const documentLinks = buildTravelDocumentLinks({
    days,
    insurancePolicies: input.insurancePolicies,
    items,
    lodgingReservations: input.lodgingReservations,
    now: typeof input.now === 'number' ? input.now : input.now ? new Date(input.now).getTime() : undefined,
    tickets,
    transportBookings: bookings,
    transportSegments: segments,
    tripId: input.tripId,
  })
  const documentLinksByTicketId = groupBy(documentLinks, (link) => link.ticketId)

  const itemObjects = items.map((item) => buildItemObject({
    day: dayById.get(item.dayId),
    item,
    mediaAssets,
    now: input.now,
    tickets: ticketsByItemId.get(item.id) ?? [],
  }))
  const transportObjects = segments.flatMap((segment) => {
    const booking = bookingById.get(segment.bookingId)
    if (!booking) return []
    return [buildTransportObject({
      booking,
      mediaAssets,
      now: input.now,
      secret: secretByBookingId.get(booking.id),
      segment,
      tickets: ticketsByBookingId.get(booking.id) ?? [],
    })]
  })
  const lodgingObjects = (input.lodgingReservations ?? [])
    .filter((reservation) => reservation.tripId === input.tripId)
    .map((reservation) => buildLodgingObject(reservation, mediaAssets, input.now))
  const insuranceObjects = (input.insurancePolicies ?? [])
    .filter((policy) => policy.tripId === input.tripId)
    .map((policy) => buildInsuranceObject(policy))
  const ticketObjects = tickets.map((ticket) => buildTicketObject(
    ticket,
    mediaAssets,
    input.now,
    selectPrimaryDocumentLink(documentLinksByTicketId.get(ticket.id) ?? []),
  ))
  const all = [...itemObjects, ...transportObjects, ...lodgingObjects, ...insuranceObjects, ...ticketObjects]
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey) || left.id.localeCompare(right.id))
  const byId = new Map(all.map((object) => [object.id, object]))
  const byItemId = new Map(itemObjects.map((object) => [object.subjectId, object]))
  const byTicketId = new Map(ticketObjects.map((object) => [object.subjectId, object]))
  const preparation = [...transportObjects.filter((object) => object.brand?.namespace === 'airline'), ...lodgingObjects, ...insuranceObjects]
    .sort((left, right) => preparationRank(left) - preparationRank(right) || left.sortKey.localeCompare(right.sortKey))

  return {
    all,
    byId,
    byItemId,
    byTicketId,
    preparation,
    schemaVersion: TRAVEL_OBJECT_VIEW_MODEL_VERSION,
  }
}

export function toProviderSafeTravelObjectSummary(object: TravelObjectViewModelV1): ProviderSafeTravelObjectSummary {
  return {
    fields: object.fields
      .filter((field) => field.visibility === 'standard')
      .map(({ label, value }) => ({ label, value })),
    kind: object.kind,
    status: object.status?.label,
    subtitle: object.subtitle,
    title: object.title,
  }
}

export function getTravelObjectsForDay(collection: TravelObjectCollectionV1, date: string) {
  return collection.all.filter((object) => object.dateLabel === date && (object.kind === 'place' || object.kind === 'transport'))
}

function buildItemObject({
  day,
  item,
  mediaAssets,
  now,
  tickets,
}: {
  day?: Day
  item: ItineraryItem
  mediaAssets: TravelMediaAssetV1[]
  now?: Date | number | string
  tickets: TicketMeta[]
}): TravelObjectViewModelV1 {
  const readyTicketCount = tickets.filter((ticket) => getTicketStatus(ticket) === 'ready').length
  const media = selectTravelMediaAsset(mediaAssets, {
    kinds: ['place_photo', 'restaurant_photo'],
    now,
    subjectId: item.id,
    subjectType: 'item',
  })
  return {
    dateLabel: day?.date,
    fields: compactFields([
      field('address', '地址', item.address),
      readyTicketCount > 0 ? field('tickets', '资料', `${readyTicketCount} 份已就绪`) : undefined,
    ]),
    id: `place:${item.id}`,
    kind: 'place',
    locationLabel: item.locationName || item.address,
    media,
    schemaVersion: TRAVEL_OBJECT_VIEW_MODEL_VERSION,
    sortKey: `${day?.date ?? '9999-99-99'}:${item.startTime ?? '99:99'}:${String(item.sortOrder).padStart(6, '0')}`,
    sourceRefs: [{ confidence: 'high', id: item.id, kind: 'itinerary_item' }],
    subjectId: item.id,
    subjectType: 'item',
    subtitle: item.locationName && item.locationName !== item.title ? item.locationName : item.address,
    ticketIds: tickets.map((ticket) => ticket.id),
    timeLabel: buildTimeLabel(item.startTime, item.endTime),
    title: item.title,
    tripId: item.tripId,
  }
}

function buildTransportObject({
  booking,
  mediaAssets,
  now,
  secret,
  segment,
  tickets,
}: {
  booking: TransportBooking
  mediaAssets: TravelMediaAssetV1[]
  now?: Date | number | string
  secret?: BookingSecretData
  segment: TransportSegment
  tickets: TicketMeta[]
}): TravelObjectViewModelV1 {
  const seat = secret?.seatAssignments?.find((entry) => entry.segmentId === segment.id)?.seat
    ?? secret?.segmentSeats?.find((entry) => entry.segmentIndex === segment.sortOrder)?.seat
  const namespace = getTransportBrandNamespace(segment.kind)
  const ticketIds = tickets.map((ticket) => ticket.id)
  const media = selectTravelMediaAsset(mediaAssets, {
    kinds: ['transport_photo'],
    now,
    subjectId: booking.id,
    subjectType: 'booking',
  })
  return {
    brand: namespace ? {
      canonicalCode: segment.carrierCode || booking.providerCode,
      displayName: segment.carrier || booking.providerName,
      namespace,
    } : undefined,
    dateLabel: segment.departureDate,
    fields: compactFields([
      field('departure', '出发', formatPlace(segment.departurePlace, segment.departureCode)),
      field('arrival', '到达', formatPlace(segment.arrivalPlace, segment.arrivalCode)),
      field('departure-detail', segment.kind === 'flight' ? '出发航站楼' : '出发站台', segment.kind === 'flight' ? segment.terminal : segment.platform),
      field('arrival-detail', segment.kind === 'flight' ? '到达航站楼' : '到达站台', segment.kind === 'flight' ? segment.arrivalTerminal : segment.arrivalPlatform),
      field('gate', '登机口', segment.gate),
      field('arrival-gate', '到达口', segment.arrivalGate),
      field('seat', '座位', seat, 'private'),
      field('pnr', 'PNR', secret?.pnr, 'private'),
      field('order', '订单号', secret?.orderNumber, 'private'),
    ]),
    id: `transport:${segment.id}`,
    kind: 'transport',
    locationLabel: `${segment.departurePlace} → ${segment.arrivalPlace}`,
    media,
    schemaVersion: TRAVEL_OBJECT_VIEW_MODEL_VERSION,
    sortKey: `${segment.departureDate}:${segment.departureTime ?? '99:99'}:${String(segment.sortOrder).padStart(6, '0')}`,
    sourceRefs: [
      { confidence: 'high', id: booking.id, kind: 'transport_booking' },
      { confidence: 'high', id: segment.id, kind: 'transport_segment' },
      ...(secret ? [{ confidence: 'high' as const, id: secret.bookingId, kind: 'vault_secret' as const }] : []),
    ],
    status: transportStatus(segment.status),
    subjectId: booking.id,
    subjectType: 'booking',
    subtitle: `${segment.departurePlace} → ${segment.arrivalPlace}`,
    ticketIds,
    timeLabel: buildRouteTimeLabel(segment),
    title: segment.serviceNumber || booking.title,
    tripId: booking.tripId,
  }
}

function buildLodgingObject(
  reservation: LodgingReservationV1,
  mediaAssets: TravelMediaAssetV1[],
  now?: Date | number | string,
): TravelObjectViewModelV1 {
  return {
    dateLabel: reservation.checkInDate,
    fields: compactFields([
      field('dates', '入住', `${reservation.checkInDate}${reservation.checkInTime ? ` ${reservation.checkInTime}` : ''} → ${reservation.checkOutDate}${reservation.checkOutTime ? ` ${reservation.checkOutTime}` : ''}`),
      field('nights', '晚数', `${reservation.nightCount} 晚`),
      field('address', '地址', reservation.address),
      field('confirmation', '确认号', reservation.confirmationNumber, 'private'),
    ]),
    id: `lodging:${reservation.id}`,
    kind: 'lodging',
    locationLabel: reservation.address,
    media: findMediaByIdOrSubject(mediaAssets, reservation.mediaAssetId, 'lodging', reservation.id, now),
    schemaVersion: TRAVEL_OBJECT_VIEW_MODEL_VERSION,
    sortKey: `${reservation.checkInDate}:${reservation.checkInTime ?? '00:00'}:lodging`,
    sourceRefs: [{ confidence: reservation.source.confidence, id: reservation.source.sourceId ?? reservation.id, kind: 'lodging' }],
    status: lodgingStatus(reservation.status),
    subjectId: reservation.id,
    subjectType: 'lodging',
    subtitle: `${reservation.checkInDate} → ${reservation.checkOutDate} · ${reservation.nightCount} 晚`,
    ticketIds: reservation.ticketId ? [reservation.ticketId] : [],
    timeLabel: reservation.checkInTime,
    title: reservation.name,
    tripId: reservation.tripId,
  }
}

function buildInsuranceObject(policy: InsurancePolicyV1): TravelObjectViewModelV1 {
  return {
    brand: {
      canonicalCode: policy.providerCode,
      displayName: policy.providerName,
      namespace: 'insurance',
    },
    dateLabel: policy.effectiveFrom.slice(0, 10),
    fields: compactFields([
      field('product', '产品', policy.productName),
      field('validity', '保障期', `${policy.effectiveFrom.slice(0, 10)} → ${policy.effectiveTo.slice(0, 10)}`),
      field('policy', '保单号', policy.policyNumber, 'private'),
    ]),
    id: `insurance:${policy.id}`,
    kind: 'insurance',
    schemaVersion: TRAVEL_OBJECT_VIEW_MODEL_VERSION,
    sortKey: `${policy.effectiveFrom}:insurance`,
    sourceRefs: [{ confidence: policy.source.confidence, id: policy.source.sourceId ?? policy.id, kind: 'insurance' }],
    status: insuranceStatus(policy.status),
    subjectId: policy.id,
    subjectType: 'insurance',
    subtitle: policy.productName || policy.providerName,
    ticketIds: policy.ticketId ? [policy.ticketId] : [],
    title: policy.providerName,
    tripId: policy.tripId,
  }
}

function buildTicketObject(
  ticket: TicketMeta,
  mediaAssets: TravelMediaAssetV1[],
  now?: Date | number | string,
  documentLink?: TravelDocumentLinkV1,
): TravelObjectViewModelV1 {
  const structured = normalizeTicketStructuredFieldsV1(ticket.structuredFields)
  const status = getTicketStatus(ticket, structured?.status)
  return {
    dateLabel: structured?.serviceDate,
    documentLink: documentLink ? {
      confidence: documentLink.confidence,
      label: formatDocumentLinkLabel(documentLink),
      status: documentLink.status,
      subjectId: documentLink.subjectId,
      subjectType: documentLink.subjectType,
    } : undefined,
    fields: compactFields([
      field('date', '日期', structured?.serviceDate),
      field('entry-time', '时间', structured?.entryTime),
      field('format', '格式', ticket.fileType.toUpperCase()),
    ]),
    id: `ticket:${ticket.id}`,
    kind: 'ticket',
    media: findMediaByIdOrSubject(mediaAssets, structured?.previewMediaAssetId, 'ticket', ticket.id, now),
    schemaVersion: TRAVEL_OBJECT_VIEW_MODEL_VERSION,
    sortKey: `${structured?.serviceDate ?? '9999-99-99'}:${structured?.entryTime ?? '99:99'}:${ticket.id}`,
    sourceRefs: [{ confidence: 'high', id: ticket.id, kind: 'ticket_meta' }],
    status: ticketStatus(status),
    subjectId: ticket.id,
    subjectType: 'ticket',
    subtitle: ticketCategoryLabel(ticket.ticketCategory),
    ticketIds: [ticket.id],
    timeLabel: structured?.entryTime,
    title: getTicketDisplayTitle(ticket),
    tripId: ticket.tripId,
  }
}

function selectPrimaryDocumentLink(links: TravelDocumentLinkV1[]) {
  const subjectRank: Record<TravelDocumentLinkV1['subjectType'], number> = {
    item: 0,
    booking: 1,
    lodging: 2,
    insurance: 3,
    day: 4,
    trip: 5,
  }
  const statusRank: Record<TravelDocumentLinkV1['status'], number> = {
    confirmed: 0,
    suggested: 1,
    conflict: 2,
  }
  return [...links].sort((left, right) =>
    statusRank[left.status] - statusRank[right.status]
    || subjectRank[left.subjectType] - subjectRank[right.subjectType]
    || right.confidence - left.confidence,
  )[0]
}

function formatDocumentLinkLabel(link: TravelDocumentLinkV1) {
  if (link.status === 'suggested') return '建议关联'
  if (link.status === 'conflict') return '待确认'
  if (link.subjectType === 'item') return '已关联行程'
  if (link.subjectType === 'booking') return '已关联订单'
  if (link.subjectType === 'lodging') return '已关联住宿'
  if (link.subjectType === 'insurance') return '已关联保险'
  if (link.subjectType === 'day') return '已关联日期'
  return '旅行资料'
}

function findMediaByIdOrSubject(
  assets: TravelMediaAssetV1[],
  mediaAssetId: string | undefined,
  subjectType: 'lodging' | 'ticket',
  subjectId: string,
  now?: Date | number | string,
) {
  const explicit = mediaAssetId ? assets.find((asset) => asset.id === mediaAssetId) : undefined
  if (explicit && isTravelMediaAssetCurrent(explicit, now)) return explicit
  return selectTravelMediaAsset(assets, { now, subjectId, subjectType })
}

function getTicketStatus(ticket: TicketMeta, normalized?: TicketReadinessStatus): TicketReadinessStatus {
  if (normalized) return normalized
  if (ticket.storageMode === 'external' && !ticket.externalUrl) return 'unavailable'
  if (ticket.storageMode === 'reference' && !ticket.referenceLocation) return 'unavailable'
  return 'ready'
}

function field(
  id: string,
  label: string,
  value: string | number | undefined,
  visibility: TravelObjectDisplayField['visibility'] = 'standard',
): TravelObjectDisplayField | undefined {
  if (value === undefined || value === '') return undefined
  return { id, label, value: String(value), visibility }
}

function compactFields(fields: Array<TravelObjectDisplayField | undefined>) {
  return fields.filter((value): value is TravelObjectDisplayField => Boolean(value))
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const groupKey = key(value)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value])
  }
  return groups
}

function buildTimeLabel(start?: string, end?: string) {
  if (!start) return undefined
  return end ? `${start}–${end}` : start
}

function buildRouteTimeLabel(segment: TransportSegment) {
  const departure = `${segment.departureTime ?? '--:--'}`
  const arrival = `${segment.arrivalDate !== segment.departureDate ? `${segment.arrivalDate} ` : ''}${segment.arrivalTime ?? '--:--'}`
  return `${departure} → ${arrival}`
}

function formatPlace(place: string, code?: string) {
  return code ? `${place} (${code})` : place
}

function getTransportBrandNamespace(kind: TransportBookingKind): BrandNamespace | undefined {
  if (kind === 'flight') return 'airline'
  if (kind === 'train') return 'rail'
  return undefined
}

function ticketCategoryLabel(category?: TicketCategory) {
  if (category === 'flight_ticket') return '机票'
  if (category === 'train_ticket') return '火车票'
  if (category === 'hotel_booking') return '住宿订单'
  if (category === 'restaurant_reservation') return '餐厅预订'
  if (category === 'transport_booking') return '交通订单'
  if (category === 'admission_ticket') return '门票'
  return '旅行资料'
}

function ticketStatus(status: TicketReadinessStatus): NonNullable<TravelObjectViewModelV1['status']> {
  if (status === 'ready') return { code: status, label: '已就绪', tone: 'success' }
  if (status === 'needs_review') return { code: status, label: '待确认', tone: 'warning' }
  if (status === 'expired') return { code: status, label: '已过期', tone: 'danger' }
  return { code: status, label: '不可打开', tone: 'danger' }
}

function transportStatus(status: TransportSegment['status']): NonNullable<TravelObjectViewModelV1['status']> {
  if (status === 'arrived') return { code: status, label: '已到达', tone: 'success' }
  if (status === 'departed') return { code: status, label: '已出发', tone: 'neutral' }
  if (status === 'delayed') return { code: status, label: '延误', tone: 'warning' }
  if (status === 'cancelled') return { code: status, label: '已取消', tone: 'danger' }
  if (status === 'scheduled') return { code: status, label: '已确认', tone: 'success' }
  return { code: status, label: '状态待更新', tone: 'neutral' }
}

function lodgingStatus(status: LodgingReservationV1['status']): NonNullable<TravelObjectViewModelV1['status']> {
  if (status === 'confirmed' || status === 'completed') return { code: status, label: status === 'confirmed' ? '已确认' : '已完成', tone: 'success' }
  if (status === 'changed') return { code: status, label: '有变更', tone: 'warning' }
  if (status === 'cancelled') return { code: status, label: '已取消', tone: 'danger' }
  return { code: status, label: '待确认', tone: 'warning' }
}

function insuranceStatus(status: InsurancePolicyV1['status']): NonNullable<TravelObjectViewModelV1['status']> {
  if (status === 'active') return { code: status, label: '保障中', tone: 'success' }
  if (status === 'expired') return { code: status, label: '已过期', tone: 'danger' }
  if (status === 'cancelled') return { code: status, label: '已取消', tone: 'danger' }
  return { code: status, label: '待确认', tone: 'warning' }
}

function preparationRank(object: TravelObjectViewModelV1) {
  if (object.kind === 'transport') return 0
  if (object.kind === 'lodging') return 1
  return 2
}
