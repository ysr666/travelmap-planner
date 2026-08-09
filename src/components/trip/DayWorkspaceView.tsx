import { AlertTriangle, CalendarDays, List, Map as MapIcon, MapPin, MoreHorizontal, Route, ShieldCheck, Ticket } from 'lucide-react'
import { lazy, Suspense, useMemo } from 'react'
import { DayBriefCard } from '../ai/DayBriefCard'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Collapsible } from '../ui/Collapsible'
import { SkeletonLine } from '../ui/SkeletonLine'
import { loadDayMapView } from '../../lib/dayWorkspaceMapLoader'
import { useTravelObjectPresentation } from '../../hooks/useTravelObjectPresentation'
import { navigateTo } from '../../lib/routes'
import { formatShortDate } from '../../lib/dates'
import type { DayWorkspaceViewModel } from '../../lib/dayWorkspaceViewModel'
import { navigateToTripOperationsRecommendation } from '../../lib/tripOperationsNavigation'
import type { TripOperationsLocalState } from '../../lib/tripOperationsState'
import type { TripIntelligenceSuggestion } from '../../lib/tripIntelligence'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../../types'
import { DayMoreMenu } from './DayMoreMenu'
import { DaySelector } from './DaySelector'
import { DayTimelineView } from './DayTimelineView'
import { RestoreTripIntelligenceSuggestionButton, TripIntelligenceSuggestionControls } from './TripIntelligenceSuggestionControls'
import { TripLiveModeCard } from './TripLiveModeCard'

export type DayWorkspaceView = 'schedule' | 'map'

type DayWorkspaceProps = {
  allItems: ItineraryItem[]
  days: Day[]
  hasOpenedMap: boolean
  isMoreMenuOpen: boolean
  isTripIntelligenceStateLoaded: boolean
  items: ItineraryItem[]
  itemsByDay: Record<string, ItineraryItem[]>
  liveNow: Date
  mapResizeToken: number
  model: DayWorkspaceViewModel
  onCloseMoreMenu: () => void
  onDayUpdated: () => void
  onLiveModeChanged: () => Promise<void>
  onLocalStateChange: (state: TripOperationsLocalState) => void
  onOpenMoreMenu: () => void
  onRefreshItems: () => Promise<void>
  onRestoreSuggestion: (suggestion: TripIntelligenceSuggestion) => void
  onSetSuggestionState: (suggestion: TripIntelligenceSuggestion, status: 'ignored' | 'later') => void
  onSwitchView: (view: DayWorkspaceView) => void
  selectedDay: Day
  tickets: TicketMeta[]
  trip: Trip
  tripOperationsLocalState: TripOperationsLocalState
  view: DayWorkspaceView
}

const LazyDayMapView = lazy(loadDayMapView)

export function DayWorkspace({
  allItems,
  days,
  hasOpenedMap,
  isMoreMenuOpen,
  isTripIntelligenceStateLoaded,
  items,
  itemsByDay,
  liveNow,
  mapResizeToken,
  model,
  onCloseMoreMenu,
  onDayUpdated,
  onLiveModeChanged,
  onLocalStateChange,
  onOpenMoreMenu,
  onRefreshItems,
  onRestoreSuggestion,
  onSetSuggestionState,
  onSwitchView,
  selectedDay,
  tickets,
  trip,
  tripOperationsLocalState,
  view,
}: DayWorkspaceProps) {
  const isMapView = view === 'map'
  const presentationItems = allItems.length > 0 ? allItems : items
  const mediaItemIds = useMemo(() => items.slice(0, 4).map((item) => item.id), [items])
  const { collection: travelObjects } = useTravelObjectPresentation({
    days,
    items: presentationItems,
    mediaItemIds,
    now: liveNow,
    tickets,
    trip,
  })

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <DayMoreMenu
        day={selectedDay}
        key={`${selectedDay.id}:${selectedDay.timeZone ?? ''}`}
        onDayUpdated={onDayUpdated}
        onClose={onCloseMoreMenu}
        open={isMoreMenuOpen}
        trip={trip}
        tripId={trip.id}
      />

      {isMapView ? (
        <div className="relative h-full min-h-0 w-full overflow-hidden bg-map-bg">
          {hasOpenedMap ? (
            <Suspense fallback={<MapLoadingFallback day={selectedDay} items={items} />}>
              <LazyDayMapView
                allDays={days}
                day={selectedDay}
                dayItemsByDayId={itemsByDay}
                embedded
                isVisible
                items={items}
                onBackToSchedule={() => onSwitchView('schedule')}
                onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id, view: 'map' })}
                onOpenTickets={(item) => navigateTo('tickets', {
                  itemId: item.id,
                  ...(item.ticketIds.length === 1 ? { ticketId: item.ticketIds[0] } : {}),
                  tripId: trip.id,
                })}
                prewarmEnabled={false}
                resizeSignal={mapResizeToken}
                showDefaultMarkerCard={false}
                showFloatingHeader={false}
                trip={trip}
              />
            </Suspense>
          ) : (
            <MapLoadingFallback day={selectedDay} items={items} />
          )}
          <ViewSwitch activeView={view} floating onSwitch={onSwitchView} />
          <button
            aria-expanded={isMoreMenuOpen}
            aria-label="更多操作"
            className="absolute right-4 top-3 z-30 flex size-11 items-center justify-center rounded-lg border border-outline-variant bg-surface/94 text-on-surface shadow-sm backdrop-blur tm-focus"
            onClick={onOpenMoreMenu}
            type="button"
          >
            <MoreHorizontal className="size-5" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 top-16 z-30 px-4 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
            <DaySelector
              days={days}
              density="compact"
              getDayHref={(day) => buildDayHref(trip.id, day.id, view)}
              onSelectDay={(day) => navigateTo('day', { tripId: trip.id, dayId: day.id, view })}
              selectedDayId={selectedDay.id}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 app-scrollbar">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <section className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-on-surface">{selectedDay.title}</h2>
                <p className="mt-0.5 text-xs text-on-surface-variant">第 {model.dayIndex} 天 · {model.dayDateLabel}</p>
              </div>
              <button
                aria-expanded={isMoreMenuOpen}
                aria-label="更多操作"
                className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-outline-variant bg-surface text-on-surface tm-focus"
                onClick={onOpenMoreMenu}
                type="button"
              >
                <MoreHorizontal className="size-5" />
              </button>
            </section>

            <DaySelector
              density="compact"
              days={days}
              getDayHref={(day) => buildDayHref(trip.id, day.id, view)}
              onSelectDay={(day) => navigateTo('day', { tripId: trip.id, dayId: day.id, view })}
              selectedDayId={selectedDay.id}
            />

            <DayTimelineView
              compact
              day={selectedDay}
              items={items}
              onItemsChange={onRefreshItems}
              onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id, view: 'schedule' })}
              onSwitchToMap={() => onSwitchView('map')}
              sourceView="schedule"
              travelObjects={travelObjects}
              trip={trip}
            />

            <Collapsible
              subtitle={model.dayIntelligenceSuggestions.length > 0
                ? `${model.dayIntelligenceSuggestions.length} 项待处理`
                : undefined}
              testId="day-support-tools"
              title="提醒与工具"
            >
              <div className="space-y-stack-gap">
                {isTripIntelligenceStateLoaded ? (
                  <DayContextIntelligenceCard
                    dayId={selectedDay.id}
                    hiddenSuggestions={model.hiddenDayIntelligenceSuggestions}
                    itemById={model.dayContextItemById}
                    onIgnore={(suggestion) => onSetSuggestionState(suggestion, 'ignored')}
                    onLater={(suggestion) => onSetSuggestionState(suggestion, 'later')}
                    onRestore={onRestoreSuggestion}
                    suggestions={model.dayIntelligenceSuggestions}
                    tripId={trip.id}
                  />
                ) : null}

                {isTripIntelligenceStateLoaded ? (
                  <TripLiveModeCard
                    allItems={allItems.length > 0 ? allItems : items}
                    compact
                    day={selectedDay}
                    days={days}
                    items={items}
                    localState={tripOperationsLocalState}
                    now={liveNow}
                    onChanged={onLiveModeChanged}
                    onLocalStateChange={onLocalStateChange}
                    onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id, view: 'schedule' })}
                    onOpenMap={() => onSwitchView('map')}
                    onOpenOperation={(recommendation) => navigateToTripOperationsRecommendation(recommendation, trip.id)}
                    onOpenTickets={(item) => navigateTo('tickets', { itemId: item.id, tripId: trip.id })}
                    operationsRecommendations={model.tripOperationsModel.activeRecommendations}
                    routeDay={model.selectedRouteDay}
                    tickets={tickets}
                    trip={trip}
                  />
                ) : null}

                {model.dayBrief ? <DayBriefCard brief={model.dayBrief} /> : null}
              </div>
            </Collapsible>
          </div>
        </div>
      )}
    </div>
  )
}

function DayContextIntelligenceCard({
  dayId,
  hiddenSuggestions,
  itemById,
  onIgnore,
  onLater,
  onRestore,
  suggestions,
  tripId,
}: {
  dayId: string
  hiddenSuggestions: TripIntelligenceSuggestion[]
  itemById: Map<string, ItineraryItem>
  onIgnore: (suggestion: TripIntelligenceSuggestion) => void
  onLater: (suggestion: TripIntelligenceSuggestion) => void
  onRestore: (suggestion: TripIntelligenceSuggestion) => void
  suggestions: TripIntelligenceSuggestion[]
  tripId: string
}) {
  if (suggestions.length === 0 && hiddenSuggestions.length === 0) return null

  return (
    <Card className="space-y-2" data-testid="day-intelligence-card" variant="grouped">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">今天要处理</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-on-primary-fixed dark:text-primary-fixed-dim">{suggestions.length} 项</span>
      </div>
      {suggestions[0] ? <p className="line-clamp-1 text-xs leading-5 tm-muted">{suggestions[0].title}</p> : null}
      <details className="rounded-lg bg-surface-container-high/55 px-3 py-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-on-surface marker:hidden">
          <span>查看处理项</span>
          <span className="tm-muted">{suggestions.length + hiddenSuggestions.length} 项</span>
        </summary>
        <div className="mt-2 divide-y divide-outline-variant/20">
          {suggestions.map((suggestion) => (
            <div className="flex min-h-16 items-start gap-3 px-0 py-3" data-testid="day-intelligence-suggestion" key={suggestion.id}>
              <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${getDaySuggestionIconTone(suggestion)}`}>
                {getDaySuggestionIcon(suggestion)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{suggestion.title}</p>
                <p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{suggestion.message}</p>
              </div>
              <Button className="shrink-0 px-3 text-xs" onClick={() => openDaySuggestion(suggestion, { dayId, itemById, tripId })} variant="secondary">
                {suggestion.action?.label ?? '查看'}
              </Button>
              <TripIntelligenceSuggestionControls onIgnore={onIgnore} onLater={onLater} suggestion={suggestion} />
            </div>
          ))}
          {hiddenSuggestions.length > 0 ? (
            <details className="py-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold tm-muted">已隐藏建议（{hiddenSuggestions.length}）</summary>
              <div className="mt-2 space-y-1">
                {hiddenSuggestions.map((suggestion) => (
                  <div className="flex min-h-11 items-center justify-between gap-2" key={suggestion.key}>
                    <span className="min-w-0 truncate text-xs tm-muted">{suggestion.title}</span>
                    <RestoreTripIntelligenceSuggestionButton onRestore={onRestore} suggestion={suggestion} />
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </details>
    </Card>
  )
}

function getDaySuggestionIcon(suggestion: TripIntelligenceSuggestion) {
  if (suggestion.scope === 'ticket') return <Ticket className="size-4" />
  if (suggestion.scope === 'live') return <AlertTriangle className="size-4" />
  if (suggestion.requiresConfirmation || suggestion.requiresPreview) return <ShieldCheck className="size-4" />
  if (suggestion.scope === 'item') return <MapPin className="size-4" />
  return <Route className="size-4" />
}

function getDaySuggestionIconTone(suggestion: TripIntelligenceSuggestion) {
  if (suggestion.severity === 'high') return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200'
  if (suggestion.severity === 'medium') return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
  return 'bg-primary/10 text-on-primary-fixed dark:text-primary-fixed-dim'
}

function openDaySuggestion(
  suggestion: TripIntelligenceSuggestion,
  context: { dayId: string; itemById: Map<string, ItineraryItem>; tripId: string },
) {
  const sourceActionKind = suggestion.action?.sourceActionKind
  if (
    suggestion.scope === 'live'
    || sourceActionKind === 'open_adaptive_replan'
    || sourceActionKind === 'replan_apply_option'
    || sourceActionKind === 'replan_undo'
  ) {
    if (scrollToDayElement('trip-live-mode-card')) return
  }

  if (suggestion.scope === 'ticket' || suggestion.action?.targetRoute === 'tickets' || sourceActionKind === 'open_tickets') {
    navigateTo('tickets', { tripId: context.tripId })
    return
  }

  if (sourceActionKind === 'generate_routes' || sourceActionKind === 'open_route_panel' || sourceActionKind === 'open_readiness') {
    navigateTo('trip', { tripId: context.tripId })
    return
  }

  const itemId = suggestion.affectedItemIds[0]
  if (itemId) {
    const item = context.itemById.get(itemId)
    navigateTo('item', {
      dayId: item?.dayId ?? context.dayId,
      itemId,
      tripId: context.tripId,
      view: 'schedule',
    })
    return
  }

  if (suggestion.affectedDayIds[0]) {
    navigateTo('day', {
      dayId: suggestion.affectedDayIds[0],
      tripId: context.tripId,
      view: 'schedule',
    })
    return
  }

  navigateTo('trip', { tripId: context.tripId })
}

function scrollToDayElement(id: string) {
  const element = document.getElementById(id)
  if (!element) return false
  element.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  return true
}

function buildDayHref(tripId: string, dayId: string, view: DayWorkspaceView) {
  return `#/day?${new URLSearchParams({ tripId, dayId, view }).toString()}`
}

function ViewSwitch({
  activeView,
  floating = false,
  onSwitch,
}: {
  activeView: DayWorkspaceView
  floating?: boolean
  onSwitch: (view: DayWorkspaceView) => void
}) {
  if (floating) {
    return (
      <button
        aria-label="切换到列表"
        className="absolute right-[4.25rem] top-3 z-30 flex size-11 items-center justify-center rounded-lg border border-outline-variant bg-surface/94 text-on-surface shadow-sm backdrop-blur-xl transition active:scale-[0.98] tm-focus"
        data-testid="view-switch-schedule"
        onClick={() => onSwitch('schedule')}
        title="切换到列表"
        type="button"
      >
        <List className="size-5" />
      </button>
    )
  }

  return (
    <div className="relative rounded-lg border border-outline-variant bg-surface/94 p-1 backdrop-blur-xl">
      <div className="grid grid-cols-2 gap-1">
        <button
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition active:scale-[0.98] tm-focus ${activeView === 'map' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant'}`}
          data-testid="view-switch-map"
          onClick={() => onSwitch('map')}
          type="button"
        >
          <MapIcon className="size-4" />
          地图
        </button>
        <button
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition active:scale-[0.98] tm-focus ${activeView === 'schedule' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant'}`}
          data-testid="view-switch-schedule"
          onClick={() => onSwitch('schedule')}
          type="button"
        >
          <Route className="size-4" />
          列表
        </button>
      </div>
    </div>
  )
}

function MapLoadingFallback({ day, items }: { day: Day; items: ItineraryItem[] }) {
  const previewItem = items[0] ?? null

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-map-bg p-4" data-testid="map-loading-fallback">
      <div className="absolute left-4 right-4 top-20 rounded-2xl tm-surface p-4">
        <SkeletonLine className="w-1/2" />
        <p className="mt-3 text-sm font-medium text-on-surface-variant dark:text-outline-variant">正在加载地图</p>
      </div>
      {previewItem ? (
        <div className="absolute bottom-[calc(56px+env(safe-area-inset-bottom,20px)+16px)] left-4 right-4 z-30 rounded-2xl border border-outline-variant/30 bg-surface-container-high/95 p-4 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <CalendarDays className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-primary">{formatShortDate(day.date)} · {items.length} 个行程点</p>
              <h2 className="mt-0.5 truncate text-base font-semibold text-on-surface dark:text-on-surface">{previewItem.title}</h2>
              <p className="mt-0.5 truncate text-xs tm-muted">{previewItem.locationName || previewItem.address || day.title}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
