import { sortItineraryItems } from './itinerary'
import { getItemLngLat, type LngLat } from './routing'
import type { Day, ItineraryItem } from '../types'

export type DayPrewarmTarget = {
  dayId: string
  title: string
  bounds: [LngLat, LngLat]
  coordinatesCount: number
}

export type NetworkInformationLike = {
  effectiveType?: string
  saveData?: boolean
}

export function buildDayPrewarmQueue({
  days,
  currentDayId,
  itemsByDayId,
}: {
  days: Day[]
  currentDayId: string
  itemsByDayId: Record<string, ItineraryItem[]>
}) {
  const currentIndex = days.findIndex((day) => day.id === currentDayId)
  if (currentIndex < 0) {
    return []
  }

  const maxDistance = days.length <= 5 ? Number.POSITIVE_INFINITY : 2
  return days
    .map((day, index) => {
      const distance = Math.abs(index - currentIndex)
      return {
        day,
        distance,
        priority: getPrewarmPriority(index, currentIndex),
      }
    })
    .filter(({ distance }) => distance <= maxDistance)
    .sort((left, right) => left.priority - right.priority)
    .flatMap(({ day }) => {
      const bounds = buildBoundsForItems(itemsByDayId[day.id] ?? [])
      if (!bounds) {
        return []
      }

      return [{
        dayId: day.id,
        title: day.title,
        bounds: bounds.bounds,
        coordinatesCount: bounds.coordinatesCount,
      }]
    })
}

export function shouldSkipMapPrewarm(connection?: NetworkInformationLike | null) {
  if (!connection) {
    return false
  }

  if (connection.saveData) {
    return true
  }

  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

function getPrewarmPriority(index: number, currentIndex: number) {
  const distance = Math.abs(index - currentIndex)
  if (distance === 0) {
    return 0
  }

  const isAfterCurrent = index > currentIndex
  return distance * 2 - (isAfterCurrent ? 1 : 0)
}

function buildBoundsForItems(items: ItineraryItem[]) {
  const coordinates = sortItineraryItems(items)
    .map((item) => getItemLngLat(item))
    .filter((coordinate): coordinate is LngLat => coordinate !== null)

  if (coordinates.length === 0) {
    return null
  }

  let minLng = coordinates[0][0]
  let minLat = coordinates[0][1]
  let maxLng = coordinates[0][0]
  let maxLat = coordinates[0][1]

  coordinates.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  })

  if (coordinates.length === 1) {
    const pointPadding = 0.012
    minLng -= pointPadding
    maxLng += pointPadding
    minLat -= pointPadding
    maxLat += pointPadding
  }

  return {
    bounds: [[minLng, minLat], [maxLng, maxLat]] as [LngLat, LngLat],
    coordinatesCount: coordinates.length,
  }
}
