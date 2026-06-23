import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Bot, CheckCircle2, ChevronDown, Loader2, MessagesSquare, ReceiptText, RotateCcw, Route, Send, ShieldCheck, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { createTripDisruptionEvent, updateItineraryItem } from '../../db'
import {
  applyAiTripEditPatchPlanToDb,
  buildAiTripEditLocalStateFingerprint,
  type AiTripEditAppliedChange,
} from '../../lib/ai/aiTripEditApply'
import { buildAiTripEditContext, type AiTripEditContext } from '../../lib/ai/aiTripEditContext'
import { buildAiTripEditPatchPreview, type AiTripEditPatchPlan, type AiTripEditPatchPreview } from '../../lib/ai/aiTripEditPatch'
import {
  buildAiTripEditSearchRequest,
  summarizeTravelSearchResultsForPrompt,
} from '../../lib/ai/aiTripEditSearch'
import { getStoredAiPrivacySettings } from '../../lib/ai/aiPrivacy'
import {
  formatFlexibility,
  formatMobility,
  formatPriority,
  formatWeather,
  type GlobalAiCommandContext,
  type GlobalAiReplanPreviewResult,
} from '../../lib/ai/globalAiCommandRouter'
import {
  buildAssistantAnswerFallbackAfterError,
  loadGlobalAiInteractionContext,
  mergeAssistantAnswerProviderResponse,
  resolveGlobalAiInteraction,
  type GlobalAiActionProposal,
  type GlobalAiFailureRecord,
  type GlobalAiInteractionContextMode,
  type GlobalAiInteractionResult,
} from '../../lib/ai/globalAiInteraction'
import { PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION, type ProviderProxyAiTripEditSearchSummary, type ProviderProxyTravelSearchRequest } from '../../lib/ai/providerProxyContract'
import { applyTripReplanOption, createTripReplanPreviewForEvent } from '../../lib/adaptiveReplanning'
import { emitTravelDataChanged } from '../../lib/dataEvents'
import { navigateTo } from '../../lib/routes'
import {
  fetchProviderProxyAiTripEditPlan,
  fetchProviderProxyAssistantAnswer,
  fetchProviderProxyTravelSearch,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import {
  appendTripIntelligenceExecutionResult,
  mapTripReplanAppliedChange,
  type TripIntelligenceAppliedChange,
} from '../../lib/tripIntelligence'
import type { ItineraryReplanPreference, RouteId, TripReplanDiff, TripReplanOption, TripReplanRecord } from '../../types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type GlobalAiCommandBarProps = {
  activeRoute: RouteId
  hasBottomTab: boolean
}

type PendingAiTripEdit = {
  actionProposal?: GlobalAiActionProposal
  baselineFingerprint: string
  command: string
  context: AiTripEditContext
  searchRequest: ProviderProxyTravelSearchRequest | null
  tripId: string
  warnings: string[]
}

type AiTripEditPreviewState = {
  actionProposal?: GlobalAiActionProposal
  baselineFingerprint: string
  patchPlan: AiTripEditPatchPlan
  preview: AiTripEditPatchPreview
  searchResults: ProviderProxyAiTripEditSearchSummary | null
  tripId: string
  warnings: string[]
}

type ConversationMessage = {
  createdAt: number
  id: string
  sourceCardCount?: number
  text: string
  tone?: 'error' | 'normal' | 'success'
  type: 'assistant' | 'user'
}

const HIDDEN_ROUTES = new Set<RouteId>([
  'item/edit',
  'item/new',
  'ledger/expense',
  'shared-trip',
  'trip/edit',
  'trip/new',
])

const NO_SEARCH_WARNING = '没有可用来源时不会声明实时事实；本次未取得来源结果。'

export function GlobalAiCommandBar({ activeRoute, hasBottomTab }: GlobalAiCommandBarProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [command, setCommand] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [result, setResult] = useState<GlobalAiInteractionResult | null>(null)
  const [contextLabel, setContextLabel] = useState(getRouteScopeFallback(activeRoute))
  const [contextMode, setContextMode] = useState<GlobalAiInteractionContextMode>('current_page')
  const [expanded, setExpanded] = useState(false)
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const [failureRecords, setFailureRecords] = useState<GlobalAiFailureRecord[]>([])
  const [lastFailedCommand, setLastFailedCommand] = useState<string | null>(null)
  const [selectedReplanOptionId, setSelectedReplanOptionId] = useState<string | null>(null)
  const [pendingAi, setPendingAi] = useState<PendingAiTripEdit | null>(null)
  const [aiSendConfirmOpen, setAiSendConfirmOpen] = useState(false)
  const [aiApplyConfirmOpen, setAiApplyConfirmOpen] = useState(false)
  const [aiPreview, setAiPreview] = useState<AiTripEditPreviewState | null>(null)
  const [writeConfirmOpen, setWriteConfirmOpen] = useState(false)

  const trimmedCommand = command.trim()
  const hidden = HIDDEN_ROUTES.has(activeRoute)
  const selectedReplanOption = result?.kind === 'replan_preview'
    ? result.record.options.find((option) => option.id === selectedReplanOptionId) ?? result.record.options[0]
    : null
  const panelOpen = Boolean(expanded || error || success || result || aiPreview || loading)

  useEffect(() => {
    let cancelled = false
    async function refreshContextLabel() {
      try {
        const context = await loadGlobalAiInteractionContext(
          contextMode === 'account' ? 'home' : activeRoute,
          contextMode === 'account' ? '#/home' : window.location.hash,
        )
        if (!cancelled) setContextLabel(context.scopeLabel)
      } catch {
        if (!cancelled) setContextLabel(getRouteScopeFallback(activeRoute))
      }
    }
    void refreshContextLabel()
    window.addEventListener('hashchange', refreshContextLabel)
    return () => {
      cancelled = true
      window.removeEventListener('hashchange', refreshContextLabel)
    }
  }, [activeRoute, contextMode])

  if (hidden) return null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runCommand(trimmedCommand)
  }

  async function runCommand(commandText: string, options: { forceAssistant?: boolean } = {}) {
    const submittedCommand = commandText.trim()
    if (!submittedCommand || loading) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    setResult(null)
    setAiPreview(null)
    setLastFailedCommand(null)
    appendConversationMessage({ text: submittedCommand, type: 'user' })
    try {
      const context = await loadGlobalAiInteractionContext(
        contextMode === 'account' ? 'home' : activeRoute,
        contextMode === 'account' ? '#/home' : window.location.hash,
      )
      setContextLabel(context.scopeLabel)
      const resolved = await resolveGlobalAiInteraction(submittedCommand, context, {
        forceMode: options.forceAssistant ? 'assistant_answer' : undefined,
      })
      if (resolved.kind === 'ai_trip_edit') {
        if (prepareAiTripEdit(context, submittedCommand, resolved.actionProposal)) {
          appendConversationMessage({
            sourceCardCount: resolved.actionProposal?.sourceCards.length,
            text: '已准备生成 AI 修改预览，发送前需要你确认。',
            type: 'assistant',
          })
        }
      } else if (resolved.kind === 'assistant_answer') {
        const answer = await resolveAssistantAnswer(resolved)
        setResult(answer)
        appendConversationMessage({
          sourceCardCount: answer.sourceCards.length,
          text: answer.answer,
          type: 'assistant',
        })
      } else {
        setSelectedReplanOptionId(resolved.kind === 'replan_preview' ? resolved.record.options[0]?.id ?? null : null)
        setResult(resolved)
        appendConversationMessage({
          sourceCardCount: getInteractionSourceCardCount(resolved),
          text: summarizeInteractionResult(resolved),
          type: 'assistant',
        })
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'AI 指令处理失败。'
      setError(message)
      setLastFailedCommand(submittedCommand)
      recordFailure({ errorCode: caught instanceof ProviderProxyClientError ? caught.code : 'unknown', failureStage: 'render', mode: 'assistant_answer', operation: 'global_ai_interaction' })
      appendConversationMessage({ text: message, tone: 'error', type: 'assistant' })
    } finally {
      setLoading(false)
    }
  }

  function prepareAiTripEdit(context: GlobalAiCommandContext, commandText: string, actionProposal?: GlobalAiActionProposal) {
    if (!context.trip) {
      setError('当前没有打开具体旅行。')
      setLastFailedCommand(commandText)
      recordFailure({ errorCode: 'missing_trip', failureStage: 'context', mode: 'action_proposal', operation: 'ai_trip_edit_plan' })
      return false
    }
    if (!providerConfig.configured || !providerConfig.proxyUrl) {
      setError('当前未配置 AI 修改服务。')
      setLastFailedCommand(commandText)
      recordFailure({ errorCode: 'provider_unconfigured', failureStage: 'provider', mode: 'action_proposal', operation: 'ai_trip_edit_plan' })
      return false
    }
    const contextResult = buildAiTripEditContext({
      days: context.days,
      items: context.items,
      privacy: getStoredAiPrivacySettings(),
      trip: context.trip,
    })
    if (!contextResult.ok) {
      setError(contextResult.errors.join(' '))
      setLastFailedCommand(commandText)
      recordFailure({ errorCode: 'context_invalid', failureStage: 'context', mode: 'action_proposal', operation: 'ai_trip_edit_plan' })
      return false
    }
    setPendingAi({
      actionProposal,
      baselineFingerprint: buildAiTripEditLocalStateFingerprint({
        days: context.days,
        items: context.items,
        trip: context.trip,
      }),
      command: commandText,
      context: contextResult.context,
      searchRequest: buildAiTripEditSearchRequest(commandText, contextResult.context),
      tripId: context.trip.id,
      warnings: contextResult.warnings,
    })
    setAiSendConfirmOpen(true)
    return true
  }

  async function resolveAssistantAnswer(answer: Extract<GlobalAiInteractionResult, { kind: 'assistant_answer' }>) {
    if (!providerConfig.configured || !providerConfig.proxyUrl) return answer
    try {
      const response = await fetchProviderProxyAssistantAnswer(answer.providerRequest, providerConfig.proxyUrl)
      return mergeAssistantAnswerProviderResponse(answer, response)
    } catch {
      return buildAssistantAnswerFallbackAfterError(answer)
    }
  }

  async function confirmAiSend() {
    if (!pendingAi || !providerConfig.proxyUrl) return
    setLoading(true)
    setError(null)
    setAiPreview(null)
    const warnings = [...pendingAi.warnings]
    let searchResults: ProviderProxyAiTripEditSearchSummary | null = null
    try {
      if (pendingAi.searchRequest) {
        try {
          const searchResponse = await fetchProviderProxyTravelSearch(pendingAi.searchRequest, providerConfig.proxyUrl)
          searchResults = summarizeTravelSearchResultsForPrompt(searchResponse)
          if (searchResults?.warnings?.length) warnings.push(...searchResults.warnings)
          if (!searchResults) warnings.push(NO_SEARCH_WARNING)
        } catch {
          warnings.push(NO_SEARCH_WARNING)
        }
      }
      const response = await fetchProviderProxyAiTripEditPlan({
        command: pendingAi.command,
        context: pendingAi.context,
        operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
        searchResults: searchResults ?? undefined,
      }, providerConfig.proxyUrl)
      setAiPreview({
        baselineFingerprint: pendingAi.baselineFingerprint,
        actionProposal: pendingAi.actionProposal,
        patchPlan: response.patchPlan,
        preview: buildAiTripEditPatchPreview(response.patchPlan, pendingAi.context),
        searchResults,
        tripId: pendingAi.tripId,
        warnings: Array.from(new Set([...warnings, ...(response.warnings ?? []), ...(response.patchPlan.warnings ?? [])])),
      })
      appendConversationMessage({
        sourceCardCount: pendingAi.actionProposal?.sourceCards.length,
        text: '已生成 AI 修改预览，确认前不会写入。',
        type: 'assistant',
      })
      setAiSendConfirmOpen(false)
    } catch (caught) {
      if (caught instanceof ProviderProxyClientError && caught.code === 'invalid_response') {
        try {
          const response = await fetchProviderProxyAiTripEditPlan({
            command: `${pendingAi.command}\n\n请只返回符合 TripMap patch schema 的 JSON，不要输出解释文字。`,
            context: pendingAi.context,
            operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
            searchResults: undefined,
          }, providerConfig.proxyUrl)
          setAiPreview({
            actionProposal: pendingAi.actionProposal,
            baselineFingerprint: pendingAi.baselineFingerprint,
            patchPlan: response.patchPlan,
            preview: buildAiTripEditPatchPreview(response.patchPlan, pendingAi.context),
            searchResults,
            tripId: pendingAi.tripId,
            warnings: Array.from(new Set([...warnings, 'AI 输出结构异常，已自动重试一次。', ...(response.warnings ?? []), ...(response.patchPlan.warnings ?? [])])),
          })
          recordFailure({ errorCode: 'invalid_response', failureStage: 'schema_validation', mode: 'action_proposal', operation: 'ai_trip_edit_plan' })
          appendConversationMessage({
            sourceCardCount: pendingAi.actionProposal?.sourceCards.length,
            text: 'AI 输出结构异常，已自动修复并生成预览。',
            type: 'assistant',
          })
          setAiSendConfirmOpen(false)
          return
        } catch {
          setError('我理解了你的需求，但没能生成可应用修改。你可以重新生成，或改成普通咨询。')
          setLastFailedCommand(pendingAi.command)
          recordFailure({ errorCode: 'invalid_response', failureStage: 'schema_validation', mode: 'action_proposal', operation: 'ai_trip_edit_plan' })
          appendConversationMessage({
            text: '我理解了你的需求，但没能生成可应用修改。你可以重新生成，或改成普通咨询。',
            tone: 'error',
            type: 'assistant',
          })
          setAiSendConfirmOpen(false)
          return
        }
      }
      setError(caught instanceof ProviderProxyClientError ? caught.message : 'AI 修改建议生成失败。')
      setLastFailedCommand(pendingAi.command)
      recordFailure({ errorCode: caught instanceof ProviderProxyClientError ? caught.code : 'unknown', failureStage: 'provider', mode: 'action_proposal', operation: 'ai_trip_edit_plan' })
      setAiSendConfirmOpen(false)
    } finally {
      setLoading(false)
    }
  }

  async function confirmAiApply() {
    if (!aiPreview) return
    setApplying(true)
    setError(null)
    try {
      const result = await applyAiTripEditPatchPlanToDb(aiPreview.tripId, aiPreview.patchPlan, {
        expectedBaselineFingerprint: aiPreview.baselineFingerprint,
      })
      if (!result.ok) {
        setError(result.errors.join(' '))
        setAiApplyConfirmOpen(false)
        return
      }
      await appendTripIntelligenceExecutionResult(aiPreview.tripId, {
        result: {
          appliedChanges: mapAiTripEditAppliedChanges(result.appliedChanges),
          message: `已应用 ${result.appliedOperationCount} 项 AI 修改。`,
          status: 'completed',
        },
        source: 'ai_trip_edit',
        suggestion: aiPreview.actionProposal?.suggestion,
        title: aiPreview.actionProposal?.title ?? 'AI 修改已应用',
      })
      setSuccess(`已应用 ${result.appliedOperationCount} 项修改。`)
      appendConversationMessage({ text: `已应用 ${result.appliedOperationCount} 项修改。`, tone: 'success', type: 'assistant' })
      clearInteraction()
      setAiApplyConfirmOpen(false)
    } catch {
      setError('应用 AI 修改方案失败。')
      recordFailure({ errorCode: 'write_failed', failureStage: 'write', mode: 'action_proposal', operation: 'ai_trip_edit_apply' })
      setAiApplyConfirmOpen(false)
    } finally {
      setApplying(false)
    }
  }

  async function confirmWrite() {
    if (!result) return
    setApplying(true)
    setError(null)
    try {
      if (result.kind === 'preference_preview') {
        const updated = await updateItineraryItem(result.item.id, { replanPreference: result.nextPreference })
        if (!updated) throw new Error('未找到行程点。')
        await appendTripIntelligenceExecutionResult(updated.tripId, {
          result: {
            appliedChanges: [buildPreferenceAppliedChange(updated.id, updated.title)],
            message: `已更新「${updated.title}」重排偏好。`,
            status: 'completed',
          },
          source: 'ai_trip_edit',
          suggestion: result.actionProposal?.suggestion,
          title: result.actionProposal?.title ?? '重排偏好已更新',
        })
        emitTravelDataChanged()
        setSuccess(`已更新「${result.item.title}」重排偏好。`)
        appendConversationMessage({ text: `已更新「${result.item.title}」重排偏好。`, tone: 'success', type: 'assistant' })
        clearInteraction()
      } else if (result.kind === 'replan_preview') {
        const record = await applyReplanPreview(result, selectedReplanOption)
        await appendTripIntelligenceExecutionResult(record.tripId, {
          result: {
            appliedChanges: [mapTripReplanAppliedChange(record, 'applied')],
            message: '已应用全局 AI 重排建议。',
            status: 'completed',
          },
          source: 'live',
          suggestion: result.actionProposal?.suggestion,
          title: result.actionProposal?.title ?? 'Live Mode 重排已应用',
        })
        setSuccess(result.hypothetical ? '已应用模拟重排，并保存为一次可撤销记录。' : '已应用突发重排，并保存为一次可撤销记录。')
        appendConversationMessage({ text: '已应用重排，并写入统一完成记录。', tone: 'success', type: 'assistant' })
        clearInteraction()
      }
      setWriteConfirmOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '写入失败。')
      recordFailure({ errorCode: 'write_failed', failureStage: 'write', mode: 'action_proposal', operation: 'global_ai_write' })
      setWriteConfirmOpen(false)
    } finally {
      setApplying(false)
    }
  }

  function clearInteraction() {
    setCommand('')
    setResult(null)
    setAiPreview(null)
    setPendingAi(null)
    setSelectedReplanOptionId(null)
  }

  function appendConversationMessage(input: Omit<ConversationMessage, 'createdAt' | 'id'>) {
    const now = Date.now()
    setConversation((current) => [
      ...current,
      {
        createdAt: now,
        id: `global-ai-message:${now}:${current.length}`,
        ...input,
      },
    ].slice(-12))
  }

  function recordFailure(input: Omit<GlobalAiFailureRecord, 'occurredAt' | 'schemaVersion'>) {
    setFailureRecords((current) => [
      ...current,
      {
        occurredAt: Date.now(),
        schemaVersion: 'global_ai_interaction.v1',
        ...input,
      },
    ].slice(-8))
  }

  function handleNavigation(result: Extract<GlobalAiInteractionResult, { kind: 'navigation' }> | Extract<GlobalAiInteractionResult, { kind: 'ledger_summary' }>) {
    if (result.kind === 'ledger_summary') {
      navigateTo('ledger', result.params)
      return
    }
    navigateTo(result.route, result.params)
    if (result.scrollTargetId) {
      window.setTimeout(() => {
        document.getElementById(result.scrollTargetId!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 250)
    }
  }

  return (
    <>
      <div
        className={`pointer-events-none absolute inset-x-3 z-40 mx-auto max-w-[576px] ${hasBottomTab ? 'bottom-[4.75rem]' : 'bottom-4'}`}
        data-testid="global-ai-command-bar"
      >
        {panelOpen ? (
          <div className="pointer-events-auto mb-2 max-h-[52dvh] overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface/95 p-3 shadow-[0_18px_44px_rgba(15,23,42,0.18)] backdrop-blur-xl app-scrollbar">
            {expanded ? (
              <ConversationPanel
                contextMode={contextMode}
                failureRecords={failureRecords}
                messages={conversation}
                onClear={() => {
                  setConversation([])
                  setFailureRecords([])
                  setError(null)
                  setSuccess(null)
                  setResult(null)
                  setAiPreview(null)
                }}
                onContextModeChange={setContextMode}
              />
            ) : null}
            {loading ? <StatusLine icon={<Loader2 className="size-4 animate-spin" />} text="正在处理指令…" /> : null}
            {error ? (
              <div className="space-y-2">
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</p>
                <FailureRecovery
                  canRetry={Boolean(lastFailedCommand)}
                  onClear={() => {
                    setError(null)
                    setLastFailedCommand(null)
                  }}
                  onConsult={() => lastFailedCommand && void runCommand(lastFailedCommand, { forceAssistant: true })}
                  onHome={() => navigateTo('home')}
                  onRetry={() => lastFailedCommand && void runCommand(lastFailedCommand)}
                />
              </div>
            ) : null}
            {success ? <StatusLine icon={<CheckCircle2 className="size-4" />} tone="success" text={success} /> : null}
            {result ? (
              <CommandResultView
                onNavigate={handleNavigation}
                onRequestWrite={() => setWriteConfirmOpen(true)}
                onSelectReplanOption={setSelectedReplanOptionId}
                result={result}
                selectedReplanOptionId={selectedReplanOptionId}
              />
            ) : null}
            {aiPreview ? (
              <AiPreviewView
                aiPreview={aiPreview}
                onApply={() => setAiApplyConfirmOpen(true)}
                onDiscard={() => setAiPreview(null)}
              />
            ) : null}
          </div>
        ) : null}

        <div className="pointer-events-none mb-1 flex max-w-full items-center gap-1.5 overflow-hidden px-1 text-[11px] font-semibold text-on-surface-variant" data-testid="global-ai-context-label">
          <span className="shrink-0">上下文</span>
          <span className="min-w-0 truncate rounded-lg bg-surface-container-high px-2 py-1 text-on-surface">{contextLabel}</span>
        </div>
        <form
          className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-2xl border border-outline-variant/35 bg-surface/95 px-2 py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)] backdrop-blur-xl"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <button
            aria-label={expanded ? '收起 AI 会话' : '展开 AI 会话'}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition active:scale-95"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? <ChevronDown className="size-4" /> : <MessagesSquare className="size-4" />}
          </button>
          <input
            aria-label="全局 AI 指令"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-sm font-medium text-on-surface outline-none placeholder:text-on-surface-variant/70"
            maxLength={1000}
            onChange={(event) => setCommand(event.currentTarget.value)}
            placeholder="问我改行程、重排、查账本…"
            value={command}
          />
          <button
            aria-label="发送 AI 指令"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary transition active:scale-95 disabled:opacity-50"
            disabled={!trimmedCommand || loading}
            type="submit"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
      </div>

      <ConfirmDialog
        body={pendingAi?.searchRequest
          ? '将把脱敏后的旅行上下文发送给 AI 服务；此指令可能需要一次来源搜索。搜索无来源时不会声明实时事实，结果只进入预览。'
          : '将把脱敏后的旅行上下文发送给 AI 服务。AI 只返回结构化修改预览，不会直接写入。'}
        cancelLabel="暂不发送"
        confirmLabel="确认发送"
        icon={<Bot className="size-5" />}
        loading={loading}
        onCancel={() => !loading && setAiSendConfirmOpen(false)}
        onConfirm={() => void confirmAiSend()}
        open={aiSendConfirmOpen}
        testId="global-ai-send-confirm-dialog"
        title="发送给 AI？"
      />
      <ConfirmDialog
        body="将把当前 AI 修改方案写入旅行。写入前会校验本地基线；行程已变化时会阻止应用。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<Wand2 className="size-5" />}
        loading={applying}
        onCancel={() => !applying && setAiApplyConfirmOpen(false)}
        onConfirm={() => void confirmAiApply()}
        open={aiApplyConfirmOpen}
        testId="global-ai-apply-confirm-dialog"
        title="应用 AI 修改？"
      />
      <ConfirmDialog
        body={buildWriteConfirmBody(result, selectedReplanOption)}
        cancelLabel="暂不写入"
        confirmLabel="确认写入"
        icon={<ShieldCheck className="size-5" />}
        loading={applying}
        onCancel={() => !applying && setWriteConfirmOpen(false)}
        onConfirm={() => void confirmWrite()}
        open={writeConfirmOpen}
        testId="global-ai-write-confirm-dialog"
        title="确认写入？"
      />
    </>
  )
}

function CommandResultView({
  onNavigate,
  onRequestWrite,
  onSelectReplanOption,
  result,
  selectedReplanOptionId,
}: {
  onNavigate: (result: Extract<GlobalAiInteractionResult, { kind: 'navigation' }> | Extract<GlobalAiInteractionResult, { kind: 'ledger_summary' }>) => void
  onRequestWrite: () => void
  onSelectReplanOption: (optionId: string) => void
  result: GlobalAiInteractionResult
  selectedReplanOptionId: string | null
}) {
  if (result.kind === 'help' || result.kind === 'assistant_answer') {
    return (
      <ResultShell icon={<Bot className="size-4" />} title={result.title}>
        <div className="space-y-1 text-xs leading-5 text-on-surface-variant" data-testid={result.kind === 'help' ? 'global-ai-help-result' : 'global-ai-assistant-answer-result'}>
          {result.answer.split('\n').map((line) => <p className="break-words [overflow-wrap:anywhere]" key={line}>{line}</p>)}
        </div>
        <SourceCards cards={result.sourceCards} />
        {result.caveats.length ? (
          <div className="space-y-1 rounded-xl bg-surface-container-high px-3 py-2 text-xs leading-5 text-on-surface-variant">
            {result.caveats.slice(0, 4).map((caveat) => <p key={caveat}>{caveat}</p>)}
          </div>
        ) : null}
      </ResultShell>
    )
  }

  if (result.kind === 'navigation') {
    return (
      <ResultShell icon={<Route className="size-4" />} title={result.title}>
        <p className="text-xs leading-5 tm-muted">{result.message}</p>
        <ActionProposalCard proposal={result.actionProposal} />
        <Button className="min-h-10 px-3 text-xs" onClick={() => onNavigate(result)} variant="secondary">{result.actionLabel}</Button>
      </ResultShell>
    )
  }

  if (result.kind === 'ledger_summary') {
    return (
      <ResultShell icon={<ReceiptText className="size-4" />} title={result.title}>
        <div className="space-y-1 text-xs leading-5 tm-muted">
          {result.lines.map((line) => <p key={line}>{line}</p>)}
        </div>
        <ActionProposalCard proposal={result.actionProposal} />
        <Button className="min-h-10 px-3 text-xs" onClick={() => onNavigate(result)} variant="secondary">{result.actionLabel}</Button>
      </ResultShell>
    )
  }

  if (result.kind === 'consultation') {
    return (
      <ResultShell icon={<Bot className="size-4" />} title={result.title}>
        <div className="space-y-1 text-xs leading-5 text-on-surface-variant" data-testid="global-ai-consultation-result">
          {result.lines.map((line) => <p className="break-words [overflow-wrap:anywhere]" key={line}>{line}</p>)}
        </div>
        {result.warnings.length ? (
          <div className="space-y-1 rounded-xl bg-surface-container-high px-3 py-2 text-xs leading-5 text-on-surface-variant">
            {result.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
        <ActionProposalCard proposal={result.actionProposal} />
      </ResultShell>
    )
  }

  if (result.kind === 'preference_preview') {
    return (
      <ResultShell icon={<ShieldCheck className="size-4" />} title={result.title}>
        <PreferenceChips preference={result.nextPreference} />
        <p className="text-xs leading-5 tm-muted">{result.message}</p>
        <ActionProposalCard proposal={result.actionProposal} />
        <Button className="min-h-10 px-3 text-xs" onClick={onRequestWrite} variant="secondary">确认保存偏好</Button>
      </ResultShell>
    )
  }

  if (result.kind === 'replan_preview') {
    const selectedOption = result.record.options.find((option) => option.id === selectedReplanOptionId) ?? result.record.options[0]
    return (
      <ResultShell icon={<Sparkles className="size-4" />} title={result.title}>
        <p className="text-xs leading-5 tm-muted">
          {result.targetItem ? `目标：${result.targetItem.title}` : '未锁定具体行程点，将按当前日期后续安排推演。'}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {result.record.options.map((option) => (
            <button
              className={`min-h-20 rounded-xl border px-3 py-2 text-left text-xs transition ${selectedOption?.id === option.id ? 'border-primary bg-primary/10 text-on-surface' : 'border-outline-variant/35 bg-surface-container text-on-surface-variant'}`}
              key={option.id}
              onClick={() => onSelectReplanOption(option.id)}
              type="button"
            >
              <span className="block font-semibold text-on-surface">{option.title}</span>
              <span className="mt-1 block leading-5">{option.summary}</span>
            </button>
          ))}
        </div>
        {selectedOption ? <ReplanDiffSummary diff={selectedOption.diff} /> : null}
        {result.warnings.length ? (
          <div className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            {Array.from(new Set(result.warnings)).slice(0, 5).map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
        <ActionProposalCard proposal={result.actionProposal} />
        <Button className="min-h-10 px-3 text-xs" disabled={!selectedOption} onClick={onRequestWrite} variant="secondary">确认应用重排</Button>
      </ResultShell>
    )
  }

  return null
}

function ConversationPanel({
  contextMode,
  failureRecords,
  messages,
  onClear,
  onContextModeChange,
}: {
  contextMode: GlobalAiInteractionContextMode
  failureRecords: GlobalAiFailureRecord[]
  messages: ConversationMessage[]
  onClear: () => void
  onContextModeChange: (mode: GlobalAiInteractionContextMode) => void
}) {
  return (
    <div className="mb-3 space-y-3 rounded-xl bg-surface-container px-3 py-3" data-testid="global-ai-conversation-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
          <Bot className="size-4 text-primary" />
          <span>AI 会话</span>
        </div>
        <button
          aria-label="清空 AI 会话"
          className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-high"
          onClick={onClear}
          type="button"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 text-xs font-semibold" data-testid="global-ai-context-switch">
        {([
          ['current_page', '当前页面'],
          ['account', '全部旅行'],
        ] as const).map(([mode, label]) => (
          <button
            className={`min-h-11 rounded-lg px-2 transition ${contextMode === mode ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant'}`}
            key={mode}
            onClick={() => onContextModeChange(mode)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-2" data-testid="global-ai-conversation-messages">
        {messages.length === 0 ? (
          <p className="rounded-xl bg-surface px-3 py-2 text-xs leading-5 tm-muted">本轮会话只保存在当前页面内，刷新后会清空。</p>
        ) : messages.slice(-6).map((message) => (
          <div
            className={`rounded-xl px-3 py-2 text-xs leading-5 ${message.type === 'user' ? 'bg-primary/10 text-on-surface' : message.tone === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200' : message.tone === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-surface text-on-surface-variant'}`}
            key={message.id}
          >
            <p className="mb-1 text-[11px] font-semibold">{message.type === 'user' ? '你' : '助手'}</p>
            <p className="line-clamp-4 break-words [overflow-wrap:anywhere]">{message.text}</p>
            {message.sourceCardCount ? <p className="mt-1 text-[11px] tm-muted">来源卡 {message.sourceCardCount} 张</p> : null}
          </div>
        ))}
      </div>
      {failureRecords.length > 0 ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" data-testid="global-ai-failure-count">
          本轮记录了 {failureRecords.length} 次脱敏失败计数，仅包含 operation、mode、阶段和错误码。
        </p>
      ) : null}
    </div>
  )
}

function FailureRecovery({
  canRetry,
  onClear,
  onConsult,
  onHome,
  onRetry,
}: {
  canRetry: boolean
  onClear: () => void
  onConsult: () => void
  onHome: () => void
  onRetry: () => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="global-ai-failure-recovery">
      <Button className="min-h-11 px-3 text-xs" disabled={!canRetry} icon={<RotateCcw className="size-4" />} onClick={onRetry} variant="secondary">重试</Button>
      <Button className="min-h-11 px-3 text-xs" disabled={!canRetry} icon={<Bot className="size-4" />} onClick={onConsult} variant="secondary">改为咨询</Button>
      <Button className="min-h-11 px-3 text-xs" icon={<Route className="size-4" />} onClick={onHome} variant="secondary">打开首页</Button>
      <Button className="min-h-11 px-3 text-xs" icon={<Trash2 className="size-4" />} onClick={onClear} variant="secondary">清除错误</Button>
    </div>
  )
}

function SourceCards({ cards }: { cards: Array<{ detail?: string; id: string; kind: string; title: string }> }) {
  if (cards.length === 0) return null
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="global-ai-source-cards">
      {cards.slice(0, 4).map((card) => (
        <div className="rounded-xl bg-surface-container-high px-3 py-2 text-xs leading-5" key={card.id}>
          <p className="font-semibold text-on-surface">{card.title}</p>
          {card.detail ? <p className="tm-muted">{card.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}

function AiPreviewView({
  aiPreview,
  onApply,
  onDiscard,
}: {
  aiPreview: AiTripEditPreviewState
  onApply: () => void
  onDiscard: () => void
}) {
  return (
    <ResultShell icon={<Wand2 className="size-4" />} title={aiPreview.patchPlan.summary}>
      <p className="text-xs leading-5 tm-muted">影响 {aiPreview.preview.affectedDayCount} 天、{aiPreview.preview.affectedItemCount} 个行程点，尚未写入。</p>
      <ul className="space-y-1 text-xs leading-5 text-on-surface-variant">
        {aiPreview.preview.lines.slice(0, 5).map((line) => <li className="break-words [overflow-wrap:anywhere]" key={line}>{line}</li>)}
      </ul>
      {aiPreview.searchResults?.results.length ? (
        <div className="space-y-1 rounded-xl bg-surface-container-high px-3 py-2 text-xs leading-5">
          <p className="font-semibold">来源</p>
          {aiPreview.searchResults.results.slice(0, 2).map((source) => (
            <p className="break-words tm-muted [overflow-wrap:anywhere]" key={`${source.url}:${source.retrievedAt}`}>{source.title} · {source.domain || source.displayUrl}</p>
          ))}
        </div>
      ) : null}
      {aiPreview.warnings.length ? (
        <div className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {aiPreview.warnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      <ActionProposalCard proposal={aiPreview.actionProposal} />
      <div className="grid grid-cols-2 gap-2">
        <Button className="min-h-10 px-3 text-xs" onClick={onDiscard} variant="secondary">放弃</Button>
        <Button className="min-h-10 px-3 text-xs" disabled={!aiPreview.preview.hasWritePayload} onClick={onApply}>应用修改</Button>
      </div>
    </ResultShell>
  )
}

function ActionProposalCard({ proposal }: { proposal?: GlobalAiActionProposal }) {
  if (!proposal) return null
  return (
    <div className="space-y-1 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5" data-testid="global-ai-action-proposal">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-on-surface [overflow-wrap:anywhere]">{proposal.title}</p>
          <p className="tm-muted">{proposal.message}</p>
        </div>
        <span className="shrink-0 rounded-lg bg-surface px-2 py-1 text-[11px] font-semibold text-primary">
          {proposal.requiresConfirmation ? '需确认' : '入口'}
        </span>
      </div>
      <p className="tm-muted">动作来源：Unified Intelligence · {proposal.actionLabel}</p>
    </div>
  )
}

function ResultShell({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <div className="space-y-3" data-testid="global-ai-command-result">
      <div className="flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{title}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function StatusLine({ icon, text, tone = 'muted' }: { icon: ReactNode; text: string; tone?: 'muted' | 'success' }) {
  return (
    <p className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold leading-5 ${tone === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-surface-container-high text-on-surface-variant'}`}>
      {icon}
      <span>{text}</span>
    </p>
  )
}

function PreferenceChips({ preference }: { preference: ItineraryReplanPreference }) {
  const chips = [
    preference.flexibility ? formatFlexibility(preference.flexibility) : '',
    preference.priority ? formatPriority(preference.priority) : '',
    preference.minimumStayMinutes ? `停留 ${preference.minimumStayMinutes} 分` : '',
    preference.bufferMinutes ? `缓冲 ${preference.bufferMinutes} 分` : '',
    preference.weatherSuitability ? formatWeather(preference.weatherSuitability) : '',
    preference.mobilitySuitability ? formatMobility(preference.mobilitySuitability) : '',
  ].filter(Boolean)
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => <span className="rounded-lg bg-surface-container-high px-2 py-1 text-[11px] font-semibold text-on-surface-variant" key={chip}>{chip}</span>)}
    </div>
  )
}

function ReplanDiffSummary({ diff }: { diff: TripReplanDiff }) {
  const changedItems = diff.itemChanges.filter((change) => change.changeType !== 'unchanged')
  return (
    <div className="space-y-2 text-xs leading-5">
      {changedItems.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {changedItems.slice(0, 4).map((change) => (
            <div className="rounded-xl bg-surface-container-high px-3 py-2" key={change.itemId}>
              <p className="font-semibold text-on-surface">{change.title}</p>
              <p className="tm-muted">{formatItemChange(change)}</p>
            </div>
          ))}
        </div>
      ) : <p className="rounded-xl bg-surface-container-high px-3 py-2 tm-muted">这个方案不会改动现有行程。</p>}
      {diff.ticketImpacts.length ? <p className="text-amber-700 dark:text-amber-200">{diff.ticketImpacts.map((impact) => impact.summary).join(' ')}</p> : null}
      {diff.ledgerImpacts.length ? <p className="text-amber-700 dark:text-amber-200">{diff.ledgerImpacts.map((impact) => impact.summary).join(' ')}</p> : null}
      {diff.companionImpacts.length ? <p className="text-primary">{diff.companionImpacts.map((impact) => impact.summary).join(' ')}</p> : null}
    </div>
  )
}

function formatItemChange(change: TripReplanDiff['itemChanges'][number]) {
  if (change.changeType === 'skipped') return '改为跳过'
  if (change.changeType === 'day_changed') return `移动日期：${change.before.dayId} -> ${change.after.dayId}`
  if (change.changeType === 'reordered') return `顺序：${change.before.sortOrder} -> ${change.after.sortOrder}`
  if (change.changeType === 'time_changed') {
    const before = [change.before.startTime, change.before.endTime].filter(Boolean).join('-') || '未定'
    const after = [change.after.startTime, change.after.endTime].filter(Boolean).join('-') || '未定'
    return `时间：${before} -> ${after}`
  }
  return '无变化'
}

async function applyReplanPreview(result: GlobalAiReplanPreviewResult, selectedOption: TripReplanOption | null): Promise<TripReplanRecord> {
  if (!selectedOption) throw new Error('请选择一个重排方案。')
  const event = await createTripDisruptionEvent(result.eventDraft)
  const record = await createTripReplanPreviewForEvent(event.id)
  const option = record.options.find((candidate) => candidate.strategy === selectedOption.strategy) ?? record.options[0]
  if (!option) throw new Error('没有可应用的重排方案。')
  return applyTripReplanOption(record.id, option.id)
}

function buildWriteConfirmBody(result: GlobalAiInteractionResult | null, selectedOption: TripReplanOption | null) {
  if (!result) return '确认写入当前预览。'
  if (result.kind === 'preference_preview') {
    return `将把重排偏好写入「${result.item.title}」。这只影响后续重排判断，不会立即改变行程时间。`
  }
  if (result.kind === 'replan_preview') {
    return `将创建突发事件和重排记录，并应用「${selectedOption?.title ?? '所选方案'}」。票据、账本和交通订单不会自动取消或退款，可整次撤销。`
  }
  return '确认写入当前预览。'
}

function summarizeInteractionResult(result: GlobalAiInteractionResult) {
  if (result.kind === 'help' || result.kind === 'assistant_answer') return result.answer
  if (result.kind === 'navigation') return result.message
  if (result.kind === 'ledger_summary') return result.lines.join(' ')
  if (result.kind === 'consultation') return result.lines.join(' ')
  if (result.kind === 'preference_preview') return `${result.title}：${result.message}`
  if (result.kind === 'replan_preview') return `${result.title}：${result.warnings[0] ?? '已生成预览，确认前不会写入。'}`
  if (result.kind === 'ai_trip_edit') return result.message
  return '已生成结果。'
}

function getInteractionSourceCardCount(result: GlobalAiInteractionResult) {
  if (result.kind === 'help' || result.kind === 'assistant_answer') return result.sourceCards.length
  return result.actionProposal?.sourceCards.length
}

function buildPreferenceAppliedChange(itemId: string, title: string): TripIntelligenceAppliedChange {
  const now = Date.now()
  return {
    actionType: 'global_ai_preference_updated',
    detail: '已更新重排偏好；不会立即改变现有行程时间。',
    id: `global-ai:preference:${hashString(`${itemId}:${now}`)}`,
    occurredAt: now,
    source: { id: 'global_ai_preference', kind: 'operations', label: 'Global AI' },
    targetId: itemId,
    targetType: 'item',
    title,
  }
}

function mapAiTripEditAppliedChanges(changes: AiTripEditAppliedChange[]): TripIntelligenceAppliedChange[] {
  const now = Date.now()
  return changes.map((change, index) => ({
    actionType: `global_ai_patch_${change.action}`,
    detail: '已通过 AI 修改预览写入，写入前经过用户确认。',
    id: `global-ai:patch:${hashString(`${change.action}:${change.itemId ?? change.dayId ?? index}:${change.title}:${now}`)}`,
    occurredAt: now,
    source: { id: 'ai_trip_edit', kind: 'operations', label: 'AI Trip Edit' },
    targetId: change.itemId ?? change.dayId,
    targetType: change.itemId ? 'item' : 'day',
    title: change.title,
  }))
}

function getRouteScopeFallback(route: RouteId) {
  if (route === 'inbox') return '旅行材料输入'
  if (route === 'ledger') return '账本'
  if (route === 'documents') return '资料'
  if (route === 'tickets') return '票据'
  if (route === 'day') return 'Day'
  if (route === 'item') return '当前行程点'
  if (route === 'trip') return '当前旅行'
  if (route === 'shared-trip') return '同行'
  return '全部旅行'
}

function hashString(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
