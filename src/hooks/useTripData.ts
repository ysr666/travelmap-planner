import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTrip, listDaysByTrip, listItemsByDay } from '../db'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import { formatDateKey } from '../lib/dates'
import type { Day, ItineraryItem, Trip } from '../types'

type UseTripDataOptions = {
  tripId: string | null
  dayId?: string | null
}

type UseTripDataReturn = {
  trip: Trip | null
  days: Day[]
  selectedDay: Day | null
  items: ItineraryItem[]
  itemsByDay: Record<string, ItineraryItem[]>
  allItems: ItineraryItem[]
  isLoading: boolean
  error: string | null
  setSelectedDay: (day: Day | null) => void
  setDays: (days: Day[]) => void
  setItems: (items: ItineraryItem[]) => void
  setItemsByDay: (itemsByDay: Record<string, ItineraryItem[]>) => void
  refresh: () => Promise<{ nextSelectedDay: Day | null }>
  refreshItems: () => Promise<void>
}

export function pickSelectedDay(trip: Trip, days: Day[], requestedDayId: string | null) {
  if (days.length === 0) {
    return null
  }

  const requestedDay = requestedDayId ? days.find((day) => day.id === requestedDayId) : undefined
  if (requestedDay) {
    return requestedDay
  }

  const today = formatDateKey(new Date())
  if (today >= trip.startDate && today <= trip.endDate) {
    const todayDay = days.find((day) => day.date === today)
    if (todayDay) {
      return todayDay
    }
  }

  return [...days].sort((a, b) => a.sortOrder - b.sortOrder)[0]
}

export async function loadTripDataBundle({
  tripId,
  dayId,
}: {
  tripId: string
  dayId?: string | null
}) {
  const foundTrip = await getTrip(tripId)
  if (!foundTrip) {
    return {
      trip: null,
      days: [],
      selectedDay: null,
      items: [],
      itemsByDay: {},
    }
  }

  const foundDays = await listDaysByTrip(tripId)
  const nextSelectedDay = pickSelectedDay(foundTrip, foundDays, dayId ?? null)
  const nextItems = nextSelectedDay ? await listItemsByDay(nextSelectedDay.id) : []

  return {
    trip: foundTrip,
    days: foundDays,
    selectedDay: nextSelectedDay,
    items: nextItems,
    itemsByDay: nextSelectedDay ? { [nextSelectedDay.id]: nextItems } : {},
  }
}

export function useTripData({ tripId, dayId }: UseTripDataOptions): UseTripDataReturn {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [selectedDay, setSelectedDay] = useState<Day | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [itemsByDay, setItemsByDay] = useState<Record<string, ItineraryItem[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const allItems = useMemo(() => Object.values(itemsByDay).flat(), [itemsByDay])

  const refresh = useCallback(async () => {
    if (!tripId) {
      setError('缺少旅行 ID，请从首页选择一个旅行。')
      setIsLoading(false)
      return { nextSelectedDay: null as Day | null }
    }

    setIsLoading(true)
    setError(null)
    const requestId = ++requestIdRef.current
    try {
      const bundle = await loadTripDataBundle({ tripId, dayId })
      if (requestId !== requestIdRef.current) {
        return { nextSelectedDay: null as Day | null }
      }

      if (!bundle.trip) {
        setTrip(null)
        setDays([])
        setSelectedDay(null)
        setItems([])
        setItemsByDay({})
        setError('没有找到这个旅行，请返回首页重新选择。')
        return { nextSelectedDay: null as Day | null }
      }

      setTrip(bundle.trip)
      setDays(bundle.days)
      setSelectedDay(bundle.selectedDay)
      setItems(bundle.items)
      setItemsByDay(bundle.itemsByDay)
      return { nextSelectedDay: bundle.selectedDay }
    } catch (caught) {
      if (requestId === requestIdRef.current) {
        setError(caught instanceof Error ? caught.message : '读取旅行工作台失败')
      }
      return { nextSelectedDay: null as Day | null }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [dayId, tripId])

  const refreshItems = useCallback(async () => {
    if (!selectedDay) return
    const nextItems = await listItemsByDay(selectedDay.id)
    setItems(nextItems)
    setItemsByDay((current) => ({ ...current, [selectedDay.id]: nextItems }))
  }, [selectedDay])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => {
      requestIdRef.current += 1
      window.clearTimeout(timeout)
    }
  }, [refresh])

  useEffect(() => subscribeTravelDataChanged(() => void refresh()), [refresh])

  return {
    trip,
    days,
    selectedDay,
    items,
    itemsByDay,
    allItems,
    isLoading,
    error,
    setSelectedDay,
    setDays,
    setItems,
    setItemsByDay,
    refresh,
    refreshItems,
  }
}
