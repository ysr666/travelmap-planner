import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Map,
  MapPin,
  Navigation,
  RotateCcw,
  Scissors,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Ticket,
} from 'lucide-react'
import { setItineraryItemExecutionState } from '../../db'
import { prepareAiTripEditExecution } from '../../lib/ai/aiTripEditExecution'
import { applyAiTripEditPatchPlanToDb } from '../../lib/ai/aiTripEditApply'
import { buildAiTripEditPatchPreview, type AiTripEditPatchPlan, type AiTripEditPatchPreview } from '../../lib/ai/aiTripEditPatch'
import { PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION } from '../../lib/ai/providerProxyContract'
import { fetchProviderProxyAiTripEditPlan, getProviderProxyConfig, ProviderProxyClientError } from '../../lib/providerProxyClient'
import { buildAppleMapsDirectionsUrl, buildGoogleMapsDirectionsUrl } from '../../lib/mapLinks'
import type { RoutePreparationDay } from '../../lib/routePreparation'
import { buildTripLiveModel, type TripLiveRisk, type TripLiveStage } from '../../lib/tripLiveMode'
import type { TripOperationsRecommendation } from '../../lib/tripOperationsAgent'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../../types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Collapsible } from '../ui/Collapsible'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type TripLiveModeCardProps = {
  allItems: ItineraryItem[]
  compact?: boolean
  day: Day
  days: Day[]
  items: ItineraryItem[]
  now?: Date
  onChanged: () => Promise<void>
  onOpenItem: (item: ItineraryItem) => void
  onOpenMap: () => void
  onOpenOperation: (recommendation: TripOperationsRecommendation) => void
  onOpenTickets: (item: ItineraryItem) => void
  operationsRecommendations?: TripOperationsRecommendation[]
  routeDay?: RoutePreparationDay | null
  tickets?: TicketMeta[]
  trip: Trip
}

type AdjustmentKind = 'compress' | 'adjust'

export function TripLiveModeCard({
  allItems,
  compact = false,
  day,
  days,
  items,
  now,
  onChanged,
  onOpenItem,
  onOpenMap,
  onOpenOperation,
  onOpenTickets,
  operationsRecommendations = [],
  routeDay,
  tickets = [],
  trip,
}: TripLiveModeCardProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const model = useMemo(() => buildTripLiveModel({
    day,
    items,
    now,
    operations: { recommendations: operationsRecommendations },
    routeDay,
    tickets,
    trip,
  }), [day, items, now, operationsRecommendations, routeDay, tickets, trip])
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adjustmentKind, setAdjustmentKind] = useState<AdjustmentKind | null>(null)
  const [aiContext, setAiContext] = useState<ReturnType<typeof prepareAiTripEditExecution> extends infer R ? R : never>()
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false)
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [patchPlan, setPatchPlan] = useState<AiTripEditPatchPlan | null>(null)
  const [patchPreview, setPatchPreview] = useState<AiTripEditPatchPreview | null>(null)
  const hasCriticalTimeRisk = model.risks.some((risk) => risk.kind === 'late' && risk.severity === 'critical')
  const targetItem = model.targetItem
  const appleDirectionsUrl = model.previousItem && targetItem
    ? buildAppleMapsDirectionsUrl(model.previousItem, targetItem, targetItem.previousTransportMode)
    : null
  const googleDirectionsUrl = model.previousItem && targetItem
    ? buildGoogleMapsDirectionsUrl(model.previousItem, targetItem, targetItem.previousTransportMode)
    : null

  async function setExecutionState(item: ItineraryItem, state: 'completed' | 'skipped' | null) {
    setBusyItemId(item.id)
    setError(null)
    try {
      await setItineraryItemExecutionState(item.id, state)
      setMessage(state === 'completed' ? `已完成「${item.title}」，下一站已更新。` : state === 'skipped' ? `已跳过「${item.title}」，可随时恢复。` : `已恢复「${item.title}」。`)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新旅行执行状态失败。')
    } finally {
      setBusyItemId(null)
    }
  }

  function startAdjustment(kind: AdjustmentKind) {
    if (!targetItem) return
    setError(null)
    setMessage(null)
    if (!providerConfig.configured || !providerConfig.proxyUrl) {
      onOpenItem(targetItem)
      return
    }
    const prepared = prepareAiTripEditExecution({ days, items: allItems, trip })
    if (!prepared.ok) {
      setError(prepared.errors.join(' '))
      return
    }
    setAdjustmentKind(kind)
    setAiContext(prepared)
    setSendConfirmOpen(true)
  }

  async function generatePatch() {
    if (!providerConfig.proxyUrl || !aiContext?.ok || !adjustmentKind || !targetItem) return
    setGenerating(true)
    setError(null)
    try {
      const response = await fetchProviderProxyAiTripEditPlan({
        command: buildAdjustmentCommand(adjustmentKind, day, targetItem),
        context: aiContext.context,
        operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
      }, providerConfig.proxyUrl)
      setPatchPlan(response.patchPlan)
      setPatchPreview(buildAiTripEditPatchPreview(response.patchPlan, aiContext.context))
      setSendConfirmOpen(false)
    } catch (caught) {
      setError(caught instanceof ProviderProxyClientError ? caught.message : '生成调整预览失败。')
      setSendConfirmOpen(false)
    } finally {
      setGenerating(false)
    }
  }

  async function applyPatch() {
    if (!patchPlan || !aiContext?.ok) return
    setApplying(true)
    setError(null)
    try {
      const result = await applyAiTripEditPatchPlanToDb(trip.id, patchPlan, {
        expectedBaselineFingerprint: aiContext.baselineFingerprint,
      })
      if (!result.ok) {
        setError(result.errors.join(' '))
        setApplyConfirmOpen(false)
        return
      }
      setMessage(`已应用 ${result.appliedOperationCount} 项调整：${patchPlan.summary}`)
      clearPatch()
      await onChanged()
    } finally {
      setApplying(false)
    }
  }

  function clearPatch() {
    setAdjustmentKind(null)
    setAiContext(undefined)
    setPatchPlan(null)
    setPatchPreview(null)
    setApplyConfirmOpen(false)
  }

  return (
    <>
      <Card className="space-y-4" data-testid="trip-live-mode-card" variant="grouped">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Navigation className="size-4" /></span>
              <h3 className="text-base font-semibold text-on-surface">Trip Live Mode</h3>
              <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs font-semibold text-on-surface-variant">当前 {model.currentTimeLabel}</span>
            </div>
            <p className="mt-1 text-xs leading-5 tm-muted">本地时钟与已有数据实时重算，不包含实时交通、实时开闭园或位置追踪。</p>
          </div>
          <StagePill stage={model.stage} />
        </div>

        <div className="rounded-lg bg-surface-container-high/70 p-3">
          <p className="break-words text-base font-semibold text-on-surface [overflow-wrap:anywhere]">{model.title}</p>
          <p className="mt-1 break-words text-sm leading-6 tm-muted [overflow-wrap:anywhere]">{model.subtitle}</p>
          {targetItem ? <p className="mt-2 text-xs font-semibold text-on-surface-variant">{targetItem.locationName || targetItem.address || '地点待补全'}</p> : null}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Count label="已完成" value={model.counts.completed} />
          <Count label="已跳过" value={model.counts.skipped} />
          <Count label="待处理" value={model.counts.pending} />
        </div>

        {targetItem ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <InfoBlock icon={<Navigation className="size-3.5" />} label="预计路程" text={model.travelEstimate ? `${model.travelEstimate.minutes} 分钟 · ${model.travelEstimate.arrivalLabel} 到` : '暂无可靠单段估算'} />
            <InfoBlock icon={<Ticket className="size-3.5" />} label="相关票据" text={model.ticketTitles.length ? model.ticketTitles.join('、') : '暂无绑定票据'} />
            <InfoBlock icon={<MapPin className="size-3.5" />} label="开放时间" text={model.openingHours.detail} />
          </div>
        ) : null}

        {model.risks.length > 0 ? (
          <div className="space-y-2" data-testid="trip-live-risks">
            {model.risks.map((risk) => <RiskRow key={risk.id} onOpenOperation={onOpenOperation} risk={risk} />)}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 size-3.5" />暂未发现明显本地风险。</div>
        )}

        {targetItem ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={<ExternalLink className="size-4" />} onClick={() => onOpenItem(targetItem)} variant="secondary">详情</Button>
            <Button icon={<Map className="size-4" />} onClick={onOpenMap} variant="secondary">地图</Button>
            <Button disabled={model.ticketIds.length === 0} icon={<Ticket className="size-4" />} onClick={() => onOpenTickets(targetItem)} variant="secondary">票据</Button>
            {appleDirectionsUrl ? <a className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface-variant tm-focus" href={appleDirectionsUrl} rel="noreferrer" target="_blank"><Navigation className="size-4" />Apple 路线</a> : null}
            {googleDirectionsUrl ? <a className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface-variant tm-focus" href={googleDirectionsUrl} rel="noreferrer" target="_blank"><ExternalLink className="size-4" />Google 路线</a> : null}
          </div>
        ) : null}

        {targetItem ? (
          <div className="flex flex-wrap gap-2 border-t border-outline-variant/20 pt-3">
            <Button disabled={busyItemId === targetItem.id} icon={busyItemId === targetItem.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} onClick={() => void setExecutionState(targetItem, 'completed')}>已完成</Button>
            <Button disabled={busyItemId === targetItem.id} icon={<SkipForward className="size-4" />} onClick={() => void setExecutionState(targetItem, 'skipped')} variant="secondary">跳过</Button>
          </div>
        ) : null}

        {hasCriticalTimeRisk && targetItem ? (
          <div className="space-y-2 rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 dark:bg-amber-500/10" data-testid="trip-live-adjustment-actions">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">当前时间明显不够，可跳过或先生成调整预览。</p>
            <div className="flex flex-wrap gap-2">
              <Button icon={<SkipForward className="size-4" />} onClick={() => void setExecutionState(targetItem, 'skipped')} variant="secondary">跳过下一站</Button>
              <Button icon={<Scissors className="size-4" />} onClick={() => startAdjustment('compress')} variant="secondary">压缩安排</Button>
              <Button icon={<Sparkles className="size-4" />} onClick={() => startAdjustment('adjust')} variant="secondary">调整下一站</Button>
            </div>
          </div>
        ) : null}

        {patchPlan && patchPreview ? (
          <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-high/45 p-3" data-testid="trip-live-ai-patch-preview">
            <p className="text-xs font-semibold text-on-surface">{patchPlan.summary}</p>
            <p className="text-xs leading-5 tm-muted">影响 {patchPreview.affectedDayCount} 天、{patchPreview.affectedItemCount} 个行程点，尚未写入。</p>
            {!compact ? <ul className="space-y-1 text-xs leading-5 text-on-surface-variant">{patchPreview.lines.map((line) => <li key={line}>{line}</li>)}</ul> : null}
            <Button icon={<ShieldCheck className="size-4" />} onClick={() => setApplyConfirmOpen(true)} variant="secondary">应用修改</Button>
          </div>
        ) : null}

        {message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="trip-live-result">{message}</p> : null}
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="trip-live-error">{error}</p> : null}

        {model.completedItems.length + model.skippedItems.length > 0 ? (
          <Collapsible subtitle="恢复后会重新参与下一站判断。" title={`已处理行程点（${model.completedItems.length + model.skippedItems.length}）`}>
            <div className="space-y-2" data-testid="trip-live-processed-items">
              {[...model.completedItems, ...model.skippedItems].map((item) => (
                <div className="flex min-h-11 items-center justify-between gap-3" key={item.id}>
                  <span className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">{item.title} · {item.executionState?.status === 'completed' ? '已完成' : '已跳过'}</span>
                  <Button disabled={busyItemId === item.id} icon={<RotateCcw className="size-3.5" />} onClick={() => void setExecutionState(item, null)} variant="ghost">恢复</Button>
                </div>
              ))}
            </div>
          </Collapsible>
        ) : null}
      </Card>

      <ConfirmDialog
        body="将把脱敏后的旅行、日期和行程点信息发送给 AI 服务。只返回结构化修改方案，不会直接写入，也不会自动联网搜索。"
        cancelLabel="取消"
        confirmLabel="确认发送"
        icon={<Sparkles className="size-5" />}
        loading={generating}
        onCancel={() => !generating && setSendConfirmOpen(false)}
        onConfirm={() => void generatePatch()}
        open={sendConfirmOpen}
        testId="trip-live-ai-send-confirm-dialog"
        title="发送脱敏上下文？"
      />
      <ConfirmDialog
        body="将应用当前结构化修改方案。写入前会重新校验行程基线；行程已变化时会阻止写入。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<ShieldCheck className="size-5" />}
        loading={applying}
        onCancel={() => !applying && setApplyConfirmOpen(false)}
        onConfirm={() => void applyPatch()}
        open={applyConfirmOpen}
        testId="trip-live-ai-apply-confirm-dialog"
        title="应用行程调整？"
      />
    </>
  )
}

function StagePill({ stage }: { stage: TripLiveStage }) {
  const warning = stage === 'next_due'
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${warning ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-primary/10 text-primary'}`}>{warning ? <AlertTriangle className="size-3.5" /> : <Navigation className="size-3.5" />}{stageText(stage)}</span>
}

function stageText(stage: TripLiveStage) {
  if (stage === 'not_started') return '未出发'
  if (stage === 'en_route') return '前往下一站'
  if (stage === 'visiting') return '正在游览'
  if (stage === 'next_due') return '该去下一站'
  return '今日已结束'
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-surface-container-high/60 px-2 py-2"><strong className="block text-base text-on-surface">{value}</strong><span className="tm-muted">{label}</span></div>
}

function InfoBlock({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return <div className="min-w-0 rounded-lg bg-surface-container-high/60 p-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant">{icon}{label}</p><p className="mt-1 break-words text-xs leading-5 text-on-surface [overflow-wrap:anywhere]">{text}</p></div>
}

function RiskRow({ onOpenOperation, risk }: { onOpenOperation: (recommendation: TripOperationsRecommendation) => void; risk: TripLiveRisk }) {
  return <div className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-xs ${risk.severity === 'critical' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200' : risk.severity === 'warning' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200'}`}><div className="min-w-0"><p className="font-semibold">{risk.title}</p><p className="mt-0.5 break-words leading-5 [overflow-wrap:anywhere]">{risk.detail}</p></div>{risk.recommendation ? <Button className="shrink-0 px-3 text-xs" onClick={() => onOpenOperation(risk.recommendation!)} variant="ghost">处理</Button> : null}</div>
}

function buildAdjustmentCommand(kind: AdjustmentKind, day: Day, item: ItineraryItem) {
  if (kind === 'compress') {
    return `今天时间明显不足。请仅针对日期 ID ${day.id} 压缩「${item.title}」及其后续安排的时间，优先调整开始和结束时间，不删除地点，不添加新地点。`
  }
  return `今天时间明显不足。请仅针对日期 ID ${day.id} 和下一站「${item.title}」提出最小结构化调整，可修改时间或顺序，不添加新地点。`
}
