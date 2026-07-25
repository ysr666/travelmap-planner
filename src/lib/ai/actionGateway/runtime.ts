import {
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
  updateItineraryItem,
} from '../../../db'
import type {
  Day,
  ItineraryItem,
  TicketMeta,
  Trip,
} from '../../../types'
import { buildAiTripEditLocalStateFingerprint } from '../aiTripEditApply'
import { buildTripContext } from '../aiTripContext'
import {
  applyTripContentEnrichmentPreviewsToDb,
  generateTripContentEnrichmentPreview,
  type TripContentEnrichmentPreview,
} from '../tripContentEnrichment'
import {
  buildTripDailyTravelTip,
  generateEnhancedTripDailyTravelTip,
  saveTripDailyTravelTipPreviewToNotes,
  type TripDailyTravelTipEnhancedPreview,
  type TripDailyTravelTipModel,
} from '../tripDailyTravelTip'
import { PROVIDER_PROXY_PLACE_LOOKUP_OPERATION } from '../providerProxyContract'
import {
  resolveGlobalAiCommand,
  type GlobalAiCommandContext,
  type GlobalAiNavigationResult,
} from '../globalAiCommandRouter'
import { getCloudSyncQueueSummary, type CloudSyncQueueSummary } from '../../cloudSyncQueueSummary'
import { emitTravelDataChanged } from '../../dataEvents'
import { listTicketBlobSyncStatesByTrip } from '../../objectSyncLocal'
import {
  fetchProviderProxyPlaceLookup,
  type ProviderProxyRuntimeConfig,
} from '../../providerProxyClient'
import {
  getPersistentRouteProvider,
  loadTripRoutePreparation,
  type TripRoutePreparation,
} from '../../routePreparation'
import { generateRoutePreviewsForTrip } from '../../routeGeneration'
import { getRoutingConfig } from '../../routing'
import { analyzeTripContext, type TripCheckResult } from '../../tripCheck'
import {
  buildTripReadinessModel,
  buildTripReadinessRepairPreview,
  type TripReadinessIssue,
  type TripReadinessModel,
  type TripReadinessRepairPreview,
} from '../../tripReadiness'
import { retryTicketBlobUpload } from '../../cloudObjectSync'
import { getZonedPlainDate, resolveTripTimeZone } from '../../timeZone'
import { getStoredTravelProfile } from '../../travelProfile'
import {
  appendTripIntelligenceExecutionResult,
  type TripIntelligenceAppliedChange,
} from '../../tripIntelligence'
import {
  type AiActionPlaceEnrichArgs,
  type AiActionId,
  type AiActionItemTimeUpdateArgs,
  type AiActionManualEntry,
  type AiActionPlanV1,
  type AiActionPreparedPlan,
  type AiActionPreparedStep,
  type AiActionRunEffect,
  type AiActionRunResult,
  type AiActionStepRunResult,
  type AiActionTicketOpenArgs,
  type AiActionTripRepairArgs,
  type AiActionWorkspaceOpenArgs,
} from './types'
import { getAiActionMetadata } from './registry'

export type AiActionGatewayRuntimeContext = {
  command: string
  commandContext: GlobalAiCommandContext
  providerConfig: ProviderProxyRuntimeConfig
}

type PreparedTicketAction = {
  kind: 'ticket'
  navigation: GlobalAiNavigationResult
}

type PreparedWorkspaceAction = {
  kind: 'workspace'
  navigation: GlobalAiNavigationResult
}

type PreparedItemTimeAction = {
  changed: boolean
  item: ItineraryItem
  kind: 'item-time'
  nextEndTime?: string
  nextStartTime: string
}

type PreparedPlaceAction = {
  baselineFingerprint: string
  candidate: {
    displayName: string
    formattedAddress: string
    lat: number
    lng: number
    placeId: string
    retrievedAt: string
    source: string
  }
  item: ItineraryItem
  kind: 'place'
}

type TripRepairSnapshot = {
  allItems: ItineraryItem[]
  cloudSummary: CloudSyncQueueSummary
  dailyTipModel: TripDailyTravelTipModel | null
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  model: TripReadinessModel
  routePreparation: TripRoutePreparation
  tickets: TicketMeta[]
  trip: Trip
  tripCheck: TripCheckResult
}

type PreparedTripRepairAction = {
  baselineFingerprint: string
  contentPreview: TripContentEnrichmentPreview | null
  dailyTipPreview: TripDailyTravelTipEnhancedPreview | null
  kind: 'repair'
  manualIssues: TripReadinessIssue[]
  placeCandidates: Array<PreparedPlaceAction['candidate'] & { itemId: string; itemTitle: string }>
  preparationErrors: string[]
  preview: TripReadinessRepairPreview
  snapshot: TripRepairSnapshot
}

type PreparedAction =
  | PreparedItemTimeAction
  | PreparedPlaceAction
  | PreparedTicketAction
  | PreparedTripRepairAction
  | PreparedWorkspaceAction

type ActionExecutionResult = {
  appliedChanges: TripIntelligenceAppliedChange[]
  effects: AiActionRunEffect[]
  errors: string[]
  message: string
}

type AiActionRuntimeDefinition = {
  execute: (
    prepared: PreparedAction,
    context: AiActionGatewayRuntimeContext,
  ) => Promise<ActionExecutionResult>
  prepare: (
    args: AiActionPlanV1['steps'][number]['args'],
    context: AiActionGatewayRuntimeContext,
    baselineFingerprint?: string,
  ) => Promise<PreparedAction>
  preview: (prepared: PreparedAction) => {
    affectedLabels: string[]
    hasWrite: boolean
    manualEntry?: AiActionManualEntry
    text: string
  }
}

const ACTION_RUNTIME_DEFINITIONS: Record<AiActionId, AiActionRuntimeDefinition> = {
  'item.time.update@1': {
    execute: async (prepared) =>
      executeItemTimeAction(requirePreparedKind(prepared, 'item-time')),
    prepare: (args, context) =>
      prepareItemTimeAction(args as AiActionItemTimeUpdateArgs, context),
    preview: (prepared) => {
      const time = requirePreparedKind(prepared, 'item-time')
      return {
        affectedLabels: [time.item.title],
        hasWrite: time.changed,
        text: time.changed
          ? `${time.item.title}：${formatTimeRange(time.item.startTime, time.item.endTime)} → ${formatTimeRange(time.nextStartTime, time.nextEndTime)}。`
          : `${time.item.title} 的时间无需调整。`,
      }
    },
  },
  'place.enrich@1': {
    execute: async (prepared) => executePlaceAction(requirePreparedKind(prepared, 'place')),
    prepare: (args, context, baselineFingerprint) =>
      preparePlaceAction(args as AiActionPlaceEnrichArgs, context, baselineFingerprint),
    preview: (prepared) => {
      const place = requirePreparedKind(prepared, 'place')
      return {
        affectedLabels: [place.item.title],
        hasWrite: true,
        text: `${place.item.title}：${place.candidate.displayName}，${place.candidate.formattedAddress}。来源：${formatPlaceSource(place.candidate.source)}。`,
      }
    },
  },
  'ticket.open@1': {
    execute: async (prepared) => {
      const ticket = requirePreparedKind(prepared, 'ticket')
      return executeNavigationAction(ticket.navigation)
    },
    prepare: (args, context) => prepareTicketAction(args as AiActionTicketOpenArgs, context),
    preview: (prepared) => {
      const ticket = requirePreparedKind(prepared, 'ticket')
      return {
        affectedLabels: [ticket.navigation.title],
        hasWrite: false,
        text: ticket.navigation.message,
      }
    },
  },
  'trip.repair@1': {
    execute: (prepared) =>
      executeTripRepairAction(requirePreparedKind(prepared, 'repair')),
    prepare: (args, context, baselineFingerprint) =>
      prepareTripRepairAction(args as AiActionTripRepairArgs, context, baselineFingerprint),
    preview: (prepared) => {
      const repair = requirePreparedKind(prepared, 'repair')
      const total = repair.preview.issueIds.length
      const manualCount = repair.manualIssues.length
      return {
        affectedLabels: collectRepairAffectedLabels(repair),
        hasWrite: total > 0,
        manualEntry: manualCount > 0
          ? {
              kind: 'navigate',
              label: `查看 ${manualCount} 项待处理`,
              params: { tripId: repair.snapshot.trip.id },
              route: 'trip',
              scrollTargetId: 'trip-readiness-details-section',
            }
          : undefined,
        text: total > 0
          ? `将处理 ${total} 项：地点 ${repair.preview.placeItemIds.length}、路线 ${repair.preview.routeDayIds.length}、资料 ${repair.preview.contentItemIds.length}${manualCount > 0 ? `；另有 ${manualCount} 项需手动处理` : ''}。`
          : manualCount > 0
            ? `有 ${manualCount} 项需手动处理，不会自动改动。`
            : '没有发现需要修复的问题。',
      }
    },
  },
  'workspace.open@1': {
    execute: async (prepared) => {
      const workspace = requirePreparedKind(prepared, 'workspace')
      return executeNavigationAction(workspace.navigation)
    },
    prepare: (args, context) =>
      prepareWorkspaceAction(args as AiActionWorkspaceOpenArgs, context),
    preview: (prepared) => {
      const workspace = requirePreparedKind(prepared, 'workspace')
      return {
        affectedLabels: [workspace.navigation.title],
        hasWrite: false,
        text: workspace.navigation.message,
      }
    },
  },
}

export async function prepareAiActionPlan(
  plan: AiActionPlanV1,
  context: AiActionGatewayRuntimeContext,
  options: { completedStepIds?: string[] } = {},
): Promise<AiActionPreparedPlan> {
  const baselineFingerprint = context.commandContext.trip
    ? buildAiTripEditLocalStateFingerprint({
        days: context.commandContext.days,
        items: context.commandContext.items,
        trip: context.commandContext.trip,
      })
    : undefined
  const preparedSteps: AiActionPreparedStep[] = []
  const failedIds = new Set<string>()
  const completedIds = new Set(options.completedStepIds ?? [])

  for (const step of plan.steps) {
    if (completedIds.has(step.id)) {
      preparedSteps.push({
        actionId: step.actionId,
        affectedLabels: [],
        hasWrite: false,
        id: step.id,
        idempotencyKey: step.idempotencyKey,
        prepared: null,
        preview: '此前已完成，不会重复执行。',
        risk: step.risk,
        status: 'prepared',
      })
      continue
    }
    if (step.dependsOn.some((dependency) => failedIds.has(dependency))) {
      failedIds.add(step.id)
      preparedSteps.push({
        actionId: step.actionId,
        affectedLabels: [],
        error: '前置步骤准备失败。',
        hasWrite: false,
        id: step.id,
        idempotencyKey: step.idempotencyKey,
        prepared: null,
        preview: '前置步骤未准备完成。',
        risk: step.risk,
        status: 'failed',
      })
      continue
    }
    try {
      preparedSteps.push(await prepareStep(step, context, baselineFingerprint))
    } catch (caught) {
      failedIds.add(step.id)
      preparedSteps.push({
        actionId: step.actionId,
        affectedLabels: [],
        error: toErrorMessage(caught, '动作准备失败。'),
        hasWrite: false,
        id: step.id,
        idempotencyKey: step.idempotencyKey,
        prepared: null,
        preview: '无法生成可执行预览。',
        risk: step.risk,
        status: 'failed',
      })
    }
  }

  return {
    baselineFingerprint,
    plan: {
      ...plan,
      baselineFingerprint,
      requiresConfirmation: preparedSteps.some((step) => step.status === 'prepared' && step.hasWrite),
    },
    preparedAt: Date.now(),
    steps: preparedSteps,
  }
}

export async function executeAiActionPlan(
  preparedPlan: AiActionPreparedPlan,
  context: AiActionGatewayRuntimeContext,
  options: { completedStepIds?: string[] } = {},
): Promise<AiActionRunResult> {
  const previouslyCompleted = new Set(options.completedStepIds ?? [])
  const completed = new Set(previouslyCompleted)
  const failed = new Set<string>()
  const effects: AiActionRunEffect[] = []
  const results: AiActionStepRunResult[] = []
  const appliedChanges: TripIntelligenceAppliedChange[] = []
  const trip = context.commandContext.trip

  if (preparedPlan.plan.requiresConfirmation && trip && preparedPlan.baselineFingerprint) {
    const fresh = await loadFreshFingerprint(trip.id)
    if (fresh !== preparedPlan.baselineFingerprint) {
      return failedRun(
        preparedPlan,
        '旅行内容已变化，请重新生成预览。',
        [...previouslyCompleted],
      )
    }
  }

  for (const step of preparedPlan.plan.steps) {
    if (previouslyCompleted.has(step.id)) {
      results.push({ actionId: step.actionId, id: step.id, message: '此前已完成，未重复执行。', status: 'skipped' })
      continue
    }
    if (step.dependsOn.some((dependency) => failed.has(dependency) || !completed.has(dependency))) {
      failed.add(step.id)
      results.push({ actionId: step.actionId, id: step.id, message: '前置步骤未完成。', status: 'skipped' })
      continue
    }
    const preparedStep = preparedPlan.steps.find((candidate) => candidate.id === step.id)
    if (!preparedStep || preparedStep.status === 'failed' || !preparedStep.prepared) {
      failed.add(step.id)
      results.push({
        actionId: step.actionId,
        id: step.id,
        message: preparedStep?.error ?? '动作没有可执行预览。',
        status: 'failed',
      })
      continue
    }

    try {
      const output = await executePreparedAction(
        preparedStep.actionId,
        preparedStep.prepared as PreparedAction,
        context,
      )
      appliedChanges.push(...output.appliedChanges)
      effects.push(...output.effects)
      if (output.errors.length > 0) {
        failed.add(step.id)
        results.push({
          actionId: step.actionId,
          id: step.id,
          message: [output.message, ...output.errors].filter(Boolean).join(' '),
          status: 'failed',
        })
      } else {
        completed.add(step.id)
        results.push({ actionId: step.actionId, id: step.id, message: output.message, status: 'completed' })
      }
    } catch (caught) {
      failed.add(step.id)
      results.push({
        actionId: step.actionId,
        id: step.id,
        message: toErrorMessage(caught, '动作执行失败。'),
        status: 'failed',
      })
    }
  }

  const newCompletedIds = [...completed].filter((id) => !previouslyCompleted.has(id))
  const status = failed.size === 0
    ? 'completed'
    : completed.size > 0 || appliedChanges.length > 0
      ? 'partial'
      : 'failed'
  if (trip && appliedChanges.length > 0) {
    await appendTripIntelligenceExecutionResult(trip.id, {
      result: {
        appliedChanges,
        message: status === 'completed' ? 'AI 动作计划已完成。' : 'AI 动作计划部分完成。',
        status: status === 'completed' ? 'completed' : 'failed',
      },
      source: 'operations',
      title: preparedPlan.plan.summary,
    })
  }
  if (appliedChanges.length > 0) emitTravelDataChanged()

  return {
    completedStepIds: [...new Set([...previouslyCompleted, ...newCompletedIds])],
    effects,
    failedStepIds: [...failed],
    message: status === 'completed'
      ? '已完成。'
      : status === 'partial'
        ? '部分完成，可重试失败项。'
        : results[0]?.message ?? '没有动作完成。',
    status,
    steps: results,
  }
}

export function summarizePreparedAiActionPlan(prepared: AiActionPreparedPlan) {
  const ready = prepared.steps.filter((step) => step.status === 'prepared')
  const affectedCount = new Set(ready.flatMap((step) => step.affectedLabels)).size
  return {
    affectedCount,
    failedCount: prepared.steps.length - ready.length,
    readyCount: ready.length,
  }
}

async function prepareStep(
  step: AiActionPlanV1['steps'][number],
  context: AiActionGatewayRuntimeContext,
  baselineFingerprint?: string,
): Promise<AiActionPreparedStep> {
  if (getAiActionMetadata(step.actionId).requiresTrip && !context.commandContext.trip) {
    throw new Error('请先打开具体旅行。')
  }
  const definition = ACTION_RUNTIME_DEFINITIONS[step.actionId]
  const prepared = await definition.prepare(step.args, context, baselineFingerprint)
  const preview = definition.preview(prepared)
  return buildPreparedStep(
    step,
    prepared,
    preview.text,
    preview.affectedLabels,
    preview.hasWrite,
    preview.manualEntry,
  )
}

function buildPreparedStep(
  step: AiActionPlanV1['steps'][number],
  prepared: PreparedAction,
  preview: string,
  affectedLabels: string[],
  hasWrite: boolean,
  manualEntry?: AiActionManualEntry,
): AiActionPreparedStep {
  return {
    actionId: step.actionId,
    affectedLabels,
    hasWrite,
    id: step.id,
    idempotencyKey: step.idempotencyKey,
    manualEntry,
    prepared,
    preview,
    risk: step.risk,
    status: 'prepared',
  }
}

async function prepareTicketAction(
  args: AiActionTicketOpenArgs,
  context: AiActionGatewayRuntimeContext,
): Promise<PreparedTicketAction> {
  const command = args.query ? `找一下${args.query}的门票` : '打开票据'
  const result = await resolveGlobalAiCommand(command, context.commandContext)
  if (result.kind !== 'navigation') throw new Error('无法生成票据入口。')
  return { kind: 'ticket', navigation: result }
}

async function prepareWorkspaceAction(
  args: AiActionWorkspaceOpenArgs,
  context: AiActionGatewayRuntimeContext,
): Promise<PreparedWorkspaceAction> {
  const result = await resolveGlobalAiCommand(
    getWorkspaceNavigationCommand(args.target),
    context.commandContext,
  )
  if (result.kind !== 'navigation') throw new Error('无法生成页面入口。')
  return { kind: 'workspace', navigation: result }
}

function prepareItemTimeAction(
  args: AiActionItemTimeUpdateArgs,
  context: AiActionGatewayRuntimeContext,
): Promise<PreparedItemTimeAction> {
  const item = resolveItemTarget(args.target, context.commandContext)
  const day = context.commandContext.days.find((candidate) => candidate.id === item.dayId)
  const nextEndTime = args.endTime ?? preserveSameDayDuration(item, args.startTime, day)
  const spansLaterDate = Boolean(item.endDate && day && item.endDate > day.date)
  if (
    nextEndTime &&
    !spansLaterDate &&
    timeToMinutes(nextEndTime) < timeToMinutes(args.startTime)
  ) {
    throw new Error('结束时间不能早于开始时间。')
  }
  return Promise.resolve({
    changed: item.startTime !== args.startTime || item.endTime !== nextEndTime,
    item,
    kind: 'item-time',
    nextEndTime,
    nextStartTime: args.startTime,
  })
}

async function preparePlaceAction(
  args: AiActionPlaceEnrichArgs,
  context: AiActionGatewayRuntimeContext,
  baselineFingerprint?: string,
): Promise<PreparedPlaceAction> {
  const trip = requireTrip(context.commandContext)
  const item = resolveItemTarget(args.target, context.commandContext)
  const proxyUrl = requireProviderProxy(context.providerConfig)
  const response = await fetchProviderProxyPlaceLookup({
    locale: 'zh-CN',
    maxResults: 3,
    operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
    query: buildPlaceQuery(item, trip),
  }, proxyUrl)
  const candidate = response.results.find((entry) => isValidCoordinate(entry.location))
  if (!candidate?.location) throw new Error(`没有找到「${item.title}」的有效地点候选。`)
  return {
    baselineFingerprint: baselineFingerprint ?? buildAiTripEditLocalStateFingerprint({
      days: context.commandContext.days,
      items: context.commandContext.items,
      trip,
    }),
    candidate: {
      displayName: candidate.displayName,
      formattedAddress: candidate.formattedAddress,
      lat: candidate.location.lat,
      lng: candidate.location.lng,
      placeId: candidate.placeId,
      retrievedAt: candidate.retrievedAt,
      source: response.source,
    },
    item,
    kind: 'place',
  }
}

async function prepareTripRepairAction(
  args: AiActionTripRepairArgs,
  context: AiActionGatewayRuntimeContext,
  baselineFingerprint?: string,
): Promise<PreparedTripRepairAction> {
  const trip = requireTrip(context.commandContext)
  const snapshot = await loadTripRepairSnapshot(trip.id, context.commandContext.currentDay?.id)
  const scopedIssues = snapshot.model.issues
    .filter((issue) => issueMatchesRepairScope(issue, args, context.commandContext))
  const issueIds = scopedIssues
    .filter((issue) => issue.canBatchFix && issue.defaultSelected && issue.severity !== 'high')
    .map((issue) => issue.id)
  const autoIssueIds = new Set(issueIds)
  const manualIssues = scopedIssues.filter((issue) =>
    !autoIssueIds.has(issue.id) && (issue.severity === 'high' || !issue.canBatchFix),
  )
  const preview = buildTripReadinessRepairPreview(snapshot.model, issueIds, 'batch')
  const proxyUrl = context.providerConfig.configured
    ? context.providerConfig.proxyUrl ?? undefined
    : undefined
  const preparationErrors: string[] = []

  const [placeCandidates, contentPreview, dailyTipPreview] = await Promise.all([
    prepareRepairPlaceCandidates(preview, snapshot, proxyUrl, preparationErrors),
    prepareRepairContent(preview, snapshot, proxyUrl, preparationErrors),
    prepareRepairDailyTip(preview, snapshot, proxyUrl, preparationErrors),
  ])
  const executablePreview = includeRoutesUnlockedByPlaceCandidates(
    preview,
    snapshot,
    placeCandidates,
  )

  return {
    baselineFingerprint: baselineFingerprint ?? buildAiTripEditLocalStateFingerprint({
      days: snapshot.days,
      items: snapshot.allItems,
      trip: snapshot.trip,
    }),
    contentPreview,
    dailyTipPreview,
    kind: 'repair',
    manualIssues,
    placeCandidates,
    preparationErrors,
    preview: executablePreview,
    snapshot,
  }
}

async function executePreparedAction(
  actionId: AiActionId,
  prepared: PreparedAction,
  context: AiActionGatewayRuntimeContext,
): Promise<ActionExecutionResult> {
  return ACTION_RUNTIME_DEFINITIONS[actionId].execute(prepared, context)
}

async function executeItemTimeAction(
  prepared: PreparedItemTimeAction,
): Promise<ActionExecutionResult> {
  if (!prepared.changed) {
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: `「${prepared.item.title}」的时间无需调整。`,
    }
  }
  const updated = await updateItineraryItem(prepared.item.id, {
    ...(prepared.nextEndTime !== undefined ? { endTime: prepared.nextEndTime } : {}),
    startTime: prepared.nextStartTime,
  })
  if (!updated) throw new Error('行程点已不存在，请重新生成预览。')
  return {
    appliedChanges: [buildAppliedChange({
      actionType: 'global_ai_item_time_updated',
      detail: `已确认将时间调整为 ${formatTimeRange(updated.startTime, updated.endTime)}。`,
      targetId: updated.id,
      targetType: 'item',
      title: updated.title,
    })],
    effects: [],
    errors: [],
    message: `已调整「${updated.title}」的时间。`,
  }
}

function executeNavigationAction(navigation: GlobalAiNavigationResult): ActionExecutionResult {
  return {
    appliedChanges: [],
    effects: [{
      kind: 'navigate',
      params: navigation.params,
      route: navigation.route,
      scrollTargetId: navigation.scrollTargetId,
    }],
    errors: [],
    message: navigation.message,
  }
}

async function executePlaceAction(prepared: PreparedPlaceAction): Promise<ActionExecutionResult> {
  const updated = await updateItineraryItem(prepared.item.id, {
    address: prepared.candidate.formattedAddress,
    lat: prepared.candidate.lat,
    lng: prepared.candidate.lng,
    locationName: prepared.candidate.displayName,
  })
  if (!updated) throw new Error('行程点已不存在，请重新生成预览。')
  return {
    appliedChanges: [buildAppliedChange({
      actionType: 'global_ai_place_enriched',
      detail: '已确认地点候选并补充地址与坐标。',
      targetId: updated.id,
      targetType: 'item',
      title: updated.title,
    })],
    effects: [],
    errors: [],
    message: `已补全「${updated.title}」的地点信息。`,
  }
}

async function executeTripRepairAction(
  prepared: PreparedTripRepairAction,
): Promise<ActionExecutionResult> {
  const { preview, snapshot } = prepared
  const appliedChanges: TripIntelligenceAppliedChange[] = []
  const errors = [...prepared.preparationErrors]
  const messages: string[] = []

  if (prepared.contentPreview?.items.length) {
    const result = await applyTripContentEnrichmentPreviewsToDb(
      snapshot.trip.id,
      prepared.contentPreview.items,
      prepared.contentPreview.checkedIds,
    )
    if (result.ok) {
      messages.push(`已补充 ${result.appliedCount} 个行程点资料。`)
      prepared.contentPreview.items
        .filter((item) => prepared.contentPreview?.checkedIds.includes(item.id) && item.hasWrite)
        .forEach((item) => appliedChanges.push(buildAppliedChange({
          actionType: 'global_ai_content_enriched',
          detail: '已应用带来源的景点内容预览。',
          targetId: item.itemId,
          targetType: 'item',
          title: item.itemTitle,
        })))
    } else {
      errors.push(...result.errors)
    }
  }

  if (prepared.dailyTipPreview) {
    const result = await saveTripDailyTravelTipPreviewToNotes({
      preview: prepared.dailyTipPreview,
      tripId: snapshot.trip.id,
    })
    if (result.ok) {
      messages.push('已保存每日旅行提示。')
      appliedChanges.push(buildAppliedChange({
        actionType: 'global_ai_daily_tip_saved',
        detail: '已保存带来源的每日旅行提示。',
        targetId: snapshot.trip.id,
        targetType: 'trip',
        title: snapshot.trip.title,
      }))
    } else {
      errors.push(...result.errors)
    }
  }

  for (const candidate of prepared.placeCandidates) {
    try {
      const updated = await updateItineraryItem(candidate.itemId, {
        address: candidate.formattedAddress,
        lat: candidate.lat,
        lng: candidate.lng,
        locationName: candidate.displayName,
      })
      if (!updated) {
        errors.push(`${candidate.itemTitle} 已不存在。`)
        continue
      }
      appliedChanges.push(buildAppliedChange({
        actionType: 'global_ai_place_enriched',
        detail: '已确认地点候选并补充地址与坐标。',
        targetId: updated.id,
        targetType: 'item',
        title: updated.title,
      }))
    } catch {
      errors.push(`${candidate.itemTitle} 地点写入失败。`)
    }
  }
  if (prepared.placeCandidates.length > 0) messages.push(`已补全 ${prepared.placeCandidates.length} 个地点。`)

  if (preview.routeDayIds.length > 0) {
    const freshItems = await listItemsByTrip(snapshot.trip.id)
    const routeResult = await generateRoutePreviewsForTrip({
      config: getRoutingConfig(),
      days: snapshot.days,
      itemsByDay: groupItemsByDay(freshItems),
      targetDayIds: preview.routeDayIds,
      tripId: snapshot.trip.id,
    })
    messages.push(`已生成 ${routeResult.generatedCount} 天路线。`)
    routeResult.outcomes.filter((outcome) => outcome.saved).forEach((outcome) => {
      appliedChanges.push(buildAppliedChange({
        actionType: 'global_ai_route_generated',
        detail: '已生成并缓存当天路线预览。',
        targetId: outcome.day.id,
        targetType: 'day',
        title: outcome.day.title,
      }))
    })
    routeResult.outcomes.filter((outcome) => outcome.status === 'failed').forEach((outcome) => {
      errors.push(`${outcome.day.title} 路线生成失败。`)
    })
  }

  if (preview.ticketIds.length > 0) {
    const settled = await Promise.allSettled(preview.ticketIds.map((ticketId) => retryTicketBlobUpload(ticketId)))
    settled.forEach((entry, index) => {
      const ticketId = preview.ticketIds[index]
      const ticket = snapshot.tickets.find((candidate) => candidate.id === ticketId)
      if (entry.status === 'fulfilled') {
        appliedChanges.push(buildAppliedChange({
          actionType: 'global_ai_ticket_retry_queued',
          detail: '已将票据重新加入上传队列。',
          targetId: ticketId,
          targetType: 'ticket',
          title: ticket?.title || ticket?.fileName || '票据',
        }))
      } else {
        errors.push(`${ticket?.title || ticket?.fileName || '票据'} 重试失败。`)
      }
    })
    messages.push(`已处理 ${preview.ticketIds.length} 张票据同步。`)
  }

  return {
    appliedChanges,
    effects: [],
    errors: Array.from(new Set(errors)),
    message: messages.join(' ') || '没有需要写入的自动修复。',
  }
}

async function loadTripRepairSnapshot(tripId: string, selectedDayId?: string): Promise<TripRepairSnapshot> {
  const [trip, days, allItems, tickets, ticketBlobSyncStates, cloudSummary] = await Promise.all([
    getTrip(tripId),
    listDaysByTrip(tripId),
    listItemsByTrip(tripId),
    listTicketsByTrip(tripId),
    listTicketBlobSyncStatesByTrip(tripId),
    getCloudSyncQueueSummary(tripId),
  ])
  if (!trip) throw new Error('旅行不存在。')
  const itemsByDay = groupItemsByDay(allItems)
  const routePreparation = await loadTripRoutePreparation({
    days,
    itemsByDay,
    provider: getPersistentRouteProvider(getRoutingConfig()),
    tripId,
  })
  const tripContext = buildTripContext({
    days,
    items: allItems,
    nowPlainDate: getZonedPlainDate(new Date(), resolveTripTimeZone(trip)),
    profile: getStoredTravelProfile(),
    selectedDayId,
    tickets,
    trip,
  })
  const tripCheck = analyzeTripContext(tripContext)
  const dailyTipModel = buildTripDailyTravelTip({
    days,
    itemsByDay,
    routePreparation,
    trip,
    tripCheck,
  })
  const model = buildTripReadinessModel({
    allItems,
    cloudSummary,
    dailyTipModel,
    days,
    itemsByDay,
    routePreparation,
    ticketBlobSyncStates,
    tickets,
    trip,
    tripCheck,
  })
  return {
    allItems,
    cloudSummary,
    dailyTipModel,
    days,
    itemsByDay,
    model,
    routePreparation,
    tickets,
    trip,
    tripCheck,
  }
}

async function prepareRepairPlaceCandidates(
  preview: TripReadinessRepairPreview,
  snapshot: TripRepairSnapshot,
  proxyUrl: string | undefined,
  errors: string[],
) {
  if (preview.placeItemIds.length === 0) return []
  if (!proxyUrl) {
    errors.push('地点补全服务不可用。')
    return []
  }
  const itemById = new Map(snapshot.allItems.map((item) => [item.id, item]))
  const prepared = await mapWithConcurrency(preview.placeItemIds, 3, async (itemId) => {
    const item = itemById.get(itemId)
    if (!item) return null
    try {
      const response = await fetchProviderProxyPlaceLookup({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query: buildPlaceQuery(item, snapshot.trip),
      }, proxyUrl)
      const candidate = response.results.find((entry) => isValidCoordinate(entry.location))
      if (!candidate?.location) {
        errors.push(`${item.title} 没有有效地点候选。`)
        return null
      }
      return {
        displayName: candidate.displayName,
        formattedAddress: candidate.formattedAddress,
        itemId,
        itemTitle: item.title,
        lat: candidate.location.lat,
        lng: candidate.location.lng,
        placeId: candidate.placeId,
        retrievedAt: candidate.retrievedAt,
        source: response.source,
      }
    } catch {
      errors.push(`${item.title} 地点查询失败。`)
      return null
    }
  })
  return prepared.filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
}

async function prepareRepairContent(
  preview: TripReadinessRepairPreview,
  snapshot: TripRepairSnapshot,
  proxyUrl: string | undefined,
  errors: string[],
) {
  if (preview.contentItemIds.length === 0) return null
  if (!proxyUrl) {
    errors.push('景点内容补充服务不可用。')
    return null
  }
  try {
    const targetIds = new Set(preview.contentItemIds)
    return await generateTripContentEnrichmentPreview({
      days: snapshot.days,
      items: snapshot.allItems,
      proxyUrl,
      targets: snapshot.allItems.filter((item) => targetIds.has(item.id)),
      trip: snapshot.trip,
    })
  } catch {
    errors.push('景点内容预览生成失败。')
    return null
  }
}

async function prepareRepairDailyTip(
  preview: TripReadinessRepairPreview,
  snapshot: TripRepairSnapshot,
  proxyUrl: string | undefined,
  errors: string[],
) {
  if (!preview.dailyTipRequested) return null
  if (!proxyUrl || !snapshot.dailyTipModel) {
    errors.push('每日旅行提示服务不可用。')
    return null
  }
  try {
    return await generateEnhancedTripDailyTravelTip({
      model: snapshot.dailyTipModel,
      proxyUrl,
      trip: snapshot.trip,
    })
  } catch {
    errors.push('每日旅行提示预览生成失败。')
    return null
  }
}

function includeRoutesUnlockedByPlaceCandidates(
  preview: TripReadinessRepairPreview,
  snapshot: TripRepairSnapshot,
  candidates: PreparedTripRepairAction['placeCandidates'],
): TripReadinessRepairPreview {
  if (!snapshot.routePreparation.providerConfigured || candidates.length === 0) return preview
  const candidateItemIds = new Set(candidates.map((candidate) => candidate.itemId))
  const routeDayIds = new Set(preview.routeDayIds)
  for (const day of snapshot.days) {
    const dayItems = snapshot.itemsByDay[day.id] ?? []
    if (!dayItems.some((item) => candidateItemIds.has(item.id))) continue
    const futureCoordinateCount = dayItems.filter((item) =>
      isValidCoordinate(
        candidateItemIds.has(item.id)
          ? candidates.find((candidate) => candidate.itemId === item.id)
          : item.lat !== undefined && item.lng !== undefined
            ? { lat: item.lat, lng: item.lng }
            : undefined,
      )).length
    if (futureCoordinateCount >= 2) routeDayIds.add(day.id)
  }
  const nextRouteDayIds = [...routeDayIds]
  if (nextRouteDayIds.length === preview.routeDayIds.length) return preview
  return {
    ...preview,
    requestCounts: {
      ...preview.requestCounts,
      routeGeneration: nextRouteDayIds.length,
      totalProviderRequests: preview.requestCounts.totalProviderRequests
        + nextRouteDayIds.length
        - preview.routeDayIds.length,
    },
    routeDayIds: nextRouteDayIds,
  }
}

function resolveItemTarget(target: string, context: GlobalAiCommandContext) {
  const ordered = orderItems(context.days, context.items)
  if (target === 'current_item') {
    if (!context.currentItem) throw new Error('请先打开具体行程点。')
    return context.currentItem
  }
  if (target === 'first_item') {
    const first = context.currentDay
      ? ordered.find((item) => item.dayId === context.currentDay?.id)
      : ordered[0]
    if (!first) throw new Error('当前旅行还没有行程点。')
    return first
  }
  const ordinal = target.match(/第\s*(\d{1,2})\s*站/)
  if (ordinal) {
    const item = ordered[Number(ordinal[1]) - 1]
    if (!item) throw new Error('没有找到对应站点。')
    return item
  }
  const normalized = normalizeText(target)
  const matches = ordered.filter((item) =>
    [item.title, item.locationName, item.address]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalized.includes(normalizeText(value)) || normalizeText(value).includes(normalized)),
  )
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error('找到多个匹配行程点，请写清楚名称。')
  throw new Error('没有找到目标行程点。')
}

function issueMatchesRepairScope(
  issue: TripReadinessIssue,
  args: AiActionTripRepairArgs,
  context: GlobalAiCommandContext,
) {
  if (args.scope === 'trip') return true
  if (args.scope === 'day') return Boolean(context.currentDay && issue.dayId === context.currentDay.id)
  return Boolean(context.currentItem && issue.itemId === context.currentItem.id)
}

function collectRepairAffectedLabels(prepared: PreparedTripRepairAction) {
  const issueIds = new Set([
    ...prepared.preview.issueIds,
    ...prepared.manualIssues.map((issue) => issue.id),
  ])
  return prepared.snapshot.model.issues
    .filter((issue) => issueIds.has(issue.id))
    .map((issue) => issue.title)
}

async function loadFreshFingerprint(tripId: string) {
  const [trip, days, items] = await Promise.all([
    getTrip(tripId),
    listDaysByTrip(tripId),
    listItemsByTrip(tripId),
  ])
  if (!trip) return ''
  return buildAiTripEditLocalStateFingerprint({ days, items, trip })
}

function failedRun(
  prepared: AiActionPreparedPlan,
  message: string,
  completedStepIds: string[] = [],
): AiActionRunResult {
  const completed = new Set(completedStepIds)
  const failedStepIds = prepared.plan.steps
    .filter((step) => !completed.has(step.id))
    .map((step) => step.id)
  return {
    completedStepIds,
    effects: [],
    failedStepIds,
    message,
    status: completed.size > 0 ? 'partial' : 'failed',
    steps: prepared.plan.steps.map((step) => ({
      actionId: step.actionId,
      id: step.id,
      message: completed.has(step.id) ? '此前已完成，未重复执行。' : message,
      status: completed.has(step.id) ? 'skipped' : 'failed',
    })),
  }
}

function requirePreparedKind<TKind extends PreparedAction['kind']>(
  prepared: PreparedAction,
  kind: TKind,
): Extract<PreparedAction, { kind: TKind }> {
  if (prepared.kind !== kind) throw new Error('动作预览类型不匹配。')
  return prepared as Extract<PreparedAction, { kind: TKind }>
}

function requireTrip(context: GlobalAiCommandContext) {
  if (!context.trip) throw new Error('请先打开一个具体旅行。')
  return context.trip
}

function requireProviderProxy(config: ProviderProxyRuntimeConfig) {
  if (!config.configured || !config.proxyUrl) {
    throw new Error('请先登录或刷新云端账号后再使用 AI / 地点服务。')
  }
  return config.proxyUrl
}

function buildPlaceQuery(item: ItineraryItem, trip: Trip) {
  return Array.from(new Set([item.locationName, item.address, item.title, trip.destination]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value)))).join(' ')
}

function isValidCoordinate(location: { lat: number; lng: number } | undefined): location is { lat: number; lng: number } {
  return Boolean(
    location &&
    Number.isFinite(location.lat) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    Number.isFinite(location.lng) &&
    location.lng >= -180 &&
    location.lng <= 180,
  )
}

function formatPlaceSource(source: string) {
  if (source === 'google_places' || source === 'google') return 'Google Places'
  if (source === 'mock') return '测试地点服务'
  return '地点服务'
}

function getWorkspaceNavigationCommand(target: AiActionWorkspaceOpenArgs['target']) {
  if (target === 'documents') return '打开资料中心'
  if (target === 'home') return '打开首页'
  if (target === 'inbox') return '打开收件箱'
  if (target === 'ledger') return '打开账本'
  if (target === 'map') return '打开地图'
  if (target === 'search') return '打开搜索'
  if (target === 'settings') return '打开设置'
  return '打开行程总览'
}

function preserveSameDayDuration(item: ItineraryItem, nextStartTime: string, day?: Day) {
  if (!item.endTime) return undefined
  if (!item.startTime || (item.endDate && day && item.endDate > day.date)) return item.endTime
  const startMinutes = timeToMinutes(item.startTime)
  const endMinutes = timeToMinutes(item.endTime)
  if (endMinutes < startMinutes) return item.endTime
  const nextEndMinutes = timeToMinutes(nextStartTime) + endMinutes - startMinutes
  if (nextEndMinutes >= 24 * 60) {
    throw new Error('调整后会跨天，请同时写清楚结束时间。')
  }
  return formatMinutes(nextEndMinutes)
}

function formatTimeRange(startTime?: string, endTime?: string) {
  if (startTime && endTime) return `${startTime}-${endTime}`
  return startTime ?? endTime ?? '时间未定'
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function orderItems(days: Day[], items: ItineraryItem[]) {
  const dayOrder = new Map([...days]
    .sort((first, second) => first.sortOrder - second.sortOrder)
    .map((day, index) => [day.id, index]))
  return [...items].sort((first, second) =>
    (dayOrder.get(first.dayId) ?? Number.MAX_SAFE_INTEGER) - (dayOrder.get(second.dayId) ?? Number.MAX_SAFE_INTEGER) ||
    first.sortOrder - second.sortOrder ||
    first.id.localeCompare(second.id),
  )
}

function groupItemsByDay(items: ItineraryItem[]) {
  return items.reduce<Record<string, ItineraryItem[]>>((grouped, item) => {
    grouped[item.dayId] = [...(grouped[item.dayId] ?? []), item]
    return grouped
  }, {})
}

function buildAppliedChange({
  actionType,
  detail,
  targetId,
  targetType,
  title,
}: {
  actionType: string
  detail: string
  targetId: string
  targetType: TripIntelligenceAppliedChange['targetType']
  title: string
}): TripIntelligenceAppliedChange {
  const occurredAt = Date.now()
  return {
    actionType,
    detail,
    id: `action-gateway:${hashString(`${actionType}:${targetId}:${occurredAt}`)}`,
    occurredAt,
    source: { id: 'ai_action_gateway', kind: 'operations', label: 'Global AI' },
    targetId,
    targetType,
    title,
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput) => Promise<TOutput>,
) {
  const output = new Array<TOutput>(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return output
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function hashString(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
