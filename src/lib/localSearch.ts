import { formatDateRange } from './dates'
import { describeItemTime } from './itinerary'
import { formatLedgerMoney, ledgerCategoryLabels } from './ledger'
import { getTicketCategoryLabel, getTicketDisplayTitle } from './tickets'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  RouteId,
  TicketMeta,
  TransportBooking,
  TransportBookingKind,
  TransportSegment,
  Trip,
} from '../types'

export type LocalSearchCategory = 'trip' | 'item' | 'ticket' | 'transport' | 'ledger'
export type LocalSearchFilter = 'all' | LocalSearchCategory

export type LocalSearchRecord = {
  category: LocalSearchCategory
  detail: string
  eyebrow: string
  id: string
  params: Record<string, string>
  route: RouteId
  searchFields: {
    primary: string[]
    secondary: string[]
  }
  title: string
  updatedAt: number
}

export type LocalSearchIndexInput = {
  bookings: TransportBooking[]
  days: Day[]
  expenses: LedgerExpense[]
  items: ItineraryItem[]
  segments: TransportSegment[]
  tickets: TicketMeta[]
  trips: Trip[]
}

export type LocalSearchResult = {
  record: LocalSearchRecord
  score: number
}

export type LocalSearchView = {
  counts: Record<LocalSearchFilter, number>
  groups: Array<{
    category: LocalSearchCategory
    label: string
    results: LocalSearchResult[]
  }>
  results: LocalSearchResult[]
  totalMatches: number
}

const DEFAULT_RESULT_LIMIT = 60
const categoryOrder: LocalSearchCategory[] = ['trip', 'item', 'ticket', 'transport', 'ledger']

export const localSearchCategoryLabels: Record<LocalSearchFilter, string> = {
  all: '全部',
  item: '行程点',
  ledger: '账本',
  ticket: '票据',
  transport: '交通',
  trip: '旅行',
}

const bookingKindLabels: Record<TransportBookingKind, string> = {
  bus: '长途巴士',
  cruise: '邮轮',
  ferry: '轮渡',
  flight: '航班',
  other: '其他交通',
  train: '火车',
}

export function buildLocalSearchIndex(input: LocalSearchIndexInput): LocalSearchRecord[] {
  const tripById = new Map(input.trips.map((trip) => [trip.id, trip]))
  const dayById = new Map(input.days.map((day) => [day.id, day]))
  const itemById = new Map(input.items.map((item) => [item.id, item]))
  const segmentsByBooking = groupSegmentsByBooking(input.segments)

  return [
    ...input.trips.map(buildTripRecord),
    ...input.items.flatMap((item) => {
      const trip = tripById.get(item.tripId)
      if (!trip) return []
      return [buildItemRecord(item, trip, dayById.get(item.dayId))]
    }),
    ...input.tickets.flatMap((ticket) => {
      const trip = tripById.get(ticket.tripId)
      if (!trip) return []
      return [buildTicketRecord(ticket, trip, ticket.itemId ? itemById.get(ticket.itemId) : undefined)]
    }),
    ...input.bookings.flatMap((booking) => {
      const trip = tripById.get(booking.tripId)
      if (!trip) return []
      return [buildTransportRecord(booking, trip, segmentsByBooking.get(booking.id) ?? [])]
    }),
    ...input.expenses.flatMap((expense) => {
      const trip = tripById.get(expense.tripId)
      if (!trip) return []
      return [buildLedgerRecord(expense, trip)]
    }),
  ]
}

export function buildLocalSearchView(
  index: LocalSearchRecord[],
  options: { filter?: LocalSearchFilter; limit?: number; query?: string } = {},
): LocalSearchView {
  const filter = options.filter ?? 'all'
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const allMatches = queryLocalSearch(index, { query: options.query })
  const counts = buildCounts(allMatches)
  const results = allMatches
    .filter((result) => filter === 'all' || result.record.category === filter)
    .slice(0, limit)
  const groups = categoryOrder.flatMap((category) => {
    const categoryResults = results.filter((result) => result.record.category === category)
    return categoryResults.length > 0
      ? [{ category, label: localSearchCategoryLabels[category], results: categoryResults }]
      : []
  })

  return { counts, groups, results, totalMatches: allMatches.length }
}

export function queryLocalSearch(
  index: LocalSearchRecord[],
  options: { query?: string } = {},
): LocalSearchResult[] {
  const query = normalizeSearchText(options.query ?? '')
  if (!query) {
    return index
      .map((record) => ({ record, score: 0 }))
      .sort(compareSearchResults)
  }

  const tokens = getSearchTokens(query)
  return index.flatMap((record) => {
    const score = scoreRecord(record, query, tokens)
    return score > 0 ? [{ record, score }] : []
  }).sort(compareSearchResults)
}

export function normalizeSearchText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function buildTripRecord(trip: Trip): LocalSearchRecord {
  return {
    category: 'trip',
    detail: `${trip.destination || '目的地待补充'} · ${formatDateRange(trip.startDate, trip.endDate)}`,
    eyebrow: '旅行',
    id: `trip:${trip.id}`,
    params: { tripId: trip.id },
    route: 'trip',
    searchFields: {
      primary: [trip.title, trip.destination],
      secondary: [trip.startDate, trip.endDate, trip.notes ?? ''],
    },
    title: trip.title,
    updatedAt: trip.updatedAt,
  }
}

function buildItemRecord(item: ItineraryItem, trip: Trip, day?: Day): LocalSearchRecord {
  const place = item.locationName || item.address || '地点待补充'
  return {
    category: 'item',
    detail: `${trip.title} · ${day?.title || '未分配日期'} · ${describeItemTime(item)} · ${place}`,
    eyebrow: day?.title || '行程点',
    id: `item:${item.id}`,
    params: { dayId: item.dayId, itemId: item.id, tripId: item.tripId },
    route: 'item',
    searchFields: {
      primary: [item.title, item.locationName ?? '', item.address ?? ''],
      secondary: [trip.title, trip.destination, day?.title ?? '', day?.date ?? '', item.notes ?? ''],
    },
    title: item.title,
    updatedAt: item.updatedAt,
  }
}

function buildTicketRecord(ticket: TicketMeta, trip: Trip, item?: ItineraryItem): LocalSearchRecord {
  const category = getTicketCategoryLabel(ticket)
  const title = getTicketDisplayTitle(ticket)
  return {
    category: 'ticket',
    detail: `${trip.title}${item ? ` · ${item.title}` : ''} · ${category}`,
    eyebrow: category,
    id: `ticket:${ticket.id}`,
    params: {
      ...(ticket.itemId ? { itemId: ticket.itemId } : {}),
      tab: 'attachments',
      tripId: ticket.tripId,
    },
    route: 'documents',
    searchFields: {
      primary: [title, ticket.fileName],
      secondary: [trip.title, item?.title ?? '', category, ticket.note ?? ''],
    },
    title,
    updatedAt: ticket.updatedAt,
  }
}

function buildTransportRecord(booking: TransportBooking, trip: Trip, segments: TransportSegment[]): LocalSearchRecord {
  const sortedSegments = [...segments].sort((first, second) => first.sortOrder - second.sortOrder)
  const firstSegment = sortedSegments[0]
  const routeLabel = firstSegment ? `${firstSegment.departurePlace} → ${firstSegment.arrivalPlace}` : '交通段待补充'
  const dateLabel = firstSegment?.departureDate ? `${firstSegment.departureDate} · ` : ''
  return {
    category: 'transport',
    detail: `${trip.title} · ${dateLabel}${routeLabel}`,
    eyebrow: bookingKindLabels[booking.kind],
    id: `transport:${booking.id}`,
    params: { bookingId: booking.id, tab: 'transport', tripId: booking.tripId },
    route: 'documents',
    searchFields: {
      primary: [booking.title, booking.providerName ?? '', ...sortedSegments.flatMap((segment) => [
        segment.carrier ?? '',
        segment.serviceNumber ?? '',
        segment.departurePlace,
        segment.arrivalPlace,
      ])],
      secondary: [trip.title, trip.destination, bookingKindLabels[booking.kind], booking.status, booking.sourceLabel ?? ''],
    },
    title: booking.title,
    updatedAt: Math.max(booking.updatedAt, ...sortedSegments.map((segment) => segment.updatedAt)),
  }
}

function buildLedgerRecord(expense: LedgerExpense, trip: Trip): LocalSearchRecord {
  const amount = expense.amountMinor === undefined
    ? '金额待补充'
    : formatLedgerMoney(expense.amountMinor, expense.currency ?? 'CNY')
  const category = ledgerCategoryLabels[expense.category]
  return {
    category: 'ledger',
    detail: `${trip.title} · ${expense.date} · ${amount}`,
    eyebrow: `${category} · ${getExpenseStatusLabel(expense.status)}`,
    id: `ledger:${expense.id}`,
    params: { expenseId: expense.id, tripId: expense.tripId },
    route: 'ledger/expense',
    searchFields: {
      primary: [expense.title, expense.merchant ?? '', expense.city ?? ''],
      secondary: [trip.title, trip.destination, expense.date, category, expense.status, expense.currency ?? ''],
    },
    title: expense.title,
    updatedAt: expense.updatedAt,
  }
}

function scoreRecord(record: LocalSearchRecord, query: string, tokens: string[]) {
  const normalizedPrimary = record.searchFields.primary.map(normalizeSearchText).filter(Boolean)
  const normalizedSecondary = record.searchFields.secondary.map(normalizeSearchText).filter(Boolean)
  const allFields = [...normalizedPrimary, ...normalizedSecondary]
  const compactQuery = compactSearchText(query)
  const compactFields = allFields.map(compactSearchText)

  let score = 0
  for (const token of tokens) {
    const compactToken = compactSearchText(token)
    const primaryScore = Math.max(0, ...normalizedPrimary.map((field) => scoreField(field, token, 40)))
    const secondaryScore = Math.max(0, ...normalizedSecondary.map((field) => scoreField(field, token, 14)))
    const compactScore = compactToken
      ? Math.max(0, ...compactFields.map((field) => scoreField(field, compactToken, 10)))
      : 0
    const tokenScore = Math.max(primaryScore, secondaryScore, compactScore)
    if (tokenScore === 0) return 0
    score += tokenScore
  }

  const title = normalizeSearchText(record.title)
  if (title === query) score += 300
  else if (title.startsWith(query)) score += 180
  else if (title.includes(query)) score += 120
  if (compactQuery && compactSearchText(title) === compactQuery) score += 80
  return score
}

function scoreField(field: string, token: string, weight: number) {
  if (!field || !token) return 0
  if (field === token) return weight * 4
  if (field.startsWith(token)) return weight * 3
  if (field.includes(token)) return weight * 2
  return 0
}

function compareSearchResults(first: LocalSearchResult, second: LocalSearchResult) {
  return second.score - first.score
    || second.record.updatedAt - first.record.updatedAt
    || first.record.title.localeCompare(second.record.title, 'zh-CN')
    || first.record.id.localeCompare(second.record.id)
}

function getSearchTokens(query: string) {
  return [...new Set(query.split(' ').filter(Boolean))]
}

function compactSearchText(value: string) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, '')
}

function buildCounts(results: LocalSearchResult[]): Record<LocalSearchFilter, number> {
  const counts: Record<LocalSearchFilter, number> = {
    all: results.length,
    item: 0,
    ledger: 0,
    ticket: 0,
    transport: 0,
    trip: 0,
  }
  for (const result of results) counts[result.record.category] += 1
  return counts
}

function groupSegmentsByBooking(segments: TransportSegment[]) {
  const grouped = new Map<string, TransportSegment[]>()
  for (const segment of segments) {
    const current = grouped.get(segment.bookingId) ?? []
    current.push(segment)
    grouped.set(segment.bookingId, current)
  }
  return grouped
}

function getExpenseStatusLabel(status: LedgerExpense['status']) {
  if (status === 'confirmed') return '已确认'
  if (status === 'void') return '已作废'
  return '待确认'
}
