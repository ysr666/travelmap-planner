import {
  createItineraryItemIdempotent,
  createLedgerExpenseIdempotent,
  db,
  getItineraryItem,
  getLedgerSettingsByTrip,
  getTrip,
  ItineraryBaselineConflictError,
  listDaysByTrip,
  listItemsByTrip,
  listLedgerExpenses,
  listLedgerParticipants,
  listTicketsByTrip,
  reorderDayItems,
  updateItineraryItem,
} from '../../../db'
import { createId } from '../../../db/ids'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerParticipant,
  LedgerSettings,
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
import { todayInTimeZone } from '../../timeSemantics'
import { getStoredTravelProfile } from '../../travelProfile'
import {
  formatLedgerMoney,
  ledgerCategoryLabels,
  normalizeCurrencyCode,
  parseMoneyInput,
} from '../../ledger'
import {
  appendTripIntelligenceExecutionResult,
  buildTripIntelligenceAppliedChangeRecordId,
  type TripIntelligenceAppliedChange,
} from '../../tripIntelligence'
import {
  type AiActionDayItemsReorderArgs,
  type AiActionItemCreateArgs,
  type AiActionPlaceEnrichArgs,
  type AiActionId,
  type AiActionItemTimeUpdateArgs,
  type AiActionLedgerExpenseDraftArgs,
  type AiActionManualEntry,
  type AiActionPlanV1,
  type AiActionPreparedPlan,
  type AiActionPreparedStep,
  type AiActionRunEffect,
  type AiActionRunResult,
  type AiActionRoutePreviewArgs,
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

type PreparedItemCreateAction = {
  day: Day
  endTime?: string
  existingItem?: ItineraryItem
  expectedCurrentItemIds: string[]
  itemId: string
  kind: 'item-create'
  operationFingerprint: string
  sortOrder: number
  startTime?: string
  title: string
  trip: Trip
}

type PreparedDayItemsReorderAction = {
  changed: boolean
  currentIndex: number
  currentItemIds: string[]
  day: Day
  kind: 'day-items-reorder'
  nextIndex: number
  nextItemIds: string[]
  operationFingerprint: string
  target: ItineraryItem
  trip: Trip
}

type PreparedLedgerExpenseDraftAction = {
  amountMinor: number
  category: LedgerExpenseCategory
  currency: string
  date: string
  existingExpense?: LedgerExpense
  itemIds: string[]
  kind: 'ledger-expense-draft'
  ledgerBaseline: string
  operationFingerprint: string
  title: string
  trip: Trip
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

type PreparedRoutePreviewAction = {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  kind: 'route-preview'
  provider: NonNullable<TripRoutePreparation['provider']>
  routingFingerprint: string
  targetDays: Day[]
  targetDayIds: string[]
  trip: Trip
}

type PreparedAction =
  | PreparedDayItemsReorderAction
  | PreparedItemCreateAction
  | PreparedItemTimeAction
  | PreparedLedgerExpenseDraftAction
  | PreparedPlaceAction
  | PreparedRoutePreviewAction
  | PreparedTicketAction
  | PreparedTripRepairAction
  | PreparedWorkspaceAction

type ActionExecutionResult = {
  appliedChanges: TripIntelligenceAppliedChange[]
  effects: AiActionRunEffect[]
  errors: string[]
  message: string
}

class FreshConfirmationRequiredError extends Error {}

type AiActionRuntimeDefinition = {
  execute: (
    prepared: PreparedAction,
    context: AiActionGatewayRuntimeContext,
  ) => Promise<ActionExecutionResult>
  prepare: (
    args: AiActionPlanV1['steps'][number]['args'],
    context: AiActionGatewayRuntimeContext,
    preparation: {
      baselineFingerprint?: string
      executionId: string
      idempotencyKey: string
    },
  ) => Promise<PreparedAction>
  preview: (prepared: PreparedAction) => {
    affectedLabels: string[]
    hasWrite: boolean
    manualEntry?: AiActionManualEntry
    text: string
  }
}

const ACTION_RUNTIME_DEFINITIONS: Record<AiActionId, AiActionRuntimeDefinition> = {
  'day.items.reorder@1': {
    execute: async (prepared) =>
      executeDayItemsReorderAction(requirePreparedKind(prepared, 'day-items-reorder')),
    prepare: (args, context, preparation) =>
      prepareDayItemsReorderAction(
        args as AiActionDayItemsReorderArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const reorder = requirePreparedKind(prepared, 'day-items-reorder')
      return {
        affectedLabels: [reorder.target.title],
        hasWrite: reorder.changed,
        text: reorder.changed
          ? `${reorder.target.title}：第 ${reorder.currentIndex + 1} 位 → 第 ${reorder.nextIndex + 1} 位。`
          : `${reorder.target.title} 已在目标位置。`,
      }
    },
  },
  'item.create@1': {
    execute: async (prepared) =>
      executeItemCreateAction(requirePreparedKind(prepared, 'item-create')),
    prepare: (args, context, preparation) =>
      prepareItemCreateAction(
        args as AiActionItemCreateArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const item = requirePreparedKind(prepared, 'item-create')
      return {
        affectedLabels: [item.title],
        hasWrite: !item.existingItem,
        text: item.existingItem
          ? `「${item.title}」已由本次操作创建，不会重复新增。`
          : `${item.day.title}：将在末尾新增「${item.title}」${item.startTime ? ` · ${formatTimeRange(item.startTime, item.endTime)}` : ''}。`,
      }
    },
  },
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
  'ledger.expense.draft@1': {
    execute: async (prepared) =>
      executeLedgerExpenseDraftAction(requirePreparedKind(prepared, 'ledger-expense-draft')),
    prepare: (args, context, preparation) =>
      prepareLedgerExpenseDraftAction(
        args as AiActionLedgerExpenseDraftArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const expense = requirePreparedKind(prepared, 'ledger-expense-draft')
      return {
        affectedLabels: [expense.title],
        hasWrite: !expense.existingExpense,
        text: expense.existingExpense
          ? `「${expense.title}」费用草稿已存在，不会重复创建。`
          : `${expense.title}：${formatLedgerMoney(expense.amountMinor, expense.currency)} · ${ledgerCategoryLabels[expense.category]} · ${expense.date}；将创建待审核草稿。`,
      }
    },
  },
  'place.enrich@1': {
    execute: async (prepared) => executePlaceAction(requirePreparedKind(prepared, 'place')),
    prepare: (args, context, preparation) =>
      preparePlaceAction(
        args as AiActionPlaceEnrichArgs,
        context,
        preparation.baselineFingerprint,
      ),
    preview: (prepared) => {
      const place = requirePreparedKind(prepared, 'place')
      return {
        affectedLabels: [place.item.title],
        hasWrite: true,
        text: `${place.item.title}：${place.candidate.displayName}，${place.candidate.formattedAddress}。来源：${formatPlaceSource(place.candidate.source)}。`,
      }
    },
  },
  'route.preview@1': {
    execute: async (prepared) =>
      executeRoutePreviewAction(requirePreparedKind(prepared, 'route-preview')),
    prepare: (args, context) =>
      prepareRoutePreviewAction(args as AiActionRoutePreviewArgs, context),
    preview: (prepared) => {
      const route = requirePreparedKind(prepared, 'route-preview')
      return {
        affectedLabels: route.targetDays.map((day) => day.title),
        hasWrite: route.targetDayIds.length > 0,
        text: route.targetDayIds.length > 0
          ? `将为 ${route.targetDayIds.length} 天生成路线预览；确认后才调用路线服务。`
          : '所选日期已有可用路线预览，无需重复生成。',
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
    prepare: (args, context, preparation) =>
      prepareTripRepairAction(
        args as AiActionTripRepairArgs,
        context,
        preparation.baselineFingerprint,
      ),
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
  options: { completedStepIds?: string[]; executionId?: string } = {},
): Promise<AiActionPreparedPlan> {
  const executionId = options.executionId ?? createId('ai_action_run')
  const preparedAt = Date.now()
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
        confirmationFingerprint: step.idempotencyKey,
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
        confirmationFingerprint: '',
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
      preparedSteps.push(await prepareStep(
        step,
        context,
        baselineFingerprint,
        executionId,
      ))
    } catch (caught) {
      failedIds.add(step.id)
      preparedSteps.push({
        actionId: step.actionId,
        affectedLabels: [],
        confirmationFingerprint: '',
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
    executionId,
    plan: {
      ...plan,
      baselineFingerprint,
      requiresConfirmation: preparedSteps.some((step) => step.status === 'prepared' && step.hasWrite),
    },
    preparedAt,
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
  let requiresFreshConfirmation = false

  if (preparedPlan.plan.requiresConfirmation && trip && preparedPlan.baselineFingerprint) {
    const fresh = await loadFreshFingerprint(trip.id)
    if (fresh !== preparedPlan.baselineFingerprint) {
      return failedRun(
        preparedPlan,
        '旅行内容已变化，请重新生成预览。',
        [...previouslyCompleted],
        true,
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
      const message = preparedStep?.error ?? '动作没有可执行预览。'
      results.push({
        actionId: step.actionId,
        id: step.id,
        message,
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
      const message = toErrorMessage(caught, '动作执行失败。')
      requiresFreshConfirmation ||= caught instanceof FreshConfirmationRequiredError
      results.push({
        actionId: step.actionId,
        id: step.id,
        message,
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
    requiresFreshConfirmation,
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
  baselineFingerprint: string | undefined,
  executionId: string,
): Promise<AiActionPreparedStep> {
  if (getAiActionMetadata(step.actionId).requiresTrip && !context.commandContext.trip) {
    throw new Error('请先打开具体旅行。')
  }
  const definition = ACTION_RUNTIME_DEFINITIONS[step.actionId]
  const prepared = await definition.prepare(step.args, context, {
    baselineFingerprint,
    executionId,
    idempotencyKey: step.idempotencyKey,
  })
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
    confirmationFingerprint: hashString(stableStringify(prepared)),
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

async function prepareItemCreateAction(
  args: AiActionItemCreateArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedItemCreateAction> {
  const trip = requireTrip(context.commandContext)
  const day = resolveExplicitDayTarget(args.day, context.commandContext)
  const currentItems = orderItems(context.commandContext.days, context.commandContext.items)
    .filter((item) => item.dayId === day.id)
  const operationFingerprint = buildActionOperationFingerprint(
    preparation.executionId,
    preparation.idempotencyKey,
  )
  const itemId = buildActionItemId(preparation.executionId)
  const existingItem = await getItineraryItem(itemId)
  return {
    day,
    ...(args.endTime ? { endTime: args.endTime } : {}),
    ...(existingItem ? { existingItem } : {}),
    expectedCurrentItemIds: currentItems.map((item) => item.id),
    itemId,
    kind: 'item-create',
    operationFingerprint,
    sortOrder: existingItem?.sortOrder
      ?? Math.max(0, ...currentItems.map((item) => item.sortOrder)) + 1,
    ...(args.startTime ? { startTime: args.startTime } : {}),
    title: args.title,
    trip,
  }
}

function prepareDayItemsReorderAction(
  args: AiActionDayItemsReorderArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedDayItemsReorderAction> {
  const trip = requireTrip(context.commandContext)
  const explicitDay = args.day
    ? resolveExplicitDayTarget(args.day, context.commandContext)
    : undefined
  const scopedDay = explicitDay ?? context.commandContext.currentDay
  const target = scopedDay
    ? resolveItemTargetInDay(args.target, scopedDay, context.commandContext)
    : resolveItemTarget(args.target, context.commandContext)
  const day = scopedDay
    ?? context.commandContext.days.find((candidate) => candidate.id === target.dayId)
  if (!day) throw new Error('目标日期已不存在。')
  if (target.dayId !== day.id) throw new Error('目标行程点不在所选日期。')

  const currentItems = orderItems(context.commandContext.days, context.commandContext.items)
    .filter((item) => item.dayId === day.id)
  const currentItemIds = currentItems.map((item) => item.id)
  const currentIndex = currentItemIds.indexOf(target.id)
  if (currentIndex < 0) throw new Error('目标行程点不在所选日期。')
  const nextItemIds = currentItemIds.filter((itemId) => itemId !== target.id)
  let insertionIndex = 0
  if (args.position === 'last') {
    insertionIndex = nextItemIds.length
  } else if (args.position === 'before' || args.position === 'after') {
    if (!args.anchor) throw new Error('请写清楚相对位置的参照行程点。')
    const anchor = resolveItemTargetInDay(args.anchor, day, context.commandContext)
    if (anchor.id === target.id) throw new Error('目标与参照行程点不能相同。')
    const anchorIndex = nextItemIds.indexOf(anchor.id)
    if (anchorIndex < 0) throw new Error('参照行程点不在所选日期。')
    insertionIndex = anchorIndex + (args.position === 'after' ? 1 : 0)
  }
  nextItemIds.splice(insertionIndex, 0, target.id)
  const nextIndex = nextItemIds.indexOf(target.id)
  return Promise.resolve({
    changed: nextItemIds.some((itemId, index) => itemId !== currentItemIds[index]),
    currentIndex,
    currentItemIds,
    day,
    kind: 'day-items-reorder',
    nextIndex,
    nextItemIds,
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    target,
    trip,
  })
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

async function prepareLedgerExpenseDraftAction(
  args: AiActionLedgerExpenseDraftArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedLedgerExpenseDraftAction> {
  const trip = requireTrip(context.commandContext)
  const operationFingerprint = buildActionOperationFingerprint(
    preparation.executionId,
    preparation.idempotencyKey,
  )
  const [settings, participants, expenses] = await Promise.all([
    getLedgerSettingsByTrip(trip.id),
    listLedgerParticipants(trip.id),
    listLedgerExpenses(trip.id),
  ])
  if (!settings) throw new Error('请先在账本建立币种和预算。')
  if (participants.length === 0) throw new Error('请先在账本添加同行人。')
  const currency = normalizeCurrencyCode(args.currency ?? settings.tripCurrency)
  const amountMinor = parseMoneyInput(args.amount, currency)
  if (!amountMinor || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('费用金额无效。')
  }
  const today = todayInTimeZone(resolveTripTimeZone(trip))
  const defaultDate = context.commandContext.currentDay?.date
    ?? (today >= trip.startDate && today <= trip.endDate ? today : trip.startDate)
  return {
    amountMinor,
    category: args.category ?? 'other',
    currency,
    date: args.date ?? defaultDate,
    existingExpense: expenses.find((expense) =>
      expense.source.kind === 'manual' &&
      expense.source.fingerprint === operationFingerprint,
    ),
    itemIds: context.commandContext.currentItem ? [context.commandContext.currentItem.id] : [],
    kind: 'ledger-expense-draft',
    ledgerBaseline: buildLedgerBaseline(settings, participants),
    operationFingerprint,
    title: args.title,
    trip,
  }
}

async function prepareRoutePreviewAction(
  args: AiActionRoutePreviewArgs,
  context: AiActionGatewayRuntimeContext,
): Promise<PreparedRoutePreviewAction> {
  const trip = requireTrip(context.commandContext)
  const config = getRoutingConfig()
  const provider = getPersistentRouteProvider(config)
  if (!provider) throw new Error('当前路线服务不可用。')
  const itemsByDay = groupItemsByDay(context.commandContext.items)
  const preparation = await loadTripRoutePreparation({
    days: context.commandContext.days,
    itemsByDay,
    provider,
    tripId: trip.id,
  })
  const selectedDays = args.scope === 'day'
    ? [resolveDayTarget(args.target, context.commandContext)]
    : preparation.days
      .filter((entry) => entry.eligible)
      .map((entry) => entry.day)
  if (selectedDays.length === 0) throw new Error('没有至少包含两个坐标点的日期。')

  const selectedIds = new Set(selectedDays.map((day) => day.id))
  const targetDayIds = preparation.days
    .filter((entry) =>
      selectedIds.has(entry.day.id) &&
      (entry.status === 'ready_to_generate' || entry.status === 'stale_if_cache_key_changed'),
    )
    .map((entry) => entry.day.id)
  const unavailableDay = preparation.days.find((entry) =>
    selectedIds.has(entry.day.id) && !entry.eligible,
  )
  if (args.scope === 'day' && unavailableDay) {
    throw new Error(`${unavailableDay.day.title} 至少需要两个有坐标的行程点。`)
  }
  return {
    days: context.commandContext.days,
    itemsByDay,
    kind: 'route-preview',
    provider,
    routingFingerprint: buildRoutingFingerprint(config),
    targetDays: selectedDays,
    targetDayIds,
    trip,
  }
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

async function executeActionMutationWithHistory<T>(
  tripId: string,
  title: string,
  mutation: () => Promise<{
    change: TripIntelligenceAppliedChange
    value: T
  }>,
) {
  let output: T | undefined
  await db.transaction(
    'rw',
    [
      db.days,
      db.itineraryItems,
      db.trips,
      db.syncOutbox,
      db.objectSyncStates,
      db.tripIntelligenceAppliedChanges,
      db.tripIntelligenceSuggestionStates,
    ],
    async () => {
      const result = await mutation()
      await appendTripIntelligenceExecutionResult(tripId, {
        result: {
          appliedChanges: [result.change],
          message: 'AI 动作计划已完成。',
          status: 'completed',
        },
        source: 'operations',
        title,
      }, result.change.occurredAt)
      output = result.value
    },
  )
  if (output === undefined) throw new Error('动作事务没有返回结果。')
  return output
}

async function hasPersistedActionChange(tripId: string, operationFingerprint: string) {
  const changeId = `action-gateway:${operationFingerprint}`
  const recordId = buildTripIntelligenceAppliedChangeRecordId(tripId, changeId)
  return Boolean(await db.tripIntelligenceAppliedChanges.get(recordId))
}

function matchesPreparedItemCreate(
  item: ItineraryItem,
  prepared: PreparedItemCreateAction,
) {
  return item.tripId === prepared.trip.id
    && item.dayId === prepared.day.id
    && item.title === prepared.title
    && item.startTime === prepared.startTime
    && item.endTime === prepared.endTime
}

async function executeItemCreateAction(
  prepared: PreparedItemCreateAction,
): Promise<ActionExecutionResult> {
  if (await hasPersistedActionChange(prepared.trip.id, prepared.operationFingerprint)) {
    const existing = await getItineraryItem(prepared.itemId)
    if (!existing || !matchesPreparedItemCreate(existing, prepared)) {
      throw new FreshConfirmationRequiredError('新增记录与操作历史不一致，请重新生成预览。')
    }
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: `「${existing.title}」已存在，未重复创建。`,
    }
  }
  try {
    const result = await executeActionMutationWithHistory(prepared.trip.id, '新增行程点', async () => {
      const creation = await createItineraryItemIdempotent({
        dayId: prepared.day.id,
        ...(prepared.endTime ? { endTime: prepared.endTime } : {}),
        sortOrder: prepared.sortOrder,
        ...(prepared.startTime ? { startTime: prepared.startTime } : {}),
        ticketIds: [],
        title: prepared.title,
        tripId: prepared.trip.id,
      }, {
        expectedCurrentItemIds: prepared.expectedCurrentItemIds,
        id: prepared.itemId,
      })
      return {
        change: buildAppliedChange({
          actionType: 'global_ai_item_created',
          detail: `已确认新增到「${prepared.day.title}」末尾。`,
          idempotencyKey: prepared.operationFingerprint,
          occurredAt: creation.item.createdAt,
          targetId: creation.item.id,
          targetType: 'item',
          title: creation.item.title,
        }),
        value: creation,
      }
    })
    return {
      appliedChanges: [],
      effects: result.created
        ? [buildDayScheduleEffect(prepared.trip.id, prepared.day.id)]
        : [],
      errors: [],
      message: result.created
        ? `已新增「${result.item.title}」。`
        : `「${result.item.title}」已存在，未重复创建。`,
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
}

async function executeDayItemsReorderAction(
  prepared: PreparedDayItemsReorderAction,
): Promise<ActionExecutionResult> {
  if (!prepared.changed) {
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: `「${prepared.target.title}」已在目标位置。`,
    }
  }
  if (await hasPersistedActionChange(prepared.trip.id, prepared.operationFingerprint)) {
    const freshItems = orderItems(
      [prepared.day],
      (await listItemsByTrip(prepared.trip.id)).filter((item) => item.dayId === prepared.day.id),
    )
    if (
      freshItems.length !== prepared.nextItemIds.length
      || !prepared.nextItemIds.every((itemId, index) => itemId === freshItems[index]?.id)
    ) {
      throw new FreshConfirmationRequiredError('当天顺序已变化，请重新生成预览。')
    }
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: `「${prepared.target.title}」已在目标位置，未重复调整。`,
    }
  }
  try {
    await executeActionMutationWithHistory(prepared.trip.id, '调整当天顺序', async () => {
      const changedItems = await reorderDayItems(
        prepared.day.id,
        prepared.nextItemIds,
        prepared.currentItemIds,
      )
      if (changedItems.length === 0) {
        throw new ItineraryBaselineConflictError('当天顺序已变化，请重新生成预览。')
      }
      return {
        change: buildAppliedChange({
          actionType: 'global_ai_day_items_reordered',
          detail: `已确认从第 ${prepared.currentIndex + 1} 位调整到第 ${prepared.nextIndex + 1} 位。`,
          idempotencyKey: prepared.operationFingerprint,
          targetId: prepared.target.id,
          targetType: 'item',
          title: prepared.target.title,
        }),
        value: changedItems,
      }
    })
    return {
      appliedChanges: [],
      effects: [buildDayScheduleEffect(prepared.trip.id, prepared.day.id)],
      errors: [],
      message: `已调整「${prepared.target.title}」的当天顺序。`,
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
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

async function executeLedgerExpenseDraftAction(
  prepared: PreparedLedgerExpenseDraftAction,
): Promise<ActionExecutionResult> {
  const [settings, participants, expenses] = await Promise.all([
    getLedgerSettingsByTrip(prepared.trip.id),
    listLedgerParticipants(prepared.trip.id),
    listLedgerExpenses(prepared.trip.id),
  ])
  const existingExpense = expenses.find((expense) =>
    expense.source.kind === 'manual' &&
    expense.source.fingerprint === prepared.operationFingerprint,
  )
  if (
    !existingExpense &&
    (!settings || buildLedgerBaseline(settings, participants) !== prepared.ledgerBaseline)
  ) {
    throw new FreshConfirmationRequiredError('账本设置或同行人已变化，请重新生成预览。')
  }
  const creation = existingExpense
    ? { created: false, record: existingExpense }
    : await createLedgerExpenseIdempotent({
        amountMinor: prepared.amountMinor,
        category: prepared.category,
        currency: prepared.currency,
        date: prepared.date,
        itemIds: prepared.itemIds,
        orderStatus: 'active',
        paymentStatus: 'unknown',
        reviewStatus: 'needs_review',
        source: {
          fingerprint: prepared.operationFingerprint,
          kind: 'manual',
          label: '全局 AI 草稿',
        },
        splitMode: 'equal',
        splitShares: participants.map((participant) => ({
          participantId: participant.id,
          weight: 1,
        })),
        status: 'draft',
        title: prepared.title,
        tripId: prepared.trip.id,
      })
  const expense = creation.record
  return {
    appliedChanges: [buildAppliedChange({
      actionType: 'ledger_expense_draft_created',
      detail: '已创建待审核费用草稿；付款人、分摊和汇率仍需在账本确认。',
      idempotencyKey: prepared.operationFingerprint,
      occurredAt: expense.createdAt,
      targetId: expense.id,
      targetType: 'finance',
      title: expense.title,
    })],
    effects: [{
      kind: 'navigate',
      params: { expenseId: expense.id, tripId: prepared.trip.id },
      route: 'ledger/expense',
    }],
    errors: [],
    message: creation.created
      ? `已创建「${expense.title}」费用草稿。`
      : `「${expense.title}」费用草稿已存在，未重复创建。`,
  }
}

async function executeRoutePreviewAction(
  prepared: PreparedRoutePreviewAction,
): Promise<ActionExecutionResult> {
  const config = getRoutingConfig()
  if (
    getPersistentRouteProvider(config) !== prepared.provider ||
    buildRoutingFingerprint(config) !== prepared.routingFingerprint
  ) {
    throw new FreshConfirmationRequiredError('路线服务配置已变化，请重新生成预览。')
  }
  const navigationDay = prepared.targetDays[0]
  if (prepared.targetDayIds.length === 0) {
    return {
      appliedChanges: [],
      effects: navigationDay ? [buildDayMapEffect(prepared.trip.id, navigationDay.id)] : [],
      errors: [],
      message: '所选日期已有可用路线预览。',
    }
  }
  const result = await generateRoutePreviewsForTrip({
    config,
    days: prepared.days,
    itemsByDay: prepared.itemsByDay,
    targetDayIds: prepared.targetDayIds,
    tripId: prepared.trip.id,
  })
  const saved = result.outcomes.filter((outcome) => outcome.saved)
  const errors = result.outcomes
    .filter((outcome) => !outcome.saved && outcome.status !== 'cached')
    .map((outcome) => outcome.status === 'generated'
      ? `${outcome.day.title} 路线未保存，可清理或调整路线缓存后重试。`
      : `${outcome.day.title} 路线生成失败。`)
  return {
    appliedChanges: saved.map((outcome) => buildAppliedChange({
      actionType: 'global_ai_route_generated',
      detail: '已确认调用路线服务并缓存当天路线预览。',
      targetId: outcome.day.id,
      targetType: 'day',
      title: outcome.day.title,
    })),
    effects: saved.length > 0 && navigationDay
      ? [buildDayMapEffect(prepared.trip.id, navigationDay.id)]
      : [],
    errors,
    message: saved.length > 0
      ? `已生成 ${saved.length} 天路线预览。`
      : '路线服务没有生成可用预览。',
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

function resolveItemTargetInDay(
  target: string,
  day: Day,
  context: GlobalAiCommandContext,
) {
  const ordered = orderItems(context.days, context.items)
    .filter((item) => item.dayId === day.id)
  if (target === 'current_item') {
    if (!context.currentItem || context.currentItem.dayId !== day.id) {
      throw new Error('当前行程点不在所选日期。')
    }
    return context.currentItem
  }
  if (target === 'first_item') {
    const first = ordered[0]
    if (!first) throw new Error('所选日期还没有行程点。')
    return first
  }
  const ordinal = target.match(/第\s*(\d{1,2})\s*站/)
  if (ordinal) {
    const item = ordered[Number(ordinal[1]) - 1]
    if (!item) throw new Error('所选日期没有对应站点。')
    return item
  }
  const normalized = normalizeText(target)
  const matches = ordered.filter((item) =>
    [item.title, item.locationName, item.address]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalized.includes(normalizeText(value)) || normalizeText(value).includes(normalized)),
  )
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error('所选日期有多个匹配行程点，请写清楚名称。')
  throw new Error('所选日期没有找到目标行程点。')
}

function resolveDayTarget(target: string | undefined, context: GlobalAiCommandContext) {
  const ordered = [...context.days]
    .sort((first, second) => first.sortOrder - second.sortOrder || first.date.localeCompare(second.date))
  if (ordered.length === 0) throw new Error('当前旅行还没有日期。')
  if (!target || target === 'current_day') {
    if (context.currentDay) return context.currentDay
    const trip = requireTrip(context)
    const today = todayInTimeZone(resolveTripTimeZone(trip))
    return ordered.find((day) => day.date === today) ?? ordered[0]
  }
  if (target === 'first_day') return ordered[0]
  const ordinal = target.match(/^(?:day:|第\s*)(\d{1,2})(?:\s*天)?$/)
  if (ordinal) {
    const day = ordered[Number(ordinal[1]) - 1]
    if (!day) throw new Error('没有找到对应日期。')
    return day
  }
  const normalized = normalizeText(target)
  const matches = ordered.filter((day) =>
    day.date === target ||
    normalized.includes(normalizeText(day.title)) ||
    normalizeText(day.title).includes(normalized),
  )
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error('找到多个匹配日期，请写清楚日期。')
  throw new Error('没有找到目标日期。')
}

function resolveExplicitDayTarget(target: string, context: GlobalAiCommandContext) {
  if (target !== 'current_day' || context.currentDay) {
    return resolveDayTarget(target, context)
  }
  const trip = requireTrip(context)
  const today = todayInTimeZone(resolveTripTimeZone(trip))
  const todayMatch = context.days.find((day) => day.date === today)
  if (todayMatch) return todayMatch
  throw new Error('当前页面没有明确日期，请写清楚第几天。')
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
  requiresFreshConfirmation = false,
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
    requiresFreshConfirmation,
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

function buildLedgerBaseline(settings: LedgerSettings, participants: LedgerParticipant[]) {
  return JSON.stringify({
    participants: [...participants]
      .sort((first, second) => first.id.localeCompare(second.id))
      .map((participant) => ({
        id: participant.id,
        updatedAt: participant.updatedAt,
      })),
    settings: {
      homeCurrency: settings.homeCurrency,
      id: settings.id,
      settlementCurrency: settings.settlementCurrency,
      tripCurrency: settings.tripCurrency,
      updatedAt: settings.updatedAt,
    },
  })
}

function buildRoutingFingerprint(config: ReturnType<typeof getRoutingConfig>) {
  return JSON.stringify({
    configured: config.configured,
    provider: config.provider,
    routeProxyUrl: config.routeProxyUrl ?? '',
    source: config.source,
  })
}

function buildActionOperationFingerprint(executionId: string, idempotencyKey: string) {
  return `ai-action:${executionId}:${idempotencyKey}`
}

function buildActionItemId(executionId: string) {
  return `item_${executionId.replace(/^ai_action_run_/, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function buildDayMapEffect(tripId: string, dayId: string): AiActionRunEffect {
  return {
    kind: 'navigate',
    params: { dayId, tripId, view: 'map' },
    route: 'day',
  }
}

function buildDayScheduleEffect(tripId: string, dayId: string): AiActionRunEffect {
  return {
    kind: 'navigate',
    params: { dayId, tripId, view: 'schedule' },
    route: 'day',
  }
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
  idempotencyKey,
  occurredAt = Date.now(),
  targetId,
  targetType,
  title,
}: {
  actionType: string
  detail: string
  idempotencyKey?: string
  occurredAt?: number
  targetId: string
  targetType: TripIntelligenceAppliedChange['targetType']
  title: string
}): TripIntelligenceAppliedChange {
  return {
    actionType,
    detail,
    id: idempotencyKey
      ? `action-gateway:${idempotencyKey}`
      : `action-gateway:${hashString(`${actionType}:${targetId}:${occurredAt}`)}`,
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
