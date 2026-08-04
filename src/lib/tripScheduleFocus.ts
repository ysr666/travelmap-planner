import type { Day, ItineraryItem } from '../types'

export type TripScheduleFocus = {
  day: Day
  dayIndex: number
  items: ItineraryItem[]
}

export function buildTripScheduleFocus({
  days,
  itemsByDay,
  liveDay,
  selectedDay,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  liveDay: Day | null
  selectedDay: Day | null
}): TripScheduleFocus | null {
  const day = liveDay ?? selectedDay ?? days[0] ?? null
  if (!day) return null

  return {
    day,
    dayIndex: Math.max(0, days.findIndex((candidate) => candidate.id === day.id)),
    items: itemsByDay[day.id] ?? [],
  }
}
