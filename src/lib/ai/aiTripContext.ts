import type { Day, ItineraryItem, TicketMeta, TicketScope, TicketStorageMode, TransportMode, Trip } from '../../types'
import { sortItineraryItems } from '../itinerary'
import { getTicketScope, getTicketStorageMode } from '../tickets'
import { normalizeTravelProfile, type TravelProfile } from '../travelProfile'

export type TripContextCoordinateState = 'missing' | 'present' | 'invalid'
export type TripContextNoteLength = 'none' | 'short' | 'medium' | 'long'
export type TripContextTicketBoundState = 'none' | 'item_bound'

export type BuildTripContextInput = {
  trip: Trip
  days: Day[]
  items: ItineraryItem[]
  tickets: TicketMeta[]
  profile?: TravelProfile
  selectedDayId?: string | null
  nowPlainDate?: string
}

export type TripContext = {
  version: 1
  nowPlainDate?: string
  profile?: TravelProfile
  selectedDayId?: string
  trip: {
    id: string
    title: string
    destination: string
    startDate: string
    endDate: string
    hasNotes: boolean
    noteLength: TripContextNoteLength
  }
  days: TripContextDay[]
  ticketSummary: TripContextTicketSummary
}

export type TripContextDay = {
  id: string
  date: string
  title: string
  sortOrder: number
  itemCount: number
  items: TripContextItem[]
}

export type TripContextItem = {
  id: string
  dayId: string
  title: string
  startTime?: string
  endTime?: string
  locationName?: string
  address?: string
  coordinateState: TripContextCoordinateState
  previousTransport: {
    mode?: TransportMode
    hasDuration: boolean
    durationMinutes?: number
    hasNote: boolean
  }
  hasNotes: boolean
  noteLength: TripContextNoteLength
  ticketCount: number
  ticketBoundState: TripContextTicketBoundState
  sortOrder: number
}

export type TripContextTicketSummary = {
  totalCount: number
  itemBoundCount: number
  tripBoundCount: number
  unassignedCount: number
  byScope: Record<TicketScope, number>
  byStorageMode: Record<TicketStorageMode, number>
  byFileType: Record<TicketMeta['fileType'], number>
}

const ticketScopes: TicketScope[] = ['trip', 'item', 'unassigned']
const ticketStorageModes: TicketStorageMode[] = ['copy', 'reference', 'external']
const ticketFileTypes: TicketMeta['fileType'][] = ['image', 'pdf', 'other']

export function buildTripContext({
  days,
  items,
  nowPlainDate,
  profile,
  selectedDayId,
  tickets,
  trip,
}: BuildTripContextInput): TripContext {
  const itemsByDay = groupItemsByDay(items)
  const ticketIdsByItemId = groupTicketIdsByItemId(tickets)
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const normalizedProfile = profile ? normalizeTravelProfile(profile) : undefined

  return {
    days: orderedDays.map((day) => {
      const dayItems = sortItineraryItems(itemsByDay.get(day.id) ?? [])
      return {
        date: day.date,
        id: day.id,
        itemCount: dayItems.length,
        items: dayItems.map((item) => buildContextItem(item, ticketIdsByItemId.get(item.id) ?? [])),
        sortOrder: day.sortOrder,
        title: day.title,
      }
    }),
    nowPlainDate: nowPlainDate?.trim() || undefined,
    ...(normalizedProfile ? { profile: normalizedProfile } : {}),
    selectedDayId: selectedDayId ?? undefined,
    ticketSummary: buildTicketSummary(tickets),
    trip: {
      destination: trip.destination,
      endDate: trip.endDate,
      hasNotes: hasText(trip.notes),
      id: trip.id,
      noteLength: classifyNoteLength(trip.notes),
      startDate: trip.startDate,
      title: trip.title,
    },
    version: 1,
  }
}

function buildContextItem(item: ItineraryItem, ticketMetaIds: string[]): TripContextItem {
  const ticketIds = new Set([...item.ticketIds, ...ticketMetaIds])
  const ticketCount = ticketIds.size
  const previousTransportDuration = Number.isFinite(item.previousTransportDurationMinutes)
    ? item.previousTransportDurationMinutes
    : undefined

  return {
    address: normalizeOptionalText(item.address),
    coordinateState: getCoordinateState(item),
    dayId: item.dayId,
    endTime: normalizeOptionalText(item.endTime),
    hasNotes: hasText(item.notes),
    id: item.id,
    locationName: normalizeOptionalText(item.locationName),
    noteLength: classifyNoteLength(item.notes),
    previousTransport: {
      durationMinutes: previousTransportDuration,
      hasDuration: previousTransportDuration !== undefined,
      hasNote: hasText(item.previousTransportNote),
      mode: item.previousTransportMode,
    },
    sortOrder: item.sortOrder,
    startTime: normalizeOptionalText(item.startTime),
    ticketBoundState: ticketCount > 0 ? 'item_bound' : 'none',
    ticketCount,
    title: item.title,
  }
}

export function getCoordinateState(item: Pick<ItineraryItem, 'lat' | 'lng'>): TripContextCoordinateState {
  const hasLat = item.lat !== undefined
  const hasLng = item.lng !== undefined
  if (!hasLat && !hasLng) {
    return 'missing'
  }

  if (
    typeof item.lat === 'number' &&
    typeof item.lng === 'number' &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng) &&
    item.lat >= -90 &&
    item.lat <= 90 &&
    item.lng >= -180 &&
    item.lng <= 180
  ) {
    return 'present'
  }

  return 'invalid'
}

function buildTicketSummary(tickets: TicketMeta[]): TripContextTicketSummary {
  const byScope = createCountRecord(ticketScopes)
  const byStorageMode = createCountRecord(ticketStorageModes)
  const byFileType = createCountRecord(ticketFileTypes)

  for (const ticket of tickets) {
    byScope[getTicketScope(ticket)] += 1
    byStorageMode[getTicketStorageMode(ticket)] += 1
    byFileType[ticket.fileType] += 1
  }

  return {
    byFileType,
    byScope,
    byStorageMode,
    itemBoundCount: byScope.item,
    totalCount: tickets.length,
    tripBoundCount: byScope.trip,
    unassignedCount: byScope.unassigned,
  }
}

function groupItemsByDay(items: ItineraryItem[]) {
  const grouped = new Map<string, ItineraryItem[]>()
  for (const item of items) {
    grouped.set(item.dayId, [...(grouped.get(item.dayId) ?? []), item])
  }
  return grouped
}

function groupTicketIdsByItemId(tickets: TicketMeta[]) {
  const grouped = new Map<string, string[]>()
  for (const ticket of tickets) {
    if (!ticket.itemId) {
      continue
    }
    grouped.set(ticket.itemId, [...(grouped.get(ticket.itemId) ?? []), ticket.id])
  }
  return grouped
}

function classifyNoteLength(value: string | undefined): TripContextNoteLength {
  const length = value?.trim().length ?? 0
  if (length === 0) {
    return 'none'
  }
  if (length <= 40) {
    return 'short'
  }
  if (length <= 160) {
    return 'medium'
  }
  return 'long'
}

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() || undefined
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim())
}

function createCountRecord<T extends string>(keys: T[]) {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
}
