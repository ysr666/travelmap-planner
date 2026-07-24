import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
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
import { listTripReplanRecordsByTrip } from '../../db'
import { prepareAiTripEditExecution } from '../../lib/ai/aiTripEditExecution'
import { applyAiTripEditPatchPlanToDb } from '../../lib/ai/aiTripEditApply'
import { buildAiTripEditPatchPreview, type AiTripEditPatchPlan, type AiTripEditPatchPreview } from '../../lib/ai/aiTripEditPatch'
import { PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION, PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION } from '../../lib/ai/providerProxyContract'
import { fetchProviderProxyAiTripEditPlan, fetchProviderProxyTravelSearch, getProviderProxyConfig, ProviderProxyClientError } from '../../lib/providerProxyClient'
import { buildAppleMapsDirectionsUrl, buildGoogleMapsDirectionsUrl } from '../../lib/mapLinks'
import type { RoutePreparationDay } from '../../lib/routePreparation'
import { buildTripLiveModel, type TripLiveRisk, type TripLiveStage } from '../../lib/tripLiveMode'
import type { TripOperationsRecommendation } from '../../lib/tripOperationsAgent'
import type { TripOperationsLocalState } from '../../lib/tripOperationsState'
import {
  appendTripIntelligenceExecutionRecord,
  executeTripIntelligenceAction,
  type ExecuteTripIntelligenceActionResult,
} from '../../lib/tripIntelligence'
import type { Day, ItineraryItem, TicketMeta, Trip, TripDisruptionKind, TripReplanRecord, TripReplanSourceEvidence } from '../../types'
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
  localState?: TripOperationsLocalState
  now?: Date
  onChanged: () => Promise<void>
  onLocalStateChange?: (state: TripOperationsLocalState) => void
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
type ReportKind = TripDisruptionKind

export function TripLiveModeCard({
  allItems,
  compact = false,
  day,
  days,
  items,
  localState,
  now,
  onChanged,
  onLocalStateChange,
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
  const [reportOpen, setReportOpen] = useState(false)
  const [reportKind, setReportKind] = useState<ReportKind>('late')
  const [reportDelayMinutes, setReportDelayMinutes] = useState(30)
  const [reportNotes, setReportNotes] = useState('')
  const [replanRecord, setReplanRecord] = useState<TripReplanRecord | null>(null)
  const [selectedReplanOptionId, setSelectedReplanOptionId] = useState<string | null>(null)
  const [replanApplyOpen, setReplanApplyOpen] = useState(false)
  const [replanBusy, setReplanBusy] = useState(false)
  const hasCriticalTimeRisk = model.risks.some((risk) => risk.kind === 'late' && risk.severity === 'critical')
  const targetItem = model.targetItem
  const appleDirectionsUrl = model.previousItem && targetItem
    ? buildAppleMapsDirectionsUrl(model.previousItem, targetItem, targetItem.previousTransportMode)
    : null
  const googleDirectionsUrl = model.previousItem && targetItem
    ? buildGoogleMapsDirectionsUrl(model.previousItem, targetItem, targetItem.previousTransportMode)
    : null

  useEffect(() => {
    let cancelled = false
    void listTripReplanRecordsByTrip(trip.id).then((records) => {
      if (cancelled) return
      const activeRecord = selectLatestActiveReplanRecord(records, day.id)
      setReplanRecord(activeRecord)
      setSelectedReplanOptionId(activeRecord?.selectedOptionId ?? activeRecord?.options[0]?.id ?? null)
    }).catch(() => {
      if (!cancelled) {
        setReplanRecord(null)
        setSelectedReplanOptionId(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [day.id, trip.id])

  async function setExecutionState(item: ItineraryItem, state: 'completed' | 'skipped' | null) {
    setBusyItemId(item.id)
    setError(null)
    try {
      const result = await executeTripIntelligenceAction({
        itemId: item.id,
        kind: 'live_set_item_execution_state',
        status: state,
      })
      if (result.status === 'failed' || !result.liveItem) {
        throw new Error(result.message)
      }
      commitLiveExecutionRecord(
        state === 'completed' ? '标记行程点完成' : state === 'skipped' ? '跳过行程点' : '恢复行程点',
        result,
      )
      setMessage(result.message)
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

  async function submitDisruptionReport() {
    setReplanBusy(true)
    setError(null)
    setMessage(null)
    try {
      const evidence = await fetchDisruptionEvidence({
        day,
        kind: reportKind,
        notes: reportNotes,
        providerConfig,
        targetItem: targetItem ?? null,
        trip,
      })
      const result = await executeTripIntelligenceAction({
        event: {
          dayId: day.id,
          delayMinutes: reportKind === 'delay' || reportKind === 'late' ? reportDelayMinutes : undefined,
          evidence,
          itemId: targetItem?.id,
          kind: reportKind,
          notes: reportNotes.trim() || undefined,
          occurredAt: new Date().toISOString(),
          reportedByRole: 'owner',
          status: 'reported',
          tripId: trip.id,
        },
        kind: 'live_report_disruption',
      })
      if (result.status === 'failed' || !result.replanRecord) {
        throw new Error(result.message)
      }
      const record = result.replanRecord
      setReplanRecord(record)
      setSelectedReplanOptionId(record.options[0]?.id ?? null)
      setReportOpen(false)
      commitLiveExecutionRecord('报告突发情况', result)
      setMessage(result.message)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成重排方案失败。')
    } finally {
      setReplanBusy(false)
    }
  }

  async function applySelectedReplan() {
    if (!replanRecord || !selectedReplanOptionId) return
    setReplanBusy(true)
    setError(null)
    try {
      const result = await executeTripIntelligenceAction({
        kind: 'replan_apply_option',
        optionId: selectedReplanOptionId,
        recordId: replanRecord.id,
      })
      if (result.status === 'failed' || !result.replanRecord) {
        throw new Error(result.message)
      }
      const applied = result.replanRecord
      setReplanRecord(applied)
      setReplanApplyOpen(false)
      commitLiveExecutionRecord('应用自适应重排', result)
      setMessage(result.message)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '应用重排方案失败。')
    } finally {
      setReplanBusy(false)
    }
  }

  async function undoAppliedReplan() {
    if (!replanRecord) return
    setReplanBusy(true)
    setError(null)
    try {
      const result = await executeTripIntelligenceAction({
        kind: 'replan_undo',
        recordId: replanRecord.id,
      })
      if (result.status === 'failed' || !result.replanRecord) {
        throw new Error(result.message)
      }
      const undone = result.replanRecord
      setReplanRecord(undone)
      commitLiveExecutionRecord('撤销自适应重排', result)
      setMessage(result.message)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销重排失败。')
    } finally {
      setReplanBusy(false)
    }
  }

  function commitLiveExecutionRecord(title: string, result: ExecuteTripIntelligenceActionResult) {
    if (!localState || !onLocalStateChange || result.appliedChanges.length === 0) return
    const fingerprints = [
      result.replanRecord ? `replan:${result.replanRecord.id}` : null,
      result.disruptionEvent ? `disruption:${result.disruptionEvent.id}` : null,
      result.liveItem ? `live-item:${result.liveItem.id}` : null,
    ].filter((fingerprint): fingerprint is string => Boolean(fingerprint))
    onLocalStateChange(appendTripIntelligenceExecutionRecord(localState, {
      fingerprints,
      intelligenceAppliedChanges: result.appliedChanges,
      legacyAppliedChanges: [],
      source: 'trip_operations',
      status: 'success',
      title,
    }))
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
      <LiveModeSurface compact={compact} model={model}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Navigation className="size-4" /></span>
              <h3 className="text-base font-semibold text-on-surface">实时行程</h3>
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
            <Button icon={<AlertTriangle className="size-4" />} onClick={() => setReportOpen((open) => !open)} variant="secondary">报告突发情况</Button>
            {appleDirectionsUrl ? <a className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface-variant tm-focus" href={appleDirectionsUrl} rel="noreferrer" target="_blank"><Navigation className="size-4" />Apple 路线</a> : null}
            {googleDirectionsUrl ? <a className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface-variant tm-focus" href={googleDirectionsUrl} rel="noreferrer" target="_blank"><ExternalLink className="size-4" />Google 路线</a> : null}
          </div>
        ) : null}

        {reportOpen ? (
          <div className="space-y-3 rounded-lg border border-outline-variant/30 bg-surface-container-high/45 p-3" data-testid="trip-live-disruption-report">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <label className="min-w-0 text-xs font-semibold text-on-surface-variant">
                类型
                <select
                  className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/50 bg-surface px-3 text-sm text-on-surface"
                  onChange={(event) => setReportKind(event.currentTarget.value as ReportKind)}
                  value={reportKind}
                >
                  <option value="late">迟到</option>
                  <option value="delay">航班/火车延误</option>
                  <option value="closure">地点关闭</option>
                  <option value="weather_unsuitable">天气不适合</option>
                  <option value="cancelled">取消</option>
                  <option value="skip">临时跳过</option>
                </select>
              </label>
              <label className="min-w-0 text-xs font-semibold text-on-surface-variant">
                延误分钟
                <input
                  className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/50 bg-surface px-3 text-sm text-on-surface"
                  disabled={reportKind !== 'delay' && reportKind !== 'late'}
                  min={0}
                  onChange={(event) => setReportDelayMinutes(Number(event.currentTarget.value) || 0)}
                  type="number"
                  value={reportDelayMinutes}
                />
              </label>
            </div>
            <label className="block text-xs font-semibold text-on-surface-variant">
              备注
              <textarea
                className="mt-1 min-h-20 w-full rounded-lg border border-outline-variant/50 bg-surface px-3 py-2 text-sm text-on-surface"
                maxLength={500}
                onChange={(event) => setReportNotes(event.currentTarget.value)}
                placeholder="例如：同行人还在路上，预计 30 分钟后到。"
                value={reportNotes}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={replanBusy} icon={replanBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} onClick={() => void submitDisruptionReport()}>生成重排方案</Button>
              <Button disabled={replanBusy} onClick={() => setReportOpen(false)} variant="ghost">取消</Button>
            </div>
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

        {replanRecord ? (
          <div className="space-y-3 rounded-lg border border-outline-variant/30 bg-surface-container-high/45 p-3" data-testid="trip-live-replan-preview">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-on-surface">突发情况与智能重排</p>
                <p className="mt-1 text-xs leading-5 tm-muted">{replanRecord.status === 'applied' ? '已应用，可整次撤销。' : replanRecord.status === 'undone' ? '这次重排已撤销。' : '选择一个方案后再确认写入。'}</p>
              </div>
              {replanRecord.status === 'applied' ? (
                <Button disabled={replanBusy} icon={<RotateCcw className="size-4" />} onClick={() => void undoAppliedReplan()} variant="secondary">撤销重排</Button>
              ) : null}
            </div>
            {replanRecord.status === 'preview' ? (
              <div className="grid gap-2 md:grid-cols-3">
                {replanRecord.options.map((option) => (
                  <button
                    className={`min-h-28 rounded-lg border p-3 text-left text-xs transition ${selectedReplanOptionId === option.id ? 'border-primary bg-primary/10 text-on-surface' : 'border-outline-variant/40 bg-surface text-on-surface-variant'}`}
                    key={option.id}
                    onClick={() => setSelectedReplanOptionId(option.id)}
                    type="button"
                  >
                    <span className="block font-semibold text-on-surface">{option.title}</span>
                    <span className="mt-1 block leading-5">{option.summary}</span>
                    <span className="mt-2 block font-semibold">影响 {option.diff.itemChanges.length} 项</span>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedReplanOptionId ? (
              <ReplanDiffPreview record={replanRecord} selectedOptionId={selectedReplanOptionId} />
            ) : null}
            {replanRecord.status === 'preview' ? (
              <Button disabled={!selectedReplanOptionId || replanBusy} icon={<ShieldCheck className="size-4" />} onClick={() => setReplanApplyOpen(true)} variant="secondary">确认应用重排</Button>
            ) : null}
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
      </LiveModeSurface>

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
      <ConfirmDialog
        body="将写入所选重排方案，并保存整次重排的撤销快照。票据、账本和交通订单不会自动取消或退款。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<ShieldCheck className="size-5" />}
        loading={replanBusy}
        onCancel={() => !replanBusy && setReplanApplyOpen(false)}
        onConfirm={() => void applySelectedReplan()}
        open={replanApplyOpen}
        testId="trip-live-replan-apply-confirm-dialog"
        title="应用自适应重排？"
      />
    </>
  )
}

const ACTIVE_REPLAN_RECORD_STATUSES = new Set<TripReplanRecord['status']>(['preview', 'applied', 'conflict'])

function LiveModeSurface({
  children,
  compact,
  model,
}: {
  children: ReactNode
  compact: boolean
  model: ReturnType<typeof buildTripLiveModel>
}) {
  if (!compact) {
    return (
      <Card className="space-y-4" data-testid="trip-live-mode-card" id="trip-live-mode-card" variant="grouped">
        {children}
      </Card>
    )
  }

  return (
    <details className="group" data-testid="trip-live-mode-card" id="trip-live-mode-card">
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 tm-group marker:hidden [&::-webkit-details-marker]:hidden tm-focus"
        data-testid="trip-live-mode-toggle"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Navigation className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-on-surface">实时行程</span>
            <span className="truncate text-[11px] font-semibold tm-muted">
              {stageText(model.stage)} · {model.currentTimeLabel}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs tm-muted">{model.title}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-outline transition-transform group-open:rotate-90 dark:text-on-surface-variant" />
      </summary>
      <Card className="mt-2 space-y-4" data-testid="trip-live-mode-card-content" variant="grouped">
        {children}
      </Card>
    </details>
  )
}

function selectLatestActiveReplanRecord(records: TripReplanRecord[], dayId: string) {
  return records
    .filter((record) => ACTIVE_REPLAN_RECORD_STATUSES.has(record.status) && replanRecordTouchesDay(record, dayId))
    .sort((left, right) => (right.updatedAt - left.updatedAt) || (right.createdAt - left.createdAt))[0] ?? null
}

function replanRecordTouchesDay(record: TripReplanRecord, dayId: string) {
  return record.beforeSnapshot.days.some((snapshotDay) => snapshotDay.id === dayId)
    || record.beforeSnapshot.items.some((item) => item.dayId === dayId)
    || Boolean(record.afterSnapshot?.days.some((snapshotDay) => snapshotDay.id === dayId))
    || Boolean(record.afterSnapshot?.items.some((item) => item.dayId === dayId))
}

function ReplanDiffPreview({ record, selectedOptionId }: { record: TripReplanRecord; selectedOptionId: string }) {
  const option = record.options.find((candidate) => candidate.id === selectedOptionId)
  const diff = record.status === 'applied' || record.status === 'undone'
    ? record.selectedDiff ?? option?.diff
    : option?.diff
  if (!option || !diff) return null
  return (
    <div className="space-y-2 text-xs leading-5" data-testid="trip-live-replan-diff">
      <div className="grid gap-2 md:grid-cols-2">
        {diff.itemChanges.slice(0, 6).map((change) => (
          <div className="rounded-lg bg-surface px-3 py-2" key={change.itemId}>
            <p className="font-semibold text-on-surface">{change.title}</p>
            <p className="tm-muted">{formatItemChange(change)}</p>
            <p className="text-on-surface-variant">{change.reason}</p>
          </div>
        ))}
      </div>
      {diff.ticketImpacts.length > 0 ? <p className="text-amber-700 dark:text-amber-200">{diff.ticketImpacts.map((impact) => impact.summary).join(' ')}</p> : null}
      {diff.ledgerImpacts.length > 0 ? <p className="text-amber-700 dark:text-amber-200">{diff.ledgerImpacts.map((impact) => impact.summary).join(' ')}</p> : null}
      {diff.companionImpacts.length > 0 ? <p className="text-primary">{diff.companionImpacts.map((impact) => impact.summary).join(' ')}</p> : null}
      {diff.warnings.length > 0 ? <ul className="space-y-1 text-on-surface-variant">{diff.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    </div>
  )
}

function StagePill({ stage }: { stage: TripLiveStage }) {
  const warning = stage === 'next_due'
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${warning ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-primary/10 text-on-primary-fixed dark:text-primary-fixed-dim'}`}>{warning ? <AlertTriangle className="size-3.5" /> : <Navigation className="size-3.5" />}{stageText(stage)}</span>
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

function formatItemChange(change: TripReplanRecord['options'][number]['diff']['itemChanges'][number]) {
  const beforeTime = [change.before.startTime, change.before.endTime].filter(Boolean).join('-') || '未定'
  const afterTime = [change.after.startTime, change.after.endTime].filter(Boolean).join('-') || '未定'
  if (change.changeType === 'skipped') return '改为跳过'
  if (change.changeType === 'day_changed') return `移动日期：${change.before.dayId} -> ${change.after.dayId}`
  if (change.changeType === 'reordered') return `顺序：${change.before.sortOrder} -> ${change.after.sortOrder}`
  if (change.changeType === 'time_changed') return `时间：${beforeTime} -> ${afterTime}`
  return '无变化'
}

async function fetchDisruptionEvidence({
  day,
  kind,
  notes,
  providerConfig,
  targetItem,
  trip,
}: {
  day: Day
  kind: ReportKind
  notes: string
  providerConfig: ReturnType<typeof getProviderProxyConfig>
  targetItem: ItineraryItem | null
  trip: Trip
}): Promise<TripReplanSourceEvidence[]> {
  if (!providerConfig.configured || !providerConfig.proxyUrl) return []
  const query = buildDisruptionSearchQuery({ day, kind, notes, targetItem, trip })
  if (!query) return []
  try {
    const response = await fetchProviderProxyTravelSearch({
      locale: 'zh-CN',
      maxResults: 3,
      operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
      query,
      region: trip.destination,
      searchType: kind === 'closure' ? 'opening_hours' : kind === 'weather_unsuitable' ? 'general' : 'transport',
    }, providerConfig.proxyUrl)
    return response.results.map((result, index) => ({
      confidence: result.confidence,
      displayUrl: result.displayUrl,
      domain: result.domain,
      id: `travel-search:${response.retrievedAt}:${index}`,
      kind: 'travel_search',
      label: result.title,
      retrievedAt: result.retrievedAt,
      snippet: result.snippet,
      sourceType: result.sourceType,
      url: result.url,
      warning: response.source === 'mock' ? '当前为模拟搜索结果，不代表实时网页信息。' : undefined,
    }))
  } catch {
    return []
  }
}

function buildDisruptionSearchQuery({
  day,
  kind,
  notes,
  targetItem,
  trip,
}: {
  day: Day
  kind: ReportKind
  notes: string
  targetItem: ItineraryItem | null
  trip: Trip
}) {
  const place = targetItem?.locationName || targetItem?.title || trip.destination
  if (kind === 'closure') return `${place} ${day.date} 开放时间 临时关闭 官方`
  if (kind === 'weather_unsuitable') return `${trip.destination} ${day.date} 天气 预警 官方`
  if (kind === 'delay') return `${notes || place} 航班 火车 延误 官方`
  return ''
}
