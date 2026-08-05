import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isAdaptiveTripReplanRecord,
  listItemsByDay,
  listTicketsByTrip,
  listTripDisruptionEventsByTrip,
  listTripReplanRecordsByTrip,
} from '../db'
import { getActiveTravelInboxPreview, listTravelInboxEntriesByTrip } from '../lib/ai/travelInbox'
import { listTravelInboxAccountSources } from '../lib/ai/travelInboxOrganization'
import { getCloudSyncQueueSummary, type CloudSyncQueueSummary } from '../lib/cloudSyncQueueSummary'
import { loadOwnerSharedTripState } from '../lib/companion'
import { listTicketBlobSyncStatesByTrip } from '../lib/objectSyncLocal'
import { ROUTE_CACHE_CHANGED_EVENT } from '../lib/routeCache'
import { getPersistentRouteProvider, loadTripRoutePreparation, type TripRoutePreparation } from '../lib/routePreparation'
import { getRoutingConfig, ROUTING_CONFIG_CHANGED_EVENT } from '../lib/routing'
import type { TripOperationsInboxSummary } from '../lib/tripOperationsAgent'
import type {
  Day,
  ItineraryItem,
  SharedTripMutation,
  TicketBlobSyncState,
  TicketMeta,
  TravelInboxAccountSource,
  TravelInboxPreviewRecord,
  Trip,
  TripDisruptionEvent,
  TripReplanRecord,
} from '../types'

type UseTripWorkspaceAggregatesInput = {
  days: Day[]
  isLoading: boolean
  itemsByDay: Record<string, ItineraryItem[]>
  setItemsByDay: (itemsByDay: Record<string, ItineraryItem[]>) => void
  trip: Trip | null
}

export function useTripWorkspaceAggregates({
  days,
  isLoading,
  itemsByDay,
  setItemsByDay,
  trip,
}: UseTripWorkspaceAggregatesInput) {
  const [ticketMetas, setTicketMetas] = useState<TicketMeta[]>([])
  const [ticketBlobSyncStates, setTicketBlobSyncStates] = useState<TicketBlobSyncState[]>([])
  const [cloudSyncQueueSummary, setCloudSyncQueueSummary] = useState<CloudSyncQueueSummary | null>(null)
  const [tripOperationsInboxSummary, setTripOperationsInboxSummary] = useState<TripOperationsInboxSummary | null>(null)
  const [tripOperationsInboxPreview, setTripOperationsInboxPreview] = useState<TravelInboxPreviewRecord | null>(null)
  const [tripDisruptionEvents, setTripDisruptionEvents] = useState<TripDisruptionEvent[]>([])
  const [tripReplanRecords, setTripReplanRecords] = useState<TripReplanRecord[]>([])
  const [sharedTripMutations, setSharedTripMutations] = useState<SharedTripMutation[]>([])
  const [loadedTripContextKey, setLoadedTripContextKey] = useState('')
  const [routePreparation, setRoutePreparation] = useState<TripRoutePreparation | null>(null)
  const [routePreparationLoading, setRoutePreparationLoading] = useState(false)
  const [routePreparationVersion, setRoutePreparationVersion] = useState(0)
  const [readinessDataVersion, setReadinessDataVersion] = useState(0)

  const tripContextKey = useMemo(() => {
    if (!trip || days.length === 0) return ''
    return `${trip.id}:${days.map((day) => day.id).join('|')}`
  }, [days, trip])

  useEffect(() => {
    if (isLoading || !trip || days.length === 0) return

    let cancelled = false
    const currentTripContextKey = tripContextKey
    void Promise.all([
      Promise.all(
        days.map(async (day) => {
          const dayItems = await listItemsByDay(day.id)
          return [day.id, dayItems] as const
        }),
      ),
      listTicketsByTrip(trip.id),
      listTicketBlobSyncStatesByTrip(trip.id),
      getCloudSyncQueueSummary(trip.id),
      listTravelInboxEntriesByTrip(trip.id),
      getActiveTravelInboxPreview(trip.id),
      listTravelInboxAccountSources(),
      listTripDisruptionEventsByTrip(trip.id),
      listTripReplanRecordsByTrip(trip.id),
      loadOwnerSharedTripState(trip.id).catch(() => null),
    ]).then(([entries, tickets, blobSyncStates, syncSummary, inboxEntries, inboxPreview, accountSources, replanEvents, replanRecords, sharedState]) => {
      if (cancelled) return
      setItemsByDay(Object.fromEntries(entries))
      setTicketMetas(tickets)
      setTicketBlobSyncStates(blobSyncStates)
      setCloudSyncQueueSummary(syncSummary)
      setTripDisruptionEvents(replanEvents)
      setTripReplanRecords(replanRecords.filter(isAdaptiveTripReplanRecord))
      setSharedTripMutations(sharedState && sharedState.configured && sharedState.signedIn ? sharedState.mutations : [])
      setTripOperationsInboxPreview(inboxPreview ?? null)
      setTripOperationsInboxSummary(buildTripOperationsInboxSummary({
        accountSources,
        errorEntryCount: inboxEntries.filter((entry) => entry.status === 'error').length,
        previewCheckedCount: inboxPreview?.checkedDiffIds.length ?? 0,
        readyEntryCount: inboxEntries.filter((entry) => entry.status === 'ready' || entry.status === 'previewed').length,
        tripId: trip.id,
      }))
      setLoadedTripContextKey(currentTripContextKey)
    }).catch(() => {
      if (cancelled) return
      setTicketMetas([])
      setTicketBlobSyncStates([])
      setCloudSyncQueueSummary(null)
      setTripOperationsInboxSummary(null)
      setTripOperationsInboxPreview(null)
      setTripDisruptionEvents([])
      setTripReplanRecords([])
      setSharedTripMutations([])
      setLoadedTripContextKey('')
    })

    return () => {
      cancelled = true
    }
  }, [days, isLoading, readinessDataVersion, setItemsByDay, trip, tripContextKey])

  useEffect(() => {
    function refreshRoutePreparation() {
      setRoutePreparationVersion((version) => version + 1)
    }

    window.addEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRoutePreparation)
    window.addEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutePreparation)
    window.addEventListener('storage', refreshRoutePreparation)
    return () => {
      window.removeEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRoutePreparation)
      window.removeEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutePreparation)
      window.removeEventListener('storage', refreshRoutePreparation)
    }
  }, [])

  useEffect(() => {
    if (!trip || !tripContextKey || loadedTripContextKey !== tripContextKey) {
      queueMicrotask(() => {
        setRoutePreparation(null)
        setRoutePreparationLoading(false)
      })
      return
    }

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setRoutePreparationLoading(true)
    })
    void loadTripRoutePreparation({
      days,
      itemsByDay,
      provider: getPersistentRouteProvider(getRoutingConfig()),
      tripId: trip.id,
    }).then((preparation) => {
      if (!cancelled) setRoutePreparation(preparation)
    }).catch(() => {
      if (!cancelled) setRoutePreparation(null)
    }).finally(() => {
      if (!cancelled) setRoutePreparationLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [days, itemsByDay, loadedTripContextKey, routePreparationVersion, trip, tripContextKey])

  const refreshReadinessData = useCallback(() => {
    setReadinessDataVersion((version) => version + 1)
    setRoutePreparationVersion((version) => version + 1)
  }, [])

  const refreshRoutePreparation = useCallback(() => {
    setRoutePreparationVersion((version) => version + 1)
  }, [])

  return {
    cloudSyncQueueSummary,
    isTripContextLoaded: Boolean(tripContextKey && loadedTripContextKey === tripContextKey),
    refreshReadinessData,
    refreshRoutePreparation,
    routePreparation,
    routePreparationLoading,
    sharedTripMutations,
    ticketBlobSyncStates,
    ticketMetas,
    tripDisruptionEvents,
    tripOperationsInboxPreview,
    tripOperationsInboxSummary,
    tripReplanRecords,
  }
}

function buildTripOperationsInboxSummary({
  accountSources,
  errorEntryCount,
  previewCheckedCount,
  readyEntryCount,
  tripId,
}: {
  accountSources: TravelInboxAccountSource[]
  errorEntryCount: number
  previewCheckedCount: number
  readyEntryCount: number
  tripId: string
}): TripOperationsInboxSummary {
  const scopedAccountSources = accountSources.filter((source) => source.targetTripId === tripId || source.classification?.targetTripId === tripId)
  return {
    accountErrorCount: scopedAccountSources.filter((source) => source.status === 'error').length,
    accountNeedsAssignmentCount: scopedAccountSources.filter((source) => source.status === 'needs_assignment').length,
    accountPreviewCount: scopedAccountSources.filter((source) => source.status === 'preview_ready').length,
    errorEntryCount,
    readyEntryCount,
    selectedPreviewDiffCount: previewCheckedCount,
  }
}
