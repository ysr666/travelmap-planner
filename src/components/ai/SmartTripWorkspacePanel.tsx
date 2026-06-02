import { useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Loader2, MapPin, NotebookText, Route, Search, Sparkles } from 'lucide-react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { buildAiTripEditLocalStateFingerprint } from '../../lib/ai/aiTripEditApply'
import {
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
  buildSmartTripWorkspaceTripNoteDiff,
  getSmartTripWorkspaceDefaultCheckedIds,
  getSmartTripWorkspacePlaceTargets,
  getSmartTripWorkspaceRouteOrderCandidateDays,
  getSmartTripWorkspaceSearchTargets,
  type SmartTripWorkspaceDiffItem,
  type SmartTripWorkspacePlaceCalibrationDiff,
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
import type { Day, ItineraryItem, Trip } from '../../types'

type SmartTripWorkspacePanelProps = {
  allItems: ItineraryItem[]
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  onApplied: () => Promise<void>
  trip: Trip
}

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
  const [diffs, setDiffs] = useState<SmartTripWorkspaceDiffItem[]>([])
  const [checkedDiffIds, setCheckedDiffIds] = useState<string[]>([])
  const [previewBaselineFingerprint, setPreviewBaselineFingerprint] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const placeTargets = useMemo(() => getSmartTripWorkspacePlaceTargets(allItems), [allItems])
  const searchTargets = useMemo(() => getSmartTripWorkspaceSearchTargets(allItems), [allItems])
  const potentialRouteDayCount = useMemo(() => estimatePotentialRouteDayCount(days, itemsByDay), [days, itemsByDay])
  const estimatedRequestCount = placeTargets.length + searchTargets.length + potentialRouteDayCount
  const selectedWriteCount = diffs.filter((diff) => diff.hasWrite && checkedDiffIds.includes(diff.id)).length
  const canGenerate = Boolean(providerConfig.configured && providerConfig.proxyUrl && days.length > 0 && !isGenerating)
  const canApply = selectedWriteCount > 0 && !isApplying

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
    const startedAt = new Date().toISOString()
    const baselineFingerprint = buildAiTripEditLocalStateFingerprint({ days, items: allItems, trip })
    const nextWarnings: string[] = []

    try {
      const dayById = new Map(days.map((day) => [day.id, day]))
      const placeDiffs = await collectPlaceDiffs({
        dayById,
        items: placeTargets,
        proxyUrl: providerConfig.proxyUrl,
        trip,
        warnings: nextWarnings,
      })
      const routeDiffs = await collectRouteOrderDiffs({
        days,
        itemsByDay,
        placeDiffs,
        proxyUrl: providerConfig.proxyUrl,
        trip,
        warnings: nextWarnings,
      })
      const itemNoteDiffs = await collectItemNoteDiffs({
        dayById,
        items: searchTargets,
        proxyUrl: providerConfig.proxyUrl,
        trip,
        warnings: nextWarnings,
      })
      const tripNoteDiff = buildSmartTripWorkspaceTripNoteDiff({
        days,
        itemsByDay,
        retrievedAt: startedAt,
        trip,
      })

      const nextDiffs = [
        ...placeDiffs,
        ...routeDiffs,
        ...itemNoteDiffs,
        ...(tripNoteDiff ? [tripNoteDiff] : []),
      ]
      setPreviewBaselineFingerprint(baselineFingerprint)
      setDiffs(nextDiffs)
      setCheckedDiffIds(getSmartTripWorkspaceDefaultCheckedIds(nextDiffs))
      setWarnings(dedupeWarnings([
        ...nextWarnings,
        ...nextDiffs.flatMap((diff) => diff.warnings ?? []),
        nextDiffs.length === 0 ? '没有生成可预览的修改。' : '',
      ]))
      setConfirmSendOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '智能整理生成失败。')
      setConfirmSendOpen(false)
    } finally {
      setIsGenerating(false)
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
      setSuccessMessage(result.appliedDiffCount > 0 ? `已应用 ${result.appliedDiffCount} 项智能整理。` : '没有需要应用的修改。')
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
          className="min-h-10 px-3 text-xs"
          data-testid="smart-trip-workspace-generate"
          disabled={!canGenerate}
          icon={<Sparkles className="size-3.5" />}
          loading={isGenerating}
          onClick={prepareSmartOrganize}
        >
          智能整理此行程
        </Button>
        {!providerConfig.configured ? (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-300">当前未配置 provider proxy</span>
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

      {diffs.length > 0 ? (
        <div className="space-y-3 rounded-xl bg-surface-container-low/80 p-3 ring-1 ring-outline-variant/30 dark:bg-surface-container-highest/35" data-testid="smart-trip-workspace-preview">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-on-surface dark:text-on-surface">整理预览</p>
              <p className="mt-0.5 text-[11px] leading-5 tm-muted">已选择 {selectedWriteCount} 项可写入修改。</p>
            </div>
            <Button
              className="min-h-9 shrink-0 px-3 text-xs"
              disabled={!canApply}
              loading={isApplying}
              onClick={() => setConfirmApplyOpen(true)}
            >
              批量应用
            </Button>
          </div>
          <div className="space-y-2">
            {diffs.map((diff) => (
              <SmartDiffRow
                checked={checkedDiffIds.includes(diff.id)}
                diff={diff}
                key={diff.id}
                onToggle={() => toggleDiff(diff.id)}
              />
            ))}
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
        body={`将把已勾选的 ${selectedWriteCount} 项修改写入当前本地旅行。\n不会创建票据，不会上传云端，不会清除路线缓存。若行程在预览后已变化，将要求重新生成。`}
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

async function collectPlaceDiffs({
  dayById,
  items,
  proxyUrl,
  trip,
  warnings,
}: {
  dayById: Map<string, Day>
  items: ItineraryItem[]
  proxyUrl: string
  trip: Trip
  warnings: string[]
}) {
  const diffs: SmartTripWorkspacePlaceCalibrationDiff[] = []
  for (const item of items.slice(0, SMART_TRIP_WORKSPACE_MAX_PLACE_LOOKUPS)) {
    try {
      const response = await fetchProviderProxyPlaceLookup({
        locale: 'zh-CN',
        maxResults: 1,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query: buildSmartTripWorkspacePlaceLookupQuery(item, trip),
        requestId: `smart-place-${item.id}`,
      }, proxyUrl)
      const diff = response.results[0]
        ? buildSmartTripWorkspacePlaceDiff({ day: dayById.get(item.dayId), item, result: response.results[0] })
        : null
      if (diff) {
        diffs.push(diff)
      } else {
        warnings.push(`${item.title} 未找到可写入的地点候选。`)
      }
      warnings.push(...(response.warnings ?? []))
    } catch (caught) {
      warnings.push(`${item.title} 地点校准失败：${formatProviderError(caught)}`)
    }
  }
  return diffs
}

async function collectRouteOrderDiffs({
  days,
  itemsByDay,
  placeDiffs,
  proxyUrl,
  trip,
  warnings,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[]
  proxyUrl: string
  trip: Trip
  warnings: string[]
}) {
  const diffs: SmartTripWorkspaceDiffItem[] = []
  const candidateDays = getSmartTripWorkspaceRouteOrderCandidateDays({ days, itemsByDay, placeDiffs })
  for (const day of candidateDays.slice(0, SMART_TRIP_WORKSPACE_MAX_ROUTE_ORDER_DAYS)) {
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
    } catch (caught) {
      warnings.push(`${day.title} 路线顺序建议失败：${formatProviderError(caught)}`)
    }
  }
  return diffs
}

async function collectItemNoteDiffs({
  dayById,
  items,
  proxyUrl,
  trip,
  warnings,
}: {
  dayById: Map<string, Day>
  items: ItineraryItem[]
  proxyUrl: string
  trip: Trip
  warnings: string[]
}) {
  const diffs: SmartTripWorkspaceDiffItem[] = []
  for (const item of items.slice(0, SMART_TRIP_WORKSPACE_MAX_SEARCHES)) {
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
    } catch (caught) {
      warnings.push(`${item.title} 开放时间/票价搜索失败：${formatProviderError(caught)}`)
    }
  }
  return diffs
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
    '确认后只生成可勾选 diff，不会直接写入旅行；不会创建票据、上传云端或清除路线缓存。',
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
