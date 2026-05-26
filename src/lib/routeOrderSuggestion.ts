import { sortItineraryItems } from './itinerary'
import { hasValidCoordinates } from './mapLinks'
import type { ProviderProxyRouteOrderSuggestionItem } from './providerProxyContract'
import type { Day, ItineraryItem } from '../types'

export type RouteOrderSuggestionSortPatch = {
  id: string
  sortOrder: number
}

export function buildRouteOrderSuggestionRequestItems(items: ItineraryItem[]): ProviderProxyRouteOrderSuggestionItem[] {
  return sortItineraryItems(items).map((item) => ({
    address: item.address,
    coordinate: hasValidCoordinates(item) ? { lat: item.lat as number, lng: item.lng as number } : undefined,
    id: item.id,
    locationName: item.locationName,
    title: item.title,
  }))
}

export function getRouteOrderSuggestionCandidateDay({
  days,
  itemsByDay,
  selectedDay,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  selectedDay: Day | null
}) {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const candidates = orderedDays.filter((day) => isRouteOrderSuggestionCandidate(itemsByDay[day.id] ?? []))

  if (selectedDay && candidates.some((day) => day.id === selectedDay.id)) {
    return selectedDay
  }

  return candidates[0] ?? null
}

export function isRouteOrderSuggestionCandidate(items: ItineraryItem[]) {
  const orderedItems = sortItineraryItems(items)
  const coordinateCount = orderedItems.filter(hasValidCoordinates).length
  return orderedItems.length >= 2 && orderedItems.length <= 10 && coordinateCount >= 2 && coordinateCount <= 10
}

export function buildRouteOrderSuggestionSortPatches(
  items: ItineraryItem[],
  suggestedItemIds: string[],
): RouteOrderSuggestionSortPatch[] {
  const orderedItems = sortItineraryItems(items)
  const coordinateItems = orderedItems.filter(hasValidCoordinates)
  if (!hasSameStringSet(suggestedItemIds, coordinateItems.map((item) => item.id))) {
    throw new Error('路线顺序建议与当前行程点不匹配。')
  }

  const itemById = new Map(orderedItems.map((item) => [item.id, item]))
  const suggestedQueue = suggestedItemIds.map((itemId) => {
    const item = itemById.get(itemId)
    if (!item) {
      throw new Error('路线顺序建议包含未知行程点。')
    }
    return item
  })
  const nextItems = orderedItems.map((item) => hasValidCoordinates(item) ? suggestedQueue.shift() as ItineraryItem : item)

  return nextItems.flatMap((item, index) => {
    const nextSortOrder = index + 1
    return item.sortOrder === nextSortOrder ? [] : [{ id: item.id, sortOrder: nextSortOrder }]
  })
}

function hasSameStringSet(first: string[], second: string[]) {
  if (first.length !== second.length || new Set(first).size !== first.length) {
    return false
  }
  const secondSet = new Set(second)
  return first.every((value) => secondSet.has(value))
}
