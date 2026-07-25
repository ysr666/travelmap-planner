import type {
  AiActionCatalogDescriptor,
  AiActionArgsById,
  AiActionId,
  AiActionInputSchema,
  AiActionRetryPolicy,
  AiActionRisk,
} from './types'

type AiActionMetadata = AiActionCatalogDescriptor & {
  idempotencyNamespace: string
  inputSchema: AiActionInputSchema
  retryPolicy: AiActionRetryPolicy
}

const ACTION_METADATA: Record<AiActionId, AiActionMetadata> = {
  'item.time.update@1': {
    description: '调整一个明确行程点的开始时间；可同时设置结束时间，写入前必须确认。',
    id: 'item.time.update@1',
    idempotencyNamespace: 'item-time-update',
    input: '{"target":"current_item|first_item|行程点名称","startTime":"HH:mm","endTime":"可选 HH:mm"}',
    inputSchema: { allowedFields: ['target', 'startTime', 'endTime'], requiredFields: ['target', 'startTime'] },
    label: '调整行程时间',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 1, retryable: false },
    risk: 'local_write',
  },
  'place.enrich@1': {
    description: '为一个明确的行程点查询地点候选，并在确认后补充名称、地址和坐标。',
    id: 'place.enrich@1',
    idempotencyNamespace: 'place-enrich',
    input: '{"target":"current_item|first_item|行程点名称"}',
    inputSchema: { allowedFields: ['target'], requiredFields: ['target'] },
    label: '补全地点',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'ticket.open@1': {
    description: '只使用本地票据 metadata 查找并打开票据或票据画廊。',
    id: 'ticket.open@1',
    idempotencyNamespace: 'ticket-open',
    input: '{"query":"可选的票据关键词"}',
    inputSchema: { allowedFields: ['query'], requiredFields: [] },
    label: '打开票据',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 1, retryable: false },
    risk: 'read_only',
  },
  'trip.repair@1': {
    description: '准备并执行当前旅行可自动修复的地点、路线、内容、提示和票据同步问题。',
    id: 'trip.repair@1',
    idempotencyNamespace: 'trip-repair',
    input: '{"scope":"trip|day|item","target":"可选的语义目标"}',
    inputSchema: { allowedFields: ['scope', 'target'], requiredFields: ['scope'] },
    label: '智能修复行程',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'workspace.open@1': {
    description: '打开资料、首页、收件箱、账本、地图、搜索、设置或当前行程等受限语义页面。',
    id: 'workspace.open@1',
    idempotencyNamespace: 'workspace-open',
    input: '{"target":"documents|home|inbox|ledger|map|search|settings|trip"}',
    inputSchema: { allowedFields: ['target'], requiredFields: ['target'] },
    label: '打开页面',
    requiresTrip: false,
    retryPolicy: { maxAttempts: 1, retryable: false },
    risk: 'read_only',
  },
}

export const AI_ACTION_IDS = Object.freeze(Object.keys(ACTION_METADATA) as AiActionId[])

export function getAiActionMetadata(actionId: AiActionId) {
  return ACTION_METADATA[actionId]
}

export function getAiActionRisk(actionId: AiActionId): AiActionRisk {
  return ACTION_METADATA[actionId].risk
}

export function getAiActionInputSchema(actionId: AiActionId): AiActionInputSchema {
  return ACTION_METADATA[actionId].inputSchema
}

export function getAiActionRetryPolicy(actionId: AiActionId): AiActionRetryPolicy {
  return ACTION_METADATA[actionId].retryPolicy
}

export function getAiActionIdempotencyKey<TActionId extends AiActionId>(
  actionId: TActionId,
  _args: AiActionArgsById[TActionId],
  context: { planId: string; stepId: string },
) {
  return `${ACTION_METADATA[actionId].idempotencyNamespace}:${context.planId}:${context.stepId}`
}

export function listAiActionCatalog(): AiActionCatalogDescriptor[] {
  return AI_ACTION_IDS.map((actionId) => {
    const action = ACTION_METADATA[actionId]
    return {
      description: action.description,
      id: action.id,
      input: action.input,
      label: action.label,
      requiresTrip: action.requiresTrip,
      risk: action.risk,
    }
  })
}

export function isAiActionId(value: unknown): value is AiActionId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTION_METADATA, value)
}
