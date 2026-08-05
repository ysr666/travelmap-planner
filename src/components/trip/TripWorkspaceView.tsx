import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Inbox,
  Loader2,
  NotebookText,
  Pencil,
  RotateCw,
  Route,
  Ticket,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { AiTripEditPanel } from '../ai/AiTripEditPanel'
import { SmartTripWorkspacePanel } from '../ai/SmartTripWorkspacePanel'
import { TravelInboxPanel } from '../ai/TravelInboxPanel'
import { TripBriefCard } from '../ai/TripBriefCard'
import { TripContentEnrichmentPanel } from '../ai/TripContentEnrichmentPanel'
import { TripNav } from '../AppShell'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Collapsible } from '../ui/Collapsible'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import type { RouteGenerationBatchResult } from '../../lib/routeGeneration'
import type { TripRoutePreparation } from '../../lib/routePreparation'
import { navigateTo } from '../../lib/routes'
import type { TripIntelligenceSuggestion } from '../../lib/tripIntelligence'
import { navigateToTripOperationsRecommendation } from '../../lib/tripOperationsNavigation'
import type { TripOperationsLocalState } from '../../lib/tripOperationsState'
import type { TripWorkspaceViewModel } from '../../hooks/useTripWorkspaceViewModel'
import type { Day, ItineraryItem, TicketMeta, TravelInboxPreviewRecord, Trip } from '../../types'
import { ImportRouteGenerationPanel } from './ImportRouteGenerationPanel'
import { LedgerSummaryCard } from './LedgerSummaryCard'
import { TravelBackupPanel } from './TravelBackupPanel'
import { TripDailyTravelTipCard } from './TripDailyTravelTipCard'
import { TripLiveModeCard } from './TripLiveModeCard'
import { TripMoreMenu } from './TripMoreMenu'
import { TripOperationsPanel } from './TripOperationsPanel'
import { TripReadinessCenterPanel } from './TripReadinessCenterPanel'
import { TripScheduleOverview } from './TripScheduleOverview'

type TripWorkspaceViewProps = {
  actionError: string | null
  allItems: ItineraryItem[]
  completedImportRoutePromptTripId: string | null
  days: Day[]
  dismissedImportRoutePromptTripId: string | null
  hasPostImportRoutePrompt: boolean
  isGeneratingDays: boolean
  isTripIntelligenceStateLoaded: boolean
  itemsByDay: Record<string, ItineraryItem[]>
  liveNow: Date
  model: TripWorkspaceViewModel
  onClearPostImportRoutePrompt: (options: { hide: boolean }) => void
  onConfirmGenerateRoutes: () => Promise<void>
  onGenerateDays: () => Promise<void>
  onReadinessChanged: (options?: { refreshTripData?: boolean }) => Promise<void>
  onRefresh: () => Promise<unknown>
  onRouteGenerationConfirmOpenChange: (open: boolean) => void
  onSelectDay: (day: Day) => void
  onSuggestionStateChange: (suggestion: TripIntelligenceSuggestion, status: 'ignored' | 'later') => void
  onSuggestionStateRestore: (suggestionKey: string) => void
  onTravelInboxOpen: () => void
  onTripOperationsChanged: (options?: { refreshTripData?: boolean }) => Promise<void>
  onTripOperationsLocalStateChange: (state: TripOperationsLocalState) => void
  routeGenerationConfirmOpen: boolean
  routeGenerationError: string | null
  routeGenerationLoading: boolean
  routeGenerationResult: RouteGenerationBatchResult | null
  routePreparation: TripRoutePreparation | null
  routePreparationLoading: boolean
  showTravelInboxPanel: boolean
  ticketMetas: TicketMeta[]
  travelInboxRefreshVersion: number
  trip: Trip
  tripOperationsInboxPreview: TravelInboxPreviewRecord | null
  tripOperationsLocalState: TripOperationsLocalState
}

export function TripWorkspaceView({
  actionError,
  allItems,
  completedImportRoutePromptTripId,
  days,
  dismissedImportRoutePromptTripId,
  hasPostImportRoutePrompt,
  isGeneratingDays,
  isTripIntelligenceStateLoaded,
  itemsByDay,
  liveNow,
  model,
  onClearPostImportRoutePrompt,
  onConfirmGenerateRoutes,
  onGenerateDays,
  onReadinessChanged,
  onRefresh,
  onRouteGenerationConfirmOpenChange,
  onSelectDay,
  onSuggestionStateChange,
  onSuggestionStateRestore,
  onTravelInboxOpen,
  onTripOperationsChanged,
  onTripOperationsLocalStateChange,
  routeGenerationConfirmOpen,
  routeGenerationError,
  routeGenerationLoading,
  routeGenerationResult,
  routePreparation,
  routePreparationLoading,
  showTravelInboxPanel,
  ticketMetas,
  travelInboxRefreshVersion,
  trip,
  tripOperationsInboxPreview,
  tripOperationsLocalState,
}: TripWorkspaceViewProps) {
  function openDay(day: Day, view: 'schedule' | 'map' = 'schedule') {
    navigateTo('day', { tripId: day.tripId, dayId: day.id, view })
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

  return (
    <>
      <div className="trip-workspace-v3">
        <TripNav
          activeRoute="trip"
          activeView="schedule"
          className="trip-workspace-tabs"
          firstDayId={days[0]?.id}
          tripId={trip.id}
        />

        {days.length === 0 ? (
          <section className="trip-workspace-empty">
            <EmptyState
              body="按旅行日期生成每日行程后，即可添加地点。"
              icon={<CalendarDays className="size-6" />}
              title="还没有每日行程"
            />
            {actionError ? (
              <p className="rounded-lg bg-error-container px-3 py-2 text-sm font-medium text-on-error-container">{actionError}</p>
            ) : null}
            <Button className="w-full" icon={<RotateCw className="size-4" />} loading={isGeneratingDays} onClick={() => void onGenerateDays()}>
              生成每日行程
            </Button>
          </section>
        ) : (
          <div className="trip-workspace-layout">
            <TripScheduleOverview
              actions={<TripMoreMenu tripId={trip.id} />}
              days={days}
              focus={model.tripHomeFocus}
              itemsByDay={itemsByDay}
              onAddItem={(targetDay) => navigateTo('item/new', { tripId: trip.id, dayId: targetDay.id })}
              onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: item.dayId, itemId: item.id })}
              onSelectDay={onSelectDay}
              selectedDayId={model.tripHomeFocus?.day.id}
            />

            <aside className="trip-workspace-secondary" aria-label="旅行管理">
              <Collapsible
                className="trip-workspace-disclosure"
                defaultOpen={showTravelInboxPanel}
                subtitle={model.hasInboxAttention ? '有材料待处理' : model.sharedTripNeedsAttention ? '有同行变更待处理' : undefined}
                title="旅行工具"
              >
                <div className="space-y-4" data-testid="trip-tools">
                  <TripHomeQuickActions
                    mappedItemCount={model.mappedItemCount}
                    onOpenLedger={() => navigateTo('ledger', { tripId: trip.id })}
                    onOpenRoutePreparation={() => openToolSection('route-preparation-panel')}
                    onOpenTickets={() => navigateTo('tickets', { tripId: trip.id })}
                    onOpenTravelInbox={onTravelInboxOpen}
                    routePreparation={routePreparation}
                    routePreparationLoading={routePreparationLoading}
                    ticketCount={ticketMetas.length}
                    totalItemCount={model.overviewItems.length}
                  />

                  {model.readinessModel ? (
                    <div id="trip-readiness-details-section">
                      <TripReadinessCenterPanel
                        allItems={allItems}
                        dailyTipModel={model.dailyTipModel}
                        days={days}
                        itemsByDay={itemsByDay}
                        key={trip.id}
                        model={model.readinessModel}
                        onChanged={onReadinessChanged}
                        trip={trip}
                      />
                    </div>
                  ) : null}

                  {showTravelInboxPanel ? (
                    <div id="trip-travel-inbox-panel">
                      <TravelInboxPanel
                        allItems={allItems}
                        days={days}
                        key={trip.id}
                        onApplied={async () => { await onRefresh() }}
                        onPreviewChanged={async () => { await onReadinessChanged({ refreshTripData: false }) }}
                        refreshVersion={travelInboxRefreshVersion}
                        tickets={ticketMetas}
                        trip={trip}
                      />
                    </div>
                  ) : null}

                  <details className="group rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2">
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-on-surface marker:hidden [&::-webkit-details-marker]:hidden">
                      <span>更多工具</span>
                      <ChevronRight className="size-4 text-on-surface-variant transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="space-y-4 border-t border-outline-variant/25 pt-4">
                      <TripDailyTravelTipCard
                        days={days}
                        itemsByDay={itemsByDay}
                        onOpenContentEnrichment={() => document.getElementById('trip-content-enrichment-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        onOpenDay={(targetDay) => openDay(targetDay, 'schedule')}
                        onOpenRouteGeneration={() => {
                          if (routePreparation?.canGenerate) onRouteGenerationConfirmOpenChange(true)
                        }}
                        onSaved={async () => { await onRefresh() }}
                        routePreparation={routePreparation}
                        trip={trip}
                        tripCheck={model.tripCheckResult}
                      />

                      {dismissedImportRoutePromptTripId !== trip.id && (hasPostImportRoutePrompt || completedImportRoutePromptTripId === trip.id) ? (
                        <ImportRouteGenerationPanel
                          onDismiss={() => onClearPostImportRoutePrompt({ hide: true })}
                          onGenerated={() => onClearPostImportRoutePrompt({ hide: false })}
                          showDismiss
                          tripId={trip.id}
                        />
                      ) : null}

                      {isTripIntelligenceStateLoaded && model.liveDay && model.tripOperationsModel ? (
                        <TripLiveModeCard
                          allItems={allItems}
                          compact
                          day={model.liveDay}
                          days={days}
                          items={itemsByDay[model.liveDay.id] ?? []}
                          localState={tripOperationsLocalState}
                          now={liveNow}
                          onChanged={async () => { await onTripOperationsChanged({ refreshTripData: true }) }}
                          onLocalStateChange={onTripOperationsLocalStateChange}
                          onOpenItem={(item) => navigateTo('item', { dayId: item.dayId, itemId: item.id, tripId: trip.id })}
                          onOpenMap={() => openDay(model.liveDay!, 'map')}
                          onOpenOperation={(recommendation) => navigateToTripOperationsRecommendation(recommendation, trip.id)}
                          onOpenTickets={(item) => navigateTo('tickets', { itemId: item.id, tripId: trip.id })}
                          operationsRecommendations={model.tripOperationsModel.activeRecommendations}
                          routeDay={model.liveRouteDay}
                          tickets={ticketMetas}
                          trip={trip}
                        />
                      ) : null}

                      {isTripIntelligenceStateLoaded && model.readinessModel && model.tripOperationsModel ? (
                        <TripOperationsPanel
                          activeInboxPreview={tripOperationsInboxPreview}
                          allItems={allItems}
                          dailyTipModel={model.dailyTipModel}
                          days={days}
                          intelligenceModel={model.tripIntelligenceModel}
                          itemsByDay={itemsByDay}
                          model={model.tripOperationsModel}
                          localState={tripOperationsLocalState}
                          onChanged={onTripOperationsChanged}
                          onLocalStateChange={onTripOperationsLocalStateChange}
                          onSuggestionStateChange={onSuggestionStateChange}
                          onSuggestionStateRestore={onSuggestionStateRestore}
                          readinessModel={model.readinessModel}
                          tickets={ticketMetas}
                          trip={trip}
                        />
                      ) : null}

                      <div id="trip-tools-ledger-section">
                        <LedgerSummaryCard trip={trip} />
                      </div>

                      <div id="trip-content-enrichment-panel">
                        <TripContentEnrichmentPanel allItems={allItems} days={days} onApplied={async () => { await onRefresh() }} trip={trip} />
                      </div>
                      <SmartTripWorkspacePanel allItems={allItems} days={days} itemsByDay={itemsByDay} onApplied={async () => { await onRefresh() }} trip={trip} />
                      <AiTripEditPanel allItems={allItems} days={days} onApplied={async () => { await onRefresh() }} trip={trip} />
                      <RoutePreparationPanel
                        error={routeGenerationError}
                        loading={routePreparationLoading}
                        onGenerate={() => onRouteGenerationConfirmOpenChange(true)}
                        preparation={routePreparation}
                        result={routeGenerationResult}
                        submitting={routeGenerationLoading}
                      />
                    </div>
                  </details>
                </div>
              </Collapsible>

              <Collapsible className="trip-workspace-disclosure" title="旅行详情">
                <div className="space-y-4">
                  {trip.notes ? (
                    <div className="flex items-start gap-3">
                      <NotebookText className="mt-0.5 size-4 shrink-0 text-on-surface-variant" />
                      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6 text-on-surface">{trip.notes}</p>
                    </div>
                  ) : null}
                  <div className="divide-y divide-outline-variant/35 border-y border-outline-variant/35">
                    <TripHomeActionRow detail="标题、日期和目的地" icon={<Pencil className="size-4" />} label="编辑旅行" onClick={() => navigateTo('trip/edit', { tripId: trip.id })} />
                    <TripHomeActionRow detail="成员和协作" icon={<UsersRound className="size-4" />} label="同行共享" onClick={() => navigateTo('shared-trip', { tripId: trip.id })} />
                    <TripHomeActionRow detail="登录与同步" icon={<Cloud className="size-4" />} label="账户与同步" onClick={() => navigateTo('settings/account', { tripId: trip.id })} />
                  </div>
                  <details className="group rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2">
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-on-surface marker:hidden [&::-webkit-details-marker]:hidden">
                      <span>导出与诊断</span>
                      <ChevronRight className="size-4 text-on-surface-variant transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="space-y-4 border-t border-outline-variant/25 pt-4">
                      <TravelBackupPanel showCloudBackup={false} trip={trip} />
                      {model.tripBrief ? <TripBriefCard brief={model.tripBrief} /> : null}
                    </div>
                  </details>
                </div>
              </Collapsible>
            </aside>
          </div>
        )}
      </div>

      <ConfirmDialog
        body={buildRouteGenerationConfirmBody(routePreparation)}
        cancelLabel="暂不生成"
        confirmLabel="确认生成"
        icon={<Route className="size-5" />}
        loading={routeGenerationLoading}
        onCancel={() => {
          if (!routeGenerationLoading) onRouteGenerationConfirmOpenChange(false)
        }}
        onConfirm={() => void onConfirmGenerateRoutes()}
        open={routeGenerationConfirmOpen}
        testId="route-generation-confirm-dialog"
        tone="default"
        title={`生成 ${routePreparation?.targetDayIds.length ?? 0} 天路线预览？`}
      />
    </>
  )
}

function TripHomeQuickActions({
  mappedItemCount,
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
    <section className="space-y-2" data-testid="trip-home-quick-actions">
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="text-sm font-semibold text-on-surface">常用操作</h3>
        <p className="text-xs text-on-surface-variant">已定位 {mappedItemCount}/{totalItemCount}</p>
      </div>
      <div className="divide-y divide-outline-variant/45 border-y border-outline-variant/45">
        <TripHomeActionRow detail="粘贴、上传、整理" icon={<Inbox className="size-4" />} label="添加材料" onClick={onOpenTravelInbox} testId="trip-action-travel-inbox" />
        <TripHomeActionRow detail={`${ticketCount} 张票据`} icon={<Ticket className="size-4" />} label="票据库" onClick={onOpenTickets} testId="trip-action-ticket-library" />
        <TripHomeActionRow detail={describeRouteReadiness(routePreparation, routePreparationLoading)} icon={<Route className="size-4" />} label="路线准备" onClick={onOpenRoutePreparation} testId="trip-action-route-preparation" />
        <TripHomeActionRow detail="费用和结算" icon={<WalletCards className="size-4" />} label="旅行账本" onClick={onOpenLedger} testId="trip-action-ledger" />
      </div>
    </section>
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
      className="flex min-h-14 w-full items-center gap-3 px-1 text-left transition hover:bg-surface-container-low active:scale-[0.99] tm-focus"
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-low text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-on-surface">{label}</span>
        <span className="mt-0.5 block truncate text-xs text-on-surface-variant">{detail}</span>
      </span>
      <ChevronRight className="size-4 text-outline" />
    </button>
  )
}

function describeRouteReadiness(preparation: TripRoutePreparation | null, loading: boolean) {
  if (loading || !preparation) return '正在检查路线缓存'
  if (preparation.eligibleDayCount === 0) return '补充坐标后可生成'
  if (preparation.targetDayIds.length === 0 && preparation.cachedDayCount === preparation.eligibleDayCount) {
    return `${preparation.cachedDayCount} 天已准备`
  }
  if (preparation.cachedDayCount > 0) {
    return `${preparation.cachedDayCount} 天已缓存，${preparation.targetDayIds.length} 天待生成`
  }
  return `${preparation.targetDayIds.length} 天可生成`
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
          <p className="mt-1 text-xs leading-5 tm-muted" data-testid="route-preparation-summary">{describeRoutePreparation(preparation, loading)}</p>
          {cachedCount > 0 ? <p className="mt-0.5 text-[11px] leading-5 tm-muted">已有 {cachedCount} 天路线缓存</p> : null}
          {hasUnavailableProvider ? (
            <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200" data-testid="route-preparation-provider-warning">当前路线服务不可用</p>
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
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="route-preparation-error">{error}</p> : null}
      {targetCount > 0 && preparation?.staleDayCount ? <p className="text-[11px] leading-5 tm-muted">有 {preparation.staleDayCount} 天路线可能需要更新。</p> : null}
    </Card>
  )
}

function describeRoutePreparation(preparation: TripRoutePreparation | null, loading: boolean) {
  if (loading || !preparation) return '正在检查路线缓存…'
  if (preparation.eligibleDayCount === 0) return '补充至少两个有坐标的行程点后，可生成路线预览。'
  if (preparation.targetDayIds.length === 0 && preparation.cachedDayCount === preparation.eligibleDayCount) return '路线预览已准备'
  if (!preparation.providerConfigured) return `可为 ${preparation.eligibleDayCount - preparation.cachedDayCount} 天生成路线预览`
  return `可为 ${preparation.targetDayIds.length} 天生成路线预览`
}

function describeRouteGenerationResult(result: RouteGenerationBatchResult) {
  const parts = [`已生成 ${result.generatedCount} 天路线预览`]
  if (result.failedCount > 0) parts.push(`${result.failedCount} 天失败`)
  if (!result.previewCacheSaved && result.generatedCount > 0) parts.push('地图预览缓存未更新')
  return `${parts.join('，')}。`
}

function buildRouteGenerationConfirmBody(preparation: TripRoutePreparation | null) {
  const count = preparation?.targetDayIds.length ?? 0
  return `将为 ${count} 天生成路线预览。只用已有坐标，不会自动调整行程顺序。`
}
