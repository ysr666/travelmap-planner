import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Inbox,
  Loader2,
  MapPinned,
  NotebookText,
  Plus,
  RotateCw,
  Route,
  Ticket,
  WalletCards,
} from 'lucide-react'
import { listItemsByDay, listTicketsByTrip, listTripDisruptionEventsByTrip, listTripReplanRecordsByTrip } from '../db'
import { TripCover } from '../components/trip/TripCover'
import { ImportRouteGenerationPanel } from '../components/trip/ImportRouteGenerationPanel'
import { TripMoreMenu } from '../components/trip/TripMoreMenu'
import { TripMapPreview } from '../components/trip/TripMapPreview'
import { TripDailyTravelTipCard } from '../components/trip/TripDailyTravelTipCard'
import { TripOperationsPanel } from '../components/trip/TripOperationsPanel'
import { TripLiveModeCard } from '../components/trip/TripLiveModeCard'
import { TripReadinessCenterPanel } from '../components/trip/TripReadinessCenterPanel'
import { SharedTripPanel } from '../components/trip/SharedTripPanel'
import { LedgerSummaryCard } from '../components/trip/LedgerSummaryCard'
import { TravelBackupPanel } from '../components/trip/TravelBackupPanel'
import { AiTripEditPanel } from '../components/ai/AiTripEditPanel'
import { SmartTripWorkspacePanel } from '../components/ai/SmartTripWorkspacePanel'
import { TripBriefCard } from '../components/ai/TripBriefCard'
import { TripContentEnrichmentPanel } from '../components/ai/TripContentEnrichmentPanel'
import { TravelInboxPanel } from '../components/ai/TravelInboxPanel'
import { CloudSnapshotCheckPrompts } from '../components/cloud/CloudSnapshotCheckPrompts'
import { AutoSnapshotBackupStatus } from '../components/cloud/AutoSnapshotBackupStatus'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Collapsible } from '../components/ui/Collapsible'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useTripData } from '../hooks/useTripData'
import { useLiveClock } from '../hooks/useLiveClock'
import { useTripIntelligencePersistence } from '../hooks/useTripIntelligencePersistence'
import { ensureDaysForTrip, formatDate, formatDateRange } from '../lib/dates'
import { buildTripContext } from '../lib/ai/aiTripContext'
import { getRouteParams, navigateTo } from '../lib/routes'
import { analyzeTripContext } from '../lib/tripCheck'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { buildTripBrief } from '../lib/travelBrief'
import { describeItemTime } from '../lib/itinerary'
import { buildTripDailyTravelTip } from '../lib/ai/tripDailyTravelTip'
import { generateRoutePreviewsForTrip, type RouteGenerationBatchResult } from '../lib/routeGeneration'
import { getPersistentRouteProvider, loadTripRoutePreparation, type TripRoutePreparation } from '../lib/routePreparation'
import { ROUTE_CACHE_CHANGED_EVENT } from '../lib/routeCache'
import { getRoutingConfig, ROUTING_CONFIG_CHANGED_EVENT } from '../lib/routing'
import { getCloudSyncQueueSummary, type CloudSyncQueueSummary } from '../lib/cloudSyncQueueSummary'
import { listTicketBlobSyncStatesByTrip } from '../lib/objectSyncLocal'
import { buildTripReadinessModel } from '../lib/tripReadiness'
import { buildTripOperationsModel, type TripOperationsInboxSummary } from '../lib/tripOperationsAgent'
import { buildTripIntelligenceModel } from '../lib/tripIntelligence'
import type { ExistingTripImportPreview } from '../lib/ai/existingTripImport'
import {
  type TripOperationsLocalState,
} from '../lib/tripOperationsState'
import { getZonedPlainDate, resolveDayTimeZone, resolveTripTimeZone } from '../lib/timeZone'
import { getActiveTravelInboxPreview, listTravelInboxEntriesByTrip } from '../lib/ai/travelInbox'
import { listTravelInboxAccountSources } from '../lib/ai/travelInboxOrganization'
import { navigateToTripOperationsRecommendation } from '../lib/tripOperationsNavigation'
import { loadOwnerSharedTripState } from '../lib/companion'
import type {
  Day,
  ItineraryItem,
  SharedTripMutation,
  TicketBlobSyncState,
  TicketMeta,
  TravelInboxAccountSource,
  TravelInboxPreviewRecord,
  TripDisruptionEvent,
  TripReplanRecord,
} from '../types'

export function TripWorkspacePage() {
  const params = getRouteParams()
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
  const [travelInboxRefreshVersion, setTravelInboxRefreshVersion] = useState(0)
  const [travelInboxManualOpen, setTravelInboxManualOpen] = useState(false)
  const [routeGenerationConfirmOpen, setRouteGenerationConfirmOpen] = useState(false)
  const [routeGenerationLoading, setRouteGenerationLoading] = useState(false)
  const [routeGenerationResult, setRouteGenerationResult] = useState<RouteGenerationBatchResult | null>(null)
  const [routeGenerationError, setRouteGenerationError] = useState<string | null>(null)
  const [dismissedImportRoutePromptTripId, setDismissedImportRoutePromptTripId] = useState<string | null>(null)
  const [completedImportRoutePromptTripId, setCompletedImportRoutePromptTripId] = useState<string | null>(null)
  const liveNow = useLiveClock()

  const tripContextKey = useMemo(() => {
    if (!trip || days.length === 0) {
      return ''
    }

    return `${trip.id}:${days.map((day) => day.id).join('|')}`
  }, [days, trip])

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

  useEffect(() => {
    if (isLoading || !trip || days.length === 0) {
      return
    }

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
      if (!cancelled) {
        setItemsByDay(Object.fromEntries(entries))
        setTicketMetas(tickets)
        setTicketBlobSyncStates(blobSyncStates)
        setCloudSyncQueueSummary(syncSummary)
        setTripDisruptionEvents(replanEvents)
        setTripReplanRecords(replanRecords)
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
      }
    }).catch(() => {
      if (!cancelled) {
        setTicketMetas([])
        setTicketBlobSyncStates([])
        setCloudSyncQueueSummary(null)
        setTripOperationsInboxSummary(null)
        setTripOperationsInboxPreview(null)
        setTripDisruptionEvents([])
        setTripReplanRecords([])
        setSharedTripMutations([])
        setLoadedTripContextKey('')
      }
      // Trip Home can still render without aggregate item counts.
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
      if (!cancelled) {
        setRoutePreparationLoading(true)
      }
    })
    void loadTripRoutePreparation({
      days,
      itemsByDay,
      provider: getPersistentRouteProvider(getRoutingConfig()),
      tripId: trip.id,
    }).then((preparation) => {
      if (!cancelled) {
        setRoutePreparation(preparation)
      }
    }).catch(() => {
      if (!cancelled) {
        setRoutePreparation(null)
      }
    }).finally(() => {
      if (!cancelled) {
        setRoutePreparationLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [days, itemsByDay, loadedTripContextKey, routePreparationVersion, trip, tripContextKey])


  const tripContext = useMemo(() => {
    if (!trip || !tripContextKey || loadedTripContextKey !== tripContextKey) {
      return null
    }

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
  }, [allItems, days, loadedTripContextKey, selectedDay, ticketMetas, trip, tripContextKey])

  const tripCheckResult = useMemo(() => {
    return tripContext ? analyzeTripContext(tripContext) : null
  }, [tripContext])

  const tripBrief = useMemo(() => {
    return tripContext && tripCheckResult ? buildTripBrief(tripContext, tripCheckResult) : null
  }, [tripCheckResult, tripContext])

  const dailyTipModel = useMemo(() => {
    if (!trip || !tripCheckResult) {
      return null
    }
    return buildTripDailyTravelTip({
      days,
      itemsByDay,
      routePreparation,
      trip,
      tripCheck: tripCheckResult,
    })
  }, [days, itemsByDay, routePreparation, trip, tripCheckResult])

  const readinessModel = useMemo(() => {
    if (!trip || !tripContextKey || loadedTripContextKey !== tripContextKey) {
      return null
    }
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
    itemsByDay,
    loadedTripContextKey,
    routePreparation,
    ticketBlobSyncStates,
    ticketMetas,
    trip,
    tripCheckResult,
    tripContextKey,
  ])

  const tripOperationsModel = useMemo(() => {
    if (!trip || !readinessModel) {
      return null
    }
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
    tripReplanRecords,
    tripOperationsInboxSummary,
    tripOperationsInboxPreview,
    tripOperationsLocalState.dispositions,
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
      suggestionStates: tripIntelligenceSuggestionStates,
    })
  }, [
    readinessModel,
    sharedTripMutations,
    tripIntelligenceSuggestionStates,
    trip,
    tripOperationsInboxSummary,
    tripOperationsInboxPreview,
    tripOperationsModel,
  ])

  const liveDay = useMemo(() => {
    if (!trip) return null
    return days.find((day) => day.date === getZonedPlainDate(liveNow, resolveDayTimeZone(trip, day))) ?? null
  }, [days, liveNow, trip])
  const liveRouteDay = liveDay
    ? routePreparation?.days.find((routeDay) => routeDay.day.id === liveDay.id) ?? null
    : null
  const overviewItems = useMemo(() => {
    if (allItems.length > 0) {
      return allItems
    }

    return days.flatMap((day) => itemsByDay[day.id] ?? [])
  }, [allItems, days, itemsByDay])
  const tripHomeFocus = useMemo(
    () => buildTripHomeFocus({ days, itemsByDay, liveDay, selectedDay }),
    [days, itemsByDay, liveDay, selectedDay],
  )
  const mappedItemCount = useMemo(
    () => overviewItems.filter(hasUsableCoordinates).length,
    [overviewItems],
  )
  const hasInboxAttention = hasTripHomeInboxAttention(tripOperationsInboxSummary, tripOperationsInboxPreview)
  const showTravelInboxPanel = travelInboxManualOpen || hasInboxAttention
  const sharedTripNeedsAttention = sharedTripMutations.some((mutation) => mutation.status === 'pending' || mutation.status === 'conflict')

  function handleTripOperationsLocalStateChange(nextState: TripOperationsLocalState) {
    if (!trip) return
    updateTripOperationsLocalState(nextState)
  }

  async function handleGenerateDays() {
    if (!trip) {
      return
    }

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
    if (!trip || !routePreparation?.canGenerate) {
      return
    }

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
      setRoutePreparationVersion((version) => version + 1)
    } catch (caught) {
      setRouteGenerationError(caught instanceof Error ? caught.message : '路线预览生成失败。')
    } finally {
      setRouteGenerationLoading(false)
    }
  }

  function openDay(day: Day, view: 'schedule' | 'map' = 'schedule') {
    navigateTo('day', { tripId: day.tripId, dayId: day.id, view })
  }

  function openTravelInboxPanel() {
    setTravelInboxManualOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById('trip-travel-inbox-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function openToolSection(elementId: string) {
    const element = document.getElementById(elementId)
    if (!element) return
    const details = element.closest('details') as HTMLDetailsElement | null
    if (details) details.open = true
    window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function clearPostImportRoutePrompt({ hide }: { hide: boolean }) {
    if (!trip) {
      return
    }
    if (hide) {
      setDismissedImportRoutePromptTripId(trip.id)
      setCompletedImportRoutePromptTripId(null)
    } else {
      setCompletedImportRoutePromptTripId(trip.id)
    }
    if (hasPostImportRoutePrompt) {
      navigateTo('trip', { tripId: trip.id })
    }
  }

  async function handleReadinessChanged(options: { refreshTripData?: boolean } = {}) {
    setReadinessDataVersion((version) => version + 1)
    setRoutePreparationVersion((version) => version + 1)
    if (options.refreshTripData) {
      await refresh()
    }
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
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">
          返回首页
        </Button>
      </div>
    )
  }

  return (
    <>
      {/* Trip title in main content area - matches reference 12_1/code.html */}
      <section className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-headline-lg text-headline-lg text-primary tracking-tight">{trip.title}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-2 flex items-center gap-2">
            <CalendarDays className="size-4" />
            {formatDateRange(trip.startDate, trip.endDate)}
          </p>
        </div>
        <TripMoreMenu tripId={trip.id} />
      </section>

      {days.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar">
          <Card className="space-y-4" variant="grouped">
            <TripCover trip={trip} variant="hero" />
            <EmptyState
              body="先按旅行日期生成每日行程，然后开始添加地点、交通段和票据。"
              icon={<CalendarDays className="size-6" />}
              title="这趟旅行还没有每日行程"
            />
            {actionError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300">
                {actionError}
              </p>
            ) : null}
            <Button
              className="w-full"
              icon={<RotateCw className="size-4" />}
              loading={isGeneratingDays}
              onClick={() => void handleGenerateDays()}
            >
              生成每日行程
            </Button>
          </Card>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar">
          <div className="space-y-section-gap pb-4">
            <section className="space-y-4" data-testid="trip-home-overview">
              <TripCover
                heroStats={{
                  days: days.length,
                  spots: overviewItems.length,
                  tickets: ticketMetas.length,
                }}
                trip={trip}
                variant="hero"
              />
            </section>

            {isTripIntelligenceStateLoaded && readinessModel && tripOperationsModel ? (
              <TripOperationsPanel
                activeInboxPreview={tripOperationsInboxPreview}
                allItems={allItems}
                dailyTipModel={dailyTipModel}
                days={days}
                intelligenceModel={tripIntelligenceModel}
                itemsByDay={itemsByDay}
                model={tripOperationsModel}
                localState={tripOperationsLocalState}
                onChanged={handleTripOperationsChanged}
                onLocalStateChange={handleTripOperationsLocalStateChange}
                onSuggestionStateChange={(suggestion, status) => {
                  void setTripIntelligenceSuggestionState({ status, suggestion })
                }}
                onSuggestionStateRestore={(suggestionKey) => {
                  void restoreTripIntelligenceSuggestionState(suggestionKey)
                }}
                readinessModel={readinessModel}
                tickets={ticketMetas}
                trip={trip}
              />
            ) : null}

            <section className="flex flex-col gap-stack-gap">
              {isTripIntelligenceStateLoaded && liveDay && tripOperationsModel ? (
                <TripLiveModeCard
                  allItems={allItems}
                  compact
                  day={liveDay}
                  days={days}
                  items={itemsByDay[liveDay.id] ?? []}
                  localState={tripOperationsLocalState}
                  now={liveNow}
                  onChanged={async () => { await handleTripOperationsChanged({ refreshTripData: true }) }}
                  onLocalStateChange={handleTripOperationsLocalStateChange}
                  onOpenItem={(item) => navigateTo('item', { dayId: item.dayId, itemId: item.id, tripId: trip.id })}
                  onOpenMap={() => openDay(liveDay, 'map')}
                  onOpenOperation={(recommendation) => navigateToTripOperationsRecommendation(recommendation, trip.id)}
                  onOpenTickets={(item) => navigateTo('tickets', { itemId: item.id, tripId: trip.id })}
                  operationsRecommendations={tripOperationsModel.activeRecommendations}
                  routeDay={liveRouteDay}
                  tickets={ticketMetas}
                  trip={trip}
                />
              ) : null}
            </section>

            <section className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                <TripHomeFocusPanel
                  focus={tripHomeFocus}
                  onAddItem={(targetDay) => navigateTo('item/new', { tripId: trip.id, dayId: targetDay.id })}
                  onOpenDay={(targetDay, targetView) => openDay(targetDay, targetView)}
                  onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: item.dayId, itemId: item.id })}
                />
                <TripHomeQuickActions
                  mappedItemCount={mappedItemCount}
                  onOpenAccountInbox={() => navigateTo('inbox')}
                  onOpenLedger={() => navigateTo('ledger', { tripId: trip.id })}
                  onOpenRoutePreparation={() => openToolSection('route-preparation-panel')}
                  onOpenTickets={() => navigateTo('tickets', { tripId: trip.id })}
                  onOpenTravelInbox={openTravelInboxPanel}
                  routePreparation={routePreparation}
                  routePreparationLoading={routePreparationLoading}
                  ticketCount={ticketMetas.length}
                  totalItemCount={overviewItems.length}
                />
              </div>
            </section>

            <section className="flex flex-col gap-stack-gap" data-testid="trip-home-map-overview">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-headline-md text-headline-md text-on-surface">全程地图</h3>
                  <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
                    {describeTripMapCoverage(overviewItems.length, mappedItemCount)}
                  </p>
                </div>
                {selectedDay ? (
                  <Button
                    className="min-h-11 shrink-0 px-3 text-xs"
                    icon={<MapPinned className="size-3.5" />}
                    onClick={() => openDay(selectedDay, 'map')}
                    variant="secondary"
                  >
                    打开地图
                  </Button>
                ) : null}
              </div>
              <TripMapPreview
                days={days}
                itemsByDay={itemsByDay}
                onItemsReordered={async () => { await refresh() }}
                onOpenItem={(item) => navigateTo('item', { dayId: item.dayId, itemId: item.id, tripId: trip.id })}
                onOpenMap={(targetDay) => openDay(targetDay, 'map')}
                routeDataReady={loadedTripContextKey === tripContextKey}
                selectedDay={selectedDay}
                tripId={trip.id}
              />
            </section>

            <section className="flex flex-col gap-stack-gap">
              <TripDailyTravelTipCard
                days={days}
                itemsByDay={itemsByDay}
                onOpenContentEnrichment={() => document.getElementById('trip-content-enrichment-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                onOpenDay={(targetDay) => openDay(targetDay, 'schedule')}
                onOpenRouteGeneration={() => {
                  if (routePreparation?.canGenerate) {
                    setRouteGenerationConfirmOpen(true)
                  }
                }}
                onSaved={async () => { await refresh() }}
                routePreparation={routePreparation}
                trip={trip}
                tripCheck={tripCheckResult}
              />
            </section>

            <DailyItineraryList
              days={days}
              itemsByDay={itemsByDay}
              onOpenDay={(day) => openDay(day, 'schedule')}
              selectedDayId={selectedDay?.id}
            />

            <FocusDayTimelinePreview
              focus={tripHomeFocus}
              onAddItem={(targetDay) => navigateTo('item/new', { tripId: trip.id, dayId: targetDay.id })}
              onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: item.dayId, itemId: item.id })}
            />

            {showTravelInboxPanel ? (
              <div id="trip-travel-inbox-panel">
                <TravelInboxPanel
                  allItems={allItems}
                  days={days}
                  key={trip.id}
                  onApplied={async () => { await refresh() }}
                  onPreviewChanged={async () => { await handleReadinessChanged({ refreshTripData: false }) }}
                  refreshVersion={travelInboxRefreshVersion}
                  tickets={ticketMetas}
                  trip={trip}
                />
              </div>
            ) : null}

            <div className="flex min-w-0 justify-end">
              <AutoSnapshotBackupStatus tripId={trip.id} visibility="active-only" />
            </div>
            <CloudSnapshotCheckPrompts maxItems={1} tripId={trip.id} variant="trip" />
            {tripBrief ? <TripBriefCard brief={tripBrief} /> : null}
            {dismissedImportRoutePromptTripId !== trip.id && (hasPostImportRoutePrompt || completedImportRoutePromptTripId === trip.id) ? (
              <ImportRouteGenerationPanel
                onDismiss={() => clearPostImportRoutePrompt({ hide: true })}
                onGenerated={() => clearPostImportRoutePrompt({ hide: false })}
                showDismiss
                tripId={trip.id}
              />
            ) : null}
            <Collapsible
              subtitle={sharedTripNeedsAttention ? '同行共享有待处理变更；其他工具保持二级入口。' : '账本、同行共享、出行前检查、AI 工具和路线准备。'}
              title="更多工具与详情"
            >
              <div className="space-y-4" data-testid="trip-home-secondary-tools">
                <div id="trip-tools-ledger-section">
                  <LedgerSummaryCard trip={trip} />
                </div>

                <SharedTripPanel
                  days={days}
                  itemsByDay={itemsByDay}
                  tickets={ticketMetas}
                  trip={trip}
                />

                {readinessModel ? (
                  <div id="trip-readiness-details-section">
                    <TripReadinessCenterPanel
                      allItems={allItems}
                      dailyTipModel={dailyTipModel}
                      days={days}
                      itemsByDay={itemsByDay}
                      key={trip.id}
                      model={readinessModel}
                      onChanged={handleReadinessChanged}
                      trip={trip}
                    />
                  </div>
                ) : null}

                <div id="trip-content-enrichment-panel">
                  <TripContentEnrichmentPanel allItems={allItems} days={days} onApplied={async () => { await refresh() }} trip={trip} />
                </div>
                <SmartTripWorkspacePanel allItems={allItems} days={days} itemsByDay={itemsByDay} onApplied={async () => { await refresh() }} trip={trip} />
                <AiTripEditPanel allItems={allItems} days={days} onApplied={async () => { await refresh() }} trip={trip} />
                <RoutePreparationPanel error={routeGenerationError} loading={routePreparationLoading} onGenerate={() => setRouteGenerationConfirmOpen(true)} preparation={routePreparation} result={routeGenerationResult} submitting={routeGenerationLoading} />
              </div>
            </Collapsible>

            {trip.notes ? (
              <Card className="flex items-start gap-3" variant="grouped">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50/80 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                  <NotebookText className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">旅行备注</h3>
                  <p className="mt-1 text-sm leading-6 tm-muted">{trip.notes}</p>
                </div>
              </Card>
            ) : null}

            <div id="trip-sync-archive-section">
              <Collapsible title="同步与归档">
                <TravelBackupPanel trip={trip} />
              </Collapsible>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        body={buildRouteGenerationConfirmBody(routePreparation)}
        cancelLabel="暂不生成"
        confirmLabel="确认生成"
        icon={<Route className="size-5" />}
        loading={routeGenerationLoading}
        onCancel={() => {
          if (!routeGenerationLoading) {
            setRouteGenerationConfirmOpen(false)
          }
        }}
        onConfirm={() => void handleConfirmGenerateRoutes()}
        open={routeGenerationConfirmOpen}
        testId="route-generation-confirm-dialog"
        title={`生成 ${routePreparation?.targetDayIds.length ?? 0} 天路线预览？`}
      />
    </>
  )
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

type TripHomeFocus = {
  day: Day
  dayIndex: number
  items: ItineraryItem[]
  label: string
  nextItem: ItineraryItem | null
}

function TripHomeFocusPanel({
  focus,
  onAddItem,
  onOpenDay,
  onOpenItem,
}: {
  focus: TripHomeFocus | null
  onAddItem: (day: Day) => void
  onOpenDay: (day: Day, view: 'schedule' | 'map') => void
  onOpenItem: (item: ItineraryItem) => void
}) {
  if (!focus) {
    return (
      <Card className="space-y-3" data-testid="trip-home-focus" variant="grouped">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" />
          <h3 className="font-headline-md text-headline-md text-on-surface">下一步</h3>
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant">生成每日行程后开始安排地点。</p>
      </Card>
    )
  }

  return (
    <Card className="space-y-4" data-testid="trip-home-focus" variant="grouped">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <CalendarDays className="size-4" />
            <span className="font-label-sm text-label-sm">{focus.label}</span>
          </div>
          <h3 className="mt-1 font-headline-md text-headline-md text-on-surface">{focus.day.title || `第 ${focus.dayIndex + 1} 天`}</h3>
          <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
            {formatDate(focus.day.date)} · {focus.items.length} 个行程点
          </p>
        </div>
        <button
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-outline-variant/30 bg-surface-container-high px-3 text-xs font-semibold text-primary transition hover:bg-surface-container-highest active:scale-[0.98]"
          onClick={() => onOpenDay(focus.day, 'schedule')}
          type="button"
        >
          日程
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {focus.nextItem ? (
        <button
          className="flex w-full items-start gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-high p-3 text-left transition hover:bg-surface-container-highest active:scale-[0.99]"
          data-testid="trip-home-next-item"
          onClick={() => onOpenItem(focus.nextItem as ItineraryItem)}
          type="button"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
            <Clock3 className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-on-surface">{focus.nextItem.title}</span>
            <span className="mt-1 block text-sm text-on-surface-variant">
              {describeItemTime(focus.nextItem)}
              {focus.nextItem.locationName ? ` · ${focus.nextItem.locationName}` : ''}
            </span>
          </span>
          <ChevronRight className="mt-2 size-4 shrink-0 text-outline" />
        </button>
      ) : (
        <div className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-high px-3 py-4">
          <p className="text-sm font-medium text-on-surface">这一天还没有行程点。</p>
          <p className="mt-1 text-sm text-on-surface-variant">先添加地点，再补交通、票据和路线预览。</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Button className="min-h-11 px-3 text-sm" icon={<CalendarDays className="size-4" />} onClick={() => onOpenDay(focus.day, 'schedule')} variant="secondary">
          看日程
        </Button>
        <Button className="min-h-11 px-3 text-sm" icon={<MapPinned className="size-4" />} onClick={() => onOpenDay(focus.day, 'map')} variant="secondary">
          看地图
        </Button>
        <Button className="min-h-11 px-3 text-sm" icon={<Plus className="size-4" />} onClick={() => onAddItem(focus.day)} variant="secondary">
          加地点
        </Button>
      </div>
    </Card>
  )
}

function TripHomeQuickActions({
  mappedItemCount,
  onOpenAccountInbox,
  onOpenLedger,
  onOpenRoutePreparation,
  onOpenTickets,
  onOpenTravelInbox,
  routePreparation,
  routePreparationLoading,
  ticketCount,
  totalItemCount,
}: {
  mappedItemCount: number
  onOpenAccountInbox: () => void
  onOpenLedger: () => void
  onOpenRoutePreparation: () => void
  onOpenTickets: () => void
  onOpenTravelInbox: () => void
  routePreparation: TripRoutePreparation | null
  routePreparationLoading: boolean
  ticketCount: number
  totalItemCount: number
}) {
  return (
    <Card className="space-y-3" data-testid="trip-home-quick-actions" variant="grouped">
      <div>
        <h3 className="font-headline-md text-headline-md text-on-surface">旅行工具</h3>
        <p className="mt-1 text-sm text-on-surface-variant">{mappedItemCount}/{totalItemCount} 个行程点有地图坐标</p>
      </div>
      <div className="divide-y divide-outline-variant/30 overflow-hidden rounded-xl border border-outline-variant/30">
        <TripHomeActionRow
          detail="粘贴、上传或整理本次旅行材料"
          icon={<Inbox className="size-4" />}
          label="添加材料"
          onClick={onOpenTravelInbox}
          testId="trip-action-travel-inbox"
        />
        <TripHomeActionRow
          detail="连接器与账号材料"
          icon={<Inbox className="size-4" />}
          label="账号收件箱"
          onClick={onOpenAccountInbox}
          testId="trip-action-account-inbox"
        />
        <TripHomeActionRow
          detail={`${ticketCount} 张票据`}
          icon={<Ticket className="size-4" />}
          label="票据库"
          onClick={onOpenTickets}
          testId="trip-action-ticket-library"
        />
        <TripHomeActionRow
          detail={describeRouteReadiness(routePreparation, routePreparationLoading)}
          icon={<Route className="size-4" />}
          label="路线准备"
          onClick={onOpenRoutePreparation}
          testId="trip-action-route-preparation"
        />
        <TripHomeActionRow
          detail="预算、费用和结算"
          icon={<WalletCards className="size-4" />}
          label="旅行账本"
          onClick={onOpenLedger}
          testId="trip-action-ledger"
        />
      </div>
    </Card>
  )
}

function TripHomeActionRow({
  detail,
  icon,
  label,
  onClick,
  testId,
}: {
  detail: string
  icon: ReactNode
  label: string
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      className="flex min-h-14 w-full items-center gap-3 bg-surface-container px-3 text-left transition hover:bg-surface-container-high active:scale-[0.99]"
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-container/70 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-on-surface">{label}</span>
        <span className="mt-0.5 block truncate text-xs text-on-surface-variant">{detail}</span>
      </span>
      <ChevronRight className="size-4 text-outline" />
    </button>
  )
}

function FocusDayTimelinePreview({
  focus,
  onAddItem,
  onOpenItem,
}: {
  focus: TripHomeFocus | null
  onAddItem: (day: Day) => void
  onOpenItem: (item: ItineraryItem) => void
}) {
  if (!focus) {
    return null
  }

  return (
    <section className="flex flex-col gap-stack-gap" data-testid="trip-home-focus-timeline">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-headline-md text-headline-md text-on-surface">焦点日安排</h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            第 {focus.dayIndex + 1} 天 · {formatDate(focus.day.date)}
          </p>
        </div>
        <Button className="min-h-11 shrink-0 px-3 text-xs" icon={<Plus className="size-3.5" />} onClick={() => onAddItem(focus.day)} variant="secondary">
          添加
        </Button>
      </div>

      {focus.items.length === 0 ? (
        <Card className="space-y-2" variant="grouped">
          <p className="text-sm font-semibold text-on-surface">暂无行程点</p>
          <p className="text-sm leading-6 text-on-surface-variant">添加第一个地点后，这里会按时间线展示当天安排。</p>
        </Card>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container">
          <div className="absolute bottom-5 left-[2.15rem] top-5 w-px bg-outline-variant/40" />
          {focus.items.map((item, index) => {
            const isLast = index === focus.items.length - 1
            return (
              <button
                className="group relative z-10 flex w-full items-stretch gap-3 px-4 py-3 text-left transition hover:bg-surface-container-high active:scale-[0.99]"
                key={item.id}
                onClick={() => onOpenItem(item)}
                type="button"
              >
                <span className="mt-1 flex w-9 shrink-0 justify-center">
                  <span className={`size-3 rounded-full border ring-4 ring-surface-container group-hover:ring-surface-container-high ${
                    index === 0
                      ? 'border-primary bg-primary'
                      : 'border-outline bg-surface-container-highest'
                  }`} />
                </span>
                <span className={`min-w-0 flex-1 ${isLast ? '' : 'border-b border-outline-variant/20 pb-3'}`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-on-surface">{item.title}</span>
                      <span className="mt-1 flex items-center gap-1 text-sm text-on-surface-variant">
                        <Clock3 className="size-3.5 shrink-0" />
                        <span className="truncate">{describeItemTime(item)}</span>
                      </span>
                    </span>
                    {item.ticketIds.length > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-container/70 px-2 py-1 text-xs font-semibold text-primary">
                        <Ticket className="size-3" />
                        {item.ticketIds.length}
                      </span>
                    ) : null}
                  </span>
                  {item.locationName ? (
                    <span className="mt-1 block truncate text-sm text-on-surface-variant">{item.locationName}</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function buildTripHomeFocus({
  days,
  itemsByDay,
  liveDay,
  selectedDay,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  liveDay: Day | null
  selectedDay: Day | null
}): TripHomeFocus | null {
  const day = liveDay ?? selectedDay ?? days[0] ?? null
  if (!day) {
    return null
  }

  const dayIndex = Math.max(0, days.findIndex((candidate) => candidate.id === day.id))
  const items = itemsByDay[day.id] ?? []
  return {
    day,
    dayIndex,
    items,
    label: liveDay?.id === day.id ? '今天' : selectedDay?.id === day.id ? '当前选择' : '首日',
    nextItem: items[0] ?? null,
  }
}

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

function describeTripMapCoverage(itemCount: number, mappedItemCount: number) {
  if (itemCount === 0) {
    return '添加带地点的行程点后，这里会显示全旅行路线概览。'
  }
  if (mappedItemCount === 0) {
    return '还没有可显示的坐标，先在行程点补充地点或地址。'
  }
  if (mappedItemCount === itemCount) {
    return `全部 ${itemCount} 个行程点已可在地图上查看。`
  }
  return `${mappedItemCount}/${itemCount} 个行程点已可在地图上查看。`
}

function describeRouteReadiness(preparation: TripRoutePreparation | null, loading: boolean) {
  if (loading || !preparation) {
    return '正在检查路线缓存'
  }
  if (preparation.eligibleDayCount === 0) {
    return '补充坐标后可生成'
  }
  if (preparation.targetDayIds.length === 0 && preparation.cachedDayCount === preparation.eligibleDayCount) {
    return `${preparation.cachedDayCount} 天已准备`
  }
  if (preparation.cachedDayCount > 0) {
    return `${preparation.cachedDayCount} 天已缓存，${preparation.targetDayIds.length} 天待生成`
  }
  return `${preparation.targetDayIds.length} 天可生成`
}

function DailyItineraryList({
  days,
  itemsByDay,
  onOpenDay,
  selectedDayId,
}: {
  days: Day[]
  itemsByDay: Record<string, { id: string }[]>
  onOpenDay: (day: Day) => void
  selectedDayId?: string | null
}) {
  return (
    <section className="flex flex-col gap-stack-gap">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-headline-md text-headline-md text-on-surface">每日行程</h3>
        <span className="font-label-sm text-label-sm text-on-surface-variant">{days.length} 天</span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1 py-1 app-scrollbar" data-testid="trip-day-selector">
        <div className="flex min-w-max gap-2">
        {days.map((day, index) => {
          const itemCount = itemsByDay[day.id]?.length ?? 0
          const active = day.id === selectedDayId
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={`relative z-10 flex min-h-[8.5rem] w-[10.5rem] shrink-0 flex-col justify-between rounded-2xl border p-3 text-left transition active:scale-[0.98] ${
                active
                  ? 'border-primary/35 bg-primary text-on-primary shadow-[0_8px_18px_var(--color-primary-shadow)]'
                  : 'border-outline-variant/30 bg-surface-container text-on-surface hover:bg-surface-container-high'
              }`}
              data-testid="trip-day-link"
              key={day.id}
              onClick={() => onOpenDay(day)}
              type="button"
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`font-label-sm text-label-sm uppercase tracking-wider ${active ? 'text-on-primary/80' : 'text-primary'}`}>
                  Day {index + 1}
                </span>
                {active ? (
                  <span className="rounded-full bg-on-primary/15 px-2 py-0.5 font-label-sm text-[11px] text-on-primary">
                    当前
                  </span>
                ) : null}
              </span>
              <span className="min-w-0">
                <span className={`line-clamp-2 font-body-lg text-body-lg font-medium ${active ? 'text-on-primary' : 'text-on-surface'}`}>
                  {day.title}
                </span>
                <span className={`mt-2 block font-label-sm text-label-sm ${active ? 'text-on-primary/75' : 'text-on-surface-variant'}`}>
                  {formatDate(day.date)}
                </span>
                <span className={`mt-1 block font-label-sm text-label-sm ${active ? 'text-on-primary/75' : 'text-on-surface-variant'}`}>
                  {itemCount} 个行程点
                </span>
              </span>
            </button>
          )
        })}
        </div>
      </div>
    </section>
  )
}

function RoutePreparationPanel({
  error,
  loading,
  onGenerate,
  preparation,
  result,
  submitting,
}: {
  error: string | null
  loading: boolean
  onGenerate: () => void
  preparation: TripRoutePreparation | null
  result: RouteGenerationBatchResult | null
  submitting: boolean
}) {
  const eligibleCount = preparation?.eligibleDayCount ?? 0
  const targetCount = preparation?.targetDayIds.length ?? 0
  const cachedCount = preparation?.cachedDayCount ?? 0
  const hasUnavailableProvider = Boolean(preparation && !preparation.providerConfigured && eligibleCount > cachedCount)
  const canGenerate = Boolean(preparation?.canGenerate && !submitting)

  return (
    <Card className="space-y-3" data-testid="route-preparation-panel" id="route-preparation-panel" variant="grouped">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Route className="size-4 shrink-0 text-sky-600 dark:text-sky-300 dark:text-sky-300" />
            <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">路线准备</h3>
          </div>
          <p className="mt-1 text-xs leading-5 tm-muted" data-testid="route-preparation-summary">
            {describeRoutePreparation(preparation, loading)}
          </p>
          {cachedCount > 0 ? (
            <p className="mt-0.5 text-[11px] leading-5 tm-muted">已有 {cachedCount} 天路线缓存</p>
          ) : null}
          {hasUnavailableProvider ? (
            <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200" data-testid="route-preparation-provider-warning">
              当前路线服务不可用
            </p>
          ) : null}
        </div>
        <Button
          className="min-h-11 shrink-0 px-3 text-xs"
          disabled={!canGenerate}
          icon={submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Route className="size-3.5" />}
          loading={submitting}
          onClick={onGenerate}
          variant="secondary"
        >
          生成路线预览
        </Button>
      </div>
      {result ? (
        <p className="flex items-start gap-2 rounded-xl bg-sky-50/75 px-3 py-2 text-xs leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" data-testid="route-preparation-result">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{describeRouteGenerationResult(result)}</span>
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="route-preparation-error">
          {error}
        </p>
      ) : null}
      {targetCount > 0 && preparation?.staleDayCount ? (
        <p className="text-[11px] leading-5 tm-muted">有 {preparation.staleDayCount} 天路线可能需要更新。</p>
      ) : null}
    </Card>
  )
}

function describeRoutePreparation(preparation: TripRoutePreparation | null, loading: boolean) {
  if (loading || !preparation) {
    return '正在检查路线缓存…'
  }
  if (preparation.eligibleDayCount === 0) {
    return '补充至少两个有坐标的行程点后，可生成路线预览。'
  }
  if (preparation.targetDayIds.length === 0 && preparation.cachedDayCount === preparation.eligibleDayCount) {
    return '路线预览已准备'
  }
  if (!preparation.providerConfigured) {
    return `可为 ${preparation.eligibleDayCount - preparation.cachedDayCount} 天生成路线预览`
  }
  return `可为 ${preparation.targetDayIds.length} 天生成路线预览`
}

function describeRouteGenerationResult(result: RouteGenerationBatchResult) {
  const parts = [`已生成 ${result.generatedCount} 天路线预览`]
  if (result.failedCount > 0) {
    parts.push(`${result.failedCount} 天失败`)
  }
  if (!result.previewCacheSaved && result.generatedCount > 0) {
    parts.push('地图预览缓存未更新')
  }
  return `${parts.join('，')}。`
}

function buildRouteGenerationConfirmBody(preparation: TripRoutePreparation | null) {
  const count = preparation?.targetDayIds.length ?? 0
  return `将调用路线服务生成路线预览，可能消耗 API 次数。只为有足够坐标的日期生成（共 ${count} 天），不会自动调整行程顺序，不会生成公交/地铁线路号。`
}
