import { useMemo } from 'react'
import type { ExistingTripImportPreview } from '../lib/ai/existingTripImport'
import { buildTripContext } from '../lib/ai/aiTripContext'
import { buildTripDailyTravelTip } from '../lib/ai/tripDailyTravelTip'
import type { CloudSyncQueueSummary } from '../lib/cloudSyncQueueSummary'
import { analyzeTripContext } from '../lib/tripCheck'
import { buildTripBrief } from '../lib/travelBrief'
import { buildTripIntelligenceModel } from '../lib/tripIntelligence'
import { buildTripOperationsModel, type TripOperationsInboxSummary } from '../lib/tripOperationsAgent'
import type { TripOperationsLocalState } from '../lib/tripOperationsState'
import type { TripRoutePreparation } from '../lib/routePreparation'
import { buildTripReadinessModel } from '../lib/tripReadiness'
import { buildTripScheduleFocus } from '../lib/tripScheduleFocus'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { getZonedPlainDate, resolveDayTimeZone, resolveTripTimeZone } from '../lib/timeZone'
import type {
  Day,
  ItineraryItem,
  SharedTripMutation,
  TicketBlobSyncState,
  TicketMeta,
  TravelInboxPreviewRecord,
  Trip,
  TripDisruptionEvent,
  TripIntelligenceSuggestionStateRecord,
  TripReplanRecord,
} from '../types'

type UseTripWorkspaceViewModelInput = {
  allItems: ItineraryItem[]
  cloudSyncQueueSummary: CloudSyncQueueSummary | null
  days: Day[]
  isTripContextLoaded: boolean
  itemsByDay: Record<string, ItineraryItem[]>
  liveNow: Date
  manualScheduleDayId: string | null
  requestedDayId: string | null
  routePreparation: TripRoutePreparation | null
  selectedDay: Day | null
  sharedTripMutations: SharedTripMutation[]
  suggestionStates: TripIntelligenceSuggestionStateRecord[]
  ticketBlobSyncStates: TicketBlobSyncState[]
  ticketMetas: TicketMeta[]
  trip: Trip | null
  tripDisruptionEvents: TripDisruptionEvent[]
  tripOperationsInboxPreview: TravelInboxPreviewRecord | null
  tripOperationsInboxSummary: TripOperationsInboxSummary | null
  tripOperationsLocalState: TripOperationsLocalState
  tripReplanRecords: TripReplanRecord[]
}

export function useTripWorkspaceViewModel({
  allItems,
  cloudSyncQueueSummary,
  days,
  isTripContextLoaded,
  itemsByDay,
  liveNow,
  manualScheduleDayId,
  requestedDayId,
  routePreparation,
  selectedDay,
  sharedTripMutations,
  suggestionStates,
  ticketBlobSyncStates,
  ticketMetas,
  trip,
  tripDisruptionEvents,
  tripOperationsInboxPreview,
  tripOperationsInboxSummary,
  tripOperationsLocalState,
  tripReplanRecords,
}: UseTripWorkspaceViewModelInput) {
  const tripContext = useMemo(() => {
    if (!trip || !isTripContextLoaded) return null

    return buildTripContext({
      days,
      items: allItems,
      nowPlainDate: getZonedPlainDate(
        new Date(),
        selectedDay ? resolveDayTimeZone(trip, selectedDay) : resolveTripTimeZone(trip),
      ),
      profile: getStoredTravelProfile(),
      selectedDayId: selectedDay?.id,
      tickets: ticketMetas,
      trip,
    })
  }, [allItems, days, isTripContextLoaded, selectedDay, ticketMetas, trip])

  const tripCheckResult = useMemo(
    () => tripContext ? analyzeTripContext(tripContext) : null,
    [tripContext],
  )

  const tripBrief = useMemo(
    () => tripContext && tripCheckResult ? buildTripBrief(tripContext, tripCheckResult) : null,
    [tripCheckResult, tripContext],
  )

  const dailyTipModel = useMemo(() => {
    if (!trip || !tripCheckResult) return null
    return buildTripDailyTravelTip({
      days,
      itemsByDay,
      routePreparation,
      trip,
      tripCheck: tripCheckResult,
    })
  }, [days, itemsByDay, routePreparation, trip, tripCheckResult])

  const readinessModel = useMemo(() => {
    if (!trip || !isTripContextLoaded) return null
    return buildTripReadinessModel({
      allItems,
      cloudSummary: cloudSyncQueueSummary,
      dailyTipModel,
      days,
      itemsByDay,
      routePreparation,
      ticketBlobSyncStates,
      tickets: ticketMetas,
      trip,
      tripCheck: tripCheckResult,
    })
  }, [
    allItems,
    cloudSyncQueueSummary,
    dailyTipModel,
    days,
    isTripContextLoaded,
    itemsByDay,
    routePreparation,
    ticketBlobSyncStates,
    ticketMetas,
    trip,
    tripCheckResult,
  ])

  const tripOperationsModel = useMemo(() => {
    if (!trip || !readinessModel) return null
    return buildTripOperationsModel({
      activeInboxPreview: tripOperationsInboxPreview ? {
        checkedDiffIds: tripOperationsInboxPreview.checkedDiffIds,
        id: tripOperationsInboxPreview.id,
        preview: tripOperationsInboxPreview.preview as ExistingTripImportPreview,
      } : null,
      allItems,
      cloudSummary: cloudSyncQueueSummary,
      dailyTipModel,
      days,
      dispositions: tripOperationsLocalState.dispositions,
      inboxSummary: tripOperationsInboxSummary,
      itemsByDay,
      readinessModel,
      routePreparation,
      sharedMutations: sharedTripMutations,
      ticketBlobSyncStates,
      tickets: ticketMetas,
      trip,
      tripDisruptionEvents,
      tripReplanRecords,
    })
  }, [
    allItems,
    cloudSyncQueueSummary,
    dailyTipModel,
    days,
    itemsByDay,
    readinessModel,
    routePreparation,
    sharedTripMutations,
    ticketBlobSyncStates,
    ticketMetas,
    trip,
    tripDisruptionEvents,
    tripOperationsInboxPreview,
    tripOperationsInboxSummary,
    tripOperationsLocalState.dispositions,
    tripReplanRecords,
  ])

  const tripIntelligenceModel = useMemo(() => {
    if (!trip) return null
    return buildTripIntelligenceModel({
      inbox: {
        activePreview: tripOperationsInboxPreview,
        summary: tripOperationsInboxSummary,
      },
      operationsModel: tripOperationsModel,
      readinessModel,
      sharedMutations: sharedTripMutations,
      suggestionStates,
    })
  }, [
    readinessModel,
    sharedTripMutations,
    suggestionStates,
    trip,
    tripOperationsInboxPreview,
    tripOperationsInboxSummary,
    tripOperationsModel,
  ])

  const liveDay = useMemo(() => {
    if (!trip) return null
    return days.find((day) => day.date === getZonedPlainDate(liveNow, resolveDayTimeZone(trip, day))) ?? null
  }, [days, liveNow, trip])

  const overviewItems = useMemo(() => {
    if (allItems.length > 0) return allItems
    return days.flatMap((day) => itemsByDay[day.id] ?? [])
  }, [allItems, days, itemsByDay])

  const tripHomeFocus = useMemo(() => {
    const explicitDayId = manualScheduleDayId ?? requestedDayId
    const explicitDay = explicitDayId
      ? days.find((day) => day.id === explicitDayId) ?? null
      : null
    return buildTripScheduleFocus({
      days,
      itemsByDay,
      liveDay: explicitDay ? null : liveDay,
      selectedDay: explicitDay ?? selectedDay,
    })
  }, [days, itemsByDay, liveDay, manualScheduleDayId, requestedDayId, selectedDay])

  return {
    dailyTipModel,
    hasInboxAttention: hasTripHomeInboxAttention(tripOperationsInboxSummary, tripOperationsInboxPreview),
    liveDay,
    liveRouteDay: liveDay
      ? routePreparation?.days.find((routeDay) => routeDay.day.id === liveDay.id) ?? null
      : null,
    mappedItemCount: overviewItems.filter(hasUsableCoordinates).length,
    overviewItems,
    readinessModel,
    sharedTripNeedsAttention: sharedTripMutations.some((mutation) => mutation.status === 'pending' || mutation.status === 'conflict'),
    tripBrief,
    tripCheckResult,
    tripHomeFocus,
    tripIntelligenceModel,
    tripOperationsModel,
  }
}

export type TripWorkspaceViewModel = ReturnType<typeof useTripWorkspaceViewModel>

function hasUsableCoordinates(item: ItineraryItem) {
  return typeof item.lat === 'number' && Number.isFinite(item.lat)
    && typeof item.lng === 'number' && Number.isFinite(item.lng)
}

function hasTripHomeInboxAttention(
  summary: TripOperationsInboxSummary | null,
  preview: TravelInboxPreviewRecord | null,
) {
  if (preview) return true
  if (!summary) return false
  return summary.readyEntryCount > 0
    || summary.errorEntryCount > 0
    || summary.accountNeedsAssignmentCount > 0
    || summary.accountPreviewCount > 0
    || summary.accountErrorCount > 0
}
