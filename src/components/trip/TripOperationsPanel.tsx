import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cloud,
  FileText,
  Inbox,
  Loader2,
  MapPin,
  Moon,
  Route,
  ShieldCheck,
  Sparkles,
  Ticket,
} from 'lucide-react'
import {
  TRIP_CONTENT_ENRICHMENT_MAX_ITEMS,
  applyTripContentEnrichmentPreviewsToDb,
  estimateTripContentEnrichmentRequestCounts,
  type TripContentEnrichmentPreview,
} from '../../lib/ai/tripContentEnrichment'
import {
  saveTripDailyTravelTipPreviewToNotes,
  type TripDailyTravelTipEnhancedPreview,
  type TripDailyTravelTipModel,
} from '../../lib/ai/tripDailyTravelTip'
import { PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION } from '../../lib/ai/providerProxyContract'
import { clearSyncedTicketBlobCache } from '../../lib/cloudObjectSync'
import { fetchProviderProxyTripOperationsSummary, getProviderProxyConfig } from '../../lib/providerProxyClient'
import {
  buildTripReadinessRepairPreview,
  type TripReadinessModel,
  type TripReadinessRepairPreview,
} from '../../lib/tripReadiness'
import { executeTripReadinessRepairPreview, type TripReadinessRepairExecutionResult } from '../../lib/tripReadinessRepair'
import type { TripOperationsModel, TripOperationsRecommendation } from '../../lib/tripOperationsAgent'
import { navigateTo } from '../../lib/routes'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { Day, ItineraryItem, Trip } from '../../types'

type TripOperationsPanelProps = {
  allItems: ItineraryItem[]
  dailyTipModel: TripDailyTravelTipModel | null
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  model: TripOperationsModel
  onChanged: (options?: { refreshTripData?: boolean }) => Promise<void>
  readinessModel: TripReadinessModel
  trip: Trip
}

type PendingOperation = {
  cacheTicketIds: string[]
  repairPreview: TripReadinessRepairPreview | null
  title: string
}

type OperationResult = Omit<TripReadinessRepairExecutionResult, 'contentPreview' | 'dailyTipPreview'>

const AI_SUMMARY_ENABLED_KEY = 'tripmap:trip-operations:ai-summary-enabled'

export function TripOperationsPanel({
  allItems,
  dailyTipModel,
  days,
  itemsByDay,
  model,
  onChanged,
  readinessModel,
  trip,
}: TripOperationsPanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [operationResult, setOperationResult] = useState<OperationResult | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [contentPreview, setContentPreview] = useState<TripContentEnrichmentPreview | null>(null)
  const [dailyTipPreview, setDailyTipPreview] = useState<TripDailyTravelTipEnhancedPreview | null>(null)
  const [contentApplyConfirmOpen, setContentApplyConfirmOpen] = useState(false)
  const [dailyTipSaveConfirmOpen, setDailyTipSaveConfirmOpen] = useState(false)
  const [isApplyingContent, setIsApplyingContent] = useState(false)
  const [isSavingDailyTip, setIsSavingDailyTip] = useState(false)
  const [applySuccess, setApplySuccess] = useState<string | null>(null)
  const [aiSummaryEnabled, setAiSummaryEnabled] = useState(() => readAiSummaryEnabled())
  const [aiSummaryMessage, setAiSummaryMessage] = useState<string | null>(null)
  const [aiSummaryHighlights, setAiSummaryHighlights] = useState<string[]>([])
  const [isGeneratingAiSummary, setIsGeneratingAiSummary] = useState(false)

  const visibleRecommendations = model.recommendations
  const batchOperation = useMemo(() => buildBatchOperation(visibleRecommendations, readinessModel), [readinessModel, visibleRecommendations])
  const hasBatchAction = Boolean(batchOperation?.repairPreview?.issueIds.length || batchOperation?.cacheTicketIds.length)

  function openRecommendation(recommendation: TripOperationsRecommendation) {
    setOperationError(null)
    setApplySuccess(null)
    setAiSummaryMessage(null)
    setAiSummaryHighlights([])
    if (isRepairRecommendation(recommendation)) {
      const preview = buildTripReadinessRepairPreview(readinessModel, recommendation.readinessIssueIds, 'single')
      if (preview.issueIds.length > 0) {
        setPendingOperation({
          cacheTicketIds: [],
          repairPreview: preview,
          title: recommendation.title,
        })
      }
      return
    }
    if (recommendation.actionKind === 'clear_ticket_cache') {
      setPendingOperation({
        cacheTicketIds: recommendation.ticketIds,
        repairPreview: null,
        title: recommendation.title,
      })
      return
    }
    runNavigationAction(recommendation, trip.id)
  }

  async function confirmOperation() {
    if (!pendingOperation) {
      return
    }
    const operation = pendingOperation
    setIsRunning(true)
    setOperationError(null)
    setOperationResult(null)
    setApplySuccess(null)
    setContentPreview(null)
    setDailyTipPreview(null)
    try {
      const result: OperationResult = {
        messages: [],
        ticketErrors: [],
        ticketRetryCount: 0,
      }

      if (operation.repairPreview?.issueIds.length) {
        const repairResult = await executeTripReadinessRepairPreview({
          allItems,
          dailyTipModel,
          days,
          itemsByDay,
          preview: operation.repairPreview,
          providerConfig,
          trip,
        })
        result.messages.push(...repairResult.messages)
        result.routeResult = repairResult.routeResult
        result.ticketErrors.push(...repairResult.ticketErrors)
        result.ticketRetryCount += repairResult.ticketRetryCount
        if (repairResult.contentPreview) {
          setContentPreview(repairResult.contentPreview)
        }
        if (repairResult.dailyTipPreview) {
          setDailyTipPreview(repairResult.dailyTipPreview)
        }
      }

      if (operation.cacheTicketIds.length > 0) {
        const settled = await Promise.allSettled(operation.cacheTicketIds.map((ticketId) => clearSyncedTicketBlobCache(ticketId)))
        const clearedCount = settled.filter((entry) => entry.status === 'fulfilled').length
        const errors = settled
          .filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
          .map((entry) => entry.reason instanceof Error ? entry.reason.message : '清理缓存失败。')
        result.messages.push(`已清理 ${clearedCount} 张票据的此设备离线缓存。`)
        result.ticketErrors.push(...errors)
      }

      setPendingOperation(null)
      setOperationResult(result)
      await onChanged({ refreshTripData: false })
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : '执行建议失败。')
    } finally {
      setIsRunning(false)
    }
  }

  async function handleApplyContentPreview() {
    if (!contentPreview) {
      return
    }
    setIsApplyingContent(true)
    setOperationError(null)
    try {
      const result = await applyTripContentEnrichmentPreviewsToDb(
        trip.id,
        contentPreview.items,
        contentPreview.checkedIds,
        { expectedBaselineFingerprint: contentPreview.baselineFingerprint },
      )
      if (!result.ok) {
        setOperationError(result.errors.join('；'))
        return
      }
      setContentPreview(null)
      setContentApplyConfirmOpen(false)
      setApplySuccess(`已写入 ${result.appliedCount} 个行程点的景点内容。`)
      await onChanged({ refreshTripData: true })
    } finally {
      setIsApplyingContent(false)
    }
  }

  async function handleSaveDailyTipPreview() {
    if (!dailyTipPreview) {
      return
    }
    setIsSavingDailyTip(true)
    setOperationError(null)
    try {
      const result = await saveTripDailyTravelTipPreviewToNotes({
        expectedBaselineFingerprint: dailyTipPreview.baselineFingerprint,
        preview: dailyTipPreview,
        tripId: trip.id,
      })
      if (!result.ok) {
        setOperationError(result.errors.join('；'))
        return
      }
      setDailyTipPreview(null)
      setDailyTipSaveConfirmOpen(false)
      setApplySuccess('已保存每日旅行提示到旅行备注。')
      await onChanged({ refreshTripData: true })
    } finally {
      setIsSavingDailyTip(false)
    }
  }

  function toggleAiSummary() {
    const next = !aiSummaryEnabled
    setAiSummaryEnabled(next)
    writeAiSummaryEnabled(next)
    setAiSummaryMessage(next ? 'AI 摘要已启用，点击生成时才会发送精简建议。' : null)
    setAiSummaryHighlights([])
  }

  async function generateAiSummary() {
    if (!aiSummaryEnabled) {
      return
    }
    if (!providerConfig.proxyUrl) {
      setOperationError('当前未配置 provider proxy。')
      return
    }
    if (model.recommendations.length === 0) {
      setAiSummaryMessage('当前本地建议为空，暂不需要生成 AI 摘要。')
      setAiSummaryHighlights([])
      return
    }
    setIsGeneratingAiSummary(true)
    setOperationError(null)
    setAiSummaryMessage(null)
    setAiSummaryHighlights([])
    try {
      const response = await fetchProviderProxyTripOperationsSummary(buildTripOperationsSummaryRequest(model, trip), providerConfig.proxyUrl)
      setAiSummaryMessage(response.summary)
      setAiSummaryHighlights(response.highlights)
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : '生成 AI 摘要失败。')
    } finally {
      setIsGeneratingAiSummary(false)
    }
  }

  return (
    <>
      <Card className="space-y-4" data-testid="trip-operations-panel" variant="grouped">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-primary">{model.phaseLabel}</p>
                <h3 className="text-base font-semibold text-on-surface">现在建议做什么</h3>
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 tm-muted" data-testid="trip-operations-summary">
              {model.summary.message}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              aria-pressed={aiSummaryEnabled}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold tm-focus ${
                aiSummaryEnabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-outline-variant/30 bg-surface-container-high text-on-surface-variant'
              }`}
              onClick={toggleAiSummary}
              type="button"
            >
              <Bot className="size-3.5" />
              AI 摘要
            </button>
            <Button
              className="min-h-11 px-3 text-xs"
              disabled={!aiSummaryEnabled || isGeneratingAiSummary}
              icon={isGeneratingAiSummary ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              loading={isGeneratingAiSummary}
              onClick={() => void generateAiSummary()}
              variant="secondary"
            >
              生成摘要
            </Button>
          </div>
        </div>

        {visibleRecommendations.length === 0 ? (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <span>路线、票据、收件箱和同步状态暂时没有需要优先处理的事项。</span>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRecommendations.map((recommendation) => (
              <RecommendationRow
                key={recommendation.id}
                onAction={openRecommendation}
                recommendation={recommendation}
              />
            ))}
          </div>
        )}

        {visibleRecommendations.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 tm-muted">
              高风险项只打开确认或详情；低风险项可批量处理。
            </p>
            <Button
              className="min-h-11 px-3 text-xs"
              disabled={!hasBatchAction || isRunning}
              icon={isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              loading={isRunning}
              onClick={() => batchOperation && setPendingOperation(batchOperation)}
              variant="secondary"
            >
              批量处理 {model.batchableCount} 项
            </Button>
          </div>
        ) : null}

        {operationResult ? (
          <div className="space-y-2 rounded-xl bg-sky-50/75 px-3 py-2 text-xs leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" data-testid="trip-operations-result">
            {operationResult.messages.map((message) => (
              <p className="flex items-start gap-2" key={message}>
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                <span>{message}</span>
              </p>
            ))}
            {operationResult.ticketErrors.map((message, index) => (
              <p className="flex items-start gap-2 text-amber-700 dark:text-amber-200" key={`${message}-${index}`}>
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{message}</span>
              </p>
            ))}
          </div>
        ) : null}

        {contentPreview ? (
          <PreviewResult
            actionLabel="应用内容"
            body={`${contentPreview.items.length} 个行程点已生成预览，确认后才会写入。`}
            onAction={() => setContentApplyConfirmOpen(true)}
            testId="trip-operations-content-preview"
            title="景点内容待应用"
          />
        ) : null}

        {dailyTipPreview ? (
          <PreviewResult
            actionLabel="保存提示"
            body={`${dailyTipPreview.targetTitle}，确认后写入旅行备注。`}
            onAction={() => setDailyTipSaveConfirmOpen(true)}
            testId="trip-operations-daily-tip-preview"
            title="每日提示待保存"
          />
        ) : null}

        {applySuccess ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="trip-operations-apply-success">
            {applySuccess}
          </p>
        ) : null}

        {aiSummaryMessage ? (
          <div className="rounded-xl bg-surface-container-high px-3 py-2 text-xs leading-5 tm-muted" data-testid="trip-operations-ai-summary">
            <p>{aiSummaryMessage}</p>
            {aiSummaryHighlights.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {aiSummaryHighlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {operationError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="trip-operations-error">
            {operationError}
          </p>
        ) : null}
      </Card>

      <ConfirmDialog
        body={buildOperationConfirmBody(pendingOperation, allItems, dailyTipModel)}
        cancelLabel="暂不处理"
        confirmLabel="确认处理"
        icon={<ShieldCheck className="size-5" />}
        loading={isRunning}
        onCancel={() => {
          if (!isRunning) {
            setPendingOperation(null)
          }
        }}
        onConfirm={() => void confirmOperation()}
        open={Boolean(pendingOperation)}
        testId="trip-operations-confirm-dialog"
        title={pendingOperation ? `处理「${pendingOperation.title}」？` : '确认处理建议？'}
      />

      <ConfirmDialog
        body="将把当前内容补充预览写入对应行程点，并加入对象同步队列。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<FileText className="size-5" />}
        loading={isApplyingContent}
        onCancel={() => {
          if (!isApplyingContent) setContentApplyConfirmOpen(false)
        }}
        onConfirm={() => void handleApplyContentPreview()}
        open={contentApplyConfirmOpen}
        testId="trip-operations-content-apply-confirm-dialog"
        title="应用景点内容预览？"
      />

      <ConfirmDialog
        body="将把当前每日旅行提示保存到旅行备注，并加入对象同步队列。"
        cancelLabel="暂不保存"
        confirmLabel="确认保存"
        icon={<Sparkles className="size-5" />}
        loading={isSavingDailyTip}
        onCancel={() => {
          if (!isSavingDailyTip) setDailyTipSaveConfirmOpen(false)
        }}
        onConfirm={() => void handleSaveDailyTipPreview()}
        open={dailyTipSaveConfirmOpen}
        testId="trip-operations-daily-tip-save-confirm-dialog"
        title="保存每日旅行提示？"
      />
    </>
  )
}

function RecommendationRow({
  onAction,
  recommendation,
}: {
  onAction: (recommendation: TripOperationsRecommendation) => void
  recommendation: TripOperationsRecommendation
}) {
  return (
    <div
      className="rounded-xl border border-outline-variant/30 bg-surface-container-high/40 px-3 py-3"
      data-testid="trip-operations-recommendation"
      data-type={recommendation.type}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {recommendationIcon(recommendation)}
            <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">
              {recommendation.title}
            </p>
            <span className={severityBadgeClassName(recommendation.severity)}>{severityLabel(recommendation.severity)}</span>
          </div>
          <p className="mt-1 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{recommendation.message}</p>
          <p className="mt-0.5 break-words text-[11px] leading-5 tm-muted [overflow-wrap:anywhere]">{recommendation.detail}</p>
        </div>
        <Button
          className="min-h-11 shrink-0 px-3 text-xs"
          data-testid="trip-operations-action"
          icon={recommendation.requiresConfirm ? <ShieldCheck className="size-3.5" /> : undefined}
          onClick={() => onAction(recommendation)}
          variant="secondary"
        >
          {recommendation.actionLabel}
        </Button>
      </div>
    </div>
  )
}

function PreviewResult({
  actionLabel,
  body,
  onAction,
  testId,
  title,
}: {
  actionLabel: string
  body: string
  onAction: () => void
  testId: string
  title: string
}) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high/45 px-3 py-2" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">{title}</p>
          <p className="mt-0.5 text-xs leading-5 tm-muted">{body}</p>
        </div>
        <Button className="min-h-11 shrink-0 px-3 text-xs" onClick={onAction} variant="secondary">
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function buildBatchOperation(
  recommendations: TripOperationsRecommendation[],
  readinessModel: TripReadinessModel,
): PendingOperation | null {
  const batchable = recommendations.filter((recommendation) => recommendation.canBatch && recommendation.severity === 'low')
  const readinessIssueIds = batchable.flatMap((recommendation) => recommendation.readinessIssueIds)
  const cacheTicketIds = uniqueStrings(batchable.flatMap((recommendation) => recommendation.ticketIds))
  const repairPreview = readinessIssueIds.length > 0
    ? buildTripReadinessRepairPreview(readinessModel, readinessIssueIds, 'batch')
    : null
  if (!repairPreview?.issueIds.length && cacheTicketIds.length === 0) {
    return null
  }
  return {
    cacheTicketIds,
    repairPreview,
    title: `批量处理 ${batchable.length} 项建议`,
  }
}

function isRepairRecommendation(recommendation: TripOperationsRecommendation) {
  return recommendation.readinessIssueIds.length > 0 && (
    recommendation.actionKind === 'generate_routes' ||
    recommendation.actionKind === 'retry_ticket_upload' ||
    recommendation.actionKind === 'generate_content_preview' ||
    recommendation.actionKind === 'generate_daily_tip_preview'
  )
}

function runNavigationAction(recommendation: TripOperationsRecommendation, tripId: string) {
  if ((recommendation.actionKind === 'open_item' || recommendation.actionKind === 'open_tickets') && recommendation.itemId) {
    if (recommendation.actionKind === 'open_item' && recommendation.dayId) {
      navigateTo('item', { dayId: recommendation.dayId, itemId: recommendation.itemId, tripId })
      return
    }
    navigateTo('tickets', { itemId: recommendation.itemId, tripId })
    return
  }
  if (recommendation.actionKind === 'open_tickets') {
    navigateTo('tickets', { tripId })
    return
  }
  if ((recommendation.actionKind === 'open_day' || recommendation.actionKind === 'review_tomorrow') && recommendation.dayId) {
    navigateTo('day', { dayId: recommendation.dayId, tripId, view: 'schedule' })
    return
  }
  if (recommendation.actionKind === 'open_inbox') {
    document.getElementById('trip-travel-inbox-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (recommendation.actionKind === 'open_sync') {
    document.getElementById('trip-sync-archive-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (recommendation.actionKind === 'open_route_panel') {
    document.getElementById('route-preparation-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (recommendation.actionKind === 'open_content_enrichment') {
    document.getElementById('trip-content-enrichment-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  document.getElementById('trip-readiness-center-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function buildOperationConfirmBody(
  operation: PendingOperation | null,
  allItems: ItineraryItem[],
  dailyTipModel: TripDailyTravelTipModel | null,
) {
  if (!operation) {
    return '确认后才会执行建议。'
  }
  const preview = operation.repairPreview
  const contentTargets = preview?.contentItemIds
    .map((itemId) => allItems.find((item) => item.id === itemId))
    .filter((item): item is ItineraryItem => Boolean(item)) ?? []
  const contentCounts = estimateTripContentEnrichmentRequestCounts(contentTargets)
  const dailyTipRequestCount = preview?.dailyTipRequested && dailyTipModel ? dailyTipModel.searchTargets.length + 1 : 0
  const providerRequestCount = (preview?.routeDayIds.length ?? 0) + contentCounts.total + dailyTipRequestCount
  const parts = [
    preview && preview.routeDayIds.length > 0 ? `生成 ${preview.routeDayIds.length} 天路线缓存` : '',
    preview && preview.ticketIds.length > 0 ? `重试 ${preview.ticketIds.length} 张票据上传` : '',
    preview && preview.contentItemIds.length > 0 ? `生成 ${Math.min(preview.contentItemIds.length, TRIP_CONTENT_ENRICHMENT_MAX_ITEMS)} 个景点内容预览` : '',
    preview?.dailyTipRequested ? '生成每日旅行提示预览' : '',
    operation.cacheTicketIds.length > 0 ? `清理 ${operation.cacheTicketIds.length} 张已同步票据的此设备缓存` : '',
  ].filter(Boolean)
  return [
    `将执行：${parts.length > 0 ? parts.join('、') : '暂无可执行项'}。`,
    `预计 provider/路线请求 ${providerRequestCount} 次；清理缓存只删除此设备离线副本，不删除账号文件。`,
    '内容补充和每日提示只会生成预览，仍需在结果区再次确认应用。',
  ].join('\n')
}

function recommendationIcon(recommendation: TripOperationsRecommendation) {
  if (recommendation.type === 'missing_route' || recommendation.type === 'route_long_distance') return <Route className="size-3.5 shrink-0 text-sky-600" />
  if (recommendation.type === 'missing_coordinate') return <MapPin className="size-3.5 shrink-0 text-amber-600" />
  if (recommendation.type === 'missing_ticket' || recommendation.type === 'ticket_unsynced' || recommendation.type === 'synced_ticket_cache') return <Ticket className="size-3.5 shrink-0 text-violet-600" />
  if (recommendation.type === 'missing_content' || recommendation.type === 'daily_tip_missing') return <Sparkles className="size-3.5 shrink-0 text-emerald-600" />
  if (recommendation.type === 'cloud_sync_pending') return <Cloud className="size-3.5 shrink-0 text-slate-600" />
  if (recommendation.type === 'inbox_needs_attention') return <Inbox className="size-3.5 shrink-0 text-primary" />
  if (recommendation.type === 'tomorrow_review') return <Moon className="size-3.5 shrink-0 text-indigo-600" />
  return <AlertTriangle className="size-3.5 shrink-0 text-red-600" />
}

function severityBadgeClassName(severity: TripOperationsRecommendation['severity']) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold'
  if (severity === 'high') return `${base} bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200`
  if (severity === 'medium') return `${base} bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200`
  return `${base} bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200`
}

function severityLabel(severity: TripOperationsRecommendation['severity']) {
  if (severity === 'high') return '高风险'
  if (severity === 'medium') return '建议'
  return '低风险'
}

function buildTripOperationsSummaryRequest(model: TripOperationsModel, trip: Trip) {
  return {
    destination: trip.destination,
    generatedAt: new Date().toISOString(),
    operation: PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION,
    phase: model.phase,
    recommendations: model.recommendations.map((recommendation) => ({
      actionKind: recommendation.actionKind,
      actionLabel: recommendation.actionLabel,
      message: recommendation.message,
      severity: recommendation.severity,
      title: recommendation.title,
      type: recommendation.type,
    })),
    tripTitle: trip.title,
  }
}

function readAiSummaryEnabled() {
  try {
    return window.localStorage.getItem(AI_SUMMARY_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

function writeAiSummaryEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(AI_SUMMARY_ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    // localStorage can be unavailable in private contexts; keep state in memory.
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}
