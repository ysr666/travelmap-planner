import { useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Loader2, MapPin, NotebookText, RefreshCw, Route, Search, Sparkles } from 'lucide-react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { buildAiTripEditLocalStateFingerprint } from '../../lib/ai/aiTripEditApply'
import {
  SMART_TRIP_WORKSPACE_DIFF_CATEGORY_ORDER,
  SMART_TRIP_WORKSPACE_MAX_PLACE_LOOKUPS,
  SMART_TRIP_WORKSPACE_MAX_ROUTE_ORDER_DAYS,
  SMART_TRIP_WORKSPACE_MAX_SEARCHES,
  applySmartTripWorkspaceDiffsToDb,
  buildSmartTripWorkspaceItemNoteDiff,
  buildSmartTripWorkspacePlaceDiff,
  buildSmartTripWorkspacePlaceLookupQuery,
  buildSmartTripWorkspaceRouteOrderDiff,
  buildSmartTripWorkspaceRouteOrderRequestItems,
  buildSmartTripWorkspaceSearchQuery,
  buildSmartTripWorkspaceSearchType,
  formatSmartTripWorkspaceSourceConfidence,
  formatSmartTripWorkspaceSourceDate,
  buildSmartTripWorkspaceTripNoteDiff,
  getSmartTripWorkspaceCheckedPlaceDiffs,
  getSmartTripWorkspaceDiffCategoryLabel,
  getSmartTripWorkspacePlaceTargets,
  getSmartTripWorkspaceRouteOrderCandidateDays,
  getSmartTripWorkspaceSearchTargets,
  replaceSmartTripWorkspaceCategoryDiffs,
  selectBestSmartTripWorkspacePlaceResult,
  type SmartTripWorkspaceDiffItem,
  type SmartTripWorkspaceDiffType,
  type SmartTripWorkspacePlaceCalibrationDiff,
  type SmartTripWorkspaceStageType,
} from '../../lib/ai/smartTripWorkspace'
import {
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
  PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION,
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
} from '../../lib/ai/providerProxyContract'
import {
  fetchProviderProxyPlaceLookup,
  fetchProviderProxyRouteOrderSuggestion,
  fetchProviderProxyTravelSearch,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import { SYNC_QUEUE_SUCCESS_COPY } from '../../lib/tripSyncQueue'
import type { Day, ItineraryItem, Trip } from '../../types'

type SmartTripWorkspacePanelProps = {
  allItems: ItineraryItem[]
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  onApplied: () => Promise<void>
  trip: Trip
}

type SmartTripWorkspaceStageStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed'

type SmartTripWorkspaceStageState = {
  message?: string
  requestCount: number
  status: SmartTripWorkspaceStageStatus
}

type SmartTripWorkspaceStageRunResult = {
  allFailed: boolean
  diffs: SmartTripWorkspaceDiffItem[]
  failureCount: number
  requestCount: number
  successCount: number
  type: SmartTripWorkspaceStageType
  warnings: string[]
}

const STALE_PREVIEW_MESSAGE = '本地行程已变化，请重新生成全部预览。'

export function SmartTripWorkspacePanel({
  allItems,
  days,
  itemsByDay,
  onApplied,
  trip,
}: SmartTripWorkspacePanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [confirmSendOpen, setConfirmSendOpen] = useState(false)
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [confirmStageType, setConfirmStageType] = useState<SmartTripWorkspaceStageType | null>(null)
  const [diffs, setDiffs] = useState<SmartTripWorkspaceDiffItem[]>([])
  const [checkedDiffIds, setCheckedDiffIds] = useState<string[]>([])
  const [previewBaselineFingerprint, setPreviewBaselineFingerprint] = useState<string | null>(null)
  const [stageStates, setStageStates] = useState<Record<SmartTripWorkspaceStageType, SmartTripWorkspaceStageState>>(createInitialStageStates)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const placeTargets = useMemo(() => getSmartTripWorkspacePlaceTargets(allItems), [allItems])
  const searchTargets = useMemo(() => getSmartTripWorkspaceSearchTargets(allItems), [allItems])
  const potentialRouteDayCount = useMemo(() => estimatePotentialRouteDayCount(days, itemsByDay), [days, itemsByDay])
  const selectedPlaceDiffs = useMemo(() => getSmartTripWorkspaceCheckedPlaceDiffs(diffs, checkedDiffIds), [checkedDiffIds, diffs])
  const stageRequestCounts = useMemo(() => buildStageRequestCounts({
    days,
    itemsByDay,
    placeDiffs: selectedPlaceDiffs,
    placeTargets,
    searchTargets,
  }), [days, itemsByDay, placeTargets, searchTargets, selectedPlaceDiffs])
  const estimatedRequestCount = placeTargets.length + searchTargets.length + potentialRouteDayCount
  const selectedWriteCount = diffs.filter((diff) => diff.hasWrite && checkedDiffIds.includes(diff.id)).length
  const isStageGenerating = Object.values(stageStates).some((stage) => stage.status === 'running')
  const categoryPreviews = useMemo(() => buildCategoryPreviews({
    checkedDiffIds,
    diffs,
    includeEmpty: Boolean(previewBaselineFingerprint || diffs.length > 0),
    stageRequestCounts,
    stageStates,
  }), [checkedDiffIds, diffs, previewBaselineFingerprint, stageRequestCounts, stageStates])
  const canGenerate = Boolean(providerConfig.configured && providerConfig.proxyUrl && days.length > 0 && !isGenerating && !isStageGenerating)
  const canApply = selectedWriteCount > 0 && !isApplying && !isStageGenerating
  const confirmStageRequestCount = confirmStageType ? stageRequestCounts[confirmStageType] : 0

  function prepareSmartOrganize() {
    setError(null)
    setSuccessMessage(null)
    if (!providerConfig.proxyUrl) {
      setError('当前未配置 provider proxy。')
      return
    }
    setConfirmSendOpen(true)
  }

  async function handleConfirmSend() {
    if (!providerConfig.proxyUrl) {
      setConfirmSendOpen(false)
      setError('当前未配置 provider proxy。')
      return
    }

    setIsGenerating(true)
    setError(null)
    setSuccessMessage(null)
    setDiffs([])
    setCheckedDiffIds([])
    setWarnings([])
    setStageStates(createInitialStageStates())
    setConfirmSendOpen(false)
    const startedAt = new Date().toISOString()
    const baselineFingerprint = buildAiTripEditLocalStateFingerprint({ days, items: allItems, trip })
    setPreviewBaselineFingerprint(baselineFingerprint)
    let workingDiffs: SmartTripWorkspaceDiffItem[] = []
    let workingCheckedDiffIds: string[] = []
    let workingWarnings: string[] = []

    try {
      for (const type of SMART_TRIP_WORKSPACE_DIFF_CATEGORY_ORDER) {
        const result = await executeStage(type, {
          placeDiffs: getSmartTripWorkspaceCheckedPlaceDiffs(workingDiffs, workingCheckedDiffIds),
          proxyUrl: providerConfig.proxyUrl,
          retrievedAt: startedAt,
        })
        const replacement = buildStagePreviewReplacement({
          checkedDiffIds: workingCheckedDiffIds,
          diffs: workingDiffs,
          preserveOnAllFailed: false,
          result,
        })
        workingDiffs = replacement.diffs
        workingCheckedDiffIds = replacement.checkedDiffIds
        workingWarnings = dedupeWarnings([
          ...workingWarnings,
          ...replacement.warnings,
          ...workingDiffs.flatMap((diff) => diff.warnings ?? []),
        ])
        setDiffs(workingDiffs)
        setCheckedDiffIds(workingCheckedDiffIds)
        setWarnings(workingWarnings)
      }
      setWarnings(dedupeWarnings([
        ...workingWarnings,
        workingDiffs.length === 0 ? '没有生成可预览的修改。' : '',
      ]))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '智能整理生成失败。')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleConfirmStageRegenerate() {
    if (!confirmStageType || !providerConfig.proxyUrl) {
      setConfirmStageType(null)
      return
    }

    const freshFingerprint = buildAiTripEditLocalStateFingerprint({ days, items: allItems, trip })
    if (previewBaselineFingerprint && freshFingerprint !== previewBaselineFingerprint) {
      setError(STALE_PREVIEW_MESSAGE)
      setConfirmStageType(null)
      return
    }

    setError(null)
    setSuccessMessage(null)
    setConfirmStageType(null)
    const type = confirmStageType
    try {
      const result = await executeStage(type, {
        placeDiffs: getSmartTripWorkspaceCheckedPlaceDiffs(diffs, checkedDiffIds),
        proxyUrl: providerConfig.proxyUrl,
        retrievedAt: new Date().toISOString(),
      })
      const replacement = buildStagePreviewReplacement({
        checkedDiffIds,
        diffs,
        preserveOnAllFailed: true,
        result,
      })
      setDiffs(replacement.diffs)
      setCheckedDiffIds(replacement.checkedDiffIds)
      setWarnings((current) => dedupeWarnings([
        ...current,
        ...replacement.warnings,
        ...replacement.diffs.flatMap((diff) => diff.warnings ?? []),
      ]))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重新生成失败。')
    }
  }

  async function handleConfirmApply() {
    setIsApplying(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const result = await applySmartTripWorkspaceDiffsToDb(trip.id, diffs, checkedDiffIds, {
        expectedBaselineFingerprint: previewBaselineFingerprint ?? undefined,
      })
      if (!result.ok) {
        setError(result.errors.join(' '))
        setConfirmApplyOpen(false)
        return
      }
      await onApplied()
      setDiffs([])
      setCheckedDiffIds([])
      setPreviewBaselineFingerprint(null)
      setConfirmApplyOpen(false)
      setSuccessMessage(result.appliedDiffCount > 0 ? `已应用 ${result.appliedDiffCount} 项智能整理。${SYNC_QUEUE_SUCCESS_COPY}` : '没有需要应用的修改。')
    } catch {
      setError('应用智能整理失败。')
      setConfirmApplyOpen(false)
    } finally {
      setIsApplying(false)
    }
  }

  function toggleDiff(diffId: string) {
    setCheckedDiffIds((current) => (
      current.includes(diffId)
        ? current.filter((id) => id !== diffId)
        : [...current, diffId]
    ))
  }

  function setCategoryChecked(type: SmartTripWorkspaceDiffType, checked: boolean) {
    const categoryDiffIds = diffs
      .filter((diff) => diff.type === type && diff.hasWrite)
      .map((diff) => diff.id)
    setCheckedDiffIds((current) => {
      const next = new Set(current)
      for (const diffId of categoryDiffIds) {
        if (checked) {
          next.add(diffId)
        } else {
          next.delete(diffId)
        }
      }
      return Array.from(next)
    })
  }

  async function executeStage(
    type: SmartTripWorkspaceStageType,
    options: {
      placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[]
      proxyUrl: string
      retrievedAt: string
    },
  ): Promise<SmartTripWorkspaceStageRunResult> {
    setStageStates((current) => ({
      ...current,
      [type]: {
        requestCount: stageRequestCounts[type],
        status: 'running',
      },
    }))

    const result = await collectStageResult({
      days,
      itemsByDay,
      placeDiffs: options.placeDiffs,
      placeTargets,
      proxyUrl: options.proxyUrl,
      retrievedAt: options.retrievedAt,
      searchTargets,
      trip,
      type,
    })
    setStageStates((current) => ({
      ...current,
      [type]: {
        message: buildStageStateMessage(result),
        requestCount: result.requestCount,
        status: getStageStatus(result),
      },
    }))
    return result
  }

  return (
    <Card className="space-y-3" data-testid="smart-trip-workspace-panel" variant="grouped">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50/80 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">AI-native Trip Workspace</h3>
          <p className="mt-1 text-xs leading-5 tm-muted">
            地点、路线、开放时间、票价和每日提示会先进入可勾选预览。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <SmartMetric icon={<MapPin className="size-3.5" />} label="地点" value={placeTargets.length} />
        <SmartMetric icon={<Route className="size-3.5" />} label="路线" value={potentialRouteDayCount} />
        <SmartMetric icon={<Search className="size-3.5" />} label="搜索" value={searchTargets.length} />
        <SmartMetric icon={<NotebookText className="size-3.5" />} label="预估" value={estimatedRequestCount} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11 px-3 text-xs"
          data-testid="smart-trip-workspace-generate"
          disabled={!canGenerate}
          icon={<Sparkles className="size-3.5" />}
          loading={isGenerating}
          onClick={prepareSmartOrganize}
        >
          智能整理此行程
        </Button>
        {!providerConfig.configured ? (
          <span className="text-xs font-medium text-amber-800 dark:text-amber-200">当前未配置 provider proxy</span>
        ) : null}
      </div>

      {isGenerating ? (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="smart-trip-workspace-loading">
          <Loader2 className="size-3.5 animate-spin" />
          正在整理行程预览…
        </p>
      ) : null}

      {successMessage ? (
        <p className="flex items-start gap-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="smart-trip-workspace-success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{successMessage}</span>
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="smart-trip-workspace-error">
          {error}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="space-y-1 rounded-xl bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200" data-testid="smart-trip-workspace-warnings">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}

      {diffs.length > 0 || previewBaselineFingerprint ? (
        <div className="space-y-3 rounded-xl bg-surface-container-low/80 p-3 ring-1 ring-outline-variant/30 dark:bg-surface-container-highest/35" data-testid="smart-trip-workspace-preview">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-on-surface dark:text-on-surface">整理预览</p>
              <p className="mt-0.5 text-[11px] leading-5 tm-muted">已选择 {selectedWriteCount} 项可写入修改。</p>
            </div>
            <Button
              className="min-h-11 shrink-0 px-3 text-xs"
              disabled={!canApply}
              loading={isApplying}
              onClick={() => setConfirmApplyOpen(true)}
            >
              批量应用
            </Button>
          </div>
          <SmartCategoryControls
            categories={categoryPreviews}
            onClear={(type) => setCategoryChecked(type, false)}
            onRegenerate={(type) => setConfirmStageType(type)}
            onSelect={(type) => setCategoryChecked(type, true)}
            regenerating={isStageGenerating}
          />
          <div className="space-y-2">
            {diffs.map((diff) => (
              <SmartDiffRow
                checked={checkedDiffIds.includes(diff.id)}
                diff={diff}
                key={diff.id}
                onToggle={() => toggleDiff(diff.id)}
              />
            ))}
            {diffs.length === 0 ? (
              <p className="rounded-lg bg-white/70 px-3 py-2 text-xs leading-5 tm-muted dark:bg-surface-dim/35">暂无可写入建议。</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        body={buildSendConfirmBody({
          estimatedRequestCount,
          placeCount: placeTargets.length,
          routeDayCount: potentialRouteDayCount,
          searchCount: searchTargets.length,
        })}
        cancelLabel="暂不整理"
        confirmLabel="确认整理"
        icon={<Sparkles className="size-5" />}
        loading={isGenerating}
        onCancel={() => {
          if (!isGenerating) setConfirmSendOpen(false)
        }}
        onConfirm={() => void handleConfirmSend()}
        open={confirmSendOpen}
        testId="smart-trip-workspace-send-confirm-dialog"
        title="智能整理此行程？"
      />

      <ConfirmDialog
        body={buildStageConfirmBody({
          requestCount: confirmStageRequestCount,
          type: confirmStageType,
        })}
        cancelLabel="暂不重新生成"
        confirmLabel="确认重新生成"
        icon={<RefreshCw className="size-5" />}
        loading={Boolean(confirmStageType && stageStates[confirmStageType]?.status === 'running')}
        onCancel={() => {
          if (!isStageGenerating) setConfirmStageType(null)
        }}
        onConfirm={() => void handleConfirmStageRegenerate()}
        open={Boolean(confirmStageType)}
        testId="smart-trip-workspace-stage-confirm-dialog"
        title={confirmStageType ? `重新生成${getSmartTripWorkspaceDiffCategoryLabel(confirmStageType)}？` : '重新生成预览？'}
      />

      <ConfirmDialog
        body={`将把已勾选的 ${selectedWriteCount} 项修改写入当前旅行。\n不会创建票据，不会清除路线缓存。确认写入后，登录状态下会自动同步。若行程在预览后已变化，将要求重新生成。`}
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<Sparkles className="size-5" />}
        loading={isApplying}
        onCancel={() => {
          if (!isApplying) setConfirmApplyOpen(false)
        }}
        onConfirm={() => void handleConfirmApply()}
        open={confirmApplyOpen}
        testId="smart-trip-workspace-apply-confirm-dialog"
        title="批量应用智能整理？"
      />
    </Card>
  )
}

function SmartMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-container-high px-2 py-2 text-on-surface ring-1 ring-outline-variant/20">
      <div className="mx-auto flex w-fit items-center gap-1 text-primary">
        {icon}
        <span className="text-xs font-semibold">{value}</span>
      </div>
      <p className="mt-0.5 text-[11px] tm-muted">{label}</p>
    </div>
  )
}

type SmartCategoryPreview = {
  label: string
  message?: string
  requestCount: number
  selectedCount: number
  status: SmartTripWorkspaceStageStatus
  totalCount: number
  type: SmartTripWorkspaceDiffType
}

function SmartCategoryControls({
  categories,
  onClear,
  onRegenerate,
  onSelect,
  regenerating,
}: {
  categories: SmartCategoryPreview[]
  onClear: (type: SmartTripWorkspaceDiffType) => void
  onRegenerate: (type: SmartTripWorkspaceDiffType) => void
  onSelect: (type: SmartTripWorkspaceDiffType) => void
  regenerating: boolean
}) {
  if (categories.length === 0) {
    return null
  }
  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      data-testid="smart-trip-workspace-category-controls"
    >
      {categories.map((category) => (
        <div
          className="flex min-w-0 flex-col gap-2 rounded-lg bg-white/70 px-2.5 py-2 ring-1 ring-outline-variant/25 sm:flex-row sm:items-center sm:justify-between dark:bg-surface-dim/35"
          key={category.type}
        >
          <div className="min-w-0 text-[11px] leading-5">
            <p className="font-semibold text-on-surface dark:text-on-surface">
              <span>{category.label}</span>
              <span className="ml-1 font-medium tm-muted">{category.selectedCount}/{category.totalCount}</span>
            </p>
            <p
              className="break-words tm-muted [overflow-wrap:anywhere]"
              data-testid={`smart-trip-workspace-stage-status-${category.type}`}
            >
              {formatStageStatus(category.status)} · 请求 {category.requestCount}
              {category.message ? ` · ${category.message}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              className="min-h-7 rounded-lg px-2 text-[11px]"
              data-testid={`smart-trip-workspace-category-select-${category.type}`}
              disabled={category.totalCount === 0 || regenerating}
              onClick={() => onSelect(category.type)}
              variant="subtle"
            >
              全选
            </Button>
            <Button
              className="min-h-7 rounded-lg px-2 text-[11px]"
              data-testid={`smart-trip-workspace-category-clear-${category.type}`}
              disabled={category.totalCount === 0 || regenerating}
              onClick={() => onClear(category.type)}
              variant="ghost"
            >
              取消
            </Button>
            <Button
              className="min-h-7 rounded-lg px-2 text-[11px]"
              data-testid={`smart-trip-workspace-category-regenerate-${category.type}`}
              disabled={regenerating}
              icon={<RefreshCw className="size-3" />}
              onClick={() => onRegenerate(category.type)}
              variant="ghost"
            >
              重新生成
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function SmartDiffRow({
  checked,
  diff,
  onToggle,
}: {
  checked: boolean
  diff: SmartTripWorkspaceDiffItem
  onToggle: () => void
}) {
  return (
    <label
      className="block rounded-xl bg-white/80 p-3 text-left ring-1 ring-outline-variant/30 dark:bg-surface-dim/45"
      data-testid="smart-trip-workspace-diff"
    >
      <div className="flex items-start gap-3">
        <input
          checked={checked}
          className="mt-1 size-4 shrink-0 accent-primary disabled:opacity-50"
          data-testid="smart-trip-workspace-diff-checkbox"
          disabled={!diff.hasWrite}
          onChange={onToggle}
          type="checkbox"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-on-surface dark:text-on-surface">{diff.title}</p>
            {!diff.hasWrite ? (
              <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">无需写入</span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-5 tm-muted">{diff.summary}</p>
          <div
            className="mt-2 space-y-1 rounded-lg bg-surface-container-high/70 px-2 py-1.5 text-[11px] leading-5 text-on-surface-variant dark:bg-surface-container-highest/50"
            data-testid="smart-trip-workspace-source-meta"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">{diff.sourceMeta.label}</span>
              <span>来源时间：{formatSmartTripWorkspaceSourceDate(diff.sourceMeta.retrievedAt)}</span>
              <span>可信度：{formatSmartTripWorkspaceSourceConfidence(diff.sourceMeta.confidence)}</span>
            </div>
            <p className="break-words [overflow-wrap:anywhere]">建议理由：{diff.sourceMeta.reason}</p>
          </div>
          <ul className="mt-2 space-y-1 text-[11px] leading-5 text-on-surface-variant">
            {diff.detailLines.slice(0, 4).map((line) => (
              <li className="break-words [overflow-wrap:anywhere]" key={line}>{line}</li>
            ))}
          </ul>
          {diff.warnings?.length ? (
            <p className="mt-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">{diff.warnings.join(' ')}</p>
          ) : null}
        </div>
      </div>
    </label>
  )
}

function buildCategoryPreviews({
  checkedDiffIds,
  diffs,
  includeEmpty,
  stageRequestCounts,
  stageStates,
}: {
  checkedDiffIds: string[]
  diffs: SmartTripWorkspaceDiffItem[]
  includeEmpty: boolean
  stageRequestCounts: Record<SmartTripWorkspaceStageType, number>
  stageStates: Record<SmartTripWorkspaceStageType, SmartTripWorkspaceStageState>
}): SmartCategoryPreview[] {
  const checkedIdSet = new Set(checkedDiffIds)
  return SMART_TRIP_WORKSPACE_DIFF_CATEGORY_ORDER.flatMap((type) => {
    const categoryDiffs = diffs.filter((diff) => diff.type === type && diff.hasWrite)
    if (!includeEmpty && categoryDiffs.length === 0) {
      return []
    }
    return [{
      label: getSmartTripWorkspaceDiffCategoryLabel(type),
      message: stageStates[type].message,
      requestCount: stageStates[type].requestCount || stageRequestCounts[type],
      selectedCount: categoryDiffs.filter((diff) => checkedIdSet.has(diff.id)).length,
      status: stageStates[type].status,
      totalCount: categoryDiffs.length,
      type,
    }]
  })
}

async function collectStageResult({
  days,
  itemsByDay,
  placeDiffs,
  placeTargets,
  proxyUrl,
  retrievedAt,
  searchTargets,
  trip,
  type,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[]
  placeTargets: ItineraryItem[]
  proxyUrl: string
  retrievedAt: string
  searchTargets: ItineraryItem[]
  trip: Trip
  type: SmartTripWorkspaceStageType
}): Promise<SmartTripWorkspaceStageRunResult> {
  const dayById = new Map(days.map((day) => [day.id, day]))
  if (type === 'place_calibration') {
    return collectPlaceDiffs({ dayById, items: placeTargets, proxyUrl, trip })
  }
  if (type === 'route_order') {
    return collectRouteOrderDiffs({ days, itemsByDay, placeDiffs, proxyUrl, trip })
  }
  if (type === 'item_note_append') {
    return collectItemNoteDiffs({ dayById, items: searchTargets, proxyUrl, trip })
  }
  return collectTripNoteDiffs({ days, itemsByDay, retrievedAt, trip })
}

async function collectPlaceDiffs({
  dayById,
  items,
  proxyUrl,
  trip,
}: {
  dayById: Map<string, Day>
  items: ItineraryItem[]
  proxyUrl: string
  trip: Trip
}): Promise<SmartTripWorkspaceStageRunResult> {
  const diffs: SmartTripWorkspacePlaceCalibrationDiff[] = []
  const warnings: string[] = []
  let failureCount = 0
  let requestCount = 0
  let successCount = 0
  for (const item of items.slice(0, SMART_TRIP_WORKSPACE_MAX_PLACE_LOOKUPS)) {
    requestCount += 1
    try {
      const response = await fetchProviderProxyPlaceLookup({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query: buildSmartTripWorkspacePlaceLookupQuery(item, trip),
        requestId: `smart-place-${item.id}`,
      }, proxyUrl)
      const bestResult = selectBestSmartTripWorkspacePlaceResult(response.results, item)
      const diff = bestResult
        ? buildSmartTripWorkspacePlaceDiff({ day: dayById.get(item.dayId), item, result: bestResult })
        : null
      if (diff) {
        diffs.push(diff)
      } else {
        warnings.push(`${item.title} 未找到可写入的地点候选。`)
      }
      warnings.push(...(response.warnings ?? []))
      successCount += 1
    } catch (caught) {
      failureCount += 1
      warnings.push(`${item.title} 地点校准失败：${formatProviderError(caught)}`)
    }
  }
  return buildStageRunResult({
    diffs,
    failureCount,
    requestCount,
    successCount,
    type: 'place_calibration',
    warnings,
  })
}

async function collectRouteOrderDiffs({
  days,
  itemsByDay,
  placeDiffs,
  proxyUrl,
  trip,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[]
  proxyUrl: string
  trip: Trip
}): Promise<SmartTripWorkspaceStageRunResult> {
  const diffs: SmartTripWorkspaceDiffItem[] = []
  const warnings: string[] = []
  let failureCount = 0
  let requestCount = 0
  let successCount = 0
  const candidateDays = getSmartTripWorkspaceRouteOrderCandidateDays({ days, itemsByDay, placeDiffs })
  for (const day of candidateDays.slice(0, SMART_TRIP_WORKSPACE_MAX_ROUTE_ORDER_DAYS)) {
    requestCount += 1
    try {
      const items = itemsByDay[day.id] ?? []
      const response = await fetchProviderProxyRouteOrderSuggestion({
        dayId: day.id,
        items: buildSmartTripWorkspaceRouteOrderRequestItems(items, placeDiffs),
        operation: PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION,
        provider: 'auto',
        requestId: `smart-route-${day.id}`,
        tripId: trip.id,
      }, proxyUrl)
      const diff = buildSmartTripWorkspaceRouteOrderDiff({ day, items, placeDiffs, result: response })
      if (diff) {
        diffs.push(diff)
      }
      successCount += 1
    } catch (caught) {
      failureCount += 1
      warnings.push(`${day.title} 路线顺序建议失败：${formatProviderError(caught)}`)
    }
  }
  return buildStageRunResult({
    diffs,
    failureCount,
    requestCount,
    successCount,
    type: 'route_order',
    warnings,
  })
}

async function collectItemNoteDiffs({
  dayById,
  items,
  proxyUrl,
  trip,
}: {
  dayById: Map<string, Day>
  items: ItineraryItem[]
  proxyUrl: string
  trip: Trip
}): Promise<SmartTripWorkspaceStageRunResult> {
  const diffs: SmartTripWorkspaceDiffItem[] = []
  const warnings: string[] = []
  let failureCount = 0
  let requestCount = 0
  let successCount = 0
  for (const item of items.slice(0, SMART_TRIP_WORKSPACE_MAX_SEARCHES)) {
    requestCount += 1
    try {
      const response = await fetchProviderProxyTravelSearch({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
        query: buildSmartTripWorkspaceSearchQuery(item, trip),
        requestId: `smart-search-${item.id}`,
        searchType: buildSmartTripWorkspaceSearchType(),
      }, proxyUrl)
      const diff = buildSmartTripWorkspaceItemNoteDiff({
        day: dayById.get(item.dayId),
        item,
        retrievedAt: response.retrievedAt,
        searchResults: response.results,
      })
      if (diff) {
        diffs.push(diff)
      } else {
        warnings.push(`${item.title} 搜索没有可引用来源，未生成事实性提示。`)
      }
      warnings.push(...(response.warnings ?? []))
      successCount += 1
    } catch (caught) {
      failureCount += 1
      warnings.push(`${item.title} 开放时间/票价搜索失败：${formatProviderError(caught)}`)
    }
  }
  return buildStageRunResult({
    diffs,
    failureCount,
    requestCount,
    successCount,
    type: 'item_note_append',
    warnings,
  })
}

function collectTripNoteDiffs({
  days,
  itemsByDay,
  retrievedAt,
  trip,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  retrievedAt: string
  trip: Trip
}): SmartTripWorkspaceStageRunResult {
  const diff = buildSmartTripWorkspaceTripNoteDiff({
    days,
    itemsByDay,
    retrievedAt,
    trip,
  })
  return buildStageRunResult({
    diffs: diff ? [diff] : [],
    failureCount: 0,
    requestCount: 0,
    successCount: diff ? 1 : 0,
    type: 'trip_note_append',
    warnings: diff ? [] : ['没有可生成的每日提示。'],
  })
}

function buildStageRunResult({
  diffs,
  failureCount,
  requestCount,
  successCount,
  type,
  warnings,
}: {
  diffs: SmartTripWorkspaceDiffItem[]
  failureCount: number
  requestCount: number
  successCount: number
  type: SmartTripWorkspaceStageType
  warnings: string[]
}): SmartTripWorkspaceStageRunResult {
  return {
    allFailed: requestCount > 0 && failureCount === requestCount && successCount === 0,
    diffs,
    failureCount,
    requestCount,
    successCount,
    type,
    warnings: dedupeWarnings(warnings),
  }
}

function buildStagePreviewReplacement({
  checkedDiffIds,
  diffs,
  preserveOnAllFailed,
  result,
}: {
  checkedDiffIds: string[]
  diffs: SmartTripWorkspaceDiffItem[]
  preserveOnAllFailed: boolean
  result: SmartTripWorkspaceStageRunResult
}) {
  const hasPreviousCategoryDiffs = diffs.some((diff) => diff.type === result.type)
  if (preserveOnAllFailed && result.allFailed && hasPreviousCategoryDiffs) {
    return {
      checkedDiffIds,
      diffs,
      warnings: [
        ...result.warnings,
        `${getSmartTripWorkspaceDiffCategoryLabel(result.type)}重新生成失败，已保留上一版建议。`,
      ],
    }
  }
  return {
    ...replaceSmartTripWorkspaceCategoryDiffs({
      currentCheckedDiffIds: checkedDiffIds,
      currentDiffs: diffs,
      nextDiffs: result.diffs,
      type: result.type,
    }),
    warnings: result.warnings,
  }
}

function getStageStatus(result: SmartTripWorkspaceStageRunResult): SmartTripWorkspaceStageStatus {
  if (result.failureCount > 0 && result.successCount === 0) {
    return 'failed'
  }
  if (result.failureCount > 0) {
    return 'partial'
  }
  return 'success'
}

function buildStageStateMessage(result: SmartTripWorkspaceStageRunResult) {
  if (result.failureCount > 0 && result.successCount === 0) {
    return '全部失败'
  }
  if (result.failureCount > 0) {
    return `${result.successCount} 成功 / ${result.failureCount} 失败`
  }
  return `${result.diffs.length} 项建议`
}

function formatStageStatus(status: SmartTripWorkspaceStageStatus) {
  if (status === 'running') return '生成中'
  if (status === 'success') return '已完成'
  if (status === 'partial') return '部分完成'
  if (status === 'failed') return '失败'
  return '待生成'
}

function estimatePotentialRouteDayCount(days: Day[], itemsByDay: Record<string, ItineraryItem[]>) {
  return days
    .filter((day) => {
      const count = itemsByDay[day.id]?.length ?? 0
      return count >= 2 && count <= 10
    })
    .slice(0, SMART_TRIP_WORKSPACE_MAX_ROUTE_ORDER_DAYS)
    .length
}

function buildStageRequestCounts({
  days,
  itemsByDay,
  placeDiffs,
  placeTargets,
  searchTargets,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[]
  placeTargets: ItineraryItem[]
  searchTargets: ItineraryItem[]
}): Record<SmartTripWorkspaceStageType, number> {
  return {
    item_note_append: Math.min(searchTargets.length, SMART_TRIP_WORKSPACE_MAX_SEARCHES),
    place_calibration: Math.min(placeTargets.length, SMART_TRIP_WORKSPACE_MAX_PLACE_LOOKUPS),
    route_order: getSmartTripWorkspaceRouteOrderCandidateDays({ days, itemsByDay, placeDiffs }).length,
    trip_note_append: 0,
  }
}

function createInitialStageStates(): Record<SmartTripWorkspaceStageType, SmartTripWorkspaceStageState> {
  return {
    item_note_append: { requestCount: 0, status: 'idle' },
    place_calibration: { requestCount: 0, status: 'idle' },
    route_order: { requestCount: 0, status: 'idle' },
    trip_note_append: { requestCount: 0, status: 'idle' },
  }
}

function buildSendConfirmBody({
  estimatedRequestCount,
  placeCount,
  routeDayCount,
  searchCount,
}: {
  estimatedRequestCount: number
  placeCount: number
  routeDayCount: number
  searchCount: number
}) {
  return [
    `将通过 provider proxy 生成整理预览，预计最多 ${estimatedRequestCount} 次请求。`,
    `地点校准 ${placeCount} 次，路线顺序 ${routeDayCount} 次，开放时间/票价搜索 ${searchCount} 次。`,
    '确认后只生成可勾选 diff，不会直接写入旅行；不会创建票据或清除路线缓存。',
  ].join('\n')
}

function buildStageConfirmBody({
  requestCount,
  type,
}: {
  requestCount: number
  type: SmartTripWorkspaceStageType | null
}) {
  const label = type ? getSmartTripWorkspaceDiffCategoryLabel(type) : '该类别'
  return [
    `将重新生成${label}预览，预计最多 ${requestCount} 次 provider proxy 请求。`,
    '确认前不会发送请求；成功后只替换该类别建议，其他类别会保留。',
    '如果该类别 provider 全部失败，将保留上一版建议并显示警告。',
  ].join('\n')
}

function formatProviderError(caught: unknown) {
  if (caught instanceof ProviderProxyClientError || caught instanceof Error) {
    return caught.message
  }
  return '请求失败。'
}

function dedupeWarnings(warnings: string[]) {
  return Array.from(new Set(warnings.map((warning) => warning.trim()).filter(Boolean))).slice(0, 12)
}
