import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, Loader2, NotebookPen, Route, Sparkles } from 'lucide-react'
import { getProviderProxyConfig, ProviderProxyClientError } from '../../lib/providerProxyClient'
import {
  buildTripDailyTravelTip,
  generateEnhancedTripDailyTravelTip,
  saveTripDailyTravelTipPreviewToNotes,
  type TripDailyTravelTipEnhancedPreview,
  type TripDailyTravelTipSection,
} from '../../lib/ai/tripDailyTravelTip'
import type { TripRoutePreparation } from '../../lib/routePreparation'
import type { TripCheckResult } from '../../lib/tripCheck'
import { SYNC_QUEUE_SUCCESS_COPY } from '../../lib/tripSyncQueue'
import type { Day, ItineraryItem, Trip } from '../../types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type TripDailyTravelTipCardProps = {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  onOpenContentEnrichment?: () => void
  onOpenDay?: (day: Day) => void
  onOpenRouteGeneration?: () => void
  onSaved?: () => Promise<void> | void
  routePreparation?: TripRoutePreparation | null
  trip: Trip
  tripCheck?: TripCheckResult | null
}

export function TripDailyTravelTipCard({
  days,
  itemsByDay,
  onOpenContentEnrichment,
  onOpenDay,
  onOpenRouteGeneration,
  onSaved,
  routePreparation,
  trip,
  tripCheck,
}: TripDailyTravelTipCardProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const model = useMemo(() => buildTripDailyTravelTip({
    days,
    itemsByDay,
    routePreparation,
    trip,
    tripCheck,
  }), [days, itemsByDay, routePreparation, trip, tripCheck])
  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false)
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<TripDailyTravelTipEnhancedPreview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canGenerate = providerConfig.configured && model.mode !== 'completed' && Boolean(model.targetDay)

  async function handleGenerate() {
    if (!providerConfig.proxyUrl || !canGenerate) {
      return
    }
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const nextPreview = await generateEnhancedTripDailyTravelTip({
        model,
        proxyUrl: providerConfig.proxyUrl,
        trip,
      })
      setPreview(nextPreview)
      setConfirmGenerateOpen(false)
    } catch (caught) {
      setError(caught instanceof ProviderProxyClientError ? caught.message : caught instanceof Error ? caught.message : '生成增强提示失败。')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!preview) {
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const result = await saveTripDailyTravelTipPreviewToNotes({
        expectedBaselineFingerprint: preview.baselineFingerprint,
        preview,
        tripId: trip.id,
      })
      if (!result.ok) {
        setError(result.errors.join('\n'))
        return
      }
      setMessage(`已保存到旅行备注。${SYNC_QUEUE_SUCCESS_COPY}`)
      setPreview(null)
      setConfirmSaveOpen(false)
      await onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-4" data-testid="trip-daily-travel-tip-card" variant="grouped">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="size-4" />
            </span>
            <h3 className="break-words text-base font-semibold text-on-surface [overflow-wrap:anywhere] dark:text-on-surface">今日旅行提示</h3>
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
              {model.title}
            </span>
          </div>
          <p className="mt-1 break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">{model.subtitle}</p>
        </div>
        <Button
          className="min-w-0 shrink-0"
          disabled={!canGenerate || loading}
          icon={loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          onClick={() => setConfirmGenerateOpen(true)}
          variant="secondary"
        >
          生成增强提示
        </Button>
      </div>

      {!providerConfig.configured ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
          服务未连接，先显示本地汇总。
        </p>
      ) : null}
      {model.warnings.map((warning) => (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-200" key={warning}>
          {warning}
        </p>
      ))}
      {error ? (
        <p className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
          {message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {model.sections.map((section) => (
          <DailyTipSectionView key={section.key} section={section} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {model.targetDay ? (
          <Button icon={<CalendarDays className="size-4" />} onClick={() => onOpenDay?.(model.targetDay!)} variant="subtle">
            查看目标日
          </Button>
        ) : null}
        <Button icon={<NotebookPen className="size-4" />} onClick={onOpenContentEnrichment} variant="subtle">
          内容补充
        </Button>
        <Button icon={<Route className="size-4" />} onClick={onOpenRouteGeneration} variant="subtle">
          路线生成提示
        </Button>
      </div>

      {preview ? (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3" data-testid="trip-daily-tip-preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface dark:text-on-surface">增强提示预览</p>
              <p className="mt-1 text-xs tm-muted">来源 {preview.requestCounts.travelSearch} · 汇总 {preview.requestCounts.aiSynthesis}</p>
            </div>
            <Button icon={<CheckCircle2 className="size-4" />} loading={saving} onClick={() => setConfirmSaveOpen(true)} variant="primary">
              保存到旅行备注
            </Button>
          </div>
          <p className="break-words text-sm leading-6 text-on-surface [overflow-wrap:anywhere] dark:text-on-surface">{preview.response.summary}</p>
          <div className="space-y-2">
            {preview.response.sections.map((section) => (
              <div className="rounded-lg bg-surface-container px-3 py-2" key={`${section.key}:${section.title}`}>
                <p className="text-sm font-semibold text-on-surface dark:text-on-surface">{section.title}</p>
                <p className="mt-1 break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">{section.text}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {preview.sources.slice(0, 4).map((source) => (
              <a
                className="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-xs font-semibold text-on-surface-variant"
                href={source.url}
                key={source.id}
                rel="noreferrer"
                target="_blank"
              >
                <span className="truncate">{source.label}</span>
                {source.url ? <ExternalLink className="size-3 shrink-0" /> : null}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        body={`将为 ${model.subtitle} 联网生成今日提示。预计查询 ${model.searchTargets.length} 个来源，结果会先给你预览。`}
        cancelLabel="暂不生成"
        confirmLabel="确认生成"
        icon={<Sparkles className="size-5" />}
        loading={loading}
        onCancel={() => {
          if (!loading) setConfirmGenerateOpen(false)
        }}
        onConfirm={() => void handleGenerate()}
        open={confirmGenerateOpen}
        tone="default"
        title="生成增强今日提示？"
      />
      <ConfirmDialog
        body="将把当前提示追加到旅行备注，不会覆盖已有内容。若备注已变化，会让你重新生成。"
        cancelLabel="暂不保存"
        confirmLabel="确认保存"
        icon={<NotebookPen className="size-5" />}
        loading={saving}
        onCancel={() => {
          if (!saving) setConfirmSaveOpen(false)
        }}
        onConfirm={() => void handleSave()}
        open={confirmSaveOpen}
        tone="default"
        title="保存到旅行备注？"
      />
    </Card>
  )
}

function DailyTipSectionView({ section }: { section: TripDailyTravelTipSection }) {
  const hasLines = section.lines.length > 0
  return (
    <div className="min-w-0 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
      <div className="flex items-center gap-2">
        {!hasLines ? <AlertTriangle className="size-4 text-amber-500" /> : <CheckCircle2 className="size-4 text-emerald-600" />}
        <p className="text-sm font-semibold text-on-surface dark:text-on-surface">{section.title}</p>
      </div>
      {hasLines ? (
        <ul className="mt-2 space-y-2">
          {section.lines.map((line) => (
            <li className="min-w-0 text-sm leading-6 tm-muted" key={line.id}>
              <span className="font-semibold text-on-surface dark:text-on-surface">{line.title}</span>
              <span className="break-words [overflow-wrap:anywhere]">：{line.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm tm-muted">{section.emptyText}</p>
      )}
    </div>
  )
}
