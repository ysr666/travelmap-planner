import type { LedgerExpenseCategory, RouteId } from '../../../types'

export const AI_ACTION_PLAN_SCHEMA_VERSION = 'ai_action_plan.v1' as const
export const AI_ACTION_PLAN_MAX_STEPS = 6

export type AiActionId =
  | 'day.items.reorder@1'
  | 'item.create@1'
  | 'item.move@1'
  | 'item.time.update@1'
  | 'ledger.expense.draft@1'
  | 'place.enrich@1'
  | 'route.preview@1'
  | 'ticket.open@1'
  | 'trip.repair@1'
  | 'workspace.open@1'

export type AiActionRisk =
  | 'local_write'
  | 'provider_read'
  | 'read_only'

export type AiActionStepStatus =
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'pending'
  | 'prepared'
  | 'running'
  | 'skipped'

export type AiActionTicketOpenArgs = {
  query?: string
}

export type AiActionItemTimeUpdateArgs = {
  endTime?: string
  startTime: string
  target: string
}

export type AiActionItemCreateArgs = {
  day: string
  endTime?: string
  startTime?: string
  title: string
}

export type AiActionDayItemsReorderArgs = {
  anchor?: string
  day?: string
  position: 'after' | 'before' | 'first' | 'last'
  target: string
}

export type AiActionItemMoveArgs = {
  anchor?: string
  destinationDay: string
  position: 'after' | 'before' | 'first' | 'last'
  sourceDay?: string
  target: string
}

export type AiActionLedgerExpenseDraftArgs = {
  amount: string
  category?: LedgerExpenseCategory
  currency?: string
  date?: string
  title: string
}

export type AiActionPlaceEnrichArgs = {
  target: string
}

export type AiActionRoutePreviewArgs = {
  scope: 'day' | 'trip'
  target?: string
}

export type AiActionTripRepairArgs = {
  scope: 'day' | 'item' | 'trip'
  target?: string
}

export type AiActionWorkspaceOpenTarget =
  | 'documents'
  | 'home'
  | 'inbox'
  | 'ledger'
  | 'map'
  | 'search'
  | 'settings'
  | 'trip'

export type AiActionWorkspaceOpenArgs = {
  target: AiActionWorkspaceOpenTarget
}

export type AiActionArgsById = {
  'day.items.reorder@1': AiActionDayItemsReorderArgs
  'item.create@1': AiActionItemCreateArgs
  'item.move@1': AiActionItemMoveArgs
  'item.time.update@1': AiActionItemTimeUpdateArgs
  'ledger.expense.draft@1': AiActionLedgerExpenseDraftArgs
  'place.enrich@1': AiActionPlaceEnrichArgs
  'route.preview@1': AiActionRoutePreviewArgs
  'ticket.open@1': AiActionTicketOpenArgs
  'trip.repair@1': AiActionTripRepairArgs
  'workspace.open@1': AiActionWorkspaceOpenArgs
}

export type AiActionInputSchema = {
  allowedFields: readonly string[]
  requiredFields: readonly string[]
}

export type AiActionRetryPolicy = {
  maxAttempts: number
  retryable: boolean
}

export type AiActionStepV1<TActionId extends AiActionId = AiActionId> = {
  actionId: TActionId
  args: AiActionArgsById[TActionId]
  dependsOn: string[]
  id: string
  idempotencyKey: string
  risk: AiActionRisk
  status: AiActionStepStatus
}

export type AiActionPlanV1 = {
  baselineFingerprint?: string
  planId: string
  requiresConfirmation: boolean
  schemaVersion: typeof AI_ACTION_PLAN_SCHEMA_VERSION
  steps: AiActionStepV1[]
  summary: string
}

export type AiActionDefinition<
  TActionId extends AiActionId = AiActionId,
  TPrepared = unknown,
  TOutput = unknown,
> = {
  description: string
  getIdempotencyKey: (
    args: AiActionArgsById[TActionId],
    context: { planId: string; stepId: string },
  ) => string
  id: TActionId
  inputSchema: AiActionInputSchema
  label: string
  prepare: (args: AiActionArgsById[TActionId], context: unknown) => Promise<TPrepared>
  preview: (prepared: TPrepared, context: unknown) => Promise<string> | string
  execute: (prepared: TPrepared, context: unknown) => Promise<TOutput>
  requiresTrip: boolean
  retryPolicy: AiActionRetryPolicy
  risk: AiActionRisk
}

export type AiActionPreparedStep = {
  actionId: AiActionId
  affectedLabels: string[]
  confirmationFingerprint: string
  hasWrite: boolean
  id: string
  idempotencyKey: string
  manualEntry?: AiActionManualEntry
  preview: string
  prepared: unknown
  risk: AiActionRisk
  status: Extract<AiActionStepStatus, 'failed' | 'prepared'>
  error?: string
}

export type AiActionPreparedPlan = {
  baselineFingerprint?: string
  executionId: string
  plan: AiActionPlanV1
  preparedAt: number
  steps: AiActionPreparedStep[]
}

export type AiActionStepRunResult = {
  actionId: AiActionId
  id: string
  message: string
  status: Extract<AiActionStepStatus, 'completed' | 'failed' | 'skipped'>
}

export type AiActionRunEffect = {
  kind: 'navigate'
  params?: Record<string, string>
  route: RouteId
  scrollTargetId?: string
}

export type AiActionManualEntry = AiActionRunEffect & {
  label: string
}

export type AiActionRunResult = {
  completedStepIds: string[]
  effects: AiActionRunEffect[]
  failedStepIds: string[]
  message: string
  requiresFreshConfirmation: boolean
  status: 'completed' | 'failed' | 'partial'
  steps: AiActionStepRunResult[]
}

export type AiActionPlanValidationResult =
  | { ok: true; plan: AiActionPlanV1 }
  | { errors: string[]; ok: false }

export type AiActionCatalogDescriptor = {
  description: string
  id: AiActionId
  input: string
  label: string
  requiresTrip: boolean
  risk: AiActionRisk
}
