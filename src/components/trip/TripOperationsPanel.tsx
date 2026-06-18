import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Cloud,
  EyeOff,
  FileText,
  History,
  Inbox,
  Loader2,
  MapPin,
  Moon,
  Route,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
} from 'lucide-react'
import type { AiTripEditContext } from '../../lib/ai/aiTripEditContext'
import {
  applyAiTripEditPatchPlanToDb,
} from '../../lib/ai/aiTripEditApply'
import {
  buildAiTripEditPatchPreview,
  type AiTripEditPatchPlan,
  type AiTripEditPatchPreview,
} from '../../lib/ai/aiTripEditPatch'
import { prepareAiTripEditExecution } from '../../lib/ai/aiTripEditExecution'
import {
  applyTripContentEnrichmentPreviewsToDb,
  type TripContentEnrichmentPreview,
} from '../../lib/ai/tripContentEnrichment'
import {
  saveTripDailyTravelTipPreviewToNotes,
  type TripDailyTravelTipEnhancedPreview,
  type TripDailyTravelTipModel,
} from '../../lib/ai/tripDailyTravelTip'
import type { ExistingTripImportAppliedChange, ExistingTripImportPreview } from '../../lib/ai/existingTripImport'
import { PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION, PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION } from '../../lib/ai/providerProxyContract'
import { applyTravelInboxPreviewRecord } from '../../lib/ai/travelInboxApply'
import {
  fetchProviderProxyAiTripEditPlan,
  fetchProviderProxyTripOperationsSummary,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import type { TripOperationsModel, TripOperationsRecommendation } from '../../lib/tripOperationsAgent'
import { executeTripOperationsRecommendations } from '../../lib/tripOperationsExecutor'
import {
  appendTripOperationsExecutionRecord,
  clearTripOperationsExecutionHistory,
  createTripOperationsExecutionRecord,
  restoreTripOperationsRecommendation,
  setTripOperationsDisposition,
  type TripOperationsAppliedChange,
  type TripOperationsExecutionResult,
  type TripOperationsExecutionSource,
  type TripOperationsLocalState,
} from '../../lib/tripOperationsState'
import { navigateTo } from '../../lib/routes'
import { navigateToTripOperationsRecommendation } from '../../lib/tripOperationsNavigation'
import type { TripReadinessModel } from '../../lib/tripReadiness'
import { getZonedPlainDate, resolveTripTimeZone } from '../../lib/timeZone'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Collapsible } from '../ui/Collapsible'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { Day, ItineraryItem, TicketMeta, TravelInboxPreviewRecord, Trip } from '../../types'

type TripOperationsPanelProps = {
  activeInboxPreview: TravelInboxPreviewRecord | null
  allItems: ItineraryItem[]
  dailyTipModel: TripDailyTravelTipModel | null
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  localState: TripOperationsLocalState
  model: TripOperationsModel
  onChanged: (options?: { refreshTripData?: boolean }) => Promise<void>
  onLocalStateChange: (state: TripOperationsLocalState) => void
  readinessModel: TripReadinessModel
  tickets: TicketMeta[]
  trip: Trip
}

type PendingGeneratedPreview = {
  contentFingerprint?: string
  contentPreview: TripContentEnrichmentPreview | null
  dailyTipFingerprint?: string
  dailyTipPreview: TripDailyTravelTipEnhancedPreview | null
}

const AI_SUMMARY_ENABLED_KEY = 'tripmap:trip-operations:ai-summary-enabled'

export function TripOperationsPanel({
  activeInboxPreview,
  allItems,
  dailyTipModel,
  days,
  itemsByDay,
  localState,
  model,
  onChanged,
  onLocalStateChange,
  readinessModel,
  tickets,
  trip,
}: TripOperationsPanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [pendingRecommendations, setPendingRecommendations] = useState<TripOperationsRecommendation[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [executionResult, setExecutionResult] = useState<TripOperationsExecutionResult | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [generatedPreview, setGeneratedPreview] = useState<PendingGeneratedPreview | null>(null)
  const [contentApplyConfirmOpen, setContentApplyConfirmOpen] = useState(false)
  const [dailyTipSaveConfirmOpen, setDailyTipSaveConfirmOpen] = useState(false)
  const [isApplyingContent, setIsApplyingContent] = useState(false)
  const [isSavingDailyTip, setIsSavingDailyTip] = useState(false)
  const [inboxRecommendation, setInboxRecommendation] = useState<TripOperationsRecommendation | null>(null)
  const [inboxApplyConfirmOpen, setInboxApplyConfirmOpen] = useState(false)
  const [isApplyingInbox, setIsApplyingInbox] = useState(false)
  const [aiRecommendation, setAiRecommendation] = useState<TripOperationsRecommendation | null>(null)
  const [aiContext, setAiContext] = useState<AiTripEditContext | null>(null)
  const [aiBaselineFingerprint, setAiBaselineFingerprint] = useState<string | null>(null)
  const [aiSendConfirmOpen, setAiSendConfirmOpen] = useState(false)
  const [aiApplyConfirmOpen, setAiApplyConfirmOpen] = useState(false)
  const [isGeneratingAiPatch, setIsGeneratingAiPatch] = useState(false)
  const [isApplyingAiPatch, setIsApplyingAiPatch] = useState(false)
  const [aiPatchPlan, setAiPatchPlan] = useState<AiTripEditPatchPlan | null>(null)
  const [aiPatchPreview, setAiPatchPreview] = useState<AiTripEditPatchPreview | null>(null)
  const [aiPatchWarnings, setAiPatchWarnings] = useState<string[]>([])
  const [aiSummaryEnabled, setAiSummaryEnabled] = useState(() => readAiSummaryEnabled())
  const [aiSummaryMessage, setAiSummaryMessage] = useState<string | null>(null)
  const [aiSummaryHighlights, setAiSummaryHighlights] = useState<string[]>([])
  const [isGeneratingAiSummary, setIsGeneratingAiSummary] = useState(false)

  const recommendationByFingerprint = useMemo(
    () => new Map(model.allRecommendations.map((recommendation) => [recommendation.fingerprint, recommendation])),
    [model.allRecommendations],
  )

  function processRecommendation(recommendation: TripOperationsRecommendation) {
    resetTransientMessages()
    if (recommendation.executionMode === 'confirmed_low_risk' || recommendation.executionMode === 'preview_low_risk') {
      setPendingRecommendations([recommendation])
      return
    }
    if (recommendation.executionMode === 'inbox_preview') {
      if (!activeInboxPreview) {
        navigateToTripOperationsRecommendation(recommendation, trip.id)
        return
      }
      setInboxRecommendation(recommendation)
      return
    }
    if (recommendation.executionMode === 'high_risk_ai') {
      prepareAiPatch(recommendation)
      return
    }
    navigateToTripOperationsRecommendation(recommendation, trip.id)
  }

  function hideRecommendation(recommendation: TripOperationsRecommendation, status: 'ignored' | 'snoozed') {
    const zonedDate = getZonedPlainDate(new Date(), resolveTripTimeZone(trip))
    onLocalStateChange(setTripOperationsDisposition({
      phase: model.phase,
      recommendation,
      state: localState,
      status,
      zonedDate,
    }))
  }

  async function confirmLowRiskExecution() {
    if (!pendingRecommendations?.length) return
    const recommendations = pendingRecommendations
    setIsRunning(true)
    resetTransientMessages()
    try {
      const result = await executeTripOperationsRecommendations({
        allItems,
        dailyTipModel,
        days,
        itemsByDay,
        providerConfig,
        readinessModel,
        recommendations,
        tickets,
        trip,
      })
      setExecutionResult(result)
      setPendingRecommendations(null)
      if (result.pendingPreviews.length > 0) {
        const content = result.pendingPreviews.find((preview) => preview.contentPreview)
        const dailyTip = result.pendingPreviews.find((preview) => preview.dailyTipPreview)
        setGeneratedPreview({
          contentFingerprint: content?.fingerprint,
          contentPreview: content?.contentPreview ?? null,
          dailyTipFingerprint: dailyTip?.fingerprint,
          dailyTipPreview: dailyTip?.dailyTipPreview ?? null,
        })
      }
      commitExecutionResult(recommendations, result, recommendations.length > 1 ? '批量处理旅行建议' : recommendations[0].title)
      await onChanged({ refreshTripData: false })
    } catch (error) {
      setOperationError(toErrorMessage(error, '执行建议失败。'))
    } finally {
      setIsRunning(false)
    }
  }

  function commitExecutionResult(
    recommendations: TripOperationsRecommendation[],
    result: TripOperationsExecutionResult,
    title: string,
  ) {
    const zonedDate = getZonedPlainDate(new Date(), resolveTripTimeZone(trip))
    let nextState = localState
    const completedFingerprints: string[] = []
    for (const outcome of result.outcomes) {
      if ((outcome.status !== 'applied' && outcome.status !== 'partial') || outcome.appliedChanges.length === 0) continue
      const recommendation = recommendations.find((candidate) => candidate.fingerprint === outcome.fingerprint)
      if (!recommendation) continue
      nextState = setTripOperationsDisposition({
        phase: model.phase,
        recommendation,
        state: nextState,
        status: 'completed',
        zonedDate,
      })
      completedFingerprints.push(recommendation.fingerprint)
    }
    if (result.appliedChanges.length > 0) {
      nextState = appendTripOperationsExecutionRecord(nextState, createTripOperationsExecutionRecord({
        appliedChanges: result.appliedChanges,
        fingerprints: completedFingerprints,
        status: result.outcomes.some((outcome) => outcome.status === 'failed' || outcome.status === 'partial') ? 'partial' : 'success',
        title,
      }))
    }
    if (nextState !== localState) onLocalStateChange(nextState)
  }

  async function handleApplyContentPreview() {
    const contentPreview = generatedPreview?.contentPreview
    if (!contentPreview || !generatedPreview?.contentFingerprint) return
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
      const selected = contentPreview.items.filter((item) => contentPreview.checkedIds.includes(item.id) && item.hasWrite)
      const changes = selected.map((item): TripOperationsAppliedChange => ({
        action: 'updated_content',
        dayId: allItems.find((candidate) => candidate.id === item.itemId)?.dayId,
        detail: item.summary || '已补充开放时间、票价或注意事项。',
        itemId: item.itemId,
        occurredAt: Date.now(),
        target: 'item',
        title: item.itemTitle,
      }))
      completePreviewRecommendation(generatedPreview.contentFingerprint, changes, '应用景点内容预览')
      setGeneratedPreview((current) => current ? { ...current, contentPreview: null } : null)
      setContentApplyConfirmOpen(false)
      setExecutionResult({ appliedChanges: changes, outcomes: [] })
      await onChanged({ refreshTripData: true })
    } finally {
      setIsApplyingContent(false)
    }
  }

  async function handleSaveDailyTipPreview() {
    const dailyTipPreview = generatedPreview?.dailyTipPreview
    if (!dailyTipPreview || !generatedPreview?.dailyTipFingerprint) return
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
      const changes: TripOperationsAppliedChange[] = [{
        action: 'saved_daily_tip',
        dayId: dailyTipModel?.targetDay?.id,
        detail: `已保存 ${dailyTipPreview.targetTitle}。`,
        occurredAt: Date.now(),
        target: dailyTipModel?.targetDay ? 'day' : 'trip',
        title: dailyTipPreview.targetTitle,
      }]
      completePreviewRecommendation(generatedPreview.dailyTipFingerprint, changes, '保存每日旅行提示')
      setGeneratedPreview((current) => current ? { ...current, dailyTipPreview: null } : null)
      setDailyTipSaveConfirmOpen(false)
      setExecutionResult({ appliedChanges: changes, outcomes: [] })
      await onChanged({ refreshTripData: true })
    } finally {
      setIsSavingDailyTip(false)
    }
  }

  function completePreviewRecommendation(
    fingerprint: string,
    changes: TripOperationsAppliedChange[],
    title: string,
    source: TripOperationsExecutionSource = 'trip_operations',
  ) {
    const recommendation = recommendationByFingerprint.get(fingerprint)
    if (!recommendation || changes.length === 0) return
    const zonedDate = getZonedPlainDate(new Date(), resolveTripTimeZone(trip))
    const completed = setTripOperationsDisposition({
      phase: model.phase,
      recommendation,
      state: localState,
      status: 'completed',
      zonedDate,
    })
    onLocalStateChange(appendTripOperationsExecutionRecord(completed, createTripOperationsExecutionRecord({
      appliedChanges: changes,
      fingerprints: [fingerprint],
      source,
      status: 'success',
      title,
    })))
  }

  function prepareAiPatch(recommendation: TripOperationsRecommendation) {
    if (!providerConfig.configured || !providerConfig.proxyUrl) {
      navigateToTripOperationsRecommendation({ ...recommendation, actionKind: 'open_day' }, trip.id)
      return
    }
    const contextResult = prepareAiTripEditExecution({ days, items: allItems, trip })
    if (!contextResult.ok) {
      setOperationError(contextResult.errors.join(' '))
      return
    }
    setAiRecommendation(recommendation)
    setAiContext(contextResult.context)
    setAiBaselineFingerprint(contextResult.baselineFingerprint)
    setAiPatchWarnings(contextResult.warnings)
    setAiSendConfirmOpen(true)
  }

  async function generateAiPatch() {
    if (!providerConfig.proxyUrl || !aiContext || !aiRecommendation) return
    setIsGeneratingAiPatch(true)
    setOperationError(null)
    try {
      const response = await fetchProviderProxyAiTripEditPlan({
        command: buildAiCommand(aiRecommendation),
        context: aiContext,
        operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
      }, providerConfig.proxyUrl)
      setAiPatchPlan(response.patchPlan)
      setAiPatchPreview(buildAiTripEditPatchPreview(response.patchPlan, aiContext))
      setAiPatchWarnings([...aiPatchWarnings, ...(response.warnings ?? []), ...(response.patchPlan.warnings ?? [])])
      setAiSendConfirmOpen(false)
    } catch (error) {
      setOperationError(error instanceof ProviderProxyClientError ? error.message : 'AI 修改建议生成失败。')
      setAiSendConfirmOpen(false)
    } finally {
      setIsGeneratingAiPatch(false)
    }
  }

  async function applyAiPatch() {
    if (!aiPatchPlan || !aiRecommendation) return
    setIsApplyingAiPatch(true)
    setOperationError(null)
    try {
      const result = await applyAiTripEditPatchPlanToDb(trip.id, aiPatchPlan, {
        expectedBaselineFingerprint: aiBaselineFingerprint ?? undefined,
      })
      if (!result.ok) {
        setOperationError(result.errors.join(' '))
        setAiApplyConfirmOpen(false)
        return
      }
      const changes = result.appliedChanges.map((change): TripOperationsAppliedChange => ({
        action: change.action === 'created'
          ? 'created_item'
          : change.action === 'removed'
            ? 'removed_item'
            : change.action === 'reordered'
              ? 'reordered_day'
              : change.itemId
                ? 'updated_item'
                : 'updated_day',
        dayId: change.dayId,
        detail: aiPatchPlan.summary,
        itemId: change.itemId,
        occurredAt: Date.now(),
        target: change.itemId ? 'item' : 'day',
        title: change.title,
      }))
      completePreviewRecommendation(aiRecommendation.fingerprint, changes, aiRecommendation.title, 'ai_trip_edit')
      setExecutionResult({ appliedChanges: changes, outcomes: [] })
      clearAiPatch()
      await onChanged({ refreshTripData: true })
    } finally {
      setIsApplyingAiPatch(false)
    }
  }

  async function applyInboxPreview() {
    if (!activeInboxPreview || !inboxRecommendation) return
    setIsApplyingInbox(true)
    setOperationError(null)
    try {
      const result = await applyTravelInboxPreviewRecord({ record: activeInboxPreview })
      if (!result.ok) {
        setOperationError(result.errors.join('；'))
        setInboxApplyConfirmOpen(false)
        return
      }
      const changes = result.appliedChanges.map(mapInboxAppliedChange)
      if (changes.length > 0) {
        completePreviewRecommendation(inboxRecommendation.fingerprint, changes, inboxRecommendation.title, 'travel_inbox')
      }
      setExecutionResult({ appliedChanges: changes, outcomes: [] })
      setInboxApplyConfirmOpen(false)
      setInboxRecommendation(null)
      await onChanged({ refreshTripData: true })
    } finally {
      setIsApplyingInbox(false)
    }
  }

  function restoreRecommendation(fingerprint: string) {
    onLocalStateChange(restoreTripOperationsRecommendation(localState, fingerprint))
  }

  function clearHistory() {
    onLocalStateChange(clearTripOperationsExecutionHistory(localState))
  }

  function toggleAiSummary() {
    const next = !aiSummaryEnabled
    setAiSummaryEnabled(next)
    writeAiSummaryEnabled(next)
    setAiSummaryMessage(next ? 'AI 摘要已启用，点击生成时才会发送精简建议。' : null)
    setAiSummaryHighlights([])
  }

  async function generateAiSummary() {
    if (!aiSummaryEnabled || !providerConfig.proxyUrl) {
      if (aiSummaryEnabled) setOperationError('当前未配置 provider proxy。')
      return
    }
    if (model.recommendations.length === 0) {
      setAiSummaryMessage('当前本地建议为空，暂不需要生成 AI 摘要。')
      return
    }
    setIsGeneratingAiSummary(true)
    setOperationError(null)
    try {
      const response = await fetchProviderProxyTripOperationsSummary(buildTripOperationsSummaryRequest(model, trip), providerConfig.proxyUrl)
      setAiSummaryMessage(response.summary)
      setAiSummaryHighlights(response.highlights)
    } catch (error) {
      setOperationError(toErrorMessage(error, '生成 AI 摘要失败。'))
    } finally {
      setIsGeneratingAiSummary(false)
    }
  }

  function resetTransientMessages() {
    setExecutionResult(null)
    setOperationError(null)
    setAiSummaryMessage(null)
    setAiSummaryHighlights([])
  }

  function clearAiPatch() {
    setAiRecommendation(null)
    setAiContext(null)
    setAiBaselineFingerprint(null)
    setAiPatchPlan(null)
    setAiPatchPreview(null)
    setAiPatchWarnings([])
    setAiApplyConfirmOpen(false)
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
            <p className="mt-2 text-sm leading-6 tm-muted" data-testid="trip-operations-summary">{model.summary.message}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              aria-pressed={aiSummaryEnabled}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-semibold tm-focus ${aiSummaryEnabled ? 'border-primary/30 bg-primary/10 text-primary' : 'border-outline-variant/30 bg-surface-container-high text-on-surface-variant'}`}
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

        {model.recommendations.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <span>路线、票据、收件箱和同步状态暂时没有需要优先处理的事项。</span>
          </div>
        ) : (
          <div className="space-y-2">
            {model.recommendations.map((recommendation) => (
              <RecommendationRow
                key={recommendation.fingerprint}
                onIgnore={() => hideRecommendation(recommendation, 'ignored')}
                onProcess={() => processRecommendation(recommendation)}
                onSnooze={() => hideRecommendation(recommendation, 'snoozed')}
                recommendation={recommendation}
              />
            ))}
          </div>
        )}

        {model.recommendations.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 tm-muted">只批量处理低风险项；预览生成后仍需再次确认写入。</p>
            <Button
              className="min-h-11 px-3 text-xs"
              disabled={model.batchableCount === 0 || isRunning}
              icon={isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              loading={isRunning}
              onClick={() => setPendingRecommendations(model.batchableRecommendations)}
              variant="secondary"
            >
              批量处理 {model.batchableCount} 项
            </Button>
          </div>
        ) : null}

        {model.replanTimeline.length > 0 ? <ReplanTimeline entries={model.replanTimeline} /> : null}

        {generatedPreview?.contentPreview ? (
          <PreviewResult
            actionLabel="应用内容"
            body={`${generatedPreview.contentPreview.items.length} 个行程点已生成预览，尚未写入。`}
            onAction={() => setContentApplyConfirmOpen(true)}
            testId="trip-operations-content-preview"
            title="景点内容待最终确认"
          />
        ) : null}

        {generatedPreview?.dailyTipPreview ? (
          <PreviewResult
            actionLabel="保存提示"
            body={`${generatedPreview.dailyTipPreview.targetTitle} 已生成预览，尚未写入。`}
            onAction={() => setDailyTipSaveConfirmOpen(true)}
            testId="trip-operations-daily-tip-preview"
            title="每日提示待最终确认"
          />
        ) : null}

        {inboxRecommendation && activeInboxPreview ? (
          <PreviewResult
            actionLabel="确认应用"
            body={describeInboxPreview(activeInboxPreview)}
            onAction={() => setInboxApplyConfirmOpen(true)}
            testId="trip-operations-inbox-preview"
            title="收件箱修改预览"
          />
        ) : null}

        {aiPatchPreview && aiPatchPlan ? (
          <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-high/45 p-3" data-testid="trip-operations-ai-patch-preview">
            <p className="text-xs font-semibold text-on-surface">{aiPatchPlan.summary}</p>
            <p className="text-xs leading-5 tm-muted">影响 {aiPatchPreview.affectedDayCount} 天、{aiPatchPreview.affectedItemCount} 个行程点，当前尚未写入。</p>
            <ul className="space-y-1 text-xs leading-5 text-on-surface-variant">
              {aiPatchPreview.lines.map((line) => <li className="break-words [overflow-wrap:anywhere]" key={line}>{line}</li>)}
            </ul>
            {aiPatchWarnings.map((warning) => <p className="text-xs text-amber-700 dark:text-amber-200" key={warning}>{warning}</p>)}
            <Button className="min-h-11 px-3 text-xs" onClick={() => setAiApplyConfirmOpen(true)} variant="secondary">应用修改</Button>
          </div>
        ) : null}

        {executionResult ? <ExecutionResult changes={executionResult.appliedChanges} outcomes={executionResult.outcomes} /> : null}

        {aiSummaryMessage ? (
          <div className="rounded-lg bg-surface-container-high px-3 py-2 text-xs leading-5 tm-muted" data-testid="trip-operations-ai-summary">
            <p>{aiSummaryMessage}</p>
            {aiSummaryHighlights.map((highlight) => <p className="mt-1" key={highlight}>{highlight}</p>)}
          </div>
        ) : null}

        {operationError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="trip-operations-error">{operationError}</p>
        ) : null}

        {model.hiddenRecommendations.length > 0 ? (
          <Collapsible subtitle="完成、忽略或暂缓的建议不会重复出现。" title={`已隐藏建议（${model.hiddenRecommendations.length}）`}>
            <div className="space-y-2" data-testid="trip-operations-hidden-list">
              {model.hiddenRecommendations.map(({ disposition, recommendation }) => (
                <div className="flex items-center justify-between gap-3" key={recommendation.fingerprint}>
                  <div className="min-w-0">
                    <p className="break-words text-xs font-medium text-on-surface">{recommendation.title}</p>
                    <p className="text-[11px] tm-muted">{dispositionLabel(disposition.status)}</p>
                  </div>
                  <Button className="min-h-11 shrink-0 px-3 text-xs" icon={<RotateCcw className="size-3.5" />} onClick={() => restoreRecommendation(recommendation.fingerprint)} variant="ghost">恢复</Button>
                </div>
              ))}
            </div>
          </Collapsible>
        ) : null}

        {localState.history.length > 0 ? (
          <Collapsible subtitle="最近 20 条，仅保存在本机。" title="完成了什么">
            <div className="space-y-3" data-testid="trip-operations-history">
              <div className="flex justify-end">
                <Button className="min-h-11 px-3 text-xs" icon={<Trash2 className="size-3.5" />} onClick={clearHistory} variant="ghost">清空历史</Button>
              </div>
              {localState.history.map((record) => (
                <div className="space-y-1 border-t border-outline-variant/20 pt-2 first:border-0 first:pt-0" key={record.id}>
                  <div className="flex items-center gap-2">
                    <History className="size-3.5 text-primary" />
                    <p className="text-xs font-semibold text-on-surface">{record.title}</p>
                    <span className="text-[11px] tm-muted">{executionSourceLabel(record.source)} · {formatHistoryTime(record.createdAt)}</span>
                  </div>
                  {record.appliedChanges.map((change, index) => (
                    <button
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-xs hover:bg-surface-container-high tm-focus"
                      key={`${change.action}-${change.itemId ?? change.ticketId ?? change.dayId ?? index}`}
                      onClick={() => navigateToAppliedChange(change, trip.id)}
                      type="button"
                    >
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{appliedActionLabel(change.action)} · {change.title} · {change.detail}</span>
                      <span className="shrink-0 text-primary">查看</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Collapsible>
        ) : null}
      </Card>

      <ConfirmDialog
        body={buildLowRiskConfirmBody(pendingRecommendations)}
        cancelLabel="暂不处理"
        confirmLabel="确认处理"
        icon={<ShieldCheck className="size-5" />}
        loading={isRunning}
        onCancel={() => !isRunning && setPendingRecommendations(null)}
        onConfirm={() => void confirmLowRiskExecution()}
        open={Boolean(pendingRecommendations?.length)}
        testId="trip-operations-confirm-dialog"
        title={pendingRecommendations?.length === 1 ? `处理「${pendingRecommendations[0].title}」？` : `批量处理 ${pendingRecommendations?.length ?? 0} 项建议？`}
      />

      <ConfirmDialog
        body="将把当前内容补充预览写入对应行程点，并加入对象同步队列。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<FileText className="size-5" />}
        loading={isApplyingContent}
        onCancel={() => !isApplyingContent && setContentApplyConfirmOpen(false)}
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
        onCancel={() => !isSavingDailyTip && setDailyTipSaveConfirmOpen(false)}
        onConfirm={() => void handleSaveDailyTipPreview()}
        open={dailyTipSaveConfirmOpen}
        testId="trip-operations-daily-tip-save-confirm-dialog"
        title="保存每日旅行提示？"
      />

      <ConfirmDialog
        body="将把已脱敏的旅行、日期和行程点信息发送给 AI 服务。AI 只返回结构化修改方案，不会直接写入，也不会自动联网搜索。"
        cancelLabel="取消"
        confirmLabel="确认发送"
        icon={<Sparkles className="size-5" />}
        loading={isGeneratingAiPatch}
        onCancel={() => !isGeneratingAiPatch && setAiSendConfirmOpen(false)}
        onConfirm={() => void generateAiPatch()}
        open={aiSendConfirmOpen}
        testId="trip-operations-ai-send-confirm-dialog"
        title="发送脱敏上下文？"
      />

      <ConfirmDialog
        body="将应用当前结构化修改方案。写入前会再次校验行程基线；行程已变化时会阻止写入。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<ShieldCheck className="size-5" />}
        loading={isApplyingAiPatch}
        onCancel={() => !isApplyingAiPatch && setAiApplyConfirmOpen(false)}
        onConfirm={() => void applyAiPatch()}
        open={aiApplyConfirmOpen}
        testId="trip-operations-ai-apply-confirm-dialog"
        title="应用 AI 修改方案？"
      />

      <ConfirmDialog
        body={activeInboxPreview ? describeInboxPreview(activeInboxPreview) : '当前没有可应用的收件箱预览。'}
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<Inbox className="size-5" />}
        loading={isApplyingInbox}
        onCancel={() => !isApplyingInbox && setInboxApplyConfirmOpen(false)}
        onConfirm={() => void applyInboxPreview()}
        open={inboxApplyConfirmOpen}
        testId="trip-operations-inbox-apply-confirm-dialog"
        title="应用已勾选收件箱修改？"
      />
    </>
  )
}

function RecommendationRow({
  onIgnore,
  onProcess,
  onSnooze,
  recommendation,
}: {
  onIgnore: () => void
  onProcess: () => void
  onSnooze: () => void
  recommendation: TripOperationsRecommendation
}) {
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-high/40 px-3 py-3" data-testid="trip-operations-recommendation" data-type={recommendation.type}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {recommendationIcon(recommendation)}
            <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{recommendation.title}</p>
            <span className={severityBadgeClassName(recommendation.severity)}>{severityLabel(recommendation.severity)}</span>
          </div>
          <p className="mt-1 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{recommendation.message}</p>
          <p className="mt-0.5 break-words text-[11px] leading-5 tm-muted [overflow-wrap:anywhere]">{recommendation.detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button className="min-h-11 px-3 text-xs" data-testid="trip-operations-action" icon={recommendation.requiresConfirm ? <ShieldCheck className="size-3.5" /> : undefined} onClick={onProcess} variant="secondary">处理</Button>
          <button aria-label={`稍后处理：${recommendation.title}`} className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high tm-focus" onClick={onSnooze} title="稍后处理" type="button"><Clock3 className="size-4" /></button>
          <button aria-label={`忽略建议：${recommendation.title}`} className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high tm-focus" onClick={onIgnore} title="忽略" type="button"><EyeOff className="size-4" /></button>
        </div>
      </div>
    </div>
  )
}

function PreviewResult({ actionLabel, body, onAction, testId, title }: { actionLabel: string; body: string; onAction: () => void; testId: string; title: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-high/45 px-3 py-2" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">{title}</p>
          <p className="mt-0.5 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{body}</p>
        </div>
        <Button className="min-h-11 shrink-0 px-3 text-xs" onClick={onAction} variant="secondary">{actionLabel}</Button>
      </div>
    </div>
  )
}

function ReplanTimeline({ entries }: { entries: TripOperationsModel['replanTimeline'] }) {
  return (
    <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-high/35 p-3" data-testid="trip-operations-replan-timeline">
      <div className="flex items-center gap-2">
        <History className="size-4 text-primary" />
        <p className="text-xs font-semibold text-on-surface">最近重排动态</p>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div className="flex items-start gap-2 text-xs leading-5" key={entry.id}>
            <span className={`mt-1 size-2 shrink-0 rounded-full ${entry.severity === 'high' ? 'bg-red-500' : entry.severity === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-on-surface">{entry.title}</span>
                <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-on-surface-variant">{entry.label}</span>
              </div>
              <p className="break-words tm-muted [overflow-wrap:anywhere]">{entry.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExecutionResult({ changes, outcomes }: { changes: TripOperationsAppliedChange[]; outcomes: TripOperationsExecutionResult['outcomes'] }) {
  const errors = outcomes.flatMap((outcome) => outcome.errors)
  const messages = outcomes.flatMap((outcome) => outcome.messages)
  if (changes.length === 0 && errors.length === 0 && messages.length === 0) return null
  return (
    <div className="space-y-2 rounded-lg bg-sky-50/75 px-3 py-2 text-xs leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" data-testid="trip-operations-result">
      {changes.map((change, index) => <p className="flex items-start gap-2" key={`${change.action}-${index}`}><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /><span>{change.title}：{change.detail}</span></p>)}
      {changes.length === 0 ? messages.map((message) => <p key={message}>{message}</p>) : null}
      {errors.map((error, index) => <p className="flex items-start gap-2 text-amber-700 dark:text-amber-200" key={`${error}-${index}`}><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></p>)}
    </div>
  )
}

function buildLowRiskConfirmBody(recommendations: TripOperationsRecommendation[] | null) {
  if (!recommendations?.length) return '确认后才会执行建议。'
  const previewCount = recommendations.filter((recommendation) => recommendation.executionMode === 'preview_low_risk').length
  return [
    `将处理 ${recommendations.length} 项低风险建议。路线、上传重试和缓存清理会直接执行。`,
    previewCount > 0 ? `${previewCount} 项 AI 内容或每日提示只生成预览，写入仍需再次确认。` : '',
    '批量发生部分失败时，只记录并隐藏成功项。',
  ].filter(Boolean).join('\n')
}

function buildAiCommand(recommendation: TripOperationsRecommendation) {
  const dayScope = recommendation.affectedDayIds.length > 0 ? `仅检查日期 ID：${recommendation.affectedDayIds.join('、')}。` : ''
  return `请处理旅行执行建议「${recommendation.title}」。${recommendation.message}${dayScope} 只提出解决该风险所需的最小结构化修改，不添加未经要求的新地点。`
}

function describeInboxPreview(record: TravelInboxPreviewRecord) {
  const preview = record.preview as ExistingTripImportPreview
  const selected = preview.diffs.filter((diff) => record.checkedDiffIds.includes(diff.id))
  const summaries = selected.slice(0, 3).map((diff) => diff.summary).join('；')
  return `将应用 ${selected.length} 项已勾选修改${summaries ? `：${summaries}` : ''}。写入前会重新校验行程基线。`
}

function mapInboxAppliedChange(change: ExistingTripImportAppliedChange): TripOperationsAppliedChange {
  const target = change.kind === 'ticket' ? 'tickets' : change.kind === 'item' ? 'item' : change.kind === 'day' ? 'day' : 'trip'
  const action: TripOperationsAppliedChange['action'] = change.kind === 'ticket'
    ? change.action === 'bound' ? 'bound_ticket' : 'merged_ticket'
    : change.kind === 'item'
      ? change.action === 'created' ? 'created_item' : 'updated_item'
      : change.kind === 'day'
        ? 'updated_day'
        : 'updated_trip'
  return {
    action,
    dayId: change.dayId,
    detail: `${inboxActionLabel(change.action)}收件箱内容。`,
    itemId: change.itemId,
    occurredAt: Date.now(),
    target,
    ticketId: change.ticketId,
    title: change.title,
  }
}

function inboxActionLabel(action: ExistingTripImportAppliedChange['action']) {
  if (action === 'created') return '已创建'
  if (action === 'bound') return '已绑定'
  if (action === 'merged') return '已合并'
  if (action === 'appended') return '已追加'
  return '已更新'
}

function navigateToAppliedChange(change: TripOperationsAppliedChange, tripId: string) {
  if (change.target === 'item' && change.itemId && change.dayId) {
    navigateTo('item', { dayId: change.dayId, itemId: change.itemId, tripId })
    return
  }
  if (change.target === 'day' && change.dayId) {
    navigateTo('day', { dayId: change.dayId, tripId, view: 'schedule' })
    return
  }
  if (change.target === 'tickets') {
    navigateTo('tickets', { tripId })
    return
  }
  if (change.target === 'sync_settings') {
    navigateTo('settings', { section: 'cloud' })
    return
  }
  if (change.target === 'route_settings') {
    navigateTo('settings')
    return
  }
  navigateTo('trip', { tripId })
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

function dispositionLabel(status: 'completed' | 'ignored' | 'snoozed') {
  if (status === 'completed') return '已处理'
  if (status === 'ignored') return '已忽略'
  return '稍后处理，目的地次日或阶段变化后恢复'
}

function formatHistoryTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(timestamp)
}

function executionSourceLabel(source: TripOperationsExecutionSource) {
  if (source === 'ai_trip_edit') return 'AI 修改方案'
  if (source === 'travel_inbox') return '旅行收件箱'
  return '执行代理'
}

function appliedActionLabel(action: TripOperationsAppliedChange['action']) {
  if (action === 'generated_route') return '生成路线'
  if (action === 'retried_ticket_upload') return '重试上传'
  if (action === 'cleared_ticket_cache') return '清理缓存'
  if (action === 'saved_daily_tip') return '保存提示'
  if (action === 'updated_content') return '补充内容'
  if (action === 'bound_ticket') return '绑定票据'
  if (action === 'merged_ticket') return '合并票据'
  if (action === 'created_item') return '创建行程点'
  if (action === 'removed_item') return '删除行程点'
  if (action === 'reordered_day') return '调整顺序'
  if (action === 'updated_day') return '更新日期'
  if (action === 'updated_trip') return '更新旅行'
  return '更新行程点'
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
    // The local toggle is best effort.
  }
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
