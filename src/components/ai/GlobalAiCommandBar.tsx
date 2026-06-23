import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Bot, CheckCircle2, Loader2, ReceiptText, Route, Send, ShieldCheck, Sparkles, Wand2 } from 'lucide-react'
import { createTripDisruptionEvent, updateItineraryItem } from '../../db'
import { applyAiTripEditPatchPlanToDb, buildAiTripEditLocalStateFingerprint } from '../../lib/ai/aiTripEditApply'
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
  loadGlobalAiCommandContext,
  resolveGlobalAiCommand,
  type GlobalAiCommandContext,
  type GlobalAiCommandResult,
  type GlobalAiReplanPreviewResult,
} from '../../lib/ai/globalAiCommandRouter'
import { PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION, type ProviderProxyAiTripEditSearchSummary, type ProviderProxyTravelSearchRequest } from '../../lib/ai/providerProxyContract'
import { applyTripReplanOption, createTripReplanPreviewForEvent } from '../../lib/adaptiveReplanning'
import { emitTravelDataChanged } from '../../lib/dataEvents'
import { navigateTo } from '../../lib/routes'
import {
  fetchProviderProxyAiTripEditPlan,
  fetchProviderProxyTravelSearch,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import type { ItineraryReplanPreference, RouteId, TripReplanDiff, TripReplanOption } from '../../types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type GlobalAiCommandBarProps = {
  activeRoute: RouteId
  hasBottomTab: boolean
}

type PendingAiTripEdit = {
  baselineFingerprint: string
  command: string
  context: AiTripEditContext
  searchRequest: ProviderProxyTravelSearchRequest | null
  tripId: string
  warnings: string[]
}

type AiTripEditPreviewState = {
  baselineFingerprint: string
  patchPlan: AiTripEditPatchPlan
  preview: AiTripEditPatchPreview
  searchResults: ProviderProxyAiTripEditSearchSummary | null
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

export function GlobalAiCommandBar({ activeRoute, hasBottomTab }: GlobalAiCommandBarProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [command, setCommand] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [result, setResult] = useState<GlobalAiCommandResult | null>(null)
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
  const panelOpen = Boolean(error || success || result || aiPreview || loading)

  if (hidden) return null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmedCommand || loading) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    setResult(null)
    setAiPreview(null)
    try {
      const context = await loadGlobalAiCommandContext(activeRoute)
      const resolved = await resolveGlobalAiCommand(trimmedCommand, context)
      if (resolved.kind === 'ai_trip_edit') {
        prepareAiTripEdit(context)
      } else {
        setSelectedReplanOptionId(resolved.kind === 'replan_preview' ? resolved.record.options[0]?.id ?? null : null)
        setResult(resolved)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI 指令处理失败。')
    } finally {
      setLoading(false)
    }
  }

  function prepareAiTripEdit(context: GlobalAiCommandContext) {
    if (!context.trip) {
      setError('当前没有打开具体旅行。')
      return
    }
    if (!providerConfig.configured || !providerConfig.proxyUrl) {
      setError('当前未配置 AI 修改服务。')
      return
    }
    const contextResult = buildAiTripEditContext({
      days: context.days,
      items: context.items,
      privacy: getStoredAiPrivacySettings(),
      trip: context.trip,
    })
    if (!contextResult.ok) {
      setError(contextResult.errors.join(' '))
      return
    }
    setPendingAi({
      baselineFingerprint: buildAiTripEditLocalStateFingerprint({
        days: context.days,
        items: context.items,
        trip: context.trip,
      }),
      command: trimmedCommand,
      context: contextResult.context,
      searchRequest: buildAiTripEditSearchRequest(trimmedCommand, contextResult.context),
      tripId: context.trip.id,
      warnings: contextResult.warnings,
    })
    setAiSendConfirmOpen(true)
  }

  async function confirmAiSend() {
    if (!pendingAi || !providerConfig.proxyUrl) return
    setLoading(true)
    setError(null)
    setAiPreview(null)
    try {
      const warnings = [...pendingAi.warnings]
      let searchResults: ProviderProxyAiTripEditSearchSummary | null = null
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
        patchPlan: response.patchPlan,
        preview: buildAiTripEditPatchPreview(response.patchPlan, pendingAi.context),
        searchResults,
        tripId: pendingAi.tripId,
        warnings: Array.from(new Set([...warnings, ...(response.warnings ?? []), ...(response.patchPlan.warnings ?? [])])),
      })
      setAiSendConfirmOpen(false)
    } catch (caught) {
      setError(caught instanceof ProviderProxyClientError ? caught.message : 'AI 修改建议生成失败。')
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
      setSuccess(`已应用 ${result.appliedOperationCount} 项修改。`)
      clearInteraction()
      setAiApplyConfirmOpen(false)
    } catch {
      setError('应用 AI 修改方案失败。')
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
        emitTravelDataChanged()
        setSuccess(`已更新「${result.item.title}」重排偏好。`)
        clearInteraction()
      } else if (result.kind === 'replan_preview') {
        await applyReplanPreview(result, selectedReplanOption)
        setSuccess(result.hypothetical ? '已应用模拟重排，并保存为一次可撤销记录。' : '已应用突发重排，并保存为一次可撤销记录。')
        clearInteraction()
      }
      setWriteConfirmOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '写入失败。')
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

  function handleNavigation(result: Extract<GlobalAiCommandResult, { kind: 'navigation' }> | Extract<GlobalAiCommandResult, { kind: 'ledger_summary' }>) {
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
        className={`absolute inset-x-3 z-40 mx-auto max-w-[576px] ${hasBottomTab ? 'bottom-[4.75rem]' : 'bottom-4'}`}
        data-testid="global-ai-command-bar"
      >
        {panelOpen ? (
          <div className="mb-2 max-h-[52dvh] overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface/95 p-3 shadow-[0_18px_44px_rgba(15,23,42,0.18)] backdrop-blur-xl app-scrollbar">
            {loading ? <StatusLine icon={<Loader2 className="size-4 animate-spin" />} text="正在处理指令…" /> : null}
            {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</p> : null}
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

        <form
          className="flex min-h-12 items-center gap-2 rounded-2xl border border-outline-variant/35 bg-surface/95 px-2 py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)] backdrop-blur-xl"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
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
  onNavigate: (result: Extract<GlobalAiCommandResult, { kind: 'navigation' }> | Extract<GlobalAiCommandResult, { kind: 'ledger_summary' }>) => void
  onRequestWrite: () => void
  onSelectReplanOption: (optionId: string) => void
  result: GlobalAiCommandResult
  selectedReplanOptionId: string | null
}) {
  if (result.kind === 'navigation') {
    return (
      <ResultShell icon={<Route className="size-4" />} title={result.title}>
        <p className="text-xs leading-5 tm-muted">{result.message}</p>
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
      </ResultShell>
    )
  }

  if (result.kind === 'preference_preview') {
    return (
      <ResultShell icon={<ShieldCheck className="size-4" />} title={result.title}>
        <PreferenceChips preference={result.nextPreference} />
        <p className="text-xs leading-5 tm-muted">{result.message}</p>
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
        <Button className="min-h-10 px-3 text-xs" disabled={!selectedOption} onClick={onRequestWrite} variant="secondary">确认应用重排</Button>
      </ResultShell>
    )
  }

  return null
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
      <div className="grid grid-cols-2 gap-2">
        <Button className="min-h-10 px-3 text-xs" onClick={onDiscard} variant="secondary">放弃</Button>
        <Button className="min-h-10 px-3 text-xs" disabled={!aiPreview.preview.hasWritePayload} onClick={onApply}>应用修改</Button>
      </div>
    </ResultShell>
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

async function applyReplanPreview(result: GlobalAiReplanPreviewResult, selectedOption: TripReplanOption | null) {
  if (!selectedOption) throw new Error('请选择一个重排方案。')
  const event = await createTripDisruptionEvent(result.eventDraft)
  const record = await createTripReplanPreviewForEvent(event.id)
  const option = record.options.find((candidate) => candidate.strategy === selectedOption.strategy) ?? record.options[0]
  if (!option) throw new Error('没有可应用的重排方案。')
  await applyTripReplanOption(record.id, option.id)
}

function buildWriteConfirmBody(result: GlobalAiCommandResult | null, selectedOption: TripReplanOption | null) {
  if (!result) return '确认写入当前预览。'
  if (result.kind === 'preference_preview') {
    return `将把重排偏好写入「${result.item.title}」。这只影响后续重排判断，不会立即改变行程时间。`
  }
  if (result.kind === 'replan_preview') {
    return `将创建突发事件和重排记录，并应用「${selectedOption?.title ?? '所选方案'}」。票据、账本和交通订单不会自动取消或退款，可整次撤销。`
  }
  return '确认写入当前预览。'
}
