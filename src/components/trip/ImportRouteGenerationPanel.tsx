import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Route, X } from 'lucide-react'
import { listDaysByTrip, listItemsByDay } from '../../db'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDate } from '../../lib/dates'
import { generateRoutePreviewsForTrip, type RouteGenerationBatchResult } from '../../lib/routeGeneration'
import {
  getPersistentRouteProvider,
  loadTripRoutePreparation,
  type RoutePreparationDay,
  type TripRoutePreparation,
} from '../../lib/routePreparation'
import { ROUTE_CACHE_CHANGED_EVENT } from '../../lib/routeCache'
import { getRoutingConfig, ROUTING_CONFIG_CHANGED_EVENT } from '../../lib/routing'
import type { Day, ItineraryItem, TransportMode } from '../../types'

export type ImportRouteGenerationPanelProps = {
  className?: string
  onDismiss?: () => void
  onGenerated?: () => void
  showDismiss?: boolean
  tripId: string
}

export function ImportRouteGenerationPanel({
  className = '',
  onDismiss,
  onGenerated,
  showDismiss = false,
  tripId,
}: ImportRouteGenerationPanelProps) {
  const [days, setDays] = useState<Day[]>([])
  const [itemsByDay, setItemsByDay] = useState<Record<string, ItineraryItem[]>>({})
  const [preparation, setPreparation] = useState<TripRoutePreparation | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generationResult, setGenerationResult] = useState<RouteGenerationBatchResult | null>(null)

  useEffect(() => {
    function refresh() {
      setReloadVersion((version) => version + 1)
    }

    window.addEventListener(ROUTE_CACHE_CHANGED_EVENT, refresh)
    window.addEventListener(ROUTING_CONFIG_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(ROUTE_CACHE_CHANGED_EVENT, refresh)
      window.removeEventListener(ROUTING_CONFIG_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadPreparation() {
      setLoading(true)
      setLoadError(null)
      try {
        const nextDays = await listDaysByTrip(tripId)
        const entries = await Promise.all(
          nextDays.map(async (day) => [day.id, await listItemsByDay(day.id)] as const),
        )
        const nextItemsByDay = Object.fromEntries(entries)
        const nextPreparation = await loadTripRoutePreparation({
          days: nextDays,
          itemsByDay: nextItemsByDay,
          provider: getPersistentRouteProvider(getRoutingConfig()),
          tripId,
        })
        if (!cancelled) {
          setDays(nextDays)
          setItemsByDay(nextItemsByDay)
          setPreparation(nextPreparation)
        }
      } catch (caught) {
        if (!cancelled) {
          setDays([])
          setItemsByDay({})
          setPreparation(null)
          setLoadError(caught instanceof Error ? caught.message : '路线候选检查失败。')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadPreparation()

    return () => {
      cancelled = true
    }
  }, [reloadVersion, tripId])

  const targetDays = useMemo(
    () => preparation?.days.filter((day) => preparation.targetDayIds.includes(day.day.id)) ?? [],
    [preparation],
  )
  const canGenerate = Boolean(preparation?.canGenerate && targetDays.length > 0 && !generating && !loading)

  async function handleConfirmGenerate() {
    if (!preparation?.canGenerate || targetDays.length === 0) {
      return
    }

    setGenerating(true)
    setGenerationError(null)
    setGenerationResult(null)
    try {
      const result = await generateRoutePreviewsForTrip({
        config: getRoutingConfig(),
        days,
        itemsByDay,
        tripId,
      })
      setGenerationResult(result)
      setConfirmOpen(false)
      setReloadVersion((version) => version + 1)
      onGenerated?.()
    } catch (caught) {
      setGenerationError(caught instanceof Error ? caught.message : '路线预览生成失败。')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <Card className={`space-y-3 ${className}`} data-testid="import-route-generation-panel" variant="grouped">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Route className="size-4 shrink-0 text-sky-600 dark:text-sky-300" />
              <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">导入后路线生成</h3>
            </div>
            <p className="mt-1 text-xs leading-5 tm-muted" data-testid="import-route-generation-summary">
              {describeImportRoutePreparation(preparation, loading, loadError)}
            </p>
          </div>
          {showDismiss ? (
            <button
              aria-label="关闭导入路线提示"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-high tm-focus"
              data-testid="import-route-dismiss-button"
              onClick={onDismiss}
              type="button"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {targetDays.length > 0 ? (
          <div className="space-y-2" data-testid="import-route-generation-day-list">
            <p className="text-xs font-semibold text-on-surface dark:text-on-surface">可生成路线的日程</p>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1 app-scrollbar">
              {targetDays.map((routeDay) => (
                <ImportRouteDayRow
                  index={days.findIndex((day) => day.id === routeDay.day.id)}
                  items={itemsByDay[routeDay.day.id] ?? []}
                  key={routeDay.day.id}
                  providerConfigured={Boolean(preparation?.providerConfigured)}
                  routeDay={routeDay}
                  target
                />
              ))}
            </div>
          </div>
        ) : null}

        {loadError ? (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="import-route-generation-error">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{loadError}</span>
          </p>
        ) : null}

        {preparation && !preparation.providerConfigured && preparation.eligibleDayCount > preparation.cachedDayCount ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" data-testid="import-route-provider-warning">
            当前路线服务不可用，配置路线服务后可批量生成。
          </p>
        ) : null}

        {generationResult ? (
          <p className="flex items-start gap-2 rounded-xl bg-sky-50/75 px-3 py-2 text-xs leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" data-testid="import-route-generation-result">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <span>{describeRouteGenerationResult(generationResult)}</span>
          </p>
        ) : null}

        {generationError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="import-route-generation-submit-error">
            {generationError}
          </p>
        ) : null}

        <Button
          className="w-full"
          disabled={!canGenerate}
          icon={generating ? <Loader2 className="size-4 animate-spin" /> : <Route className="size-4" />}
          loading={generating}
          onClick={() => setConfirmOpen(true)}
          data-testid="import-route-generate-button"
          variant="secondary"
        >
          {targetDays.length > 0 ? `批量生成 ${targetDays.length} 天路线` : '暂无可生成路线'}
        </Button>
      </Card>

      <ConfirmDialog
        body={buildImportRouteGenerationConfirmBody(targetDays.length)}
        cancelLabel="暂不生成"
        confirmLabel="确认生成"
        icon={<Route className="size-5" />}
        loading={generating}
        onCancel={() => {
          if (!generating) {
            setConfirmOpen(false)
          }
        }}
        onConfirm={() => void handleConfirmGenerate()}
        open={confirmOpen}
        testId="import-route-generation-confirm-dialog"
        title={`生成 ${targetDays.length} 天路线预览？`}
      />
    </>
  )
}

function ImportRouteDayRow({
  index,
  items,
  providerConfigured,
  routeDay,
  target,
}: {
  index: number
  items: ItineraryItem[]
  providerConfigured: boolean
  routeDay: RoutePreparationDay
  target: boolean
}) {
  const status = describeRouteDayStatus(routeDay, providerConfigured, target)
  return (
    <div
      className="rounded-xl border border-outline-variant/30 bg-surface-container-high/40 px-3 py-2"
      data-status={routeDay.status}
      data-testid="import-route-generation-day"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere] dark:text-on-surface">
            Day {Math.max(index, 0) + 1} · {routeDay.day.title}
          </p>
          <p className="mt-0.5 text-xs leading-5 tm-muted">
            {formatDate(routeDay.day.date)} · {routeDay.coordinateCount} 个有坐标行程点 · {describeTransportModes(items)}
          </p>
        </div>
        <span className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
          {status.label}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-5 tm-muted">{status.detail}</p>
    </div>
  )
}

function describeImportRoutePreparation(
  preparation: TripRoutePreparation | null,
  loading: boolean,
  error: string | null,
) {
  if (loading || !preparation) {
    return error ? '路线候选检查失败。' : '正在检查可生成路线的日程…'
  }
  if (preparation.days.length === 0) {
    return '导入的行程还没有日程。'
  }
  if (preparation.targetDayIds.length > 0) {
    return `已找到 ${preparation.targetDayIds.length} 天可生成路线，确认后才会调用路线服务。`
  }
  if (preparation.eligibleDayCount === 0) {
    return '暂无可生成路线的日程；每日至少需要两个有坐标的行程点。'
  }
  if (!preparation.providerConfigured) {
    return `检测到 ${preparation.eligibleDayCount - preparation.cachedDayCount} 天可生成路线，但当前路线服务不可用。`
  }
  return '可走路线的日程已有路线预览。'
}

function describeRouteDayStatus(
  routeDay: RoutePreparationDay,
  providerConfigured: boolean,
  target: boolean,
) {
  if (!providerConfigured && routeDay.eligible && routeDay.status !== 'cached') {
    return {
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
      detail: '已有足够坐标，但需要先配置路线服务。',
      label: '服务未配置',
    }
  }
  if (target && routeDay.status === 'stale_if_cache_key_changed') {
    return {
      className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
      detail: '行程点或交通方式变化后，可重新生成路线预览。',
      label: '可更新',
    }
  }
  if (target) {
    return {
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
      detail: '确认批量生成后会为这一天请求路线预览。',
      label: '可生成',
    }
  }
  if (routeDay.status === 'cached') {
    return {
      className: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
      detail: '这一天已有匹配当前行程点和交通方式的路线缓存。',
      label: '已缓存',
    }
  }
  if (routeDay.status === 'not_enough_points') {
    return {
      className: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
      detail: '至少需要两个有坐标的行程点。',
      label: '坐标不足',
    }
  }
  return {
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
    detail: '补充地点坐标后可生成路线预览。',
    label: '缺少坐标',
  }
}

function describeTransportModes(items: ItineraryItem[]) {
  const modes = unique(
    items
      .map((item) => item.previousTransportMode ?? item.transportMode)
      .filter((mode): mode is TransportMode => Boolean(mode)),
  )
  if (modes.length === 0) {
    return '交通方式未填写，按现有默认规则处理'
  }
  return `交通方式：${modes.map(formatTransportMode).join('、')}`
}

function formatTransportMode(mode: TransportMode) {
  switch (mode) {
    case 'walk':
      return '步行'
    case 'transit':
      return '公共交通'
    case 'bus':
      return '公交'
    case 'car':
      return '驾车'
    case 'train':
      return '火车'
    case 'flight':
      return '航班'
    default:
      return '其他'
  }
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values))
}

function describeRouteGenerationResult(result: RouteGenerationBatchResult) {
  const parts = [`已生成 ${result.generatedCount} 天路线预览`]
  if (result.failedCount > 0) {
    parts.push(`${result.failedCount} 天失败`)
  }
  if (!result.previewCacheSaved && result.generatedCount > 0) {
    parts.push('地图预览缓存未更新')
  }
  return `${parts.join('，')}。`
}

function buildImportRouteGenerationConfirmBody(count: number) {
  return `点击确认后才会调用路线服务生成路线预览，可能消耗 API 次数。只为可生成路线的日期生成（共 ${count} 天），不会调整行程顺序，不会创建票据，也不会触发云端写入。`
}
