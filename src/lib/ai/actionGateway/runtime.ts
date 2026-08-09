import {
  createItineraryItemIdempotent,
  createLedgerExpenseIdempotent,
  db,
  deleteItineraryItemReversible,
  getItineraryItem,
  getTicketMeta,
  getLedgerSettingsByTrip,
  getTrip,
  ItineraryBaselineConflictError,
  listAppliedItemDeletionRecords,
  listDaysByTrip,
  listItemsByTrip,
  listLedgerExpenses,
  listLedgerParticipants,
  listTicketsByTrip,
  moveItineraryItemBetweenDays,
  reorderDayItems,
  TicketBaselineConflictError,
  undoItineraryItemDeletion,
  updateItineraryItem,
  updateTicketMeta,
} from '../../../db'
import { createId } from '../../../db/ids'
import type {
  Day,
  ItineraryExecutionStatus,
  ItineraryItem,
  ItineraryReplanPreference,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerParticipant,
  LedgerSettings,
  TicketMeta,
  Trip,
  TripReplanRecord,
} from '../../../types'
import { buildAiTripEditLocalStateFingerprint } from '../aiTripEditApply'
import { scoreTicketItemCandidate } from '../../documentLinking'
import { getTicketDisplayTitle } from '../../tickets'
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
  formatFlexibility,
  formatMobility,
  formatPriority,
  formatWeather,
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
import { buildTripOperationSnapshotFingerprint } from '../../tripOperationSnapshots'
import {
  updateItineraryItemExecutionStateAtomically,
  updateItineraryItemReplanPreferenceAtomically,
} from '../../itemStateUpdates'
import {
  assertAdaptiveReplanActionApplied,
  buildAdaptiveReplanActionPreview,
  executeAdaptiveReplanAction,
  loadAdaptiveReplanActionContext,
  type PreparedAdaptiveReplanAction,
} from '../../adaptiveReplanActions'
import { REPLAN_CROSS_DAY_WARNING } from '../../adaptiveReplanning'
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
  type AiActionHistoryUndoArgs,
  type AiActionItemCreateArgs,
  type AiActionItemDeleteArgs,
  type AiActionItemExecutionUpdateArgs,
  type AiActionItemMoveArgs,
  type AiActionItemReplanPreferenceUpdateArgs,
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
  type AiActionTicketBindArgs,
  type AiActionTicketOpenArgs,
  type AiActionTripReplanApplyArgs,
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

type PreparedTicketBindAction = {
  changed: boolean
  expectedItemId?: string
  expectedTicketUpdatedAt: number
  kind: 'ticket-bind'
  matchConfidence: number
  matchReason: string
  operationFingerprint: string
  previousItem?: ItineraryItem
  target: ItineraryItem
  ticket: TicketMeta
  trip: Trip
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

type PreparedItemDeleteAction = {
  currentIndex: number
  currentItemIds: string[]
  day: Day
  expectedBaselineFingerprint: string
  kind: 'item-delete'
  ledgerLinkCount: number
  operationFingerprint: string
  operationRecordId: string
  target: ItineraryItem
  ticketCount: number
  trip: Trip
}

type PreparedHistoryUndoAction = {
  day: Day
  deletedItem: ItineraryItem
  expectedAppliedFingerprint: string
  kind: 'history-undo'
  operationFingerprint: string
  originalIndex: number
  record: TripReplanRecord
  trip: Trip
}

type PreparedItemExecutionUpdateAction = {
  changed: boolean
  day: Day
  expectedUpdatedAt: number
  kind: 'item-execution-update'
  nextState: AiActionItemExecutionUpdateArgs['state']
  operationFingerprint: string
  target: ItineraryItem
  trip: Trip
}

type PreparedItemReplanPreferenceUpdateAction = {
  changed: boolean
  day: Day
  expectedUpdatedAt: number
  kind: 'item-replan-preference-update'
  nextPreference: ItineraryReplanPreference
  operationFingerprint: string
  previousPreference: ItineraryReplanPreference
  target: ItineraryItem
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

type PreparedItemMoveAction = {
  currentDestinationItemIds: string[]
  currentIndex: number
  currentSourceItemIds: string[]
  destinationDay: Day
  kind: 'item-move'
  nextDestinationItemIds: string[]
  nextIndex: number
  nextSourceItemIds: string[]
  operationFingerprint: string
  sourceDay: Day
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
  | PreparedAdaptiveReplanAction
  | PreparedDayItemsReorderAction
  | PreparedHistoryUndoAction
  | PreparedItemCreateAction
  | PreparedItemDeleteAction
  | PreparedItemExecutionUpdateAction
  | PreparedItemMoveAction
  | PreparedItemReplanPreferenceUpdateAction
  | PreparedItemTimeAction
  | PreparedLedgerExpenseDraftAction
  | PreparedPlaceAction
  | PreparedRoutePreviewAction
  | PreparedTicketBindAction
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
    details?: string[]
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
  'history.undo@1': {
    execute: async (prepared) =>
      executeHistoryUndoAction(requirePreparedKind(prepared, 'history-undo')),
    prepare: (args, context, preparation) =>
      prepareHistoryUndoAction(
        args as AiActionHistoryUndoArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const undo = requirePreparedKind(prepared, 'history-undo')
      return {
        affectedLabels: [undo.deletedItem.title],
        hasWrite: true,
        text: `${undo.day.title}：恢复「${undo.deletedItem.title}」到第 ${undo.originalIndex + 1} 位；关联资料保持不变。`,
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
  'item.delete@1': {
    execute: async (prepared) =>
      executeItemDeleteAction(requirePreparedKind(prepared, 'item-delete')),
    prepare: (args, context, preparation) =>
      prepareItemDeleteAction(
        args as AiActionItemDeleteArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const deletion = requirePreparedKind(prepared, 'item-delete')
      return {
        affectedLabels: [deletion.target.title],
        hasWrite: true,
        text: `${deletion.day.title}：移除「${deletion.target.title}」（第 ${deletion.currentIndex + 1} 位）；保留 ${deletion.ticketCount} 张票据、${deletion.ledgerLinkCount} 笔账本关联和订单，可撤销。`,
      }
    },
  },
  'item.execution.update@1': {
    execute: async (prepared) =>
      executeItemExecutionUpdateAction(
        requirePreparedKind(prepared, 'item-execution-update'),
      ),
    prepare: (args, context, preparation) =>
      prepareItemExecutionUpdateAction(
        args as AiActionItemExecutionUpdateArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const update = requirePreparedKind(prepared, 'item-execution-update')
      return {
        affectedLabels: [update.target.title],
        hasWrite: update.changed,
        text: update.changed
          ? `${update.day.title}：「${update.target.title}」将${formatExecutionStateChange(update.nextState)}。`
          : `「${update.target.title}」已经是${formatExecutionState(update.nextState)}。`,
      }
    },
  },
  'item.move@1': {
    execute: async (prepared) =>
      executeItemMoveAction(requirePreparedKind(prepared, 'item-move')),
    prepare: (args, context, preparation) =>
      prepareItemMoveAction(
        args as AiActionItemMoveArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const move = requirePreparedKind(prepared, 'item-move')
      return {
        affectedLabels: [move.target.title],
        hasWrite: true,
        text: `${move.target.title}：「${move.sourceDay.title}」第 ${move.currentIndex + 1} 位 → 「${move.destinationDay.title}」第 ${move.nextIndex + 1} 位。`,
      }
    },
  },
  'item.replan.preference.update@1': {
    execute: async (prepared) =>
      executeItemReplanPreferenceUpdateAction(
        requirePreparedKind(prepared, 'item-replan-preference-update'),
      ),
    prepare: (args, context, preparation) =>
      prepareItemReplanPreferenceUpdateAction(
        args as AiActionItemReplanPreferenceUpdateArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const update = requirePreparedKind(
        prepared,
        'item-replan-preference-update',
      )
      return {
        affectedLabels: [update.target.title],
        hasWrite: update.changed,
        text: update.changed
          ? `${update.target.title}：${formatReplanPreference(update.previousPreference)} → ${formatReplanPreference(update.nextPreference)}。`
          : `「${update.target.title}」的重排偏好无需调整。`,
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
  'ticket.bind@1': {
    execute: async (prepared) =>
      executeTicketBindAction(requirePreparedKind(prepared, 'ticket-bind')),
    prepare: (args, context, preparation) =>
      prepareTicketBindAction(
        args as AiActionTicketBindArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const binding = requirePreparedKind(prepared, 'ticket-bind')
      const ticketTitle = getTicketDisplayTitle(binding.ticket)
      const movePrefix = binding.previousItem && binding.previousItem.id !== binding.target.id
        ? `从「${binding.previousItem.title}」改为`
        : '关联到'
      return {
        affectedLabels: [ticketTitle, binding.target.title],
        details: [`匹配依据：${binding.matchReason} · ${Math.round(binding.matchConfidence * 100)}%`, '票据原件与共享范围保持不变。'],
        hasWrite: binding.changed,
        text: binding.changed
          ? `「${ticketTitle}」将${movePrefix}「${binding.target.title}」。`
          : `「${ticketTitle}」已关联「${binding.target.title}」。`,
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
  'trip.replan.apply@1': {
    execute: async (prepared) =>
      executeTripReplanApplyAction(
        requirePreparedKind(prepared, 'adaptive-replan-action'),
      ),
    prepare: (args, context, preparation) =>
      prepareTripReplanApplyAction(
        args as AiActionTripReplanApplyArgs,
        context,
        preparation,
      ),
    preview: (prepared) => {
      const replan = requirePreparedKind(
        prepared,
        'adaptive-replan-action',
      )
      const changedItems = replan.selectedOption.diff.itemChanges.filter(
        (change) => change.changeType !== 'unchanged',
      )
      const ticketCount = replan.selectedOption.diff.ticketImpacts.filter(
        (impact) => impact.impact !== 'unaffected',
      ).length
      const ledgerCount = replan.selectedOption.diff.ledgerImpacts.filter(
        (impact) => impact.impact !== 'unaffected',
      ).length
      const hasCrossDayWarning = replan.selectedOption.diff.warnings.some(
        (warning) => warning.includes(REPLAN_CROSS_DAY_WARNING),
      )
      const warningParts = [
        ticketCount + ledgerCount > 0
          ? `票据 ${ticketCount}、账本 ${ledgerCount} 项需核对`
          : '',
        hasCrossDayWarning ? '跨日项需手动安排' : '',
      ].filter(Boolean)
      const warningText = warningParts.length > 0
        ? `；${warningParts.join('；')}`
        : ''
      const changeSummary = summarizeAdaptiveReplanChanges(changedItems)
      const details = buildAdaptiveReplanDetails(replan, changedItems)
      return {
        affectedLabels: changedItems.map((change) => change.title),
        ...(details.length > 0 ? { details } : {}),
        hasWrite: changedItems.length > 0,
        text: changedItems.length > 0
          ? `${replan.dayTitle}：${changeSummary}；按${formatReplanStrategy(replan.strategy)}调整 ${changedItems.length} 项${warningText}。`
          : hasCrossDayWarning
            ? `${replan.dayTitle}：顺延后会跨日，需手动安排。`
            : `${replan.dayTitle}：现有重排偏好下无需改动。`,
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
    if (
      fresh !== preparedPlan.baselineFingerprint
      && !(await canReplayPersistedPreparedPlan(
        preparedPlan,
        previouslyCompleted,
      ))
    ) {
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
    preview.details,
  )
}

function buildPreparedStep(
  step: AiActionPlanV1['steps'][number],
  prepared: PreparedAction,
  preview: string,
  affectedLabels: string[],
  hasWrite: boolean,
  manualEntry?: AiActionManualEntry,
  details?: string[],
): AiActionPreparedStep {
  return {
    actionId: step.actionId,
    affectedLabels,
    confirmationFingerprint: hashString(stableStringify(prepared)),
    ...(details && details.length > 0 ? { details } : {}),
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

async function prepareTicketBindAction(
  args: AiActionTicketBindArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedTicketBindAction> {
  const trip = requireTrip(context.commandContext)
  const ticket = resolveTicketTarget(args.ticket, context.commandContext)
  const target = resolveItemTarget(args.target, context.commandContext)
  if (ticket.tripId !== trip.id || target.tripId !== trip.id) {
    throw new Error('票据或行程点不属于当前旅行。')
  }
  const previousItem = ticket.itemId
    ? context.commandContext.items.find((item) => item.id === ticket.itemId)
    : undefined
  if (ticket.itemId && !previousItem) {
    throw new Error('票据原绑定已不存在，请先检查资料。')
  }
  const day = context.commandContext.days.find((candidate) => candidate.id === target.dayId)
  const match = scoreTicketItemCandidate(ticket, target, day)
  return {
    changed: ticket.itemId !== target.id || !target.ticketIds.includes(ticket.id),
    expectedItemId: ticket.itemId,
    expectedTicketUpdatedAt: ticket.updatedAt,
    kind: 'ticket-bind',
    matchConfidence: match.confidence,
    matchReason: match.evidence.length > 0 ? match.reason : '用户明确指定',
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    previousItem,
    target,
    ticket,
    trip,
  }
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

async function prepareItemDeleteAction(
  args: AiActionItemDeleteArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedItemDeleteAction> {
  const trip = requireTrip(context.commandContext)
  const explicitDay = args.day
    ? resolveExplicitDayTarget(args.day, context.commandContext)
    : undefined
  const target = explicitDay
    ? resolveItemTargetInDay(args.target, explicitDay, context.commandContext)
    : resolveItemTarget(args.target, context.commandContext)
  const day = explicitDay
    ?? context.commandContext.days.find((candidate) => candidate.id === target.dayId)
  if (!day || target.dayId !== day.id) {
    throw new Error('目标行程点的日期已不存在。')
  }
  const currentItems = orderItems(
    context.commandContext.days,
    context.commandContext.items,
  ).filter((item) => item.dayId === day.id)
  const currentIndex = currentItems.findIndex((item) => item.id === target.id)
  if (currentIndex < 0) throw new Error('目标行程点不在所选日期。')
  const ledgerExpenses = await listLedgerExpenses(trip.id)
  const ticketIds = new Set([
    ...target.ticketIds,
    ...context.commandContext.tickets
      .filter((ticket) => ticket.itemId === target.id)
      .map((ticket) => ticket.id),
  ])
  return {
    currentIndex,
    currentItemIds: currentItems.map((item) => item.id),
    day,
    expectedBaselineFingerprint: buildTripOperationSnapshotFingerprint({
      days: [day],
      items: currentItems,
    }),
    kind: 'item-delete',
    ledgerLinkCount: ledgerExpenses.filter((expense) =>
      expense.itemIds?.includes(target.id),
    ).length,
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    operationRecordId: createId('replan_record'),
    target,
    ticketCount: ticketIds.size,
    trip,
  }
}

async function prepareHistoryUndoAction(
  args: AiActionHistoryUndoArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedHistoryUndoAction> {
  const trip = requireTrip(context.commandContext)
  const records = await listAppliedItemDeletionRecords(trip.id)
  const matches = args.target
    ? records.filter((record) => {
        const deletedItem = getDeletedItemFromOperationRecord(record)
        const target = normalizeText(args.target ?? '')
        const title = normalizeText(deletedItem.title)
        return title.includes(target) || target.includes(title)
      })
    : records.slice(0, 1)
  if (matches.length === 0) {
    throw new Error(args.target
      ? `没有找到「${args.target}」的可撤销删除记录。`
      : '当前旅行没有可撤销的行程点删除。')
  }
  if (matches.length > 1) {
    throw new Error('找到多个匹配的删除记录，请写清楚行程点名称。')
  }
  const record = matches[0]
  if (!record.appliedFingerprint) {
    throw new Error('删除记录缺少可验证快照。')
  }
  const deletedItem = getDeletedItemFromOperationRecord(record)
  const day = record.beforeSnapshot.days.find((candidate) =>
    candidate.id === deletedItem.dayId,
  )
  if (!day) throw new Error('删除记录的日期已不存在。')
  const originalIndex = [...record.beforeSnapshot.items]
    .sort((first, second) =>
      first.sortOrder - second.sortOrder || first.id.localeCompare(second.id),
    )
    .findIndex((item) => item.id === deletedItem.id)
  if (originalIndex < 0) throw new Error('删除记录缺少原始顺序。')

  return {
    day,
    deletedItem,
    expectedAppliedFingerprint: record.appliedFingerprint,
    kind: 'history-undo',
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    originalIndex,
    record,
    trip,
  }
}

function prepareItemExecutionUpdateAction(
  args: AiActionItemExecutionUpdateArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedItemExecutionUpdateAction> {
  const resolved = resolveScopedItemActionTarget(
    args.target,
    args.day,
    context.commandContext,
  )
  const currentState = resolved.target.executionState?.status ?? 'active'
  return Promise.resolve({
    changed: currentState !== args.state,
    day: resolved.day,
    expectedUpdatedAt: resolved.target.updatedAt,
    kind: 'item-execution-update',
    nextState: args.state,
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    target: resolved.target,
    trip: resolved.trip,
  })
}

function prepareItemReplanPreferenceUpdateAction(
  args: AiActionItemReplanPreferenceUpdateArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedItemReplanPreferenceUpdateAction> {
  const resolved = resolveScopedItemActionTarget(
    args.target,
    args.day,
    context.commandContext,
  )
  const previousPreference = normalizeReplanPreference(
    resolved.target.replanPreference ?? {},
  )
  const nextPreference = normalizeReplanPreference({
    ...previousPreference,
    ...(args.bufferMinutes !== undefined
      ? { bufferMinutes: args.bufferMinutes }
      : {}),
    ...(args.flexibility ? { flexibility: args.flexibility } : {}),
    ...(args.minimumStayMinutes !== undefined
      ? { minimumStayMinutes: args.minimumStayMinutes }
      : {}),
    ...(args.mobilitySuitability
      ? { mobilitySuitability: args.mobilitySuitability }
      : {}),
    ...(args.priority ? { priority: args.priority } : {}),
    ...(args.weatherSuitability
      ? { weatherSuitability: args.weatherSuitability }
      : {}),
  })
  return Promise.resolve({
    changed: stableStringify(previousPreference) !== stableStringify(nextPreference),
    day: resolved.day,
    expectedUpdatedAt: resolved.target.updatedAt,
    kind: 'item-replan-preference-update',
    nextPreference,
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    previousPreference,
    target: resolved.target,
    trip: resolved.trip,
  })
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

function prepareItemMoveAction(
  args: AiActionItemMoveArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedItemMoveAction> {
  const trip = requireTrip(context.commandContext)
  const explicitSourceDay = args.sourceDay
    ? resolveExplicitDayTarget(args.sourceDay, context.commandContext)
    : undefined
  const target = explicitSourceDay
    ? resolveItemTargetInDay(args.target, explicitSourceDay, context.commandContext)
    : resolveItemTarget(args.target, context.commandContext)
  const sourceDay = explicitSourceDay
    ?? context.commandContext.days.find((candidate) => candidate.id === target.dayId)
  if (!sourceDay || target.dayId !== sourceDay.id) {
    throw new Error('目标行程点的来源日期已不存在。')
  }
  const destinationDay = resolveExplicitDayTarget(
    args.destinationDay,
    context.commandContext,
  )
  if (destinationDay.id === sourceDay.id) {
    throw new Error('同一天内请使用当天顺序调整。')
  }

  const orderedItems = orderItems(
    context.commandContext.days,
    context.commandContext.items,
  )
  const currentSourceItems = orderedItems.filter((item) => item.dayId === sourceDay.id)
  const currentDestinationItems = orderedItems
    .filter((item) => item.dayId === destinationDay.id)
  const currentSourceItemIds = currentSourceItems.map((item) => item.id)
  const currentDestinationItemIds = currentDestinationItems.map((item) => item.id)
  const currentIndex = currentSourceItemIds.indexOf(target.id)
  if (currentIndex < 0) throw new Error('目标行程点不在来源日期。')

  const nextDestinationItemIds = [...currentDestinationItemIds]
  let insertionIndex = 0
  if (args.position === 'last') {
    insertionIndex = nextDestinationItemIds.length
  } else if (args.position === 'before' || args.position === 'after') {
    if (!args.anchor) throw new Error('请写清楚目标日期内的参照行程点。')
    const anchor = resolveItemTargetInDay(
      args.anchor,
      destinationDay,
      context.commandContext,
    )
    const anchorIndex = nextDestinationItemIds.indexOf(anchor.id)
    if (anchorIndex < 0) throw new Error('参照行程点不在目标日期。')
    insertionIndex = anchorIndex + (args.position === 'after' ? 1 : 0)
  }
  nextDestinationItemIds.splice(insertionIndex, 0, target.id)

  return Promise.resolve({
    currentDestinationItemIds,
    currentIndex,
    currentSourceItemIds,
    destinationDay,
    kind: 'item-move',
    nextDestinationItemIds,
    nextIndex: insertionIndex,
    nextSourceItemIds: currentSourceItemIds.filter((itemId) => itemId !== target.id),
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    sourceDay,
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

async function prepareTripReplanApplyAction(
  args: AiActionTripReplanApplyArgs,
  context: AiActionGatewayRuntimeContext,
  preparation: {
    executionId: string
    idempotencyKey: string
  },
): Promise<PreparedAdaptiveReplanAction> {
  const trip = requireTrip(context.commandContext)
  const fresh = await loadAdaptiveReplanActionContext(trip.id)
  const freshCommandContext: GlobalAiCommandContext = {
    ...context.commandContext,
    currentDay: context.commandContext.currentDay
      ? fresh.days.find((day) =>
          day.id === context.commandContext.currentDay?.id,
        )
      : undefined,
    currentItem: context.commandContext.currentItem
      ? fresh.items.find((item) =>
          item.id === context.commandContext.currentItem?.id,
        )
      : undefined,
    days: fresh.days,
    items: fresh.items,
    ledgerExpenses: fresh.ledgerExpenses,
    tickets: fresh.tickets,
    trip: fresh.trip,
  }
  const explicitDay = args.day
    ? resolveExplicitDayTarget(args.day, freshCommandContext)
    : undefined
  const target = args.target
    ? explicitDay
      ? resolveItemTargetInDay(args.target, explicitDay, freshCommandContext)
      : resolveItemTarget(args.target, freshCommandContext)
    : explicitDay
      ? undefined
      : freshCommandContext.currentItem
  const day = explicitDay
    ?? (target
      ? fresh.days.find((candidate) => candidate.id === target.dayId)
      : freshCommandContext.currentDay)
    ?? resolveDayTarget(undefined, freshCommandContext)
  if (!day) throw new Error('没有找到突发情况对应的日期。')
  if (target && target.dayId !== day.id) {
    throw new Error('目标行程点不在所选日期。')
  }
  if (
    (args.kind === 'closure' || args.kind === 'cancelled')
    && !target
  ) {
    throw new Error('闭馆或取消需要写清楚行程点。')
  }
  return buildAdaptiveReplanActionPreview({
    context: fresh,
    day,
    ...((args.kind === 'delay' || args.kind === 'late')
      ? { delayMinutes: args.delayMinutes ?? 30 }
      : {}),
    disruptionKind: args.kind,
    ...(target ? { item: target } : {}),
    operationFingerprint: buildActionOperationFingerprint(
      preparation.executionId,
      preparation.idempotencyKey,
    ),
    strategy: args.strategy ?? 'least_change',
  })
}

async function executePreparedAction(
  actionId: AiActionId,
  prepared: PreparedAction,
  context: AiActionGatewayRuntimeContext,
): Promise<ActionExecutionResult> {
  return ACTION_RUNTIME_DEFINITIONS[actionId].execute(prepared, context)
}

async function executeTripReplanApplyAction(
  prepared: PreparedAdaptiveReplanAction,
): Promise<ActionExecutionResult> {
  try {
    const result = await executeAdaptiveReplanAction(prepared)
    return {
      appliedChanges: [],
      effects: result.changed
        ? [buildDayScheduleEffect(prepared.tripId, prepared.dayId)]
        : [],
      errors: [],
      message: result.changed
        ? `已按${formatReplanStrategy(prepared.strategy)}调整 ${result.changedItemCount} 个行程点，可从重排记录撤销。`
        : result.record
          ? '这次突发重排已经应用，未重复执行。'
          : '现有重排偏好下无需改动。',
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
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

async function executeItemDeleteAction(
  prepared: PreparedItemDeleteAction,
): Promise<ActionExecutionResult> {
  try {
    const result = await deleteItineraryItemReversible(prepared.target.id, {
      expectedBaselineFingerprint: prepared.expectedBaselineFingerprint,
      expectedCurrentItemIds: prepared.currentItemIds,
      expectedItemUpdatedAt: prepared.target.updatedAt,
      historyTitle: 'AI 删除行程点',
      operationFingerprint: prepared.operationFingerprint,
      operationRecordId: prepared.operationRecordId,
      tripId: prepared.trip.id,
    })
    if (!result) {
      throw new FreshConfirmationRequiredError(
        '目标行程点已不存在，请重新生成预览。',
      )
    }
    return {
      appliedChanges: [],
      effects: result.deleted
        ? [buildDayScheduleEffect(prepared.trip.id, prepared.day.id)]
        : [],
      errors: [],
      message: result.deleted
        ? `已移除「${result.deletedItem.title}」，关联资料保持不变。`
        : `「${result.deletedItem.title}」已经移除，未重复执行。`,
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
}

async function executeHistoryUndoAction(
  prepared: PreparedHistoryUndoAction,
): Promise<ActionExecutionResult> {
  try {
    const result = await undoItineraryItemDeletion(prepared.record.id, {
      expectedAppliedFingerprint: prepared.expectedAppliedFingerprint,
      historyTitle: 'AI 撤销删除',
      tripId: prepared.trip.id,
      undoOperationFingerprint: prepared.operationFingerprint,
    })
    return {
      appliedChanges: [],
      effects: result.restored
        ? [buildDayScheduleEffect(prepared.trip.id, prepared.day.id)]
        : [],
      errors: [],
      message: result.restored
        ? `已恢复「${result.restoredItem.title}」及原顺序。`
        : `「${result.restoredItem.title}」已经恢复，未重复执行。`,
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
}

async function executeItemExecutionUpdateAction(
  prepared: PreparedItemExecutionUpdateAction,
): Promise<ActionExecutionResult> {
  if (!prepared.changed) {
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: `「${prepared.target.title}」已经是${formatExecutionState(prepared.nextState)}。`,
    }
  }
  try {
    const result = await updateItineraryItemExecutionStateAtomically(
      prepared.target.id,
      prepared.nextState === 'active'
        ? null
        : prepared.nextState as ItineraryExecutionStatus,
      {
        expectedUpdatedAt: prepared.expectedUpdatedAt,
        historyTitle: 'AI 更新行程进度',
        operationFingerprint: prepared.operationFingerprint,
        tripId: prepared.trip.id,
      },
    )
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: result.changed
        ? `已将「${result.item.title}」${formatExecutionStateChange(prepared.nextState)}。`
        : `「${result.item.title}」已经是${formatExecutionState(prepared.nextState)}，未重复执行。`,
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
}

async function executeItemReplanPreferenceUpdateAction(
  prepared: PreparedItemReplanPreferenceUpdateAction,
): Promise<ActionExecutionResult> {
  if (!prepared.changed) {
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: `「${prepared.target.title}」的重排偏好无需调整。`,
    }
  }
  try {
    const result = await updateItineraryItemReplanPreferenceAtomically(
      prepared.target.id,
      prepared.nextPreference,
      {
        expectedUpdatedAt: prepared.expectedUpdatedAt,
        historyTitle: 'AI 更新重排偏好',
        operationFingerprint: prepared.operationFingerprint,
        tripId: prepared.trip.id,
      },
    )
    return {
      appliedChanges: [],
      effects: [],
      errors: [],
      message: result.changed
        ? `已更新「${result.item.title}」的重排偏好。`
        : `「${result.item.title}」的重排偏好已经更新，未重复执行。`,
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
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

async function executeItemMoveAction(
  prepared: PreparedItemMoveAction,
): Promise<ActionExecutionResult> {
  if (await hasPersistedActionChange(prepared.trip.id, prepared.operationFingerprint)) {
    return buildPersistedItemMoveResult(prepared)
  }

  try {
    await executeActionMutationWithHistory(
      prepared.trip.id,
      '跨日移动行程点',
      async () => {
        const result = await moveItineraryItemBetweenDays(
          prepared.target.id,
          prepared.destinationDay.id,
          prepared.nextDestinationItemIds,
          {
            expectedDestinationItemIds: prepared.currentDestinationItemIds,
            expectedSourceItemIds: prepared.currentSourceItemIds,
            sourceDayId: prepared.sourceDay.id,
          },
        )
        return {
          change: buildAppliedChange({
            actionType: 'global_ai_item_moved_between_days',
            detail: `已确认从「${prepared.sourceDay.title}」第 ${prepared.currentIndex + 1} 位移动到「${prepared.destinationDay.title}」第 ${prepared.nextIndex + 1} 位。`,
            idempotencyKey: prepared.operationFingerprint,
            occurredAt: result.movedItem.updatedAt,
            targetId: result.movedItem.id,
            targetType: 'item',
            title: result.movedItem.title,
          }),
          value: result,
        }
      },
    )
    return {
      appliedChanges: [],
      effects: [
        buildDayScheduleEffect(prepared.trip.id, prepared.destinationDay.id),
      ],
      errors: [],
      message: `已把「${prepared.target.title}」移到「${prepared.destinationDay.title}」。`,
    }
  } catch (caught) {
    if (caught instanceof ItineraryBaselineConflictError) {
      if (await hasPersistedActionChange(
        prepared.trip.id,
        prepared.operationFingerprint,
      )) {
        return buildPersistedItemMoveResult(prepared)
      }
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
}

async function buildPersistedItemMoveResult(
  prepared: PreparedItemMoveAction,
): Promise<ActionExecutionResult> {
  await assertPersistedItemMoveState(prepared)
  return {
    appliedChanges: [],
    effects: [],
    errors: [],
    message: `「${prepared.target.title}」已在目标日期，未重复移动。`,
  }
}

async function assertPersistedItemMoveState(
  prepared: PreparedItemMoveAction,
) {
  const freshItems = orderItems(
    [prepared.sourceDay, prepared.destinationDay],
    await listItemsByTrip(prepared.trip.id),
  )
  const freshSourceItemIds = freshItems
    .filter((item) => item.dayId === prepared.sourceDay.id)
    .map((item) => item.id)
  const freshDestinationItemIds = freshItems
    .filter((item) => item.dayId === prepared.destinationDay.id)
    .map((item) => item.id)
  const freshTarget = freshItems.find((item) => item.id === prepared.target.id)
  if (
    freshTarget?.dayId !== prepared.destinationDay.id
    || !sameOrderedItemIds(freshSourceItemIds, prepared.nextSourceItemIds)
    || !sameOrderedItemIds(
      freshDestinationItemIds,
      prepared.nextDestinationItemIds,
    )
  ) {
    throw new FreshConfirmationRequiredError(
      '跨日移动后的行程已变化，请重新生成预览。',
    )
  }
}

async function canReplayPersistedPreparedPlan(
  preparedPlan: AiActionPreparedPlan,
  previouslyCompleted: Set<string>,
) {
  let hasPendingWrite = false
  for (const preparedStep of preparedPlan.steps) {
    if (previouslyCompleted.has(preparedStep.id) || !preparedStep.hasWrite) continue
    hasPendingWrite = true
    if (!preparedStep.prepared) return false
    const prepared = preparedStep.prepared as PreparedAction
    try {
      if (prepared.kind === 'ticket-bind') {
        if (!await hasPersistedActionChange(
          prepared.trip.id,
          prepared.operationFingerprint,
        )) {
          return false
        }
        await assertPersistedTicketBindingState(prepared)
        continue
      }
      if (prepared.kind === 'item-move') {
        if (!await hasPersistedActionChange(
          prepared.trip.id,
          prepared.operationFingerprint,
        )) {
          return false
        }
        await assertPersistedItemMoveState(prepared)
        continue
      }
      if (prepared.kind === 'item-delete') {
        if (!await hasPersistedActionChange(
          prepared.trip.id,
          prepared.operationFingerprint,
        )) {
          return false
        }
        await assertPersistedItemDeleteState(prepared)
        continue
      }
      if (prepared.kind === 'history-undo') {
        if (!await hasPersistedActionChange(
          prepared.trip.id,
          prepared.operationFingerprint,
        )) {
          return false
        }
        await assertPersistedItemDeletionUndoState(prepared)
        continue
      }
      if (prepared.kind === 'item-execution-update') {
        if (!await hasPersistedActionChange(
          prepared.trip.id,
          prepared.operationFingerprint,
        )) {
          return false
        }
        await assertPersistedItemExecutionState(prepared)
        continue
      }
      if (prepared.kind === 'item-replan-preference-update') {
        if (!await hasPersistedActionChange(
          prepared.trip.id,
          prepared.operationFingerprint,
        )) {
          return false
        }
        await assertPersistedItemReplanPreference(prepared)
        continue
      }
      if (prepared.kind === 'adaptive-replan-action') {
        await assertAdaptiveReplanActionApplied(prepared)
        continue
      }
      return false
    } catch {
      return false
    }
  }
  return hasPendingWrite
}

async function assertPersistedTicketBindingState(
  prepared: PreparedTicketBindAction,
) {
  const [ticket, target] = await Promise.all([
    getTicketMeta(prepared.ticket.id),
    getItineraryItem(prepared.target.id),
  ])
  if (
    !ticket || ticket.itemId !== prepared.target.id
    || !target || !target.ticketIds.includes(ticket.id)
    || stableStringify(ticket.sharedVisibility) !== stableStringify(prepared.ticket.sharedVisibility)
  ) {
    throw new FreshConfirmationRequiredError('票据关联结果已变化，请重新生成预览。')
  }
  return ticket
}

async function assertPersistedItemExecutionState(
  prepared: PreparedItemExecutionUpdateAction,
) {
  const item = await db.itineraryItems.get(prepared.target.id)
  const currentState = item?.executionState?.status ?? 'active'
  if (!item || item.tripId !== prepared.trip.id || currentState !== prepared.nextState) {
    throw new FreshConfirmationRequiredError(
      '行程进度与操作历史不一致，请重新生成预览。',
    )
  }
}

async function assertPersistedItemReplanPreference(
  prepared: PreparedItemReplanPreferenceUpdateAction,
) {
  const item = await db.itineraryItems.get(prepared.target.id)
  if (
    !item
    || item.tripId !== prepared.trip.id
    || stableStringify(normalizeReplanPreference(item.replanPreference ?? {}))
      !== stableStringify(prepared.nextPreference)
  ) {
    throw new FreshConfirmationRequiredError(
      '重排偏好与操作历史不一致，请重新生成预览。',
    )
  }
}

async function assertPersistedItemDeleteState(
  prepared: PreparedItemDeleteAction,
) {
  const record = await db.tripReplanRecords.get(prepared.operationRecordId)
  if (
    !record
    || record.operationKind !== 'item_delete'
    || record.status !== 'applied'
    || record.operationFingerprint !== prepared.operationFingerprint
    || !record.appliedFingerprint
    || await db.itineraryItems.get(prepared.target.id)
  ) {
    throw new FreshConfirmationRequiredError(
      '删除后的行程与操作历史不一致，请重新生成预览。',
    )
  }
  const day = await db.days.get(prepared.day.id)
  if (!day) throw new FreshConfirmationRequiredError('目标日期已不存在。')
  const currentItems = (await db.itineraryItems.where('dayId').equals(day.id).toArray())
    .sort((first, second) =>
      first.sortOrder - second.sortOrder || first.id.localeCompare(second.id),
    )
  if (
    buildTripOperationSnapshotFingerprint({ days: [day], items: currentItems })
    !== record.appliedFingerprint
  ) {
    throw new FreshConfirmationRequiredError(
      '删除后的行程已变化，请重新生成预览。',
    )
  }
}

async function assertPersistedItemDeletionUndoState(
  prepared: PreparedHistoryUndoAction,
) {
  const record = await db.tripReplanRecords.get(prepared.record.id)
  if (
    !record
    || record.operationKind !== 'item_delete'
    || record.status !== 'undone'
    || !record.undoFingerprint
  ) {
    throw new FreshConfirmationRequiredError(
      '撤销后的行程与操作历史不一致，请重新生成预览。',
    )
  }
  const day = await db.days.get(prepared.day.id)
  if (!day) throw new FreshConfirmationRequiredError('目标日期已不存在。')
  const currentItems = (await db.itineraryItems.where('dayId').equals(day.id).toArray())
    .sort((first, second) =>
      first.sortOrder - second.sortOrder || first.id.localeCompare(second.id),
    )
  if (
    buildTripOperationSnapshotFingerprint({ days: [day], items: currentItems })
    !== record.undoFingerprint
  ) {
    throw new FreshConfirmationRequiredError(
      '撤销后的行程已变化，请重新生成预览。',
    )
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

async function executeTicketBindAction(
  prepared: PreparedTicketBindAction,
): Promise<ActionExecutionResult> {
  const effect = buildTicketDocumentEffect(prepared.trip.id, prepared.ticket.id)
  if (!prepared.changed) {
    return {
      appliedChanges: [],
      effects: [effect],
      errors: [],
      message: `「${getTicketDisplayTitle(prepared.ticket)}」已关联目标行程，未重复写入。`,
    }
  }

  let output: { replayed: boolean; ticket: TicketMeta } | undefined
  try {
    await db.transaction(
      'rw',
      [
        db.itineraryItems,
        db.trips,
        db.ticketMetas,
        db.syncOutbox,
        db.objectSyncStates,
        db.tripIntelligenceAppliedChanges,
        db.tripIntelligenceSuggestionStates,
      ],
      async () => {
        if (await hasPersistedActionChange(prepared.trip.id, prepared.operationFingerprint)) {
          output = {
            replayed: true,
            ticket: await assertPersistedTicketBindingState(prepared),
          }
          return
        }
        const result = await updateTicketMeta(prepared.ticket.id, {
          expectedBinding: {
            ...(prepared.previousItem && prepared.previousItem.id !== prepared.target.id
              ? {
                  currentItem: {
                    id: prepared.previousItem.id,
                    ticketIds: [...prepared.previousItem.ticketIds],
                    updatedAt: prepared.previousItem.updatedAt,
                  },
                }
              : {}),
            ...(prepared.expectedItemId ? { itemId: prepared.expectedItemId } : {}),
            targetItem: {
              id: prepared.target.id,
              ticketIds: [...prepared.target.ticketIds],
              updatedAt: prepared.target.updatedAt,
            },
            ticketUpdatedAt: prepared.expectedTicketUpdatedAt,
          },
          itemId: prepared.target.id,
          note: prepared.ticket.note,
          scope: 'item',
          sharedVisibility: prepared.ticket.sharedVisibility,
          structuredFields: prepared.ticket.structuredFields,
          ticketCategory: prepared.ticket.ticketCategory,
          title: prepared.ticket.title,
        })
        if (!result) {
          throw new FreshConfirmationRequiredError('票据已不存在，请重新生成预览。')
        }
        const change = buildAppliedChange({
          actionType: 'global_ai_ticket_bound',
          detail: `已确认关联到「${prepared.target.title}」；票据原件与共享范围保持不变。`,
          idempotencyKey: prepared.operationFingerprint,
          occurredAt: result.ticket.updatedAt,
          targetId: result.ticket.id,
          targetType: 'ticket',
          title: getTicketDisplayTitle(result.ticket),
        })
        await appendTripIntelligenceExecutionResult(prepared.trip.id, {
          result: {
            appliedChanges: [change],
            message: 'AI 动作计划已完成。',
            status: 'completed',
          },
          source: 'operations',
          title: '关联票据',
        }, change.occurredAt)
        output = { replayed: false, ticket: result.ticket }
      },
    )
  } catch (caught) {
    if (caught instanceof TicketBaselineConflictError) {
      throw new FreshConfirmationRequiredError(caught.message)
    }
    throw caught
  }
  if (!output) throw new Error('票据关联事务没有返回结果。')
  if (!output.replayed) emitTravelDataChanged()
  return {
    appliedChanges: [],
    effects: [effect],
    errors: [],
    message: output.replayed
      ? `「${getTicketDisplayTitle(output.ticket)}」已经关联，未重复写入。`
      : `已将「${getTicketDisplayTitle(output.ticket)}」关联到「${prepared.target.title}」。`,
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

function resolveScopedItemActionTarget(
  targetText: string,
  dayText: string | undefined,
  context: GlobalAiCommandContext,
) {
  const trip = requireTrip(context)
  const explicitDay = dayText
    ? resolveExplicitDayTarget(dayText, context)
    : undefined
  const target = explicitDay
    ? resolveItemTargetInDay(targetText, explicitDay, context)
    : resolveItemTarget(targetText, context)
  const day = explicitDay
    ?? context.days.find((candidate) => candidate.id === target.dayId)
  if (!day || target.dayId !== day.id) {
    throw new Error('目标行程点的日期已不存在。')
  }
  return { day, target, trip }
}

function resolveTicketTarget(target: string, context: GlobalAiCommandContext) {
  const tickets = [...context.tickets]
    .filter((ticket) => !context.trip || ticket.tripId === context.trip.id)
    .sort((first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id))
  if (target === 'first_ticket') {
    const first = tickets[0]
    if (!first) throw new Error('当前旅行还没有票据。')
    return first
  }
  if (target === 'first_unbound_ticket') {
    const first = tickets.find((ticket) => !ticket.itemId)
    if (!first) throw new Error('当前旅行没有待关联票据。')
    return first
  }
  const normalized = normalizeText(target)
  const candidates = tickets.map((ticket) => ({
    fields: [getTicketDisplayTitle(ticket), ticket.fileName, ticket.fileName.replace(/\.[^.]+$/, '')]
      .map(normalizeText),
    ticket,
  }))
  const exact = candidates.filter((candidate) => candidate.fields.includes(normalized))
  if (exact.length === 1) return exact[0].ticket
  if (exact.length > 1) throw new Error('找到多个同名票据，请写清楚文件名。')
  const matches = candidates.filter((candidate) =>
    candidate.fields.some((value) => value.includes(normalized) || normalized.includes(value)),
  )
  if (matches.length === 1) return matches[0].ticket
  if (matches.length > 1) throw new Error('找到多个匹配票据，请写清楚名称。')
  throw new Error('没有找到目标票据。')
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

function getDeletedItemFromOperationRecord(record: TripReplanRecord) {
  if (record.operationKind !== 'item_delete' || !record.afterSnapshot) {
    throw new Error('删除记录类型无效。')
  }
  const afterIds = new Set(record.afterSnapshot.items.map((item) => item.id))
  const deletedItems = record.beforeSnapshot.items.filter((item) =>
    !afterIds.has(item.id),
  )
  if (deletedItems.length !== 1) {
    throw new Error('删除记录缺少唯一行程点快照。')
  }
  return deletedItems[0]
}

function sameOrderedItemIds(first: string[], second: string[]) {
  return first.length === second.length
    && first.every((itemId, index) => itemId === second[index])
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
  const monthDay = target.match(/^(\d{2})-(\d{2})$/)
  if (monthDay) {
    const matches = ordered.filter((day) =>
      day.date.slice(5) === target,
    )
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new Error('找到多个同月同日的日期，请写清楚年份。')
    }
    throw new Error('没有找到目标日期。')
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

function formatReplanStrategy(
  strategy: PreparedAdaptiveReplanAction['strategy'],
) {
  if (strategy === 'preserve_most') return '尽量保留'
  if (strategy === 'shortest_route') return '最省路程'
  return '最少改动'
}

function summarizeAdaptiveReplanChanges(
  changes: PreparedAdaptiveReplanAction['selectedOption']['diff']['itemChanges'],
) {
  const first = changes[0]
  if (!first) return '无需改动'
  const action = first.changeType === 'skipped'
    ? '将跳过'
    : first.changeType === 'day_changed'
      ? '将移到后续日期'
      : first.changeType === 'reordered'
        ? '将调整顺序'
        : first.changeType === 'time_changed'
          ? `将改为 ${first.after.startTime ?? first.after.endTime ?? '新时间'}`
          : '保持不变'
  return changes.length > 1
    ? `${first.title}${action}，共 ${changes.length} 项`
    : `${first.title}${action}`
}

function buildAdaptiveReplanDetails(
  replan: PreparedAdaptiveReplanAction,
  changes: PreparedAdaptiveReplanAction['selectedOption']['diff']['itemChanges'],
) {
  const itemDetails = changes.map((change) => {
    if (change.changeType === 'skipped') {
      return `${change.title}：${formatReplanExecutionState(change.before.executionState?.status)} → ${formatReplanExecutionState(change.after.executionState?.status)}`
    }
    if (change.changeType === 'day_changed') {
      const beforeDay = replan.dayTitlesById[change.before.dayId] ?? '原日期'
      const afterDay = replan.dayTitlesById[change.after.dayId] ?? '新日期'
      return `${change.title}：${beforeDay} → ${afterDay}`
    }
    if (change.changeType === 'reordered') {
      return `${change.title}：顺序 ${change.before.sortOrder} → ${change.after.sortOrder}`
    }
    return `${change.title}：${formatTimeRange(change.before.startTime, change.before.endTime)} → ${formatTimeRange(change.after.startTime, change.after.endTime)}`
  })
  const routeDetails = replan.selectedOption.diff.routeImpacts
    .filter((impact) => impact.staleRouteCache || impact.summary.trim())
    .map((impact) => `路线：${impact.summary}`)
  const ticketDetails = replan.selectedOption.diff.ticketImpacts
    .filter((impact) => impact.impact !== 'unaffected')
    .map((impact) => `票据「${impact.title}」：${impact.summary}`)
  const ledgerDetails = replan.selectedOption.diff.ledgerImpacts
    .filter((impact) => impact.impact !== 'unaffected')
    .map((impact) => `账本「${impact.title}」：${impact.summary}`)
  const warnings = replan.selectedOption.diff.warnings.map((warning) => `注意：${warning}`)
  return Array.from(new Set([
    ...itemDetails,
    ...routeDetails,
    ...ticketDetails,
    ...ledgerDetails,
    ...warnings,
  ]))
}

function formatReplanExecutionState(
  status: ItineraryExecutionStatus | undefined,
) {
  if (status === 'completed') return '已完成'
  if (status === 'skipped') return '已跳过'
  return '待进行'
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

function buildTicketDocumentEffect(tripId: string, ticketId: string): AiActionRunEffect {
  return {
    kind: 'navigate',
    params: { tab: 'attachments', ticketId, tripId },
    route: 'documents',
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

function formatExecutionState(
  state: AiActionItemExecutionUpdateArgs['state'],
) {
  if (state === 'completed') return '已完成'
  if (state === 'skipped') return '已跳过'
  return '待进行'
}

function formatExecutionStateChange(
  state: AiActionItemExecutionUpdateArgs['state'],
) {
  if (state === 'completed') return '标记为已完成'
  if (state === 'skipped') return '标记为已跳过'
  return '恢复为待进行'
}

function formatReplanPreference(preference: ItineraryReplanPreference) {
  const parts = [
    preference.flexibility
      ? `移动性 ${formatFlexibility(preference.flexibility)}`
      : '',
    preference.priority ? `优先级 ${formatPriority(preference.priority)}` : '',
    preference.weatherSuitability
      ? formatWeather(preference.weatherSuitability)
      : '',
    preference.mobilitySuitability
      ? formatMobility(preference.mobilitySuitability)
      : '',
    preference.bufferMinutes
      ? `缓冲 ${preference.bufferMinutes} 分钟`
      : '',
    preference.minimumStayMinutes
      ? `停留至少 ${preference.minimumStayMinutes} 分钟`
      : '',
  ].filter(Boolean)
  return parts.join(' · ') || '未设置'
}

function normalizeReplanPreference(
  preference: ItineraryReplanPreference,
): ItineraryReplanPreference {
  return {
    ...(preference.bufferMinutes !== undefined
      ? { bufferMinutes: preference.bufferMinutes }
      : {}),
    ...(preference.flexibility ? { flexibility: preference.flexibility } : {}),
    ...(preference.minimumStayMinutes !== undefined
      ? { minimumStayMinutes: preference.minimumStayMinutes }
      : {}),
    ...(preference.mobilitySuitability
      ? { mobilitySuitability: preference.mobilitySuitability }
      : {}),
    ...(preference.priority ? { priority: preference.priority } : {}),
    ...(preference.weatherSuitability
      ? { weatherSuitability: preference.weatherSuitability }
      : {}),
  }
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
