import { applyTravelInboxPreviewRecord } from '../ai/travelInboxApply'
import { applyTripReplanOption, createTripReplanPreviewForEvent, undoTripReplan } from '../adaptiveReplanning'
import { buildLedgerExpenseFromCandidate } from '../ledgerArchive'
import type { LedgerExpenseDraftCandidate } from '../ledgerExtraction'
import {
  executeTripOperationsRecommendations,
  type ExecuteTripOperationsRecommendationsResult,
} from '../tripOperationsExecutor'
import type { ExistingTripImportApplyResult } from '../ai/existingTripImport'
import type { TripOperationsAppliedChange } from '../tripOperationsState'
import { createLedgerExpense, createTripDisruptionEvent, setItineraryItemExecutionState } from '../../db'
import type { ItineraryItem, LedgerExpense, LedgerParticipant, TravelInboxPreviewRecord, TripDisruptionEvent, TripReplanRecord } from '../../types'
import {
  mapExistingTripImportAppliedChange,
  mapExistingTripImportAppliedChangeToTripOperationsChange,
  mapLedgerExpenseDraftCreatedAppliedChange,
  mapLiveDisruptionReportedAppliedChange,
  mapLiveItemExecutionAppliedChange,
  mapTripOperationsAppliedChange,
  mapTripReplanAppliedChange,
} from './appliedChanges'
import type {
  TripIntelligenceActionExecutionKind,
  TripIntelligenceActionResult,
} from './types'

type TripOperationsExecuteActionInput = {
  kind: 'trip_operations_execute'
  operation: Parameters<typeof executeTripOperationsRecommendations>[0]
}

type TravelInboxApplyPreviewActionInput = {
  checkedDiffIds?: string[]
  kind: 'travel_inbox_apply_preview'
  record: TravelInboxPreviewRecord
}

type ReplanApplyOptionActionInput = {
  kind: 'replan_apply_option'
  optionId: string
  recordId: string
}

type ReplanUndoActionInput = {
  kind: 'replan_undo'
  recordId: string
}

type LiveSetItemExecutionStateActionInput = {
  itemId: string
  kind: 'live_set_item_execution_state'
  status: 'completed' | 'skipped' | null
}

type LiveReportDisruptionActionInput = {
  event: Parameters<typeof createTripDisruptionEvent>[0]
  kind: 'live_report_disruption'
}

type LedgerCreateExpenseDraftFromCandidateActionInput = {
  candidate: LedgerExpenseDraftCandidate
  kind: 'ledger_create_expense_draft_from_candidate'
  participants: LedgerParticipant[]
  tripId: string
}

type UnsupportedActionInput = {
  kind: string
}

export type ExecuteTripIntelligenceActionInput =
  | TripOperationsExecuteActionInput
  | TravelInboxApplyPreviewActionInput
  | ReplanApplyOptionActionInput
  | ReplanUndoActionInput
  | LiveSetItemExecutionStateActionInput
  | LiveReportDisruptionActionInput
  | LedgerCreateExpenseDraftFromCandidateActionInput
  | UnsupportedActionInput

export type ExecuteTripIntelligenceActionResult = TripIntelligenceActionResult & {
  disruptionEvent?: TripDisruptionEvent
  inboxResult?: ExistingTripImportApplyResult
  legacyAppliedChanges?: TripOperationsAppliedChange[]
  ledgerExpense?: LedgerExpense
  liveItem?: ItineraryItem
  operationsResult?: ExecuteTripOperationsRecommendationsResult
  replanRecord?: TripReplanRecord
}

export async function executeTripIntelligenceAction(
  input: ExecuteTripIntelligenceActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  try {
    if (input.kind === 'trip_operations_execute') {
      return await executeTripOperationsAction(input as TripOperationsExecuteActionInput)
    }
    if (input.kind === 'travel_inbox_apply_preview') {
      return await executeTravelInboxApplyAction(input as TravelInboxApplyPreviewActionInput)
    }
    if (input.kind === 'replan_apply_option') {
      return await executeReplanApplyAction(input as ReplanApplyOptionActionInput)
    }
    if (input.kind === 'replan_undo') {
      return await executeReplanUndoAction(input as ReplanUndoActionInput)
    }
    if (input.kind === 'live_set_item_execution_state') {
      return await executeLiveSetItemExecutionStateAction(input as LiveSetItemExecutionStateActionInput)
    }
    if (input.kind === 'live_report_disruption') {
      return await executeLiveReportDisruptionAction(input as LiveReportDisruptionActionInput)
    }
    if (input.kind === 'ledger_create_expense_draft_from_candidate') {
      return await executeLedgerCreateExpenseDraftAction(input as LedgerCreateExpenseDraftFromCandidateActionInput)
    }
    return unsupportedAction(input.kind)
  } catch (error) {
    return {
      appliedChanges: [],
      message: toErrorMessage(error, '统一动作执行失败。'),
      status: 'failed',
    }
  }
}

async function executeLedgerCreateExpenseDraftAction(
  input: LedgerCreateExpenseDraftFromCandidateActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  if (input.participants.length === 0) {
    return {
      appliedChanges: [],
      legacyAppliedChanges: [],
      message: '账本缺少参与人，先在账本中补充同行人后再生成费用草稿。',
      status: 'failed',
    }
  }
  const expense = await createLedgerExpense(buildLedgerExpenseFromCandidate(
    input.candidate,
    input.tripId,
    input.participants,
    { forceDraft: true },
  ))
  const appliedChanges = [mapLedgerExpenseDraftCreatedAppliedChange(expense, input.candidate)]
  return {
    appliedChanges,
    ledgerExpense: expense,
    legacyAppliedChanges: [],
    message: `已生成「${expense.title}」费用草稿，请在账本审核后确认。`,
    status: 'completed',
  }
}

async function executeLiveSetItemExecutionStateAction(
  input: LiveSetItemExecutionStateActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  const updated = await setItineraryItemExecutionState(input.itemId, input.status)
  if (!updated) {
    return {
      appliedChanges: [],
      legacyAppliedChanges: [],
      message: '没有找到要更新的行程点。',
      status: 'failed',
    }
  }
  const appliedChanges = [mapLiveItemExecutionAppliedChange(updated, input.status)]
  return {
    appliedChanges,
    legacyAppliedChanges: [],
    liveItem: updated,
    message: input.status === 'completed'
      ? `已完成「${updated.title}」，下一站已更新。`
      : input.status === 'skipped'
        ? `已跳过「${updated.title}」，可随时恢复。`
        : `已恢复「${updated.title}」。`,
    status: 'completed',
  }
}

async function executeLiveReportDisruptionAction(
  input: LiveReportDisruptionActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  const event = await createTripDisruptionEvent(input.event)
  const record = await createTripReplanPreviewForEvent(event.id)
  const appliedChanges = [mapLiveDisruptionReportedAppliedChange(event, record)]
  return {
    appliedChanges,
    disruptionEvent: event,
    legacyAppliedChanges: [],
    message: `已生成 ${record.options.length} 个当天重排方案，确认前不会写入。`,
    replanRecord: record,
    status: 'needs_confirmation',
  }
}

async function executeTripOperationsAction(
  input: TripOperationsExecuteActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  const operationsResult = await executeTripOperationsRecommendations(input.operation)
  const appliedChanges = operationsResult.appliedChanges.map((change) => mapTripOperationsAppliedChange(change))
  const errors = operationsResult.outcomes.flatMap((outcome) => outcome.errors)
  const messages = operationsResult.outcomes.flatMap((outcome) => outcome.messages)
  const previewCount = operationsResult.pendingPreviews.length
  const status = appliedChanges.length > 0
    ? 'completed'
    : previewCount > 0
      ? 'needs_confirmation'
      : errors.length > 0
        ? 'failed'
        : 'completed'

  return {
    appliedChanges,
    legacyAppliedChanges: operationsResult.appliedChanges,
    message: buildOperationsMessage({ appliedCount: appliedChanges.length, errors, messages, previewCount }),
    operationsResult,
    status,
  }
}

async function executeTravelInboxApplyAction(
  input: TravelInboxApplyPreviewActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  const result = await applyTravelInboxPreviewRecord({
    checkedDiffIds: input.checkedDiffIds,
    record: input.record,
  })
  if (!result.ok) {
    return {
      appliedChanges: [],
      inboxResult: result,
      legacyAppliedChanges: [],
      message: result.errors.join('；') || '旅行材料应用失败。',
      status: 'failed',
    }
  }

  const now = Date.now()
  const appliedChanges = result.appliedChanges.map((change) => mapExistingTripImportAppliedChange(change, now))
  const legacyAppliedChanges = result.appliedChanges.map((change) =>
    mapExistingTripImportAppliedChangeToTripOperationsChange(change, now),
  )
  return {
    appliedChanges,
    inboxResult: result,
    legacyAppliedChanges,
    message: appliedChanges.length > 0
      ? `已应用 ${appliedChanges.length} 项旅行材料建议。`
      : '没有可应用的旅行材料修改。',
    status: appliedChanges.length > 0 ? 'completed' : 'failed',
  }
}

async function executeReplanApplyAction(
  input: ReplanApplyOptionActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  const record = await applyTripReplanOption(input.recordId, input.optionId)
  const appliedChanges = [mapTripReplanAppliedChange(record, 'applied')]
  return {
    appliedChanges,
    legacyAppliedChanges: [],
    message: '已应用重排方案，同行人会在共享行程发布后看到新的集合时间。',
    replanRecord: record,
    status: 'completed',
  }
}

async function executeReplanUndoAction(
  input: ReplanUndoActionInput,
): Promise<ExecuteTripIntelligenceActionResult> {
  const record = await undoTripReplan(input.recordId)
  const appliedChanges = [mapTripReplanAppliedChange(record, 'undone')]
  return {
    appliedChanges,
    legacyAppliedChanges: [],
    message: '已撤销整次重排。',
    replanRecord: record,
    status: 'completed',
  }
}

function unsupportedAction(kind: string): ExecuteTripIntelligenceActionResult {
  return {
    appliedChanges: [],
    message: `「${kind}」尚未接入统一执行，将继续使用现有手动流程。`,
    status: 'failed',
  }
}

function buildOperationsMessage({
  appliedCount,
  errors,
  messages,
  previewCount,
}: {
  appliedCount: number
  errors: string[]
  messages: string[]
  previewCount: number
}) {
  const parts: string[] = []
  if (appliedCount > 0) parts.push(`已完成 ${appliedCount} 项旅行建议。`)
  if (previewCount > 0) parts.push(`${previewCount} 项生成了预览，写入前仍需再次确认。`)
  if (appliedCount === 0 && messages.length > 0) parts.push(messages.join('；'))
  if (errors.length > 0) parts.push(errors.join('；'))
  return parts.join(' ') || '没有可执行的旅行建议。'
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export const SUPPORTED_TRIP_INTELLIGENCE_ACTION_KINDS: TripIntelligenceActionExecutionKind[] = [
  'ledger_create_expense_draft_from_candidate',
  'live_report_disruption',
  'live_set_item_execution_state',
  'trip_operations_execute',
  'travel_inbox_apply_preview',
  'replan_apply_option',
  'replan_undo',
]
