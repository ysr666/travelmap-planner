import { CalendarDays } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listItemsByDay } from '../db'
import { TripWorkspaceView } from '../components/trip/TripWorkspaceView'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useLiveClock } from '../hooks/useLiveClock'
import { useTripData } from '../hooks/useTripData'
import { useTripIntelligencePersistence } from '../hooks/useTripIntelligencePersistence'
import { useTripWorkspaceAggregates } from '../hooks/useTripWorkspaceAggregates'
import { useTripWorkspaceViewModel } from '../hooks/useTripWorkspaceViewModel'
import { ensureDaysForTrip } from '../lib/dates'
import { generateRoutePreviewsForTrip, type RouteGenerationBatchResult } from '../lib/routeGeneration'
import { getRouteParams, navigateTo } from '../lib/routes'
import { getRoutingConfig } from '../lib/routing'
import type { TripOperationsLocalState } from '../lib/tripOperationsState'
import type { Day } from '../types'

export function TripWorkspacePage({ routeHash }: { routeHash?: string } = {}) {
  const params = getRouteParams(routeHash)
  const tripId = params.get('tripId')
  const requestedDayId = params.get('dayId')
  const requestedView = params.get('view')
  const hasPostImportRoutePrompt = params.get('postImportRoutePrompt') === '1'
  const {
    trip,
    days,
    selectedDay,
    itemsByDay,
    allItems,
    isLoading,
    error,
    setDays,
    setSelectedDay,
    setItems,
    setItemsByDay,
    refresh,
  } = useTripData({ tripId, dayId: requestedDayId })

  const [isGeneratingDays, setIsGeneratingDays] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [travelInboxRefreshVersion, setTravelInboxRefreshVersion] = useState(0)
  const [travelInboxManualOpen, setTravelInboxManualOpen] = useState(false)
  const [routeGenerationConfirmOpen, setRouteGenerationConfirmOpen] = useState(false)
  const [routeGenerationLoading, setRouteGenerationLoading] = useState(false)
  const [routeGenerationResult, setRouteGenerationResult] = useState<RouteGenerationBatchResult | null>(null)
  const [routeGenerationError, setRouteGenerationError] = useState<string | null>(null)
  const [dismissedImportRoutePromptTripId, setDismissedImportRoutePromptTripId] = useState<string | null>(null)
  const [completedImportRoutePromptTripId, setCompletedImportRoutePromptTripId] = useState<string | null>(null)
  const [manualScheduleDayId, setManualScheduleDayId] = useState<string | null>(null)
  const liveNow = useLiveClock()

  const aggregates = useTripWorkspaceAggregates({
    days,
    isLoading,
    itemsByDay,
    setItemsByDay,
    trip,
  })
  const {
    isLoaded: isTripIntelligenceStateLoaded,
    localState: tripOperationsLocalState,
    restoreSuggestionState: restoreTripIntelligenceSuggestionState,
    setSuggestionState: setTripIntelligenceSuggestionState,
    suggestionStates: tripIntelligenceSuggestionStates,
    updateLocalState: updateTripOperationsLocalState,
  } = useTripIntelligencePersistence(trip?.id)

  useEffect(() => {
    if (!isLoading && trip && selectedDay && (requestedView === 'schedule' || requestedView === 'map')) {
      navigateTo('day', { tripId: trip.id, dayId: selectedDay.id, view: requestedView })
    }
  }, [isLoading, requestedView, selectedDay, trip])

  const model = useTripWorkspaceViewModel({
    allItems,
    cloudSyncQueueSummary: aggregates.cloudSyncQueueSummary,
    days,
    isTripContextLoaded: aggregates.isTripContextLoaded,
    itemsByDay,
    liveNow,
    manualScheduleDayId,
    requestedDayId,
    routePreparation: aggregates.routePreparation,
    selectedDay,
    sharedTripMutations: aggregates.sharedTripMutations,
    suggestionStates: tripIntelligenceSuggestionStates,
    ticketBlobSyncStates: aggregates.ticketBlobSyncStates,
    ticketMetas: aggregates.ticketMetas,
    trip,
    tripDisruptionEvents: aggregates.tripDisruptionEvents,
    tripOperationsInboxPreview: aggregates.tripOperationsInboxPreview,
    tripOperationsInboxSummary: aggregates.tripOperationsInboxSummary,
    tripOperationsLocalState,
    tripReplanRecords: aggregates.tripReplanRecords,
  })

  function handleTripOperationsLocalStateChange(nextState: TripOperationsLocalState) {
    if (trip) updateTripOperationsLocalState(nextState)
  }

  async function handleGenerateDays() {
    if (!trip) return

    setIsGeneratingDays(true)
    setActionError(null)
    try {
      const nextDays = await ensureDaysForTrip(trip)
      const nextSelectedDay = nextDays[0] ?? null
      const nextItems = nextSelectedDay ? await listItemsByDay(nextSelectedDay.id) : []
      setDays(nextDays)
      setSelectedDay(nextSelectedDay)
      setItems(nextItems)
      setItemsByDay(nextSelectedDay ? { [nextSelectedDay.id]: nextItems } : {})
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '生成每日行程失败')
    } finally {
      setIsGeneratingDays(false)
    }
  }

  async function handleConfirmGenerateRoutes() {
    if (!trip || !aggregates.routePreparation?.canGenerate) return

    setRouteGenerationLoading(true)
    setRouteGenerationError(null)
    setRouteGenerationResult(null)
    try {
      const result = await generateRoutePreviewsForTrip({
        config: getRoutingConfig(),
        days,
        itemsByDay,
        tripId: trip.id,
      })
      setRouteGenerationResult(result)
      setRouteGenerationConfirmOpen(false)
      aggregates.refreshRoutePreparation()
    } catch (caught) {
      setRouteGenerationError(caught instanceof Error ? caught.message : '路线预览生成失败。')
    } finally {
      setRouteGenerationLoading(false)
    }
  }

  function openTravelInboxPanel() {
    setTravelInboxManualOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById('trip-travel-inbox-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function clearPostImportRoutePrompt({ hide }: { hide: boolean }) {
    if (!trip) return
    if (hide) {
      setDismissedImportRoutePromptTripId(trip.id)
      setCompletedImportRoutePromptTripId(null)
    } else {
      setCompletedImportRoutePromptTripId(trip.id)
    }
    if (hasPostImportRoutePrompt) navigateTo('trip', { tripId: trip.id })
  }

  async function handleReadinessChanged(options: { refreshTripData?: boolean } = {}) {
    aggregates.refreshReadinessData()
    if (options.refreshTripData) await refresh()
  }

  async function handleTripOperationsChanged(options: { refreshTripData?: boolean } = {}) {
    setTravelInboxRefreshVersion((version) => version + 1)
    await handleReadinessChanged(options)
  }

  if (isLoading) {
    return (
      <div className="h-full min-h-0 space-y-4 overflow-hidden">
        <Card className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
      </div>
    )
  }

  if (error || !trip) {
    return (
      <div className="space-y-5">
        <EmptyState
          body={error || '请从首页选择一个旅行。'}
          icon={<CalendarDays className="size-6" />}
          title="无法打开旅行总览"
        />
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">返回首页</Button>
      </div>
    )
  }

  return (
    <TripWorkspaceView
      actionError={actionError}
      allItems={allItems}
      completedImportRoutePromptTripId={completedImportRoutePromptTripId}
      days={days}
      dismissedImportRoutePromptTripId={dismissedImportRoutePromptTripId}
      hasPostImportRoutePrompt={hasPostImportRoutePrompt}
      isGeneratingDays={isGeneratingDays}
      isTripIntelligenceStateLoaded={isTripIntelligenceStateLoaded}
      itemsByDay={itemsByDay}
      liveNow={liveNow}
      model={model}
      onClearPostImportRoutePrompt={clearPostImportRoutePrompt}
      onConfirmGenerateRoutes={handleConfirmGenerateRoutes}
      onGenerateDays={handleGenerateDays}
      onReadinessChanged={handleReadinessChanged}
      onRefresh={refresh}
      onRouteGenerationConfirmOpenChange={setRouteGenerationConfirmOpen}
      onSelectDay={(day: Day) => {
        setManualScheduleDayId(day.id)
        setSelectedDay(day)
      }}
      onSuggestionStateChange={(suggestion, status) => {
        void setTripIntelligenceSuggestionState({ status, suggestion })
      }}
      onSuggestionStateRestore={(suggestionKey) => {
        void restoreTripIntelligenceSuggestionState(suggestionKey)
      }}
      onTravelInboxOpen={openTravelInboxPanel}
      onTripOperationsChanged={handleTripOperationsChanged}
      onTripOperationsLocalStateChange={handleTripOperationsLocalStateChange}
      routeGenerationConfirmOpen={routeGenerationConfirmOpen}
      routeGenerationError={routeGenerationError}
      routeGenerationLoading={routeGenerationLoading}
      routeGenerationResult={routeGenerationResult}
      routePreparation={aggregates.routePreparation}
      routePreparationLoading={aggregates.routePreparationLoading}
      showTravelInboxPanel={travelInboxManualOpen || Boolean(aggregates.tripOperationsInboxPreview)}
      ticketMetas={aggregates.ticketMetas}
      travelInboxRefreshVersion={travelInboxRefreshVersion}
      trip={trip}
      tripOperationsInboxPreview={aggregates.tripOperationsInboxPreview}
      tripOperationsLocalState={tripOperationsLocalState}
    />
  )
}
