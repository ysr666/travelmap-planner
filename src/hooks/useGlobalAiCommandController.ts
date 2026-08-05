import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { createTripDisruptionEvent, updateItineraryItem } from '../db'
import {
  applyAiTripEditPatchPlanToDb,
  buildAiTripEditLocalStateFingerprint,
  type AiTripEditAppliedChange,
} from '../lib/ai/aiTripEditApply'
import { buildAiTripEditContext, type AiTripEditContext } from '../lib/ai/aiTripEditContext'
import { buildAiTripEditPatchPreview } from '../lib/ai/aiTripEditPatch'
import { buildAiTripEditSearchRequest, summarizeTravelSearchResultsForPrompt } from '../lib/ai/aiTripEditSearch'
import { getStoredAiPrivacySettings } from '../lib/ai/aiPrivacy'
import {
  buildAiActionPlanProviderRequest,
  buildDeterministicAiActionPlan,
  executeAiActionPlan,
  prepareAiActionPlan,
  shouldRequestAiActionPlan,
  summarizePreparedAiActionPlan,
  validateAiActionPlanCommandBinding,
  type AiActionGatewayRuntimeContext,
  type AiActionManualEntry,
  type AiActionPreparedPlan,
  type AiActionRunEffect,
} from '../lib/ai/actionGateway'
import type { GlobalAiCommandContext, GlobalAiReplanPreviewResult } from '../lib/ai/globalAiCommandRouter'
import {
  buildAssistantAnswerFallbackAfterError,
  loadGlobalAiInteractionContext,
  mergeAssistantAnswerProviderResponse,
  resolveGlobalAiInteraction,
  type GlobalAiActionProposal,
  type GlobalAiFailureRecord,
  type GlobalAiInteractionContextMode,
  type GlobalAiInteractionResult,
} from '../lib/ai/globalAiInteraction'
import {
  PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
  type ProviderProxyAiTripEditSearchSummary,
  type ProviderProxyTravelSearchRequest,
} from '../lib/ai/providerProxyContract'
import { applyTripReplanOption, createTripReplanPreviewForEvent } from '../lib/adaptiveReplanning'
import { emitTravelDataChanged } from '../lib/dataEvents'
import {
  fetchProviderProxyAiActionPlan,
  fetchProviderProxyAiTripEditPlan,
  fetchProviderProxyAssistantAnswer,
  fetchProviderProxyTravelSearch,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../lib/providerProxyClient'
import { navigateTo } from '../lib/routes'
import {
  appendTripIntelligenceExecutionResult,
  mapTripReplanAppliedChange,
  type TripIntelligenceAppliedChange,
} from '../lib/tripIntelligence'
import type { RouteId, TripReplanOption, TripReplanRecord } from '../types'
import type { AiActionGatewayState, AiTripEditPreviewState, ConversationMessage } from '../components/ai/GlobalAiCommandViews'

type UseGlobalAiCommandControllerInput = {
  activeRoute: RouteId
  commandRef: RefObject<HTMLTextAreaElement | null>
  fallbackTripId?: string | null
  initialCommand?: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
  sheetRef: RefObject<HTMLDivElement | null>
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

const HIDDEN_ROUTES = new Set<RouteId>([
  'item/edit',
  'item/new',
  'ledger/expense',
  'shared-trip',
  'trip/edit',
  'trip/new',
])

const NO_SEARCH_WARNING = '没有可用来源时不会声明实时事实；本次未取得来源结果。'

export function useGlobalAiCommandController({
  activeRoute,
  commandRef,
  fallbackTripId,
  initialCommand,
  onOpenChange,
  open,
  sheetRef,
}: UseGlobalAiCommandControllerInput) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [command, setCommand] = useState(initialCommand ?? '')
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
  const [actionGateway, setActionGateway] = useState<AiActionGatewayState | null>(null)
  const actionGatewayBusyRef = useRef(false)
  const actionGatewayRef = useRef<AiActionGatewayState | null>(null)
  const initialCommandSubmittedRef = useRef(false)
  actionGatewayRef.current = actionGateway

  const trimmedCommand = command.trim()
  const selectedReplanOption = result?.kind === 'replan_preview'
    ? result.record.options.find((option) => option.id === selectedReplanOptionId) ?? result.record.options[0]
    : null
  const hasOutput = Boolean(expanded || error || success || result || aiPreview || actionGateway || loading)
  const dismissPanel = useCallback(() => {
    setExpanded(false)
    setError(null)
    setSuccess(null)
    setResult(null)
    setAiPreview(null)
    setActionGateway(null)
    setLastFailedCommand(null)
    onOpenChange(false)
  }, [onOpenChange])

  useEffect(() => {
    let cancelled = false
    async function refreshContextLabel() {
      try {
        const context = await loadGlobalAiInteractionContext(
          contextMode === 'account' ? 'home' : activeRoute,
          getGlobalAiContextHash(contextMode, window.location.hash, fallbackTripId),
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
  }, [activeRoute, contextMode, fallbackTripId])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      commandRef.current?.focus()
      if (initialCommand && !initialCommandSubmittedRef.current) {
        initialCommandSubmittedRef.current = true
        commandRef.current?.form?.requestSubmit()
      }
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (aiSendConfirmOpen || aiApplyConfirmOpen || writeConfirmOpen) return
        event.preventDefault()
        dismissPanel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusableElements(sheetRef.current)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [aiApplyConfirmOpen, aiSendConfirmOpen, commandRef, dismissPanel, initialCommand, open, sheetRef, writeConfirmOpen])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runCommand(trimmedCommand)
  }

  async function runCommand(commandText: string, options: { forceAssistant?: boolean } = {}) {
    const submittedCommand = commandText.trim()
    if (!submittedCommand || loading || applying) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    setResult(null)
    setAiPreview(null)
    setActionGateway(null)
    setLastFailedCommand(null)
    appendConversationMessage({ text: submittedCommand, type: 'user' })
    try {
      const context = await loadGlobalAiInteractionContext(
        contextMode === 'account' ? 'home' : activeRoute,
        getGlobalAiContextHash(contextMode, window.location.hash, fallbackTripId),
      )
      setContextLabel(context.scopeLabel)
      if (!options.forceAssistant) {
        const actionPlan = await resolveActionGatewayPlan(submittedCommand, context)
        if (actionPlan) {
          const runtimeContext: AiActionGatewayRuntimeContext = {
            command: submittedCommand,
            commandContext: context,
            providerConfig,
          }
          const prepared = await prepareAiActionPlan(actionPlan, runtimeContext)
          const summary = summarizePreparedAiActionPlan(prepared)
          if (summary.readyCount === 0) {
            throw new Error(prepared.steps.find((step) => step.error)?.error ?? '没有可执行的动作。')
          }
          if (!prepared.plan.requiresConfirmation) {
            const actionRun = await executeAiActionPlan(prepared, runtimeContext)
            appendConversationMessage({
              text: actionRun.message,
              tone: actionRun.status === 'completed' ? 'success' : 'error',
              type: 'assistant',
            })
            const navigated = applyActionEffects(actionRun.effects)
            if (actionRun.status !== 'completed' || actionRun.effects.length === 0) {
              setActionGateway({
                attemptCount: 1,
                command: submittedCommand,
                completedStepIds: actionRun.completedStepIds,
                context: runtimeContext,
                prepared,
                run: actionRun,
                writeConfirmed: false,
              })
            } else {
              setCommand('')
              if (navigated) dismissPanel()
            }
          } else {
            setActionGateway({
              attemptCount: 0,
              command: submittedCommand,
              completedStepIds: [],
              context: runtimeContext,
              prepared,
              run: null,
              writeConfirmed: false,
            })
            appendConversationMessage({ text: `${prepared.plan.summary}已准备好，确认后执行。`, type: 'assistant' })
          }
          return
        }
      }
      const resolved = await resolveGlobalAiInteraction(submittedCommand, context, {
        forceMode: options.forceAssistant ? 'assistant_answer' : undefined,
      })
      if (resolved.kind === 'ai_trip_edit') {
        if (prepareAiTripEdit(context, submittedCommand, resolved.actionProposal)) {
          appendConversationMessage({
            sourceCardCount: resolved.actionProposal?.sourceCards.length,
            text: '确认后我来生成修改方案。',
            type: 'assistant',
          })
        }
      } else if (resolved.kind === 'assistant_answer') {
        const answer = await resolveAssistantAnswer(resolved)
        setResult(answer)
        appendConversationMessage({ sourceCardCount: answer.sourceCards.length, text: answer.answer, type: 'assistant' })
      } else {
        setSelectedReplanOptionId(resolved.kind === 'replan_preview' ? resolved.record.options[0]?.id ?? null : null)
        setResult(resolved)
        appendConversationMessage({
          sourceCardCount: getInteractionSourceCardCount(resolved),
          text: summarizeInteractionResult(resolved),
          type: 'assistant',
        })
        if (shouldAutoExecuteNavigation(resolved)) {
          window.setTimeout(() => {
            handleNavigation(resolved)
            setCommand('')
            dismissPanel()
          }, 0)
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'AI 指令处理失败。'
      setError(message)
      setLastFailedCommand(submittedCommand)
      recordFailure({
        errorCode: caught instanceof ProviderProxyClientError ? caught.code : 'unknown',
        failureStage: 'render',
        mode: 'assistant_answer',
        operation: 'global_ai_interaction',
      })
      appendConversationMessage({ text: message, tone: 'error', type: 'assistant' })
    } finally {
      setLoading(false)
    }
  }

  async function resolveActionGatewayPlan(
    submittedCommand: string,
    context: Awaited<ReturnType<typeof loadGlobalAiInteractionContext>>,
  ) {
    const deterministic = buildDeterministicAiActionPlan(submittedCommand)
    if (deterministic) return deterministic
    if (!shouldRequestAiActionPlan(submittedCommand)) return null
    if (!providerConfig.configured || !providerConfig.proxyUrl) {
      throw new Error('当前 AI 动作规划服务不可用。')
    }
    const request = buildAiActionPlanProviderRequest(submittedCommand, context, getStoredAiPrivacySettings())
    const response = await fetchProviderProxyAiActionPlan(request, providerConfig.proxyUrl)
    const binding = validateAiActionPlanCommandBinding(submittedCommand, response.plan)
    if (!binding.ok) throw new Error('AI 动作与指令不一致，请把要执行的操作说得更明确。')
    return response.plan
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
        actionProposal: pendingAi.actionProposal,
        baselineFingerprint: pendingAi.baselineFingerprint,
        patchPlan: response.patchPlan,
        preview: buildAiTripEditPatchPreview(response.patchPlan, pendingAi.context),
        searchResults,
        tripId: pendingAi.tripId,
        warnings: Array.from(new Set([...warnings, ...(response.warnings ?? []), ...(response.patchPlan.warnings ?? [])])),
      })
      appendConversationMessage({
        sourceCardCount: pendingAi.actionProposal?.sourceCards.length,
        text: '修改方案已准备好，确认后写入。',
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
            warnings: Array.from(new Set([
              ...warnings,
              'AI 输出结构异常，已自动重试一次。',
              ...(response.warnings ?? []),
              ...(response.patchPlan.warnings ?? []),
            ])),
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
          const message = '我理解了你的需求，但没能生成可应用修改。你可以重新生成，或改成普通咨询。'
          setError(message)
          setLastFailedCommand(pendingAi.command)
          recordFailure({ errorCode: 'invalid_response', failureStage: 'schema_validation', mode: 'action_proposal', operation: 'ai_trip_edit_plan' })
          appendConversationMessage({ text: message, tone: 'error', type: 'assistant' })
          setAiSendConfirmOpen(false)
          return
        }
      }
      setError(caught instanceof ProviderProxyClientError ? caught.message : 'AI 修改建议生成失败。')
      setLastFailedCommand(pendingAi.command)
      recordFailure({
        errorCode: caught instanceof ProviderProxyClientError ? caught.code : 'unknown',
        failureStage: 'provider',
        mode: 'action_proposal',
        operation: 'ai_trip_edit_plan',
      })
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
      const applyResult = await applyAiTripEditPatchPlanToDb(aiPreview.tripId, aiPreview.patchPlan, {
        expectedBaselineFingerprint: aiPreview.baselineFingerprint,
      })
      if (!applyResult.ok) {
        setError(applyResult.errors.join(' '))
        setAiApplyConfirmOpen(false)
        return
      }
      await appendTripIntelligenceExecutionResult(aiPreview.tripId, {
        result: {
          appliedChanges: mapAiTripEditAppliedChanges(applyResult.appliedChanges),
          message: `已应用 ${applyResult.appliedOperationCount} 项 AI 修改。`,
          status: 'completed',
        },
        source: 'ai_trip_edit',
        suggestion: aiPreview.actionProposal?.suggestion,
        title: aiPreview.actionProposal?.title ?? 'AI 修改已应用',
      })
      setSuccess(`已应用 ${applyResult.appliedOperationCount} 项修改。`)
      appendConversationMessage({ text: `已应用 ${applyResult.appliedOperationCount} 项修改。`, tone: 'success', type: 'assistant' })
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
        if (result.hypothetical) throw new Error('模拟预览只读，不会写入旅行。')
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

  async function confirmActionGateway() {
    if (!actionGateway || applying || loading || actionGatewayBusyRef.current) return
    const executionId = actionGateway.prepared.executionId
    actionGatewayBusyRef.current = true
    setApplying(true)
    setError(null)
    try {
      const actionRun = await executeAiActionPlan(
        actionGateway.prepared,
        actionGateway.context,
        { completedStepIds: actionGateway.completedStepIds },
      )
      setActionGateway((current) => current?.prepared.executionId === executionId ? {
        ...current,
        attemptCount: current.attemptCount + 1,
        completedStepIds: actionRun.completedStepIds,
        run: actionRun,
        writeConfirmed: true,
      } : current)
      appendConversationMessage({
        text: actionRun.message,
        tone: actionRun.status === 'completed' ? 'success' : actionRun.status === 'failed' ? 'error' : 'normal',
        type: 'assistant',
      })
      const navigated = applyActionEffects(actionRun.effects)
      if (actionRun.status === 'completed' && actionRun.effects.length > 0) {
        setCommand('')
        setActionGateway((current) => current?.prepared.executionId === executionId ? null : current)
        setExpanded(false)
        if (navigated) dismissPanel()
      }
    } catch (caught) {
      if (actionGatewayRef.current?.prepared.executionId === executionId) {
        setError(caught instanceof Error ? caught.message : '动作执行失败。')
      }
    } finally {
      actionGatewayBusyRef.current = false
      setApplying(false)
    }
  }

  async function retryActionGateway() {
    const gatewaySnapshot = actionGateway
    if (!gatewaySnapshot?.run || loading || applying || actionGatewayBusyRef.current) return
    const executionId = gatewaySnapshot.prepared.executionId
    actionGatewayBusyRef.current = true
    setLoading(true)
    setError(null)
    try {
      const freshContext = await loadGlobalAiInteractionContext(
        contextMode === 'account' ? 'home' : activeRoute,
        getGlobalAiContextHash(contextMode, window.location.hash, fallbackTripId),
      )
      const runtimeContext: AiActionGatewayRuntimeContext = {
        command: gatewaySnapshot.command,
        commandContext: freshContext,
        providerConfig,
      }
      const completedStepIds = gatewaySnapshot.completedStepIds
      const prepared = await prepareAiActionPlan(gatewaySnapshot.prepared.plan, runtimeContext, {
        completedStepIds,
        executionId,
      })
      const needsFreshConfirmation = prepared.plan.requiresConfirmation && (
        gatewaySnapshot.run.requiresFreshConfirmation
        || !gatewaySnapshot.writeConfirmed
        || hasNewWritePreview(gatewaySnapshot.prepared, prepared, gatewaySnapshot.run.failedStepIds)
      )
      if (actionGatewayRef.current?.prepared.executionId !== executionId) return
      if (needsFreshConfirmation) {
        setActionGateway((current) => current?.prepared.executionId === executionId ? {
          ...current,
          completedStepIds,
          context: runtimeContext,
          prepared,
          run: null,
          writeConfirmed: false,
        } : current)
        return
      }
      const actionRun = await executeAiActionPlan(prepared, runtimeContext, { completedStepIds })
      if (actionGatewayRef.current?.prepared.executionId !== executionId) return
      setActionGateway((current) => current?.prepared.executionId === executionId ? {
        ...current,
        attemptCount: current.attemptCount + 1,
        completedStepIds: actionRun.completedStepIds,
        context: runtimeContext,
        prepared,
        run: actionRun,
      } : current)
      appendConversationMessage({
        text: actionRun.message,
        tone: actionRun.status === 'completed' ? 'success' : actionRun.status === 'failed' ? 'error' : 'normal',
        type: 'assistant',
      })
      const navigated = applyActionEffects(actionRun.effects)
      if (actionRun.status === 'completed' && actionRun.effects.length > 0) {
        setCommand('')
        setActionGateway((current) => current?.prepared.executionId === executionId ? null : current)
        setExpanded(false)
        if (navigated) dismissPanel()
      }
    } catch (caught) {
      if (actionGatewayRef.current?.prepared.executionId === executionId) {
        setError(caught instanceof Error ? caught.message : '重试失败项时出错。')
      }
    } finally {
      actionGatewayBusyRef.current = false
      setLoading(false)
    }
  }

  function clearInteraction() {
    setCommand('')
    setResult(null)
    setAiPreview(null)
    setActionGateway(null)
    setPendingAi(null)
    setSelectedReplanOptionId(null)
  }

  function appendConversationMessage(input: Omit<ConversationMessage, 'createdAt' | 'id'>) {
    const now = Date.now()
    setConversation((current) => [
      ...current,
      { createdAt: now, id: `global-ai-message:${now}:${current.length}`, ...input },
    ].slice(-12))
  }

  function recordFailure(input: Omit<GlobalAiFailureRecord, 'occurredAt' | 'schemaVersion'>) {
    setFailureRecords((current) => [
      ...current,
      { occurredAt: Date.now(), schemaVersion: 'global_ai_interaction.v1', ...input },
    ].slice(-8))
  }

  function handleNavigation(navigationResult: Extract<GlobalAiInteractionResult, { kind: 'navigation' }> | Extract<GlobalAiInteractionResult, { kind: 'ledger_summary' }>) {
    if (navigationResult.kind === 'ledger_summary') {
      navigateTo('ledger', navigationResult.params)
      dismissPanel()
      return
    }
    navigateTo(navigationResult.route, navigationResult.params)
    if (navigationResult.scrollTargetId) scrollToNavigationTarget(navigationResult.scrollTargetId)
    dismissPanel()
  }

  function clearConversation() {
    setConversation([])
    setFailureRecords([])
    setError(null)
    setSuccess(null)
    setResult(null)
    setAiPreview(null)
    setActionGateway(null)
  }

  function clearFailure() {
    setError(null)
    setLastFailedCommand(null)
  }

  return {
    actionGateway,
    aiApplyConfirmOpen,
    aiPreview,
    aiSendConfirmOpen,
    applying,
    clearConversation,
    clearFailure,
    closeAiApplyConfirm: () => { if (!applying) setAiApplyConfirmOpen(false) },
    closeAiSendConfirm: () => { if (!loading) setAiSendConfirmOpen(false) },
    closeWriteConfirm: () => { if (!applying) setWriteConfirmOpen(false) },
    command,
    confirmActionGateway,
    confirmAiApply,
    confirmAiSend,
    confirmWrite,
    contextLabel,
    contextMode,
    conversation,
    dismissPanel,
    discardAiPreview: () => setAiPreview(null),
    error,
    expanded,
    failureRecords,
    goHome: () => navigateTo('home'),
    handleNavigation,
    handleSubmit,
    hasOutput,
    hidden: HIDDEN_ROUTES.has(activeRoute),
    lastFailedCommand,
    loading,
    manualEntry: (entry: AiActionManualEntry) => applyActionEffects([entry]),
    pendingAiUsesSearch: Boolean(pendingAi?.searchRequest),
    requestAiApply: () => setAiApplyConfirmOpen(true),
    requestWrite: () => setWriteConfirmOpen(true),
    retryActionGateway,
    retryLastFailure: () => { if (lastFailedCommand) void runCommand(lastFailedCommand) },
    runLastFailureAsConsultation: () => { if (lastFailedCommand) void runCommand(lastFailedCommand, { forceAssistant: true }) },
    selectedReplanOptionId,
    setCommand,
    setContextMode,
    setExpanded,
    setSelectedReplanOptionId,
    success,
    toggleContextMode: () => setContextMode((mode) => mode === 'current_page' ? 'account' : 'current_page'),
    trimmedCommand,
    writeConfirmBody: buildWriteConfirmBody(result, selectedReplanOption),
    writeConfirmOpen,
    result,
  }
}

function hasNewWritePreview(previous: AiActionPreparedPlan, next: AiActionPreparedPlan, failedStepIds: string[]) {
  const failedIds = new Set(failedStepIds)
  return next.steps.some((step) => {
    if (!failedIds.has(step.id) || step.status !== 'prepared' || !step.hasWrite) return false
    const previousStep = previous.steps.find((candidate) => candidate.id === step.id)
    return (
      !previousStep
      || previousStep.status !== 'prepared'
      || !previousStep.hasWrite
      || previousStep.confirmationFingerprint !== step.confirmationFingerprint
      || previousStep.preview !== step.preview
      || previousStep.affectedLabels.join('\u0000') !== step.affectedLabels.join('\u0000')
    )
  })
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
  if (!result) return '确认后写入当前方案。'
  if (result.kind === 'preference_preview') return `将把重排偏好写入「${result.item.title}」。`
  if (result.kind === 'replan_preview') return `将应用「${selectedOption?.title ?? '所选方案'}」。票据、账本和交通订单不会自动取消。`
  return '确认后写入当前方案。'
}

function summarizeInteractionResult(result: GlobalAiInteractionResult) {
  if (result.kind === 'help' || result.kind === 'assistant_answer') return result.answer
  if (result.kind === 'navigation') return result.message
  if (result.kind === 'ledger_summary' || result.kind === 'consultation') return result.lines.join(' ')
  if (result.kind === 'preference_preview') return `${result.title}：${result.message}`
  if (result.kind === 'replan_preview') return `${result.title}：${result.warnings[0] ?? '方案已准备好，确认后写入。'}`
  if (result.kind === 'ai_trip_edit') return result.message
  return '已生成结果。'
}

function shouldAutoExecuteNavigation(result: GlobalAiInteractionResult): result is Extract<GlobalAiInteractionResult, { kind: 'navigation' }> {
  return result.kind === 'navigation' && result.autoExecute === true
}

function getInteractionSourceCardCount(result: GlobalAiInteractionResult) {
  if (result.kind === 'help' || result.kind === 'assistant_answer') return result.sourceCards.length
  return result.actionProposal?.sourceCards.length
}

function applyActionEffects(effects: AiActionRunEffect[]) {
  let navigated = false
  for (const effect of effects) {
    if (effect.kind !== 'navigate') continue
    navigated = true
    navigateTo(effect.route, effect.params)
    if (effect.scrollTargetId) scrollToNavigationTarget(effect.scrollTargetId)
  }
  return navigated
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
}

function scrollToNavigationTarget(targetId: string, attempt = 0) {
  const target = document.getElementById(targetId)
  if (target) {
    let ancestor = target.parentElement
    while (ancestor) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      ancestor = ancestor.parentElement
    }
    window.requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return
  }
  if (attempt >= 29) return
  window.setTimeout(() => scrollToNavigationTarget(targetId, attempt + 1), 100)
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
    detail: '已通过 AI 修改方案写入。',
    id: `global-ai:patch:${hashString(`${change.action}:${change.itemId ?? change.dayId ?? index}:${change.title}:${now}`)}`,
    occurredAt: now,
    source: { id: 'ai_trip_edit', kind: 'operations', label: 'AI Trip Edit' },
    targetId: change.itemId ?? change.dayId,
    targetType: change.itemId ? 'item' : 'day',
    title: change.title,
  }))
}

function getGlobalAiContextHash(
  contextMode: GlobalAiInteractionContextMode,
  currentHash: string,
  fallbackTripId?: string | null,
) {
  if (contextMode === 'account') return '#/home'
  if (!fallbackTripId) return currentHash
  const [path = '#/home', query = ''] = currentHash.split('?')
  const params = new URLSearchParams(query)
  if (params.has('tripId')) return currentHash
  params.set('tripId', fallbackTripId)
  return `${path || '#/home'}?${params.toString()}`
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
