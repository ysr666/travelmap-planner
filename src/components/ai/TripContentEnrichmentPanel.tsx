import { useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, Info, Loader2, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { getProviderProxyConfig, ProviderProxyClientError } from '../../lib/providerProxyClient'
import { SYNC_QUEUE_SUCCESS_COPY } from '../../lib/tripSyncQueue'
import {
  TRIP_CONTENT_ENRICHMENT_MAX_ITEMS,
  applyTripContentEnrichmentPreviewsToDb,
  applyTripContentSourceRefreshPreviewToDb,
  estimateTripContentEnrichmentRequestCounts,
  estimateTripContentSourceRefreshRequestCounts,
  generateTripContentEnrichmentPreview,
  generateTripContentSourceRefreshPreview,
  getTripContentEnrichmentTargets,
  type TripContentEnrichmentPreview,
  type TripContentEnrichmentPreviewItem,
  type TripContentSourceRefreshPreview,
  type TripContentSourceRefreshSection,
} from '../../lib/ai/tripContentEnrichment'
import type { ContentEnrichmentFactSection, ContentEnrichmentSource, Day, ItemContentEnrichment, ItineraryItem, Trip } from '../../types'

type TripContentEnrichmentPanelProps = {
  allItems: ItineraryItem[]
  days: Day[]
  onApplied: () => Promise<void>
  trip: Trip
}

type ItemContentEnrichmentCardProps = {
  day: Day
  item: ItineraryItem
  onApplied: () => Promise<void>
  trip: Trip
}

export function TripContentEnrichmentPanel({ allItems, days, onApplied, trip }: TripContentEnrichmentPanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const targets = useMemo(() => getTripContentEnrichmentTargets(allItems, trip), [allItems, trip])
  const estimate = useMemo(() => estimateTripContentEnrichmentRequestCounts(targets), [targets])
  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false)
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [preview, setPreview] = useState<TripContentEnrichmentPreview | null>(null)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedCount = preview?.items.filter((item) => checkedIds.includes(item.id)).length ?? 0
  const canGenerate = Boolean(providerConfig.proxyUrl && targets.length > 0 && !isGenerating && !isApplying)
  const canApply = Boolean(preview && selectedCount > 0 && !isGenerating && !isApplying)

  async function handleGenerate() {
    if (!providerConfig.proxyUrl) {
      setError('当前未配置 provider proxy。')
      return
    }
    setIsGenerating(true)
    setError(null)
    setSuccess(null)
    setConfirmGenerateOpen(false)
    try {
      const nextPreview = await generateTripContentEnrichmentPreview({
        days,
        items: allItems,
        proxyUrl: providerConfig.proxyUrl,
        trip,
      })
      setPreview(nextPreview)
      setCheckedIds(nextPreview.checkedIds)
      if (nextPreview.items.length === 0) {
        setError(nextPreview.warnings.join(' ') || '没有生成可应用的内容补充。')
      }
    } catch (caught) {
      setError(caught instanceof ProviderProxyClientError ? caught.message : '内容补充生成失败。')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleApply() {
    if (!preview) return
    setIsApplying(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await applyTripContentEnrichmentPreviewsToDb(trip.id, preview.items, checkedIds, {
        expectedBaselineFingerprint: preview.baselineFingerprint,
      })
      if (!result.ok) {
        setError(result.errors.join(' '))
        setConfirmApplyOpen(false)
        return
      }
      await onApplied()
      setConfirmApplyOpen(false)
      setPreview(null)
      setCheckedIds([])
      setSuccess(result.appliedCount > 0 ? `已补充 ${result.appliedCount} 个行程点内容。${SYNC_QUEUE_SUCCESS_COPY}` : '没有需要写入的内容。')
    } catch {
      setError('应用内容补充失败。')
      setConfirmApplyOpen(false)
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <Card className="space-y-3" data-testid="trip-content-enrichment-panel" variant="grouped">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-50/80 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
          <WandSparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">内容补充</h3>
          <p className="mt-1 text-xs leading-5 tm-muted">
            优先使用 Google Places，再用官网/购票来源补足，确认后才写入行程点详情。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <EnrichmentMetric label="候选" value={targets.length} />
        <EnrichmentMetric label="Places" value={estimate.placeLookup + estimate.placeDetails} />
        <EnrichmentMetric label="搜索" value={estimate.travelSearch} />
        <EnrichmentMetric label="AI" value={estimate.aiSynthesis} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-10 px-3 text-xs"
          data-testid="trip-content-enrichment-generate"
          disabled={!canGenerate}
          icon={<Sparkles className="size-3.5" />}
          loading={isGenerating}
          onClick={() => setConfirmGenerateOpen(true)}
        >
          补充景点内容
        </Button>
        {!providerConfig.configured ? (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-300">当前未配置 provider proxy</span>
        ) : null}
        {targets.length > TRIP_CONTENT_ENRICHMENT_MAX_ITEMS ? (
          <span className="text-xs tm-muted">本次最多处理 {TRIP_CONTENT_ENRICHMENT_MAX_ITEMS} 个</span>
        ) : null}
      </div>

      {isGenerating ? (
        <p className="flex items-center gap-2 rounded-xl bg-violet-50/80 px-3 py-2 text-xs leading-5 text-violet-700 dark:bg-violet-500/10 dark:text-violet-200" data-testid="trip-content-enrichment-loading">
          <Loader2 className="size-3.5 animate-spin" />
          正在生成内容补充预览…
        </p>
      ) : null}

      {success ? (
        <p className="flex items-start gap-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="trip-content-enrichment-success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{success}</span>
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="trip-content-enrichment-error">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="space-y-3 rounded-xl bg-surface-container-low/80 p-3 ring-1 ring-outline-variant/30 dark:bg-surface-container-highest/35" data-testid="trip-content-enrichment-preview">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-on-surface dark:text-on-surface">内容预览</p>
              <p className="mt-0.5 text-[11px] leading-5 tm-muted">已选择 {selectedCount} 个行程点写入。</p>
            </div>
            <Button className="min-h-11 shrink-0 px-3 text-xs" disabled={!canApply} loading={isApplying} onClick={() => setConfirmApplyOpen(true)}>
              应用内容
            </Button>
          </div>
          {preview.warnings.length > 0 ? (
            <div className="space-y-1 rounded-xl bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
              {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : null}
          <div className="space-y-2">
            {preview.items.map((item) => (
              <EnrichmentPreviewRow
                checked={checkedIds.includes(item.id)}
                key={item.id}
                preview={item}
                onToggle={() => setCheckedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
              />
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        body={`将发起 provider proxy 请求以生成内容补充预览：预计最多 ${estimate.placeLookup} 次地点查询、${estimate.placeDetails} 次 Places 详情、${estimate.travelSearch} 次来源搜索、${estimate.aiSynthesis} 次 AI 来源内总结。确认前不会发出请求，不会写入本地旅行。`}
        cancelLabel="暂不补充"
        confirmLabel="确认补充"
        icon={<WandSparkles className="size-5" />}
        loading={isGenerating}
        onCancel={() => {
          if (!isGenerating) setConfirmGenerateOpen(false)
        }}
        onConfirm={() => void handleGenerate()}
        open={confirmGenerateOpen}
        testId="trip-content-enrichment-confirm-dialog"
        title="补充景点内容？"
      />

      <ConfirmDialog
        body={`将把已勾选的 ${selectedCount} 个内容补充写入行程点详情。若行程在预览后已变化，将要求重新生成。不会创建票据、路线缓存或云端写入。`}
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<WandSparkles className="size-5" />}
        loading={isApplying}
        onCancel={() => {
          if (!isApplying) setConfirmApplyOpen(false)
        }}
        onConfirm={() => void handleApply()}
        open={confirmApplyOpen}
        testId="trip-content-enrichment-apply-dialog"
        title="应用内容补充？"
      />
    </Card>
  )
}

export function ItemContentEnrichmentCard({ day, item, onApplied, trip }: ItemContentEnrichmentCardProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false)
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [confirmSourceRefreshOpen, setConfirmSourceRefreshOpen] = useState(false)
  const [confirmSourceRefreshApplyOpen, setConfirmSourceRefreshApplyOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isRefreshingSources, setIsRefreshingSources] = useState(false)
  const [isApplyingSourceRefresh, setIsApplyingSourceRefresh] = useState(false)
  const [preview, setPreview] = useState<TripContentEnrichmentPreviewItem | null>(null)
  const [sourceRefreshPreview, setSourceRefreshPreview] = useState<TripContentSourceRefreshPreview | null>(null)
  const [baselineFingerprint, setBaselineFingerprint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const estimate = estimateTripContentEnrichmentRequestCounts([item])
  const sourceRefreshEstimate = estimateTripContentSourceRefreshRequestCounts(item)
  const current = preview?.enrichment ?? item.contentEnrichment
  const canRefreshSources = Boolean(providerConfig.proxyUrl && !preview && !sourceRefreshPreview && !isGenerating && !isApplying && !isRefreshingSources && !isApplyingSourceRefresh)

  async function handleGenerate() {
    if (!providerConfig.proxyUrl) {
      setError('当前未配置 provider proxy。')
      return
    }
    setIsGenerating(true)
    setError(null)
    setSuccess(null)
    setConfirmGenerateOpen(false)
    try {
      const nextPreview = await generateTripContentEnrichmentPreview({
        days: [day],
        items: [item],
        proxyUrl: providerConfig.proxyUrl,
        targets: [item],
        trip,
      })
      setSourceRefreshPreview(null)
      setPreview(nextPreview.items[0] ?? null)
      setBaselineFingerprint(nextPreview.baselineFingerprint)
      if (nextPreview.items.length === 0) {
        setError(nextPreview.warnings.join(' ') || '没有生成可应用的内容补充。')
      }
    } catch (caught) {
      setError(caught instanceof ProviderProxyClientError ? caught.message : '内容补充生成失败。')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleApply() {
    if (!preview || !baselineFingerprint) return
    setIsApplying(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await applyTripContentEnrichmentPreviewsToDb(trip.id, [preview], [preview.id], {
        expectedBaselineFingerprint: baselineFingerprint,
      })
      if (!result.ok) {
        setError(result.errors.join(' '))
        setConfirmApplyOpen(false)
        return
      }
      await onApplied()
      setConfirmApplyOpen(false)
      setPreview(null)
      setBaselineFingerprint(null)
      setSourceRefreshPreview(null)
      setSuccess('已写入内容补充。')
    } catch {
      setError('应用内容补充失败。')
      setConfirmApplyOpen(false)
    } finally {
      setIsApplying(false)
    }
  }

  async function handleRefreshSources() {
    if (!providerConfig.proxyUrl) {
      setError('当前未配置 provider proxy。')
      return
    }
    setIsRefreshingSources(true)
    setError(null)
    setSuccess(null)
    setConfirmSourceRefreshOpen(false)
    try {
      const nextPreview = await generateTripContentSourceRefreshPreview({
        item,
        proxyUrl: providerConfig.proxyUrl,
        trip,
      })
      setSourceRefreshPreview(nextPreview)
    } catch (caught) {
      setError(caught instanceof ProviderProxyClientError ? caught.message : '来源刷新失败。')
    } finally {
      setIsRefreshingSources(false)
    }
  }

  async function handleApplySourceRefresh() {
    if (!sourceRefreshPreview) return
    setIsApplyingSourceRefresh(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await applyTripContentSourceRefreshPreviewToDb(trip.id, sourceRefreshPreview, {
        expectedBaselineFingerprint: sourceRefreshPreview.baselineFingerprint,
      })
      if (!result.ok) {
        setError(result.errors.join(' '))
        setConfirmSourceRefreshApplyOpen(false)
        return
      }
      await onApplied()
      setConfirmSourceRefreshApplyOpen(false)
      setSourceRefreshPreview(null)
      setSuccess(`已更新开放时间、票价和官网来源。${SYNC_QUEUE_SUCCESS_COPY}`)
    } catch {
      setError('应用来源刷新失败。')
      setConfirmSourceRefreshApplyOpen(false)
    } finally {
      setIsApplyingSourceRefresh(false)
    }
  }

  return (
    <section className="space-y-3" data-testid="item-content-enrichment-card">
      <div className="flex items-center justify-between gap-3 pl-1">
        <h2 className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">景点内容</h2>
        <Button
          className="min-h-11 shrink-0 px-3 text-xs"
          disabled={!providerConfig.proxyUrl || isGenerating || isApplying}
          icon={<WandSparkles className="size-3.5" />}
          loading={isGenerating}
          onClick={() => setConfirmGenerateOpen(true)}
          variant="secondary"
        >
          {item.contentEnrichment ? '重新补充' : '补充内容'}
        </Button>
      </div>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-4 shadow-sm">
        {current ? <ContentEnrichmentDisplay enrichment={current} sourceBlocks /> : (
          <div className="space-y-3">
            <p className="font-body-md text-body-md text-on-surface-variant">暂无景点介绍、开放时间、票价来源和停留建议。</p>
            <EmptySourceBlocks />
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            className="min-h-11 px-3 text-xs"
            data-testid="item-content-source-refresh"
            disabled={!canRefreshSources}
            icon={<RefreshCw className="size-3.5" />}
            loading={isRefreshingSources}
            onClick={() => setConfirmSourceRefreshOpen(true)}
            variant="secondary"
          >
            刷新来源
          </Button>
        </div>
        {!providerConfig.configured ? (
          <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-300">当前未配置 provider proxy</p>
        ) : null}
      </div>

      {preview ? (
        <div className="space-y-2 rounded-xl bg-surface-container-low/80 p-3 ring-1 ring-outline-variant/30" data-testid="item-content-enrichment-preview">
          <p className="text-xs font-semibold text-on-surface">待应用预览</p>
          <EnrichmentPreviewRow checked onToggle={() => {}} preview={preview} />
          <Button className="w-full min-h-10" loading={isApplying} onClick={() => setConfirmApplyOpen(true)}>
            应用到此行程点
          </Button>
        </div>
      ) : null}

      {sourceRefreshPreview ? (
        <div className="space-y-3 rounded-xl bg-surface-container-low/80 p-3 ring-1 ring-outline-variant/30" data-testid="item-content-source-refresh-preview">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-on-surface">来源更新预览</p>
              <p className="mt-0.5 text-[11px] leading-5 tm-muted">只更新开放时间、票价和官网来源。</p>
            </div>
            <Button className="min-h-11 shrink-0 px-3 text-xs" loading={isApplyingSourceRefresh} onClick={() => setConfirmSourceRefreshApplyOpen(true)}>
              更新来源
            </Button>
          </div>
          {sourceRefreshPreview.warnings.length > 0 ? (
            <div className="space-y-1 rounded-xl bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
              {sourceRefreshPreview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : null}
          <div className="space-y-2">
            {sourceRefreshPreview.sections.map((section) => (
              <SourceRefreshSectionPreview
                key={section.key}
                newSourceById={new Map(sourceRefreshPreview.enrichment.sources.map((source) => [source.id, source]))}
                oldSourceById={new Map((item.contentEnrichment?.sources ?? []).map((source) => [source.id, source]))}
                section={section}
              />
            ))}
          </div>
        </div>
      ) : null}

      {success ? <p className="rounded-xl bg-emerald-50/80 px-3 py-2 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">{success}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</p> : null}

      <ConfirmDialog
        body={`将为「${item.title}」发起内容补充请求：最多 ${estimate.placeLookup} 次地点查询、${estimate.placeDetails} 次 Places 详情、${estimate.travelSearch} 次来源搜索、${estimate.aiSynthesis} 次 AI 来源内总结。确认前不会发出请求，不会写入本地旅行。`}
        cancelLabel="暂不补充"
        confirmLabel="确认补充"
        icon={<WandSparkles className="size-5" />}
        loading={isGenerating}
        onCancel={() => {
          if (!isGenerating) setConfirmGenerateOpen(false)
        }}
        onConfirm={() => void handleGenerate()}
        open={confirmGenerateOpen}
        testId="item-content-enrichment-confirm-dialog"
        title="补充此景点内容？"
      />

      <ConfirmDialog
        body="将把预览内容写入此行程点详情。若行程在预览后已变化，将要求重新生成。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<WandSparkles className="size-5" />}
        loading={isApplying}
        onCancel={() => {
          if (!isApplying) setConfirmApplyOpen(false)
        }}
        onConfirm={() => void handleApply()}
        open={confirmApplyOpen}
        testId="item-content-enrichment-apply-dialog"
        title="应用内容补充？"
      />

      <ConfirmDialog
        body={`将为「${item.title}」刷新开放时间、票价和官网来源：最多 ${sourceRefreshEstimate.placeLookup} 次地点查询、${sourceRefreshEstimate.placeDetails} 次 Places 详情、${sourceRefreshEstimate.travelSearch} 次来源搜索，0 次 AI。确认前不会发出请求，不会写入本地旅行。`}
        cancelLabel="暂不刷新"
        confirmLabel="确认刷新"
        icon={<RefreshCw className="size-5" />}
        loading={isRefreshingSources}
        onCancel={() => {
          if (!isRefreshingSources) setConfirmSourceRefreshOpen(false)
        }}
        onConfirm={() => void handleRefreshSources()}
        open={confirmSourceRefreshOpen}
        testId="item-content-source-refresh-confirm-dialog"
        title="刷新来源？"
      />

      <ConfirmDialog
        body="将只更新此行程点内容补充中的开放时间、票价和官网来源。介绍、注意事项和推荐停留时长会保留；若行程点已变化，将要求重新刷新。"
        cancelLabel="暂不更新"
        confirmLabel="确认更新"
        icon={<RefreshCw className="size-5" />}
        loading={isApplyingSourceRefresh}
        onCancel={() => {
          if (!isApplyingSourceRefresh) setConfirmSourceRefreshApplyOpen(false)
        }}
        onConfirm={() => void handleApplySourceRefresh()}
        open={confirmSourceRefreshApplyOpen}
        testId="item-content-source-refresh-apply-dialog"
        title="更新来源？"
      />
    </section>
  )
}

function EnrichmentMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-container-high px-2 py-2 text-on-surface ring-1 ring-outline-variant/20">
      <p className="text-xs font-semibold text-primary">{value}</p>
      <p className="mt-0.5 text-[11px] tm-muted">{label}</p>
    </div>
  )
}

function EnrichmentPreviewRow({ checked, onToggle, preview }: { checked: boolean; onToggle: () => void; preview: TripContentEnrichmentPreviewItem }) {
  return (
    <label className="block rounded-xl bg-white/80 p-3 text-left ring-1 ring-outline-variant/30 dark:bg-surface-dim/45" data-testid="trip-content-enrichment-preview-item">
      <div className="flex items-start gap-3">
        <input checked={checked} className="mt-1 size-4 shrink-0 accent-primary" onChange={onToggle} type="checkbox" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-on-surface dark:text-on-surface">{preview.itemTitle}</p>
          <p className="mt-1 text-[11px] leading-5 tm-muted">{preview.summary}</p>
          <ContentEnrichmentDisplay compact enrichment={preview.enrichment} />
          {preview.warnings.length > 0 ? (
            <p className="mt-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">{preview.warnings.join(' ')}</p>
          ) : null}
        </div>
      </div>
    </label>
  )
}

function ContentEnrichmentDisplay({ compact = false, enrichment, sourceBlocks = false }: { compact?: boolean; enrichment: ItemContentEnrichment; sourceBlocks?: boolean }) {
  const sourceById = new Map(enrichment.sources.map((source) => [source.id, source]))
  return (
    <div className={compact ? 'mt-2 space-y-2 text-[11px] leading-5' : 'space-y-4'}>
      <FactBlock label="景点介绍" section={enrichment.introduction} sourceById={sourceById} />
      {sourceBlocks ? <IndependentSourceBlocks enrichment={enrichment} sourceById={sourceById} /> : (
        <>
          <FactBlock label="开放时间" section={enrichment.openingHours} sourceById={sourceById} />
          <FactBlock label="票价来源" section={enrichment.ticketPrice} sourceById={sourceById} />
        </>
      )}
      {enrichment.notices.length > 0 ? (
        <div>
          <p className="font-semibold text-on-surface">注意事项</p>
          <div className="mt-1 space-y-1">
            {enrichment.notices.map((notice, index) => <FactBlock key={`${notice.text}:${index}`} section={notice} sourceById={sourceById} />)}
          </div>
        </div>
      ) : null}
      {enrichment.recommendedStay ? (
        <div className="rounded-lg bg-surface-container-high/70 px-3 py-2">
          <p className="font-semibold text-on-surface">推荐停留时长</p>
          <p className="mt-1 break-words text-on-surface-variant [overflow-wrap:anywhere]">
            {enrichment.recommendedStay.text}
            {enrichment.recommendedStay.basis === 'ai_estimate' ? ' · AI 估算' : ''}
          </p>
          <p className="mt-1 text-[11px] tm-muted">{enrichment.recommendedStay.reason}</p>
        </div>
      ) : null}
      {!sourceBlocks && enrichment.sources.length > 0 ? (
        <div className="rounded-lg bg-surface-container-high/70 px-3 py-2">
          <p className="font-semibold text-on-surface">来源</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {enrichment.sources.slice(0, 6).map((source) => <SourcePill key={source.id} source={source} />)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function EmptySourceBlocks() {
  return (
    <div className="grid gap-2 sm:grid-cols-3" data-testid="item-content-source-blocks">
      <SourceInfoBlock emptyText="暂无开放时间来源" label="开放时间" />
      <SourceInfoBlock emptyText="暂无票价来源" label="票价" />
      <SourceInfoBlock emptyText="暂无官网来源" label="官网来源" />
    </div>
  )
}

function IndependentSourceBlocks({
  enrichment,
  sourceById,
}: {
  enrichment: ItemContentEnrichment
  sourceById: Map<string, ContentEnrichmentSource>
}) {
  const officialSources = getOfficialWebsiteSources(enrichment)
  return (
    <div className="grid gap-2 sm:grid-cols-3" data-testid="item-content-source-blocks">
      <SourceInfoBlock
        emptyText="暂无开放时间来源"
        label="开放时间"
        sources={resolveSources(enrichment.openingHours?.sourceIds ?? [], sourceById)}
        text={enrichment.openingHours?.text}
      />
      <SourceInfoBlock
        emptyText="暂无票价来源"
        label="票价"
        sources={resolveSources(enrichment.ticketPrice?.sourceIds ?? [], sourceById)}
        text={enrichment.ticketPrice?.text}
      />
      <SourceInfoBlock
        emptyText="暂无官网来源"
        label="官网来源"
        sources={officialSources}
        text={officialSources[0]?.url ?? enrichment.matchedPlace?.websiteUri}
      />
    </div>
  )
}

function SourceInfoBlock({
  emptyText,
  label,
  sources = [],
  text,
}: {
  emptyText: string
  label: string
  sources?: ContentEnrichmentSource[]
  text?: string
}) {
  return (
    <div className="rounded-lg bg-surface-container-high/70 px-3 py-2" data-testid={`item-content-source-block-${label}`}>
      <p className="font-semibold text-on-surface">{label}</p>
      <p className="mt-1 break-words text-on-surface-variant [overflow-wrap:anywhere]">{text?.trim() || emptyText}</p>
      {sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((source) => <SourcePill key={source.id} source={source} />)}
        </div>
      ) : null}
    </div>
  )
}

function SourceRefreshSectionPreview({
  newSourceById,
  oldSourceById,
  section,
}: {
  newSourceById: Map<string, ContentEnrichmentSource>
  oldSourceById: Map<string, ContentEnrichmentSource>
  section: TripContentSourceRefreshSection
}) {
  return (
    <div className="rounded-lg bg-white/80 p-3 text-xs ring-1 ring-outline-variant/30 dark:bg-surface-dim/45" data-testid={`item-content-source-refresh-section-${section.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-on-surface">{section.label}</p>
        <span className={section.changed ? 'rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'rounded-md bg-surface-container-high px-1.5 py-0.5 text-[10px] font-semibold tm-muted'}>
          {section.changed ? '将更新' : '保留现有'}
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <SourceRefreshValue label="当前" sourceById={oldSourceById} sourceIds={section.oldSourceIds} text={section.oldText} />
        <SourceRefreshValue label="新来源" sourceById={newSourceById} sourceIds={section.newSourceIds} text={section.newText} />
      </div>
      {section.warning ? <p className="mt-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">{section.warning}</p> : null}
    </div>
  )
}

function SourceRefreshValue({
  label,
  sourceById,
  sourceIds,
  text,
}: {
  label: string
  sourceById: Map<string, ContentEnrichmentSource>
  sourceIds: string[]
  text?: string
}) {
  const sources = resolveSources(sourceIds, sourceById)
  return (
    <div className="min-w-0 rounded-lg bg-surface-container-high/70 px-2 py-2">
      <p className="text-[10px] font-semibold uppercase text-on-surface-variant">{label}</p>
      <p className="mt-1 break-words text-on-surface-variant [overflow-wrap:anywhere]">{text?.trim() || '暂无来源'}</p>
      {sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((source) => <SourcePill key={source.id} source={source} />)}
        </div>
      ) : null}
    </div>
  )
}

function resolveSources(sourceIds: string[], sourceById: Map<string, ContentEnrichmentSource>) {
  return sourceIds.map((sourceId) => sourceById.get(sourceId)).filter((source): source is ContentEnrichmentSource => Boolean(source))
}

function getOfficialWebsiteSources(enrichment: ItemContentEnrichment) {
  const websiteUri = enrichment.matchedPlace?.websiteUri
  return enrichment.sources.filter((source) => {
    if (source.sourceType !== 'official' || !source.url) return false
    return !websiteUri || source.url === websiteUri
  })
}

function FactBlock({
  label,
  section,
  sourceById,
}: {
  label?: string
  section?: ContentEnrichmentFactSection
  sourceById: Map<string, ContentEnrichmentSource>
}) {
  if (!section) return null
  const sources = section.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter((source): source is ContentEnrichmentSource => Boolean(source))
  return (
    <div className="rounded-lg bg-surface-container-high/70 px-3 py-2">
      {label ? <p className="font-semibold text-on-surface">{label}</p> : null}
      <p className="mt-1 break-words text-on-surface-variant [overflow-wrap:anywhere]">{section.text}</p>
      {sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((source) => <SourcePill key={source.id} source={source} />)}
        </div>
      ) : null}
    </div>
  )
}

function SourcePill({ source }: { source: ContentEnrichmentSource }) {
  const label = `${source.label} · ${formatConfidence(source.confidence)} · ${formatDate(source.retrievedAt)}`
  if (source.url) {
    return (
      <a className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-outline-variant/30 [overflow-wrap:anywhere] dark:bg-surface-dim/60" href={source.url} rel="noreferrer" target="_blank">
        <ExternalLink className="size-3 shrink-0" />
        <span className="min-w-0 break-words">{label}</span>
      </a>
    )
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-on-surface-variant ring-1 ring-outline-variant/30 [overflow-wrap:anywhere] dark:bg-surface-dim/60">
      <Info className="size-3 shrink-0" />
      <span className="min-w-0 break-words">{label}</span>
    </span>
  )
}

function formatConfidence(confidence: ContentEnrichmentSource['confidence']) {
  if (confidence === 'high') return '高可信'
  if (confidence === 'medium') return '中可信'
  if (confidence === 'low') return '低可信'
  return '未标注'
}

function formatDate(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return '未知时间'
  return new Date(parsed).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
