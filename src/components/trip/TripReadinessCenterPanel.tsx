import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Cloud,
  FileText,
  Loader2,
  MapPin,
  Route,
  ShieldCheck,
  Sparkles,
  Ticket,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  TRIP_CONTENT_ENRICHMENT_MAX_ITEMS,
  applyTripContentEnrichmentPreviewsToDb,
  estimateTripContentEnrichmentRequestCounts,
  type TripContentEnrichmentPreview,
} from '../../lib/ai/tripContentEnrichment'
import {
  saveTripDailyTravelTipPreviewToNotes,
  type TripDailyTravelTipEnhancedPreview,
  type TripDailyTravelTipModel,
} from '../../lib/ai/tripDailyTravelTip'
import { getProviderProxyConfig } from '../../lib/providerProxyClient'
import {
  buildTripReadinessRepairPreview,
  type TripReadinessIssue,
  type TripReadinessModel,
  type TripReadinessRepairPreview,
} from '../../lib/tripReadiness'
import { executeTripReadinessRepairPreview, type TripReadinessRepairExecutionResult } from '../../lib/tripReadinessRepair'
import { navigateTo } from '../../lib/routes'
import type { Day, ItineraryItem, Trip } from '../../types'

type TripReadinessCenterPanelProps = {
  allItems: ItineraryItem[]
  dailyTipModel: TripDailyTravelTipModel | null
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  model: TripReadinessModel
  onChanged: (options?: { refreshTripData?: boolean }) => Promise<void>
  trip: Trip
}

type RepairResult = Omit<TripReadinessRepairExecutionResult, 'contentPreview' | 'dailyTipPreview'>

type StoredPanelState = {
  applySuccess: string | null
  contentPreview: TripContentEnrichmentPreview | null
  dailyTipPreview: TripDailyTravelTipEnhancedPreview | null
  repairResult: RepairResult | null
}

const storedPanelStateByTripId = new Map<string, StoredPanelState>()

export function TripReadinessCenterPanel({
  allItems,
  dailyTipModel,
  days,
  itemsByDay,
  model,
  onChanged,
  trip,
}: TripReadinessCenterPanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const storedPanelState = getStoredPanelState(trip.id)
  const dayById = useMemo(() => new Map(days.map((day) => [day.id, day])), [days])
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, boolean>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingPreview, setPendingPreview] = useState<TripReadinessRepairPreview | null>(null)
  const [isRepairing, setIsRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [repairResult, setRepairResultState] = useState<RepairResult | null>(storedPanelState.repairResult)
  const [contentPreview, setContentPreviewState] = useState<TripContentEnrichmentPreview | null>(storedPanelState.contentPreview)
  const [dailyTipPreview, setDailyTipPreviewState] = useState<TripDailyTravelTipEnhancedPreview | null>(storedPanelState.dailyTipPreview)
  const [contentApplyConfirmOpen, setContentApplyConfirmOpen] = useState(false)
  const [dailyTipSaveConfirmOpen, setDailyTipSaveConfirmOpen] = useState(false)
  const [isApplyingContent, setIsApplyingContent] = useState(false)
  const [isSavingDailyTip, setIsSavingDailyTip] = useState(false)
  const [applySuccess, setApplySuccessState] = useState<string | null>(storedPanelState.applySuccess)

  const checkedIds = useMemo(
    () => model.issues
      .filter((issue) => selectionOverrides[issue.id] ?? issue.defaultSelected)
      .map((issue) => issue.id),
    [model.issues, selectionOverrides],
  )

  const batchPreview = useMemo(
    () => buildTripReadinessRepairPreview(model, checkedIds, 'batch'),
    [checkedIds, model],
  )
  const groups = useMemo(() => ({
    high: model.issues.filter((issue) => issue.severity === 'high'),
    low: model.issues.filter((issue) => issue.severity === 'low'),
    medium: model.issues.filter((issue) => issue.severity === 'medium'),
  }), [model.issues])
  const selectedLowFixableCount = batchPreview.issueIds.length

  function toggleIssue(issue: TripReadinessIssue) {
    if (!issue.canBatchFix || issue.severity !== 'low') {
      return
    }
    const selected = checkedIds.includes(issue.id)
    setSelectionOverrides((current) => ({ ...current, [issue.id]: !selected }))
  }

  function openBatchConfirm() {
    const preview = buildTripReadinessRepairPreview(model, checkedIds, 'batch')
    if (preview.issueIds.length === 0) {
      return
    }
    setPendingPreview(preview)
    setConfirmOpen(true)
  }

  function openSingleConfirm(issue: TripReadinessIssue) {
    const preview = buildTripReadinessRepairPreview(model, [issue.id], 'single')
    if (preview.issueIds.length === 0) {
      return
    }
    setPendingPreview(preview)
    setConfirmOpen(true)
  }

  function handleIssueAction(issue: TripReadinessIssue) {
    if (
      issue.actionKind === 'generate_routes' ||
      issue.actionKind === 'retry_ticket_upload' ||
      issue.actionKind === 'generate_content_preview' ||
      issue.actionKind === 'generate_daily_tip_preview'
    ) {
      openSingleConfirm(issue)
      return
    }
    if (issue.actionKind === 'navigate_item' && issue.dayId && issue.itemId) {
      navigateTo('item', { dayId: issue.dayId, itemId: issue.itemId, tripId: trip.id })
      return
    }
    if (issue.actionKind === 'navigate_tickets') {
      navigateTo('tickets', issue.itemId ? { itemId: issue.itemId, tripId: trip.id } : { tripId: trip.id })
      return
    }
    if (issue.actionKind === 'open_route_panel') {
      document.getElementById('route-preparation-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (issue.actionKind === 'open_sync') {
      document.getElementById('trip-sync-archive-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  async function handleConfirmRepair() {
    if (!pendingPreview) {
      return
    }
    const preview = pendingPreview
    setConfirmOpen(false)
    setIsRepairing(true)
    setRepairError(null)
    setStoredRepairResult(trip.id, null, setRepairResultState)
    setStoredApplySuccess(trip.id, null, setApplySuccessState)
    setStoredContentPreview(trip.id, null, setContentPreviewState)
    setStoredDailyTipPreview(trip.id, null, setDailyTipPreviewState)
    try {
      const result = await executeTripReadinessRepairPreview({
        allItems,
        dailyTipModel,
        days,
        itemsByDay,
        preview,
        providerConfig,
        trip,
      })
      if (result.contentPreview) {
        setStoredContentPreview(trip.id, result.contentPreview, setContentPreviewState)
      }
      if (result.dailyTipPreview) {
        setStoredDailyTipPreview(trip.id, result.dailyTipPreview, setDailyTipPreviewState)
      }
      setStoredRepairResult(trip.id, cloneRepairResult(result), setRepairResultState)

      setPendingPreview(null)
    } catch (caught) {
      setRepairError(caught instanceof Error ? caught.message : '出行前检查修复失败。')
    } finally {
      setIsRepairing(false)
    }
  }

  async function handleApplyContentPreview() {
    if (!contentPreview) {
      return
    }
    setIsApplyingContent(true)
    setRepairError(null)
    try {
      const result = await applyTripContentEnrichmentPreviewsToDb(
        trip.id,
        contentPreview.items,
        contentPreview.checkedIds,
        { expectedBaselineFingerprint: contentPreview.baselineFingerprint },
      )
      if (!result.ok) {
        setRepairError(result.errors.join('；'))
        return
      }
      setStoredContentPreview(trip.id, null, setContentPreviewState)
      setContentApplyConfirmOpen(false)
      setStoredApplySuccess(trip.id, `已写入 ${result.appliedCount} 个行程点的景点内容。`, setApplySuccessState)
      await onChanged({ refreshTripData: true })
    } finally {
      setIsApplyingContent(false)
    }
  }

  async function handleSaveDailyTipPreview() {
    if (!dailyTipPreview) {
      return
    }
    setIsSavingDailyTip(true)
    setRepairError(null)
    try {
      const result = await saveTripDailyTravelTipPreviewToNotes({
        expectedBaselineFingerprint: dailyTipPreview.baselineFingerprint,
        preview: dailyTipPreview,
        tripId: trip.id,
      })
      if (!result.ok) {
        setRepairError(result.errors.join('；'))
        return
      }
      setStoredDailyTipPreview(trip.id, null, setDailyTipPreviewState)
      setDailyTipSaveConfirmOpen(false)
      setStoredApplySuccess(trip.id, '已保存每日旅行提示到旅行备注。', setApplySuccessState)
      await onChanged({ refreshTripData: true })
    } finally {
      setIsSavingDailyTip(false)
    }
  }

  return (
    <>
      <Card className="space-y-4" data-testid="trip-readiness-center-panel" id="trip-readiness-center-panel" variant="grouped">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
              <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">出行前检查</h3>
            </div>
            <p className="mt-1 text-xs leading-5 tm-muted" data-testid="trip-readiness-summary">
              {model.summary.message}
            </p>
          </div>
          <div
            className={statusClassName(model.summary.status)}
            data-testid="trip-readiness-status"
          >
            {model.summary.statusLabel}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2" data-testid="trip-readiness-counts">
          <ReadinessMetric label="待处理" value={model.summary.totalCount} />
          <ReadinessMetric label="高风险" value={model.summary.highRiskCount} />
          <ReadinessMetric label="可批量" value={model.summary.fixableCount} />
        </div>

        {model.issues.length === 0 ? (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <span>路线、票据、内容和同步状态暂未发现明显阻塞项。</span>
          </div>
        ) : (
          <div className="space-y-4">
            <IssueGroup
              checkedIds={checkedIds}
              dayById={dayById}
              issues={groups.high}
              label="高风险"
              onAction={handleIssueAction}
              onToggle={toggleIssue}
            />
            <IssueGroup
              checkedIds={checkedIds}
              dayById={dayById}
              issues={groups.medium}
              label="建议处理"
              onAction={handleIssueAction}
              onToggle={toggleIssue}
            />
            <IssueGroup
              checkedIds={checkedIds}
              dayById={dayById}
              issues={groups.low}
              label="低风险"
              onAction={handleIssueAction}
              onToggle={toggleIssue}
            />
          </div>
        )}

        {model.issues.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 tm-muted" data-testid="trip-readiness-selected-summary">
              已选择 {selectedLowFixableCount} 项低风险修复，高风险不会进入批量静默处理。
            </p>
            <Button
              className="min-h-11 px-3 text-xs"
              data-testid="trip-readiness-batch-button"
              disabled={selectedLowFixableCount === 0 || isRepairing}
              icon={isRepairing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              loading={isRepairing}
              onClick={openBatchConfirm}
              variant="secondary"
            >
              批量修复 {selectedLowFixableCount} 项
            </Button>
          </div>
        ) : null}

        {repairResult ? (
          <div className="space-y-2 rounded-xl bg-sky-50/75 px-3 py-2 text-xs leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" data-testid="trip-readiness-repair-result">
            {repairResult.messages.map((message) => (
              <p className="flex items-start gap-2" key={message}>
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                <span>{message}</span>
              </p>
            ))}
            {repairResult.ticketErrors.map((message, index) => (
              <p className="flex items-start gap-2 text-amber-700 dark:text-amber-200" key={`${message}-${index}`}>
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{message}</span>
              </p>
            ))}
          </div>
        ) : null}

        {contentPreview ? (
          <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container-high/45 px-3 py-2" data-testid="trip-readiness-content-preview">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-on-surface dark:text-on-surface">景点内容待应用</p>
                <p className="mt-0.5 text-xs leading-5 tm-muted">
                  {contentPreview.items.length} 个行程点已生成预览，确认后才会写入。
                </p>
              </div>
              <Button
                className="min-h-11 shrink-0 px-3 text-xs"
                data-testid="trip-readiness-apply-content-button"
                disabled={contentPreview.items.length === 0 || isApplyingContent}
                loading={isApplyingContent}
                onClick={() => setContentApplyConfirmOpen(true)}
                variant="secondary"
              >
                应用内容
              </Button>
            </div>
          </div>
        ) : null}

        {dailyTipPreview ? (
          <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container-high/45 px-3 py-2" data-testid="trip-readiness-daily-tip-preview">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-on-surface dark:text-on-surface">每日提示待保存</p>
                <p className="mt-0.5 text-xs leading-5 tm-muted">
                  {dailyTipPreview.targetTitle}，确认后写入旅行备注。
                </p>
              </div>
              <Button
                className="min-h-11 shrink-0 px-3 text-xs"
                data-testid="trip-readiness-save-daily-tip-button"
                disabled={isSavingDailyTip}
                loading={isSavingDailyTip}
                onClick={() => setDailyTipSaveConfirmOpen(true)}
                variant="secondary"
              >
                保存提示
              </Button>
            </div>
          </div>
        ) : null}

        {applySuccess ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="trip-readiness-apply-success">
            {applySuccess}
          </p>
        ) : null}

        {repairError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="trip-readiness-error">
            {repairError}
          </p>
        ) : null}
      </Card>

      <ConfirmDialog
        body={buildRepairConfirmBody(pendingPreview, allItems, dailyTipModel)}
        cancelLabel="暂不处理"
        confirmLabel="确认处理"
        icon={<ShieldCheck className="size-5" />}
        loading={isRepairing}
        onCancel={() => {
          if (!isRepairing) {
            setConfirmOpen(false)
            setPendingPreview(null)
          }
        }}
        onConfirm={() => void handleConfirmRepair()}
        open={confirmOpen}
        testId="trip-readiness-repair-confirm-dialog"
        title="确认执行出行前修复？"
      />

      <ConfirmDialog
        body="将把当前内容补充预览写入对应行程点，并加入对象同步队列。"
        cancelLabel="暂不应用"
        confirmLabel="确认应用"
        icon={<FileText className="size-5" />}
        loading={isApplyingContent}
        onCancel={() => {
          if (!isApplyingContent) setContentApplyConfirmOpen(false)
        }}
        onConfirm={() => void handleApplyContentPreview()}
        open={contentApplyConfirmOpen}
        testId="trip-readiness-content-apply-confirm-dialog"
        title="应用景点内容预览？"
      />

      <ConfirmDialog
        body="将把当前每日旅行提示保存到旅行备注，并加入对象同步队列。"
        cancelLabel="暂不保存"
        confirmLabel="确认保存"
        icon={<Sparkles className="size-5" />}
        loading={isSavingDailyTip}
        onCancel={() => {
          if (!isSavingDailyTip) setDailyTipSaveConfirmOpen(false)
        }}
        onConfirm={() => void handleSaveDailyTipPreview()}
        open={dailyTipSaveConfirmOpen}
        testId="trip-readiness-daily-tip-save-confirm-dialog"
        title="保存每日旅行提示？"
      />
    </>
  )
}

function IssueGroup({
  checkedIds,
  dayById,
  issues,
  label,
  onAction,
  onToggle,
}: {
  checkedIds: string[]
  dayById: Map<string, Day>
  issues: TripReadinessIssue[]
  label: string
  onAction: (issue: TripReadinessIssue) => void
  onToggle: (issue: TripReadinessIssue) => void
}) {
  if (issues.length === 0) {
    return null
  }
  return (
    <div className="space-y-2" data-testid={`trip-readiness-group-${label}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-on-surface dark:text-on-surface">{label}</p>
        <span className="text-[11px] tm-muted">{issues.length} 项</span>
      </div>
      <div className="space-y-2">
        {issues.map((issue) => (
          <IssueRow
            checked={checkedIds.includes(issue.id)}
            day={issue.dayId ? dayById.get(issue.dayId) : undefined}
            issue={issue}
            key={issue.id}
            onAction={onAction}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}

function cloneRepairResult(result: RepairResult): RepairResult {
  return {
    messages: [...result.messages],
    retriedTicketIds: [...result.retriedTicketIds],
    routeResult: result.routeResult,
    ticketErrors: [...result.ticketErrors],
    ticketRetryCount: result.ticketRetryCount,
  }
}

function getStoredPanelState(tripId: string): StoredPanelState {
  return storedPanelStateByTripId.get(tripId) ?? {
    applySuccess: null,
    contentPreview: null,
    dailyTipPreview: null,
    repairResult: null,
  }
}

function updateStoredPanelState(tripId: string, patch: Partial<StoredPanelState>) {
  storedPanelStateByTripId.set(tripId, {
    ...getStoredPanelState(tripId),
    ...patch,
  })
}

function setStoredRepairResult(
  tripId: string,
  value: RepairResult | null,
  setState: (value: RepairResult | null) => void,
) {
  updateStoredPanelState(tripId, { repairResult: value })
  setState(value)
}

function setStoredContentPreview(
  tripId: string,
  value: TripContentEnrichmentPreview | null,
  setState: (value: TripContentEnrichmentPreview | null) => void,
) {
  updateStoredPanelState(tripId, { contentPreview: value })
  setState(value)
}

function setStoredDailyTipPreview(
  tripId: string,
  value: TripDailyTravelTipEnhancedPreview | null,
  setState: (value: TripDailyTravelTipEnhancedPreview | null) => void,
) {
  updateStoredPanelState(tripId, { dailyTipPreview: value })
  setState(value)
}

function setStoredApplySuccess(
  tripId: string,
  value: string | null,
  setState: (value: string | null) => void,
) {
  updateStoredPanelState(tripId, { applySuccess: value })
  setState(value)
}

function IssueRow({
  checked,
  day,
  issue,
  onAction,
  onToggle,
}: {
  checked: boolean
  day?: Day
  issue: TripReadinessIssue
  onAction: (issue: TripReadinessIssue) => void
  onToggle: (issue: TripReadinessIssue) => void
}) {
  const selectable = issue.canBatchFix && issue.severity === 'low'
  return (
    <div
      className="rounded-xl border border-outline-variant/30 bg-surface-container-high/40 px-3 py-2"
      data-issue-severity={issue.severity}
      data-issue-type={issue.type}
      data-testid="trip-readiness-issue"
    >
      <div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <label className={`flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg ${selectable ? 'cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#3895ff]' : ''}`}>
            <input
              aria-label={`选择 ${issue.title}`}
              checked={selectable && checked}
              className="mt-1 size-4 rounded border-outline-variant text-primary disabled:opacity-40"
              data-testid="trip-readiness-issue-checkbox"
              disabled={!selectable}
              onChange={() => onToggle(issue)}
              type="checkbox"
            />
            <span className="min-w-0 flex-1">
              <span className="block min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {issueIcon(issue)}
                  <p className="break-words text-xs font-semibold text-on-surface [overflow-wrap:anywhere] dark:text-on-surface">
                    {issue.title}
                  </p>
                  <span className={severityBadgeClassName(issue.severity)}>{severityLabel(issue.severity)}</span>
                </div>
                <p className="mt-1 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
                  {issue.message}
                </p>
                {day ? (
                  <p className="mt-0.5 text-[11px] leading-5 tm-muted">{day.title}</p>
                ) : null}
              </span>
            </span>
          </label>
          <Button
            className="min-h-11 shrink-0 px-2 text-xs"
            data-testid="trip-readiness-issue-action"
            icon={actionIcon(issue)}
            onClick={() => onAction(issue)}
            variant="secondary"
          >
            {issue.actionLabel}
          </Button>
        </div>
        {issue.evidence.length > 0 ? (
          <ul className="mt-2 space-y-1 text-[11px] leading-5 tm-muted" data-testid="trip-readiness-issue-evidence">
            {issue.evidence.slice(0, 2).map((line) => (
              <li className="break-words [overflow-wrap:anywhere]" key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function ReadinessMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high/35 px-3 py-2">
      <p className="text-[11px] tm-muted">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-on-surface dark:text-on-surface">{value}</p>
    </div>
  )
}

function buildRepairConfirmBody(
  preview: TripReadinessRepairPreview | null,
  allItems: ItineraryItem[],
  dailyTipModel: TripDailyTravelTipModel | null,
) {
  if (!preview) {
    return '确认后才会执行修复。'
  }
  const contentTargets = preview.contentItemIds
    .map((itemId) => allItems.find((item) => item.id === itemId))
    .filter((item): item is ItineraryItem => Boolean(item))
  const contentCounts = estimateTripContentEnrichmentRequestCounts(contentTargets)
  const dailyTipRequestCount = preview.dailyTipRequested && dailyTipModel ? dailyTipModel.searchTargets.length + 1 : 0
  const providerRequestCount = preview.routeDayIds.length + contentCounts.total + dailyTipRequestCount
  const parts = [
    preview.routeDayIds.length > 0 ? `生成 ${preview.routeDayIds.length} 天路线缓存` : '',
    preview.ticketIds.length > 0 ? `重试 ${preview.ticketIds.length} 张票据上传` : '',
    preview.contentItemIds.length > 0 ? `生成 ${Math.min(preview.contentItemIds.length, TRIP_CONTENT_ENRICHMENT_MAX_ITEMS)} 个景点内容预览` : '',
    preview.dailyTipRequested ? '生成每日旅行提示预览' : '',
  ].filter(Boolean)
  return [
    `将执行：${parts.length > 0 ? parts.join('、') : '暂无可执行项'}。`,
    `预计 provider/路线请求 ${providerRequestCount} 次；票据重试只改本地上传状态。确认前不会调用路线、AI、搜索或云端服务，也不会写入旅行内容。`,
    '内容补充和每日提示只会生成预览，仍需在结果区再次确认应用。',
  ].join('\n')
}

function statusClassName(status: TripReadinessModel['summary']['status']) {
  const base = 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-3 text-xs font-semibold'
  if (status === 'ready') {
    return `${base} bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200`
  }
  if (status === 'high_risk') {
    return `${base} bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200`
  }
  return `${base} bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200`
}

function severityBadgeClassName(severity: TripReadinessIssue['severity']) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold'
  if (severity === 'high') {
    return `${base} bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200`
  }
  if (severity === 'medium') {
    return `${base} bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200`
  }
  return `${base} bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200`
}

function severityLabel(severity: TripReadinessIssue['severity']) {
  if (severity === 'high') return '高风险'
  if (severity === 'medium') return '建议'
  return '低风险'
}

function issueIcon(issue: TripReadinessIssue) {
  if (issue.type === 'missing_coordinate') return <MapPin className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
  if (issue.type === 'missing_route' || issue.type === 'route_long_distance') return <Route className="size-3.5 shrink-0 text-sky-600 dark:text-sky-300" />
  if (issue.type === 'missing_ticket' || issue.type === 'ticket_unsynced') return <Ticket className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
  if (issue.type === 'missing_content' || issue.type === 'daily_tip_missing') return <Sparkles className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
  if (issue.type === 'cloud_sync_pending') return <Cloud className="size-3.5 shrink-0 text-slate-600 dark:text-slate-300" />
  if (issue.type === 'time_conflict') return <AlertTriangle className="size-3.5 shrink-0 text-red-600 dark:text-red-300" />
  return <CircleDot className="size-3.5 shrink-0 text-on-surface-variant" />
}

function actionIcon(issue: TripReadinessIssue) {
  if (issue.actionKind === 'generate_routes') return <Route className="size-3.5" />
  if (issue.actionKind === 'retry_ticket_upload' || issue.actionKind === 'navigate_tickets') return <Ticket className="size-3.5" />
  if (issue.actionKind === 'generate_content_preview' || issue.actionKind === 'generate_daily_tip_preview') return <Sparkles className="size-3.5" />
  if (issue.actionKind === 'open_sync') return <Cloud className="size-3.5" />
  if (issue.actionKind === 'navigate_item') return <MapPin className="size-3.5" />
  return <Route className="size-3.5" />
}
