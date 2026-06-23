import { parseTimeMinutes } from './dates'
import { sortItineraryItems } from './itinerary'
import { isValidPlainDate } from './plainDate'
import { getZonedMinuteOfDay, getZonedPlainDate, resolveDayTimeZone, resolveTripTimeZone } from './timeZone'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

export type HomeTripSnapshot = {
  days: Day[]
  items: ItineraryItem[]
  tickets: TicketMeta[]
  trip: Trip
}

export type HomeTripStatus = 'ongoing' | 'upcoming' | 'completed'

export type HomeTripOverview = {
  focusDay?: Day
  nextItem?: ItineraryItem
  preparationLabel: string
  stats: {
    dayCount: number
    itemCount: number
    mappedItemCount: number
    ticketCount: number
  }
  status: HomeTripStatus
  statusLabel: string
  today: string
  trip: Trip
}

export type HomePortfolioModel = {
  activeAndUpcoming: HomeTripOverview[]
  completed: HomeTripOverview[]
  primary: HomeTripOverview | null
}

export function buildHomePortfolioModel(
  snapshots: HomeTripSnapshot[],
  options: { now?: Date; preferredTripId?: string | null } = {},
): HomePortfolioModel {
  const now = options.now ?? new Date()
  const overviews = snapshots.map((snapshot) => buildHomeTripOverview(snapshot, now))
  const ongoing = overviews.filter((overview) => overview.status === 'ongoing')
    .sort((first, second) => compareOngoing(first, second, options.preferredTripId))
  const upcoming = overviews.filter((overview) => overview.status === 'upcoming')
    .sort((first, second) => compareUpcoming(first, second, options.preferredTripId))
  const completed = overviews.filter((overview) => overview.status === 'completed')
    .sort(compareCompleted)
  const ranked = [...ongoing, ...upcoming, ...completed]
  const primary = ranked[0] ?? null

  return {
    activeAndUpcoming: [...ongoing, ...upcoming].filter((overview) => overview.trip.id !== primary?.trip.id),
    completed: completed.filter((overview) => overview.trip.id !== primary?.trip.id),
    primary,
  }
}

export function buildHomeTripOverview(snapshot: HomeTripSnapshot, now = new Date()): HomeTripOverview {
  const { trip } = snapshot
  const today = getZonedPlainDate(now, resolveTripTimeZone(trip))
  const status = getHomeTripStatus(trip, today)
  const days = [...snapshot.days].sort(compareDays)
  const focusDay = selectFocusDay(days, status, today)
  const focusItems = focusDay
    ? sortItineraryItems(snapshot.items.filter((item) => item.dayId === focusDay.id))
    : []
  const nextItem = selectNextItem({ focusDay, items: focusItems, now, status, today, trip })
  const mappedItemCount = snapshot.items.filter(hasValidCoordinates).length

  return {
    focusDay,
    nextItem,
    preparationLabel: buildPreparationLabel({
      dayCount: days.length,
      itemCount: snapshot.items.length,
      mappedItemCount,
      ticketCount: snapshot.tickets.length,
    }),
    stats: {
      dayCount: days.length,
      itemCount: snapshot.items.length,
      mappedItemCount,
      ticketCount: snapshot.tickets.length,
    },
    status,
    statusLabel: getHomeTripStatusLabel(status),
    today,
    trip,
  }
}

export function getHomeTripStatus(trip: Trip, today: string): HomeTripStatus {
  if (!isValidPlainDate(trip.startDate) || !isValidPlainDate(trip.endDate)) return 'upcoming'
  if (today > trip.endDate) return 'completed'
  if (today >= trip.startDate) return 'ongoing'
  return 'upcoming'
}

function selectFocusDay(days: Day[], status: HomeTripStatus, today: string) {
  if (days.length === 0) return undefined
  if (status === 'completed') return days.at(-1)
  return days.find((day) => day.date >= today) ?? days.at(-1)
}

function selectNextItem({
  focusDay,
  items,
  now,
  status,
  today,
  trip,
}: {
  focusDay?: Day
  items: ItineraryItem[]
  now: Date
  status: HomeTripStatus
  today: string
  trip: Trip
}) {
  if (!focusDay || items.length === 0 || status === 'completed') return undefined
  const actionableItems = items.filter((item) => !item.executionState)
  if (status === 'upcoming' || focusDay.date > today) return actionableItems[0]

  const currentMinute = getZonedMinuteOfDay(now, resolveDayTimeZone(trip, focusDay))
  return actionableItems.find((item) => {
    const startMinute = parseTimeMinutes(item.startTime)
    return startMinute === null || startMinute >= currentMinute
  })
}

function buildPreparationLabel(stats: HomeTripOverview['stats']) {
  if (stats.dayCount === 0) return '还没有每日行程'
  if (stats.itemCount === 0) return `已有 ${stats.dayCount} 天，行程点待添加`
  if (stats.mappedItemCount < stats.itemCount) {
    return `${stats.itemCount - stats.mappedItemCount} 个行程点待补坐标`
  }
  if (stats.ticketCount === 0) return `${stats.itemCount} 个地点已可上图，票据待添加`
  return `${stats.mappedItemCount} 个地点可上图 · ${stats.ticketCount} 张票据`
}

function compareDays(first: Day, second: Day) {
  return first.date.localeCompare(second.date) || first.sortOrder - second.sortOrder
}

function compareOngoing(first: HomeTripOverview, second: HomeTripOverview, preferredTripId?: string | null) {
  const preferred = comparePreferred(first, second, preferredTripId)
  return preferred || second.trip.startDate.localeCompare(first.trip.startDate) || compareUpdated(first, second)
}

function compareUpcoming(first: HomeTripOverview, second: HomeTripOverview, preferredTripId?: string | null) {
  const date = first.trip.startDate.localeCompare(second.trip.startDate)
  return date || comparePreferred(first, second, preferredTripId) || compareUpdated(first, second)
}

function compareCompleted(first: HomeTripOverview, second: HomeTripOverview) {
  return second.trip.endDate.localeCompare(first.trip.endDate) || compareUpdated(first, second)
}

function comparePreferred(first: HomeTripOverview, second: HomeTripOverview, preferredTripId?: string | null) {
  if (!preferredTripId) return 0
  if (first.trip.id === preferredTripId) return -1
  if (second.trip.id === preferredTripId) return 1
  return 0
}

function compareUpdated(first: HomeTripOverview, second: HomeTripOverview) {
  return second.trip.updatedAt - first.trip.updatedAt || first.trip.id.localeCompare(second.trip.id)
}

function getHomeTripStatusLabel(status: HomeTripStatus) {
  if (status === 'ongoing') return '进行中'
  if (status === 'completed') return '已完成'
  return '计划中'
}

function hasValidCoordinates(item: ItineraryItem) {
  return typeof item.lat === 'number' && Number.isFinite(item.lat) && typeof item.lng === 'number' && Number.isFinite(item.lng)
}
