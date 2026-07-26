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
  'day.items.reorder@1': {
    description: '在同一天内把一个明确行程点移到首位、末位，或另一个明确行程点前后；写入前必须确认。',
    id: 'day.items.reorder@1',
    idempotencyNamespace: 'day-items-reorder',
    input: '{"target":"current_item|first_item|行程点名称","position":"first|last|before|after","anchor":"before/after 时必填的行程点名称","day":"可选 current_day|first_day|第 N 天|日期标题"}',
    inputSchema: {
      allowedFields: ['target', 'position', 'anchor', 'day'],
      requiredFields: ['target', 'position'],
    },
    label: '调整当天顺序',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'history.undo@1': {
    description: '撤销当前旅行最近一次或唯一名称匹配的行程点删除；只接受固定历史类型和可选语义名称，写入前必须确认。',
    id: 'history.undo@1',
    idempotencyNamespace: 'history-undo',
    input: '{"kind":"item_delete","target":"可选的已删除行程点名称"}',
    inputSchema: {
      allowedFields: ['kind', 'target'],
      requiredFields: ['kind'],
    },
    label: '撤销行程点删除',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'item.create@1': {
    description: '在一个明确日期末尾新增一个基础行程点；只接受短标题和可选时间，写入前必须确认。',
    id: 'item.create@1',
    idempotencyNamespace: 'item-create',
    input: '{"day":"current_day|first_day|第 N 天|日期标题","title":"行程点标题","startTime":"可选 HH:mm","endTime":"可选 HH:mm"}',
    inputSchema: {
      allowedFields: ['day', 'title', 'startTime', 'endTime'],
      requiredFields: ['day', 'title'],
    },
    label: '新增行程点',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'item.delete@1': {
    description: '从一个明确日期中移除一个明确行程点并保存可撤销快照；票据、账本和订单保持不变，写入前必须确认。',
    id: 'item.delete@1',
    idempotencyNamespace: 'item-delete',
    input: '{"target":"current_item|first_item|行程点名称","day":"可选 current_day|first_day|第 N 天|日期标题"}',
    inputSchema: {
      allowedFields: ['target', 'day'],
      requiredFields: ['target'],
    },
    label: '删除行程点',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'item.execution.update@1': {
    description: '把一个明确行程点标记为已完成、已跳过或恢复为待进行；不会根据时间、位置或模型自动推断，写入前必须确认。',
    id: 'item.execution.update@1',
    idempotencyNamespace: 'item-execution-update',
    input: '{"target":"current_item|first_item|行程点名称","state":"completed|skipped|active","day":"可选 current_day|first_day|第 N 天|日期标题"}',
    inputSchema: {
      allowedFields: ['target', 'state', 'day'],
      requiredFields: ['target', 'state'],
    },
    label: '更新行程进度',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'item.move@1': {
    description: '把一个明确行程点移动到另一天的首位、末位，或目标日期内另一个明确行程点前后；写入前必须确认。',
    id: 'item.move@1',
    idempotencyNamespace: 'item-move',
    input: '{"target":"current_item|first_item|行程点名称","destinationDay":"current_day|first_day|第 N 天|日期标题","position":"first|last|before|after","anchor":"before/after 时必填的目标日期行程点名称","sourceDay":"可选 current_day|first_day|第 N 天|日期标题"}',
    inputSchema: {
      allowedFields: ['target', 'destinationDay', 'position', 'anchor', 'sourceDay'],
      requiredFields: ['target', 'destinationDay', 'position'],
    },
    label: '跨日移动行程点',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
  'item.replan.preference.update@1': {
    description: '更新一个明确行程点的固定重排偏好；只接受登记枚举和有界分钟数，写入前必须确认。',
    id: 'item.replan.preference.update@1',
    idempotencyNamespace: 'item-replan-preference-update',
    input: '{"target":"current_item|first_item|行程点名称","day":"可选语义日期","flexibility":"可选 fixed|movable|optional","priority":"可选 must_keep|high|normal|low","weatherSuitability":"可选 any_weather|avoid_rain|indoor_preferred","mobilitySuitability":"可选 normal|easy|demanding","bufferMinutes":"可选 1-240 整数","minimumStayMinutes":"可选 1-720 整数"}',
    inputSchema: {
      allowedFields: [
        'target',
        'day',
        'flexibility',
        'priority',
        'weatherSuitability',
        'mobilitySuitability',
        'bufferMinutes',
        'minimumStayMinutes',
      ],
      requiredFields: ['target'],
    },
    label: '更新重排偏好',
    requiresTrip: true,
    retryPolicy: { maxAttempts: 2, retryable: true },
    risk: 'local_write',
  },
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
  'ledger.expense.draft@1': {
    description: '创建一笔待审核费用草稿；不会确认付款、执行结算或自动补充汇率。',
    id: 'ledger.expense.draft@1',
    idempotencyNamespace: 'ledger-expense-draft',
    input: '{"title":"费用名称","amount":"正数十进制","currency":"可选 ISO 4217","date":"可选 YYYY-MM-DD","category":"可选固定类别"}',
    inputSchema: {
      allowedFields: ['title', 'amount', 'currency', 'date', 'category'],
      requiredFields: ['title', 'amount'],
    },
    label: '创建费用草稿',
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
  'route.preview@1': {
    description: '为当前日期、指定日期或整趟旅行生成道路路线预览；请求和缓存写入前必须确认。',
    id: 'route.preview@1',
    idempotencyNamespace: 'route-preview',
    input: '{"scope":"day|trip","target":"day 范围可选 current_day|first_day|第 N 天|日期标题"}',
    inputSchema: { allowedFields: ['scope', 'target'], requiredFields: ['scope'] },
    label: '生成路线预览',
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
