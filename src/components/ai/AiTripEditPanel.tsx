import { useMemo, useState } from 'react'
import { Sparkles, Wand2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { buildAiTripEditContext, type AiTripEditContext } from '../../lib/ai/aiTripEditContext'
import { applyAiTripEditPatchPlanToDb, buildAiTripEditLocalStateFingerprint } from '../../lib/ai/aiTripEditApply'
import { buildAiTripEditPatchPreview, type AiTripEditPatchPlan, type AiTripEditPatchPreview } from '../../lib/ai/aiTripEditPatch'
import {
  buildAiTripEditSearchRequest,
  detectAiTripEditSearchIntent,
  summarizeTravelSearchResultsForPrompt,
} from '../../lib/ai/aiTripEditSearch'
import { getStoredAiPrivacySettings } from '../../lib/ai/aiPrivacy'
import {
  fetchProviderProxyAiTripEditPlan,
  fetchProviderProxyTravelSearch,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import {
  PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
  type ProviderProxyAiTripEditSearchSummary,
  type ProviderProxyTravelSearchRequest,
} from '../../lib/ai/providerProxyContract'
import type { Day, ItineraryItem, Trip } from '../../types'

type AiTripEditPanelProps = {
  allItems: ItineraryItem[]
  days: Day[]
  onApplied: () => Promise<void>
  trip: Trip
}

const NO_SEARCH_WARNING = '联网搜索暂未接入，未查询实时信息。'

export function AiTripEditPanel({
  allItems,
  days,
  onApplied,
  trip,
}: AiTripEditPanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [command, setCommand] = useState('')
  const [pendingContext, setPendingContext] = useState<AiTripEditContext | null>(null)
  const [pendingBaselineFingerprint, setPendingBaselineFingerprint] = useState<string | null>(null)
  const [pendingSearchRequest, setPendingSearchRequest] = useState<ProviderProxyTravelSearchRequest | null>(null)
  const [confirmSendOpen, setConfirmSendOpen] = useState(false)
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [patchPlan, setPatchPlan] = useState<AiTripEditPatchPlan | null>(null)
  const [preview, setPreview] = useState<AiTripEditPatchPreview | null>(null)
  const [previewSearchResults, setPreviewSearchResults] = useState<ProviderProxyAiTripEditSearchSummary | null>(null)
  const [previewBaselineFingerprint, setPreviewBaselineFingerprint] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const trimmedCommand = command.trim()
  const searchIntent = useMemo(() => detectAiTripEditSearchIntent(trimmedCommand), [trimmedCommand])
  const canGenerate = Boolean(providerConfig.configured && trimmedCommand && !isGenerating)
  const sendConfirmBody = pendingSearchRequest
    ? '将把已脱敏的旅行、日期和行程项信息发送给 AI 服务，可能消耗服务额度。此请求可能需要联网搜索；确认后会先通过旅图服务查询一次，搜索不可用时不会声称已查询实时网页信息。AI 只会返回修改方案，不会直接修改旅行。'
    : '将把已脱敏的旅行、日期和行程项信息发送给 AI 服务，可能消耗服务额度。AI 只会返回修改方案，不会直接修改旅行。当前不会联网搜索或查询实时网页信息。'

  function prepareSendConfirm() {
    setError(null)
    setWarnings([])
    if (!trimmedCommand) {
      setError('请输入想修改的内容。')
      return
    }

    const contextResult = buildAiTripEditContext({
      days,
      items: allItems,
      privacy: getStoredAiPrivacySettings(),
      trip,
    })
    if (!contextResult.ok) {
      setError(contextResult.errors.join(' '))
      return
    }

    setPendingContext(contextResult.context)
    setPendingBaselineFingerprint(buildAiTripEditLocalStateFingerprint({ days, items: allItems, trip }))
    setPendingSearchRequest(buildAiTripEditSearchRequest(trimmedCommand, contextResult.context))
    setPreviewSearchResults(null)
    setWarnings(contextResult.warnings)
    setConfirmSendOpen(true)
  }

  async function handleConfirmSend() {
    if (!providerConfig.proxyUrl || !pendingContext) {
      setConfirmSendOpen(false)
      setError('当前未配置 AI 修改服务。')
      return
    }

    setIsGenerating(true)
    setError(null)
    setPatchPlan(null)
    setPreview(null)
    setPreviewSearchResults(null)
    try {
      const nextWarnings: string[] = []
      let searchResults: ProviderProxyAiTripEditSearchSummary | null = null
      if (pendingSearchRequest) {
        try {
          const searchResponse = await fetchProviderProxyTravelSearch(pendingSearchRequest, providerConfig.proxyUrl)
          searchResults = summarizeTravelSearchResultsForPrompt(searchResponse)
          if (searchResults) {
            nextWarnings.push(...(searchResults.warnings ?? []))
          } else {
            nextWarnings.push(NO_SEARCH_WARNING)
          }
        } catch {
          nextWarnings.push(NO_SEARCH_WARNING)
        }
      }

      const response = await fetchProviderProxyAiTripEditPlan({
        command: trimmedCommand,
        context: pendingContext,
        operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
        searchResults: searchResults ?? undefined,
      }, providerConfig.proxyUrl)
      setPatchPlan(response.patchPlan)
      setPreview(buildAiTripEditPatchPreview(response.patchPlan, pendingContext))
      setPreviewSearchResults(searchResults)
      setPreviewBaselineFingerprint(pendingBaselineFingerprint)
      setWarnings([...nextWarnings, ...(response.warnings ?? []), ...(response.patchPlan.warnings ?? [])])
      setConfirmSendOpen(false)
    } catch (caught) {
      const message = caught instanceof ProviderProxyClientError
        ? caught.message
        : 'AI 修改建议生成失败。'
      setError(message)
      setConfirmSendOpen(false)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleConfirmApply() {
    if (!patchPlan) {
      return
    }

    setIsApplying(true)
    setError(null)
    try {
      const result = await applyAiTripEditPatchPlanToDb(trip.id, patchPlan, {
        expectedBaselineFingerprint: previewBaselineFingerprint ?? undefined,
      })
      if (!result.ok) {
        setError(result.errors.join(' '))
        setConfirmApplyOpen(false)
        return
      }
      await onApplied()
      setCommand('')
      setPatchPlan(null)
      setPreview(null)
      setPreviewSearchResults(null)
      setPreviewBaselineFingerprint(null)
      setPendingSearchRequest(null)
      setWarnings([])
      setConfirmApplyOpen(false)
    } catch {
      setError('应用 AI 修改方案失败。')
      setConfirmApplyOpen(false)
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <Card className="space-y-3" data-testid="ai-trip-edit-panel" variant="grouped">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-50/80 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">AI 修改建议</h3>
          <p className="mt-1 text-xs leading-5 tm-muted">
            AI 只会生成修改方案，确认前不会改动行程。联网搜索能力将通过旅图服务提供，当前仍不会自动查询网页或实时票价。
          </p>
        </div>
      </div>

      <textarea
        className="min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-sky-500/70 dark:focus:ring-sky-500/10"
        data-testid="ai-trip-edit-command"
        maxLength={1000}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="例如：第二天太满了，帮我放松一点"
        value={command}
      />

      {searchIntent.needed ? (
        <p className="rounded-xl bg-sky-50/80 px-3 py-2 text-xs leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" data-testid="ai-trip-edit-search-intent-note">
          此请求可能需要联网搜索。
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-10 px-3 text-xs"
          disabled={!canGenerate}
          icon={<Wand2 className="size-3.5" />}
          loading={isGenerating}
          onClick={prepareSendConfirm}
        >
          生成修改方案
        </Button>
        {!providerConfig.configured ? (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-300">当前未配置 AI 修改服务</span>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="ai-trip-edit-error">
          {error}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="space-y-1 rounded-xl bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200" data-testid="ai-trip-edit-warnings">
          {Array.from(new Set(warnings)).map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {preview && patchPlan ? (
        <div className="space-y-3 rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/45" data-testid="ai-trip-edit-preview">
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{patchPlan.summary}</p>
            <p className="mt-1 text-[11px] leading-5 tm-muted">
              预览出现不代表已修改旅行。影响 {preview.affectedDayCount} 天、{preview.affectedItemCount} 个行程项。
            </p>
          </div>
          <ul className="space-y-1 text-xs leading-5 text-slate-700 dark:text-slate-200">
            {preview.lines.map((line) => (
              <li className="break-words [overflow-wrap:anywhere]" key={line}>{line}</li>
            ))}
          </ul>
          {preview.warnings.length > 0 ? (
            <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
              {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : null}
          {previewSearchResults?.results.length ? (
            <div className="space-y-2 rounded-lg bg-white/80 px-3 py-2 text-xs leading-5 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/45 dark:text-slate-200 dark:ring-slate-700" data-testid="ai-trip-edit-search-sources">
              <p className="font-semibold text-slate-800 dark:text-slate-100">搜索来源</p>
              {previewSearchResults.results.slice(0, 3).map((source) => (
                <div className="space-y-0.5 break-words [overflow-wrap:anywhere]" key={`${source.url}-${source.retrievedAt}`}>
                  <p className="font-medium text-slate-800 dark:text-slate-100">{source.title}</p>
                  <p className="text-[11px] tm-muted">{source.domain || source.displayUrl} · {source.retrievedAt}</p>
                  <p>{source.snippet}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="min-h-10 px-3 text-xs"
              onClick={() => {
                setPatchPlan(null)
                setPreview(null)
                setPreviewSearchResults(null)
                setPreviewBaselineFingerprint(null)
              }}
              variant="secondary"
            >
              放弃
            </Button>
            <Button
              className="min-h-10 px-3 text-xs"
              disabled={!preview.hasWritePayload}
              loading={isApplying}
              onClick={() => setConfirmApplyOpen(true)}
            >
              {preview.hasWritePayload ? '应用修改' : '无可应用修改'}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        body={sendConfirmBody}
        cancelLabel="暂不发送"
        confirmLabel="确认发送"
        icon={<Sparkles className="size-5" />}
        loading={isGenerating}
        onCancel={() => {
          if (!isGenerating) setConfirmSendOpen(false)
        }}
        onConfirm={() => void handleConfirmSend()}
        open={confirmSendOpen}
        testId="ai-trip-edit-send-confirm-dialog"
        title="发送给 AI 生成修改方案？"
      />

      <ConfirmDialog
        body="将把这些修改写入当前本地旅行。不会联网搜索或查询网页，不会生成路线，不会创建票据，不会上传云端。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<Wand2 className="size-5" />}
        loading={isApplying}
        onCancel={() => {
          if (!isApplying) setConfirmApplyOpen(false)
        }}
        onConfirm={() => void handleConfirmApply()}
        open={confirmApplyOpen}
        testId="ai-trip-edit-apply-confirm-dialog"
        title="应用 AI 修改方案？"
      />
    </Card>
  )
}
