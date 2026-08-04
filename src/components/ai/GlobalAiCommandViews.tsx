import type { ReactNode } from 'react'
import {
  ArrowUpRight,
  Bot,
  ReceiptText,
  RotateCcw,
  Route,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import type { AiTripEditPatchPlan, AiTripEditPatchPreview } from '../../lib/ai/aiTripEditPatch'
import {
  getAiActionRetryPolicy,
  summarizePreparedAiActionPlan,
  type AiActionGatewayRuntimeContext,
  type AiActionManualEntry,
  type AiActionPreparedPlan,
  type AiActionRunResult,
} from '../../lib/ai/actionGateway'
import {
  formatFlexibility,
  formatMobility,
  formatPriority,
  formatWeather,
} from '../../lib/ai/globalAiCommandRouter'
import type {
  GlobalAiActionProposal,
  GlobalAiFailureRecord,
  GlobalAiInteractionContextMode,
  GlobalAiInteractionResult,
} from '../../lib/ai/globalAiInteraction'
import type { ProviderProxyAiTripEditSearchSummary } from '../../lib/ai/providerProxyContract'
import type { ItineraryReplanPreference, TripReplanDiff } from '../../types'
import { Button } from '../ui/Button'

export type AiTripEditPreviewState = {
  actionProposal?: GlobalAiActionProposal
  baselineFingerprint: string
  patchPlan: AiTripEditPatchPlan
  preview: AiTripEditPatchPreview
  searchResults: ProviderProxyAiTripEditSearchSummary | null
  tripId: string
  warnings: string[]
}

export type AiActionGatewayState = {
  attemptCount: number
  command: string
  completedStepIds: string[]
  context: AiActionGatewayRuntimeContext
  prepared: AiActionPreparedPlan
  run: AiActionRunResult | null
  writeConfirmed: boolean
}

export type ConversationMessage = {
  createdAt: number
  id: string
  sourceCardCount?: number
  text: string
  tone?: 'error' | 'normal' | 'success'
  type: 'assistant' | 'user'
}

export function ActionGatewayView({
  actionGateway,
  applying,
  loading,
  onConfirm,
  onManualEntry,
  onRetry,
}: {
  actionGateway: AiActionGatewayState
  applying: boolean
  loading: boolean
  onConfirm: () => void
  onManualEntry: (entry: AiActionManualEntry) => void
  onRetry: () => void
}) {
  const summary = summarizePreparedAiActionPlan(actionGateway.prepared)
  const run = actionGateway.run
  const statusText = run
    ? run.message
    : summary.failedCount > 0
      ? `已准备 ${summary.readyCount} 个步骤，${summary.failedCount} 个暂不可执行。`
      : actionGateway.prepared.steps.length === 1
        ? actionGateway.prepared.steps[0].preview
        : `${actionGateway.prepared.plan.steps.length} 个步骤已准备好。`
  const retryLabel = run?.requiresFreshConfirmation ? '重新生成预览' : '重试失败项'
  const retryLimit = run
    ? Math.max(
        0,
        ...run.failedStepIds.map((stepId) => {
          const step = actionGateway.prepared.plan.steps.find((candidate) => candidate.id === stepId)
          if (!step) return 0
          const policy = getAiActionRetryPolicy(step.actionId)
          return policy.retryable ? policy.maxAttempts : 0
        }),
      )
    : 0
  const canRetry = Boolean(run && actionGateway.attemptCount < retryLimit)
  const manualEntry = actionGateway.prepared.steps.find((step) => step.manualEntry)?.manualEntry

  return (
    <ResultShell icon={<Wand2 className="size-4" />} title={actionGateway.prepared.plan.summary}>
      <p className="break-words text-xs leading-5 text-on-surface-variant [overflow-wrap:anywhere]">
        {statusText}
      </p>
      <p className="text-[11px] font-semibold text-on-surface-variant" data-testid="global-ai-action-summary">
        {actionGateway.prepared.plan.steps.length} 个步骤 · 影响 {summary.affectedCount} 项
      </p>
      <details className="min-w-0 border-t border-outline-variant/60 pt-2 text-xs" data-testid="global-ai-action-details">
        <summary className="cursor-pointer font-semibold text-on-surface-variant">查看步骤</summary>
        <ul className="mt-2 space-y-1.5">
          {actionGateway.prepared.steps.map((step) => {
            const runStep = run?.steps.find((candidate) => candidate.id === step.id)
            return (
              <li className="min-w-0 break-words leading-5 text-on-surface-variant [overflow-wrap:anywhere]" key={step.id}>
                <p>{runStep?.message ?? step.error ?? step.preview}</p>
                {step.details?.map((detail) => (
                  <p
                    className="mt-1 border-l border-outline-variant/60 pl-2 text-[11px]"
                    data-testid="global-ai-action-step-detail"
                    key={detail}
                  >
                    {detail}
                  </p>
                ))}
              </li>
            )
          })}
        </ul>
      </details>
      {manualEntry ? (
        <button
          className="flex min-h-10 w-full items-center justify-between gap-2 px-1 text-left text-xs font-semibold text-primary tm-focus"
          onClick={() => onManualEntry(manualEntry)}
          type="button"
        >
          <span className="min-w-0 truncate">{manualEntry.label}</span>
          <ArrowUpRight className="size-4 shrink-0" />
        </button>
      ) : null}
      {!run ? (
        <Button className="min-h-10 w-full px-3 text-xs" loading={applying} onClick={onConfirm}>确认执行</Button>
      ) : run.status !== 'completed' && canRetry ? (
        <Button className="min-h-10 w-full px-3 text-xs" icon={<RotateCcw className="size-4" />} loading={loading} onClick={onRetry} variant="secondary">
          {retryLabel}
        </Button>
      ) : null}
    </ResultShell>
  )
}

export function CommandResultView({
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
    const answerLines = result.answer.split('\n').filter((line) => line.trim()).slice(0, 2)
    return (
      <ResultShell icon={<Bot className="size-4" />} title={result.title}>
        <div className="space-y-1 text-xs leading-5 text-on-surface-variant" data-testid={result.kind === 'help' ? 'global-ai-help-result' : 'global-ai-assistant-answer-result'}>
          {answerLines.map((line) => <p className="line-clamp-2 break-words [overflow-wrap:anywhere]" key={line}>{line}</p>)}
        </div>
        {result.caveats.length ? (
          <div className="space-y-1 rounded-lg bg-surface-container-high px-3 py-2 text-xs leading-5 text-on-surface-variant">
            {result.caveats.slice(0, 1).map((caveat) => <p className="line-clamp-2" key={caveat}>{caveat}</p>)}
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
          <div className="space-y-1 rounded-lg bg-surface-container-high px-3 py-2 text-xs leading-5 text-on-surface-variant">
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
              className={`min-h-20 rounded-lg border px-3 py-2 text-left text-xs transition ${selectedOption?.id === option.id ? 'border-primary bg-primary-fixed text-on-surface' : 'border-outline-variant/70 bg-surface-container text-on-surface-variant'}`}
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
          <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            {Array.from(new Set(result.warnings)).slice(0, 5).map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
        {!result.hypothetical ? <ActionProposalCard proposal={result.actionProposal} /> : null}
        {!result.hypothetical ? (
          <Button className="min-h-10 px-3 text-xs" disabled={!selectedOption} onClick={onRequestWrite} variant="secondary">确认应用重排</Button>
        ) : null}
      </ResultShell>
    )
  }

  return null
}

export function ConversationPanel({
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
    <div className="mb-3 space-y-3 rounded-lg bg-surface-container-high px-3 py-3" data-testid="global-ai-conversation-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
          <Bot className="size-4 text-primary" />
          <span>AI 会话</span>
        </div>
        <button
          aria-label="清空 AI 会话"
          className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-container tm-focus"
          onClick={onClear}
          type="button"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1 text-xs font-semibold" data-testid="global-ai-context-switch">
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
          <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-5 tm-muted">还没有对话。</p>
        ) : messages.slice(-6).map((message) => (
          <div
            className={`rounded-lg px-3 py-2 text-xs leading-5 ${message.type === 'user' ? 'bg-primary-fixed text-on-surface' : message.tone === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200' : message.tone === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-surface text-on-surface-variant'}`}
            key={message.id}
          >
            <p className="mb-1 text-[11px] font-semibold">{message.type === 'user' ? '你' : '助手'}</p>
            <p className="line-clamp-4 break-words [overflow-wrap:anywhere]">{message.text}</p>
            {message.sourceCardCount ? <p className="mt-1 text-[11px] tm-muted">来源卡 {message.sourceCardCount} 张</p> : null}
          </div>
        ))}
      </div>
      {failureRecords.length > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" data-testid="global-ai-failure-count">
          有 {failureRecords.length} 次处理失败记录。
        </p>
      ) : null}
    </div>
  )
}

export function FailureRecovery({
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

export function AiPreviewView({
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
      <p className="text-xs leading-5 tm-muted">影响 {aiPreview.preview.affectedDayCount} 天、{aiPreview.preview.affectedItemCount} 个行程点。</p>
      <ul className="space-y-1 text-xs leading-5 text-on-surface-variant">
        {aiPreview.preview.lines.slice(0, 5).map((line) => <li className="break-words [overflow-wrap:anywhere]" key={line}>{line}</li>)}
      </ul>
      {aiPreview.searchResults?.results.length ? (
        <div className="space-y-1 rounded-lg bg-surface-container-high px-3 py-2 text-xs leading-5">
          <p className="font-semibold">来源</p>
          {aiPreview.searchResults.results.slice(0, 2).map((source) => (
            <p className="break-words tm-muted [overflow-wrap:anywhere]" key={`${source.url}:${source.retrievedAt}`}>{source.title} · {source.domain || source.displayUrl}</p>
          ))}
        </div>
      ) : null}
      {aiPreview.warnings.length ? (
        <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {aiPreview.warnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      <ActionProposalCard proposal={aiPreview.actionProposal} />
      <div className="grid grid-cols-2 gap-2">
        <Button className="min-h-10 px-3 text-xs" onClick={onDiscard} variant="secondary">放弃</Button>
        <Button className="min-h-10 px-3 text-xs" disabled={!aiPreview.preview.hasWritePayload} onClick={onApply}>写入修改</Button>
      </div>
    </ResultShell>
  )
}

export function StatusLine({ icon, text, tone = 'muted' }: { icon: ReactNode; text: string; tone?: 'muted' | 'success' }) {
  return (
    <p className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold leading-5 ${tone === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-surface-container-high text-on-surface-variant'}`}>
      {icon}
      <span>{text}</span>
    </p>
  )
}

function ActionProposalCard({ proposal }: { proposal?: GlobalAiActionProposal }) {
  if (!proposal) return null
  return (
    <div className="space-y-1 rounded-lg border border-primary/20 bg-primary-fixed px-3 py-2 text-xs leading-5" data-testid="global-ai-action-proposal">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-on-surface [overflow-wrap:anywhere]">{proposal.title}</p>
          <p className="tm-muted">{proposal.message}</p>
        </div>
        <span className="shrink-0 rounded-lg bg-surface px-2 py-1 text-[11px] font-semibold text-primary">
          {proposal.requiresConfirmation ? '确认' : '入口'}
        </span>
      </div>
    </div>
  )
}

function ResultShell({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <div className="space-y-3" data-testid="global-ai-command-result">
      <div className="flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{title}</p>
        </div>
      </div>
      {children}
    </div>
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
            <div className="rounded-lg bg-surface-container-high px-3 py-2" key={change.itemId}>
              <p className="font-semibold text-on-surface">{change.title}</p>
              <p className="tm-muted">{formatItemChange(change)}</p>
            </div>
          ))}
        </div>
      ) : <p className="rounded-lg bg-surface-container-high px-3 py-2 tm-muted">这个方案不会改动现有行程。</p>}
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
