import type { AiPrivacySettings } from '../aiPrivacy'
import {
  parseGlobalAiCommandIntent,
  type GlobalAiCommandContext,
} from '../globalAiCommandRouter'
import {
  PROVIDER_PROXY_AI_ACTION_PLAN_OPERATION,
  type ProviderProxyAiActionPlanRequest,
} from '../providerProxyContract'
import { getAiActionRisk, listAiActionCatalog } from './registry'
import {
  AI_ACTION_PLAN_SCHEMA_VERSION,
  type AiActionId,
  type AiActionDayItemsReorderArgs,
  type AiActionHistoryUndoArgs,
  type AiActionItemCreateArgs,
  type AiActionItemDeleteArgs,
  type AiActionItemExecutionUpdateArgs,
  type AiActionItemMoveArgs,
  type AiActionItemReplanPreferenceUpdateArgs,
  type AiActionItemTimeUpdateArgs,
  type AiActionLedgerExpenseDraftArgs,
  type AiActionPlanV1,
  type AiActionRoutePreviewArgs,
  type AiActionStepV1,
  type AiActionTripReplanApplyArgs,
} from './types'
import { validateAiActionPlan } from './validation'

const ACTION_VERBS = [
  '打开',
  '找到',
  '找一下',
  '查找',
  '补全',
  '补充',
  '修复',
  '处理',
  '整理',
  '完成',
  '调整',
  '移动到',
  '挪到',
  '移到',
  '进入',
  '查看',
  '生成',
  '新增',
  '添加',
  '记录',
  '记一笔',
  '创建',
  '删除',
  '移除',
  '撤销',
  '恢复',
  '跳过',
  '标记',
  '设为',
]

export function buildDeterministicAiActionPlan(command: string): AiActionPlanV1 | null {
  const normalized = command.trim()
  if (!normalized || isExplicitlyNegatedActionCommand(normalized)) return null
  const steps: Array<Record<string, unknown>> = []
  const intent = parseGlobalAiCommandIntent(normalized)
  const adaptiveReplanIntent = parseAdaptiveReplanIntent(normalized, intent)

  if (intent.kind === 'ticket_lookup') {
    steps.push({
      actionId: 'ticket.open@1',
      args: intent.query ? { query: intent.query } : {},
      dependsOn: [],
      id: 'open-ticket',
    })
  }

  if (intent.kind === 'page_navigation') {
    steps.push(intent.target === 'tickets'
      ? {
          actionId: 'ticket.open@1',
          args: {},
          dependsOn: [],
          id: 'open-ticket-gallery',
        }
      : {
          actionId: 'workspace.open@1',
          args: { target: intent.target },
          dependsOn: [],
          id: 'open-workspace',
        })
  }

  const historyUndo = parseDeterministicHistoryUndo(normalized)
  if (historyUndo) {
    steps.push({
      actionId: 'history.undo@1',
      args: historyUndo,
      dependsOn: [],
      id: 'undo-item-delete',
    })
  }

  const itemCreate = historyUndo ? null : parseDeterministicItemCreate(normalized)
  if (itemCreate) {
    steps.push({
      actionId: 'item.create@1',
      args: itemCreate,
      dependsOn: [],
      id: 'create-item',
    })
  }

  const itemDelete = historyUndo || itemCreate
    ? null
    : parseDeterministicItemDelete(normalized)
  if (itemDelete) {
    steps.push({
      actionId: 'item.delete@1',
      args: itemDelete,
      dependsOn: [],
      id: 'delete-item',
    })
  }

  const itemMove = itemCreate || itemDelete ? null : parseDeterministicItemMove(normalized)
  if (itemMove) {
    steps.push({
      actionId: 'item.move@1',
      args: itemMove,
      dependsOn: [],
      id: 'move-item',
    })
  }

  const dayReorder = itemCreate || itemDelete || itemMove ? null : parseDeterministicDayReorder(normalized)
  if (dayReorder) {
    steps.push({
      actionId: 'day.items.reorder@1',
      args: dayReorder,
      dependsOn: [],
      id: 'reorder-day-items',
    })
  }

  const timeUpdate = itemCreate || itemDelete || itemMove ? null : parseDeterministicTimeUpdate(normalized)
  if (timeUpdate) {
    steps.push({
      actionId: 'item.time.update@1',
      args: timeUpdate,
      dependsOn: [],
      id: 'update-item-time',
    })
  }

  const itemExecutionUpdate = historyUndo
    || itemCreate
    || itemDelete
    || itemMove
    || dayReorder
    || timeUpdate
    ? null
    : parseDeterministicItemExecutionUpdate(normalized)
  if (itemExecutionUpdate) {
    steps.push({
      actionId: 'item.execution.update@1',
      args: itemExecutionUpdate,
      dependsOn: [],
      id: 'update-item-execution',
    })
  }

  const replanPreferenceUpdate = historyUndo
    || itemCreate
    || itemDelete
    || itemMove
    || dayReorder
    || timeUpdate
    || itemExecutionUpdate
    || adaptiveReplanIntent.kind === 'replan'
    || intent.kind !== 'preference_update'
    ? null
    : parseDeterministicReplanPreferenceUpdate(
        normalized,
        intent.preference,
      )
  if (replanPreferenceUpdate) {
    steps.push({
      actionId: 'item.replan.preference.update@1',
      args: replanPreferenceUpdate,
      dependsOn: [],
      id: 'update-item-replan-preference',
    })
  }

  const adaptiveReplan = historyUndo
    || itemCreate
    || itemDelete
    || itemMove
    || dayReorder
    || timeUpdate
    || itemExecutionUpdate
    || replanPreferenceUpdate
    ? null
    : parseDeterministicAdaptiveReplan(normalized, adaptiveReplanIntent)
  if (adaptiveReplan) {
    steps.push({
      actionId: 'trip.replan.apply@1',
      args: adaptiveReplan,
      dependsOn: [],
      id: 'apply-adaptive-replan',
    })
  }

  const tripRepair = adaptiveReplan ? false : isTripRepairCommand(normalized)
  const routePreview = tripRepair || adaptiveReplan
    ? null
    : parseDeterministicRoutePreview(normalized)
  if (routePreview) {
    steps.push({
      actionId: 'route.preview@1',
      args: routePreview,
      dependsOn: [],
      id: 'generate-route-preview',
    })
  }

  const expenseDraft = itemCreate || itemDelete || adaptiveReplan
    ? null
    : parseDeterministicExpenseDraft(normalized)
  if (expenseDraft) {
    steps.push({
      actionId: 'ledger.expense.draft@1',
      args: expenseDraft,
      dependsOn: [],
      id: 'create-expense-draft',
    })
  }

  if (tripRepair) {
    steps.push({
      actionId: 'trip.repair@1',
      args: {
        scope: inferRepairScope(normalized),
        ...(inferSemanticTarget(normalized) ? { target: inferSemanticTarget(normalized) } : {}),
      },
      dependsOn: [],
      id: 'repair-trip',
    })
  } else if (isPlaceEnrichmentCommand(normalized)) {
    steps.push({
      actionId: 'place.enrich@1',
      args: { target: inferSemanticTarget(normalized) ?? normalized },
      dependsOn: [],
      id: 'enrich-place',
    })
  }

  const safeSteps = isNonAffirmativeWriteCommand(normalized)
    ? steps.filter((step) =>
        getAiActionRisk(step.actionId as AiActionId) !== 'local_write',
      )
    : steps
  if (safeSteps.length === 0) return null
  const validation = validateAiActionPlan({
    schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
    steps: safeSteps,
    summary: summarizeSteps(safeSteps),
  })
  return validation.ok ? validation.plan : null
}

export function shouldRequestAiActionPlan(command: string) {
  const normalized = command.trim()
  if (!normalized || buildDeterministicAiActionPlan(normalized)) return false
  if (
    isHypotheticalCommand(normalized)
    || isExplicitlyNegatedActionCommand(normalized)
    || isNonAffirmativeWriteCommand(normalized)
    || isNonActionItemStateCommand(normalized)
    || isNonActionReplanCommand(normalized)
  ) {
    return false
  }
  return ACTION_VERBS.some((verb) => normalized.includes(verb)) &&
    ['票', '地点', '地址', '坐标', '行程', '行程点', '删除', '撤销', '恢复', '完成', '跳过', '进度', '优先级', '缓冲', '停留', '雨天', '体力', '不可动', '站', '天', '日期', '跨日', '顺序', '前面', '后面', '路线', '问题', '建议', '资料', '文档', '账本', '账单', '费用', '消费', '餐', '车费', '住宿', '酒店', '保险', '购物', '地图', '设置', '时间', '开始', '结束']
      .some((noun) => normalized.includes(noun))
}

export type AiActionPlanCommandBindingResult =
  | { ok: true }
  | { errors: string[]; ok: false }

export function validateAiActionPlanCommandBinding(
  command: string,
  plan: AiActionPlanV1,
): AiActionPlanCommandBindingResult {
  const normalized = command.trim()
  if (!normalized) {
    return { errors: ['用户指令不能为空。'], ok: false }
  }
  const errors = plan.steps.flatMap((step) =>
    isAiActionStepBoundToCommand(normalized, step)
      ? []
      : [`动作 ${step.actionId} 与用户指令不一致。`],
  )
  return errors.length > 0
    ? { errors: Array.from(new Set(errors)), ok: false }
    : { ok: true }
}

export function buildAiActionPlanProviderRequest(
  command: string,
  context: GlobalAiCommandContext & { scopeLabel?: string },
  privacy: AiPrivacySettings,
): ProviderProxyAiActionPlanRequest {
  const summaries: ProviderProxyAiActionPlanRequest['context']['summaries'] = [{
    key: 'page_scope',
    label: '当前范围',
    value: context.currentItem ? '当前行程点' : context.currentDay ? '当前日期' : context.trip ? '当前旅行' : '全部旅行',
  }]
  if (context.trip) {
    summaries.push({
      key: 'trip_shape',
      label: '旅行结构',
      value: `${context.days.length} 天，${context.items.length} 个行程点`,
    })
  }
  if (privacy.allowItineraryBasics && context.trip) {
    summaries.push({
      key: 'trip',
      label: '旅行',
      value: [context.trip.title, context.trip.startDate, context.trip.endDate].filter(Boolean).join(' · '),
    })
    if (context.currentDay) {
      summaries.push({ key: 'current_day', label: '当前日期', value: context.currentDay.title })
    }
    if (context.currentItem) {
      summaries.push({ key: 'current_item', label: '当前行程点', value: context.currentItem.title })
    }
  }
  if (privacy.allowLocationText && context.trip?.destination) {
    summaries.push({ key: 'destination', label: '目的地', value: context.trip.destination })
  }
  if (privacy.allowTicketMetadata) {
    summaries.push({ key: 'ticket_count', label: '票据数量', value: String(context.tickets.length) })
  }
  const genericScope = context.currentItem
    ? '当前行程点'
    : context.currentDay
      ? '当前日期'
      : context.trip
        ? '当前旅行'
        : '全部旅行'
  return {
    availableActions: listAiActionCatalog(),
    command: command.trim(),
    context: {
      scopeLabel: privacy.allowItineraryBasics && context.scopeLabel ? context.scopeLabel : genericScope,
      summaries,
    },
    locale: 'zh-CN',
    operation: PROVIDER_PROXY_AI_ACTION_PLAN_OPERATION,
  }
}

function isTripRepairCommand(command: string) {
  const repairVerb = ['修复', '一键处理', '全部处理', '智能整理'].some((value) => command.includes(value))
  const broadScope = ['全部', '所有', '缺失', '问题', '建议', '路线', '行程'].some((value) => command.includes(value))
  return repairVerb && broadScope
}

function isPlaceEnrichmentCommand(command: string) {
  const placeNoun = ['地点', '地址', '坐标', '位置'].some((value) => command.includes(value))
  const actionVerb = ['补', '查', '找', '完善', '修复'].some((value) => command.includes(value))
  return placeNoun && actionVerb
}

function inferRepairScope(command: string): 'day' | 'item' | 'trip' {
  if (['今天', '当天', '这一日', '这一天'].some((value) => command.includes(value))) return 'day'
  if (['这一站', '当前站', '这个地点', '当前地点'].some((value) => command.includes(value))) return 'item'
  return 'trip'
}

function inferSemanticTarget(command: string) {
  const quoted = command.match(/[「“"]([^」”"]{1,80})[」”"]/)
  if (quoted?.[1]?.trim()) return quoted[1].trim()
  if (hasAffirmativeSemanticMarker(command, ['第一站', '首站', '第一个地点'])) {
    return 'first_item'
  }
  if (hasAffirmativeSemanticMarker(
    command,
    ['当前站', '这一站', '这个地点', '当前地点', '当前行程点', '这个行程点', '这个预约'],
  )) {
    return 'current_item'
  }
  return undefined
}

function parseDeterministicItemCreate(command: string): AiActionItemCreateArgs | null {
  if (isHypotheticalCommand(command)) return null
  const verb = command.match(/新增|添加|加入|插入|加一个/)
  const day = findPlannerDayTarget(command)
  if (!verb || verb.index === undefined || !day) return null

  const prefix = command.slice(0, verb.index)
  const explicitSubject = prefix.match(/(?:把|将)\s*(.+)$/)?.[1]?.trim()
  const rawTitle = explicitSubject
    ? explicitSubject
    : day.index < verb.index
      ? command.slice(verb.index + verb[0].length)
      : command.slice(verb.index + verb[0].length, day.index)
  const quoted = rawTitle.match(/[「“"]([^」”"]{1,100})[」”"]/)
  const timeRange = extractTrailingPlannerTimeRange(rawTitle)
  const titleSource = quoted?.[1] ?? rawTitle.slice(0, timeRange?.index ?? rawTitle.length)
  const title = cleanItemCreateTitle(titleSource, day.text)
  if (!title || title.length > 100 || /(?:以及|并且|、|和).+(?:新增|添加|加入|插入)/.test(title)) return null

  return {
    day: day.target,
    ...(timeRange?.endTime ? { endTime: timeRange.endTime } : {}),
    ...(timeRange?.startTime ? { startTime: timeRange.startTime } : {}),
    title,
  }
}

function parseDeterministicHistoryUndo(command: string): AiActionHistoryUndoArgs | null {
  if (isHypotheticalCommand(command)) return null
  const undoVerb = command.match(/撤销|恢复/)
  if (!undoVerb || !/(?:删除|移除)/.test(command)) return null
  if (/(?:订单|预订|付款|退款|票据|门票|账本|费用)/.test(command)) return null

  const targetSource = command
    .replace(/^(?:请|麻烦|帮我|给我|\s)+/g, '')
    .replace(/^(?:撤销|恢复)\s*(?:刚才|刚刚|刚)?\s*(?:的)?\s*(?:删除|移除)\s*(?:的)?/g, '')
    .replace(/^(?:撤销|恢复)\s*(?:刚才|刚刚|刚)?\s*(?:的)?\s*/g, '')
    .replace(/^(?:删除|移除)\s*(?:的)?/g, '')
    .replace(/(?:这个|该)?(?:行程点|站点)\s*$/g, '')
    .replace(/[，,。；;：:\s]+$/g, '')
    .trim()
  if (!targetSource || /^(?:删除|移除)$/.test(targetSource)) {
    return { kind: 'item_delete' }
  }
  const semanticTarget = inferSemanticTarget(targetSource)
  const target = semanticTarget ?? cleanSemanticSelector(targetSource)
  if (!target || target.length > 160) return null
  return { kind: 'item_delete', target }
}

function parseDeterministicItemDelete(command: string): AiActionItemDeleteArgs | null {
  if (isHypotheticalCommand(command)) return null
  if (/(?:取消|退款|退票|作废)/.test(command)) return null
  if (/(?:票据|门票|订单|预订|付款|账本|费用|整个旅行|整趟旅行)/.test(command)) {
    return null
  }
  const verb = command.match(/删除|移除/)
  if (!verb || verb.index === undefined) return null
  const day = findPlannerDayTarget(command)
  const beforeVerb = command.slice(0, verb.index)
  const afterVerb = command.slice(verb.index + verb[0].length)
  const beforeIsOnlyScope = /^(?:请|麻烦|帮我|给我|\s)*(?:从)?(?:当天|当日|当前)?行程(?:中|里|内)?\s*$/.test(beforeVerb)
  const rawTarget = verb.index === 0 || beforeIsOnlyScope ? afterVerb : beforeVerb
  const semanticTarget = inferSemanticTarget(rawTarget)
  const target = semanticTarget ?? cleanSemanticSelector(rawTarget, day?.text)
    .replace(/^的\s*/g, '')
    .replace(/(?:从)?(?:当天|当日|当前)?行程(?:中|里|内)?\s*$/g, '')
    .replace(/(?:这个|该)?(?:行程点|站点)\s*$/g, '')
    .replace(/[，,。；;：:\s]+$/g, '')
    .trim()
  if (
    !target
    || target.length > 160
    || /^(?:整个|当前)?(?:行程|旅行)$/.test(target)
  ) {
    return null
  }
  return {
    ...(day ? { day: day.target } : {}),
    target,
  }
}

function parseDeterministicItemExecutionUpdate(
  command: string,
): AiActionItemExecutionUpdateArgs | null {
  if (
    isHypotheticalCommand(command)
    || isNonActionItemStateCommand(command)
    || isTripRepairCommand(command)
    || /(?:删除|移除|取消|退款|退票)/.test(command)
  ) {
    return null
  }
  if (/(?:可以|可|能|必要时)(?:直接)?跳过|跳过也行/.test(command)) {
    return null
  }
  const day = findPlannerDayTarget(command)
  let state: AiActionItemExecutionUpdateArgs['state'] | undefined
  if (/(?:待进行|未完成|未处理|重新加入下一站|恢复为进行中)/.test(command)
    && /(?:恢复|重置|重新加入)/.test(command)) {
    state = 'active'
  } else if (/(?:已完成|已经完成|完成了|标记为完成|设为完成|完成$)/.test(command)) {
    state = 'completed'
  } else if (/(?:已跳过|已经跳过|跳过了|标记为跳过|设为跳过)/.test(command)
    || /^(?:请|麻烦|帮我|给我|\s)*(?:跳过)\s*/.test(command)) {
    state = 'skipped'
  }
  if (!state) return null

  const semanticTarget = inferSemanticTarget(command)
  const target = semanticTarget ?? cleanSemanticSelector(
    command
      .replace(day?.text ?? '', ' ')
      .replace(/^(?:请|麻烦|帮我|给我|把|将|\s)+/g, '')
      .replace(/(?:标记|设置|设|改)?为?\s*(?:已经|已)?(?:完成|跳过)(?:了)?/g, ' ')
      .replace(/^(?:完成|跳过)\s*/g, '')
      .replace(/(?:恢复|重置|重新加入)\s*/g, '')
      .replace(/(?:为)?(?:待进行|未完成|未处理|进行中|下一站)/g, ' ')
      .replace(/(?:这个|该)?(?:行程点|站点)\s*$/g, '')
      .replace(/[，,。；;：:\s]+/g, ' ')
      .trim(),
  ).replace(/^的\s*/, '')
  if (!target || target.length > 160) return null
  return {
    ...(day ? { day: day.target } : {}),
    state,
    target,
  }
}

function parseDeterministicReplanPreferenceUpdate(
  command: string,
  preference: Omit<AiActionItemReplanPreferenceUpdateArgs, 'day' | 'target'>,
): AiActionItemReplanPreferenceUpdateArgs | null {
  if (
    isHypotheticalCommand(command)
    || isNonActionItemStateCommand(command)
    || /(?:不要|别|无需|不用|不必)\s*(?:把|将|让)?[^，。；;]{0,24}(?:固定|不能动|必须保留|可移动|优先级|缓冲|预留|停留)/.test(command)
  ) {
    return null
  }
  const day = findPlannerDayTarget(command)
  const semanticTarget = inferSemanticTarget(command)
  const target = semanticTarget ?? cleanSemanticSelector(
    command
      .replace(day?.text ?? '', ' ')
      .replace(/(?:不能动|不可动|固定|预约不能改|不能改时间|必须按原计划|可以挪|可移动|能移动|可以调整时间|可舍弃|可以舍弃|不重要|可以删|可以取消|可以跳过|必须保留|一定要去|必去|最高优先级|高优先级|尽量保留|很想去|低优先级|不太重要|雨天不适合|下雨不去|下雨别去|怕下雨|室内优先|适合下雨|雨天可去|全天候|下雨也行|老人|小孩|孩子|少走路|轻松一点|体力弱|徒步|爬山|体力挑战|比较累)/g, ' ')
      .replace(/(?:缓冲|间隔|预留|停留|玩|参观)\s*(?:半小时|一小时|\d{1,3}\s*(?:分钟|分|小时))/g, ' ')
      .replace(/^(?:请|麻烦|帮我|给我|把|将|\s)+/g, '')
      .replace(/(?:设置|设定|标记|设为|改为|调整为|作为)/g, ' ')
      .replace(/(?:这个|该)?(?:行程点|站点|预约)\s*$/g, '')
      .replace(/[，,。；;：:\s]+/g, ' ')
      .trim(),
  ).replace(/^的\s*/, '')
  if (!target || target.length > 160) return null
  return {
    ...(preference.bufferMinutes ? { bufferMinutes: preference.bufferMinutes } : {}),
    ...(day ? { day: day.target } : {}),
    ...(preference.flexibility ? { flexibility: preference.flexibility } : {}),
    ...(preference.minimumStayMinutes ? { minimumStayMinutes: preference.minimumStayMinutes } : {}),
    ...(preference.mobilitySuitability ? { mobilitySuitability: preference.mobilitySuitability } : {}),
    ...(preference.priority ? { priority: preference.priority } : {}),
    target,
    ...(preference.weatherSuitability ? { weatherSuitability: preference.weatherSuitability } : {}),
  }
}

function parseDeterministicAdaptiveReplan(
  command: string,
  intent: ReturnType<typeof parseGlobalAiCommandIntent>,
): AiActionTripReplanApplyArgs | null {
  if (
    intent.kind !== 'replan'
    || intent.hypothetical
    || intent.disruptionKind === 'skip'
    || isHypotheticalCommand(command)
    || isNonActionReplanCommand(command)
  ) {
    return null
  }
  if (
    intent.disruptionKind === 'cancelled'
    && /(?:预订|订单|付款|退款|退票|门票|票据)/.test(command)
  ) {
    return null
  }
  const day = findPlannerDayTarget(command)
  const semanticTarget = inferSemanticTarget(command)
  const target = semanticTarget ?? cleanSemanticSelector(
    command
      .replace(day?.text ?? '', ' ')
      .replace(/(?:但|不过|而)?\s*(?:并)?(?:不是|并非|非)\s*(?:当前站|这一站|这个地点|当前地点|当前行程点|这个行程点|第一站|首站|第一个地点)/g, ' ')
      .replace(/(?:迟到|晚到|来晚|延误|晚点|关闭|闭馆|不开门|关门|歇业|下雨|暴雨|天气|太热|太冷|台风|户外少一点|取消)(?:了|啦|呢)?/g, ' ')
      .replace(/(?:半小时|一小时|\d{1,3}\s*(?:分钟|分|小时))/g, ' ')
      .replace(/(?:按|使用)?(?:最少改动|尽量少改|尽量保留|优先保留|必须保留|一定要去|必去|最省路程|最短路线)(?:方案|策略)?/g, ' ')
      .replace(/(?:调整|重排)(?:一下|行程|安排)?/g, ' ')
      .replace(/(?:请|麻烦|帮我|给我)/g, ' ')
      .replace(/^(?:请|麻烦|帮我|给我|把|将|我|我们|\s)+/g, '')
      .replace(/(?:这个|该)?(?:行程点|站点)\s*$/g, '')
      .replace(/[，,。；;：:\s]+/g, ' ')
      .trim(),
  ).replace(/^的\s*/, '')
  const kind = intent.disruptionKind
  if (target && target.length > 160) return null
  const strategy = inferReplanStrategy(command)
  return {
    ...(day ? { day: day.target } : {}),
    ...((kind === 'delay' || kind === 'late') && intent.delayMinutes
      ? { delayMinutes: intent.delayMinutes }
      : {}),
    kind,
    ...(strategy ? { strategy } : {}),
    ...(target ? { target } : {}),
  }
}

function parseAdaptiveReplanIntent(
  command: string,
  intent: ReturnType<typeof parseGlobalAiCommandIntent>,
) {
  if (intent.kind === 'replan') return intent
  const withoutStrategyPreference = command.replace(
    /(?:尽量保留|优先保留|都保留|必须保留|一定要去|必去|最高优先级|高优先级|很想去|不能动|不可动|固定|必须按原计划|预约不能改|不能改时间|最少改动|尽量少改|少改动|最省路程|最短路线|少绕路)/g,
    ' ',
  )
  return parseGlobalAiCommandIntent(withoutStrategyPreference)
}

function inferReplanStrategy(
  command: string,
): AiActionTripReplanApplyArgs['strategy'] | undefined {
  if (/(?:最省路程|最短路线|少绕路)/.test(command)) return 'shortest_route'
  if (/(?:尽量保留|优先保留|都保留|必须保留|一定要去|必去)/.test(command)) {
    return 'preserve_most'
  }
  if (/(?:最少改动|尽量少改|少改动)/.test(command)) return 'least_change'
  return undefined
}

function parseDeterministicDayReorder(command: string): AiActionDayItemsReorderArgs | null {
  if (isHypotheticalCommand(command)) return null
  const verb = command.match(/移动到|移到|挪到|排到|调整到/)
  if (!verb || verb.index === undefined) return null
  const day = findPlannerDayTarget(command)
  const target = cleanSemanticSelector(command.slice(0, verb.index), day?.text)
  if (!target || target.length > 160) return null

  const destination = cleanSemanticSelector(
    command.slice(verb.index + verb[0].length),
    day?.text,
    false,
  )
  if (!destination) return null
  if (/^(?:最前面|最前|第一位|开头)$/.test(destination)) {
    return { ...(day ? { day: day.target } : {}), position: 'first', target }
  }
  if (/^(?:最后面|最后|末尾)$/.test(destination)) {
    return { ...(day ? { day: day.target } : {}), position: 'last', target }
  }
  const relative = destination.match(/^(.{1,160}?)(前面|之前|后面|之后)$/)
  if (!relative) return null
  const anchor = cleanSemanticSelector(relative[1])
  if (!anchor || normalizePlannerSelector(anchor) === normalizePlannerSelector(target)) return null
  return {
    anchor,
    ...(day ? { day: day.target } : {}),
    position: relative[2] === '前面' || relative[2] === '之前' ? 'before' : 'after',
    target,
  }
}

function parseDeterministicItemMove(command: string): AiActionItemMoveArgs | null {
  if (isHypotheticalCommand(command)) return null
  const verb = command.match(/移动到|移到|挪到|安排到/)
  if (!verb || verb.index === undefined) return null

  const sourceText = command.slice(0, verb.index)
  const destinationText = command.slice(verb.index + verb[0].length)
  const destinationDay = findPlannerDayTarget(destinationText)
  if (!destinationDay) return null
  const sourceDay = findPlannerDayTarget(sourceText)
  const target = cleanSemanticSelector(sourceText, sourceDay?.text)
    .replace(/^的\s*/, '')
    .trim()
  if (!target || target.length > 160) return null

  const placement = cleanMovePlacement(
    destinationText.slice(
      destinationDay.index + destinationDay.text.length,
    ),
  )
  if (!placement || /^(?:最后面|最后|末尾|末位)$/.test(placement)) {
    return {
      destinationDay: destinationDay.target,
      position: 'last',
      ...(sourceDay ? { sourceDay: sourceDay.target } : {}),
      target,
    }
  }
  if (/^(?:最前面|最前|第一位|首位|开头)$/.test(placement)) {
    return {
      destinationDay: destinationDay.target,
      position: 'first',
      ...(sourceDay ? { sourceDay: sourceDay.target } : {}),
      target,
    }
  }
  const relative = placement.match(/^(.{1,160}?)(前面|之前|后面|之后)$/)
  if (!relative) return null
  const anchor = cleanSemanticSelector(relative[1])
  if (!anchor || normalizePlannerSelector(anchor) === normalizePlannerSelector(target)) return null
  return {
    anchor,
    destinationDay: destinationDay.target,
    position: relative[2] === '前面' || relative[2] === '之前' ? 'before' : 'after',
    ...(sourceDay ? { sourceDay: sourceDay.target } : {}),
    target,
  }
}

function cleanMovePlacement(value: string) {
  return value
    .replace(/^(?:的|里|中|内|当天|当日|这一天|\s)+/g, '')
    .replace(/[，,。；;：:\s]+$/g, '')
    .trim()
}

function findPlannerDayTarget(command: string) {
  const fullDate = command.match(
    /(?<!\d)(\d{4})(?:-|\/|年)(\d{1,2})(?:-|\/|月)(\d{1,2})(?:日)?(?!\d)/,
  )
  if (fullDate?.index !== undefined) {
    return {
      index: fullDate.index,
      target: `${fullDate[1]}-${fullDate[2].padStart(2, '0')}-${fullDate[3].padStart(2, '0')}`,
      text: fullDate[0],
    }
  }
  const monthDay = command.match(/(?<!\d)(\d{1,2})月(\d{1,2})日(?!\d)/)
  if (monthDay?.index !== undefined) {
    return {
      index: monthDay.index,
      target: `${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`,
      text: monthDay[0],
    }
  }
  const current = command.match(/今天|当天|当前日|这一天/)
  if (current?.index !== undefined) {
    return { index: current.index, target: 'current_day', text: current[0] }
  }
  const first = command.match(/第一天|首日/)
  if (first?.index !== undefined) {
    return { index: first.index, target: 'first_day', text: first[0] }
  }
  const ordinal = command.match(/第\s*(\d{1,2})\s*天/)
  if (ordinal?.index !== undefined) {
    return { index: ordinal.index, target: `day:${Number(ordinal[1])}`, text: ordinal[0] }
  }
  const chineseOrdinal = command.match(/第\s*([一二三四五六七八九十]{1,3})\s*天/)
  if (chineseOrdinal?.index !== undefined) {
    const ordinalValue = parsePlannerChineseOrdinal(chineseOrdinal[1])
    if (ordinalValue) {
      return {
        index: chineseOrdinal.index,
        target: `day:${ordinalValue}`,
        text: chineseOrdinal[0],
      }
    }
  }
  return null
}

function parsePlannerChineseOrdinal(value: string) {
  const digitByText: Record<string, number> = {
    一: 1,
    七: 7,
    三: 3,
    九: 9,
    二: 2,
    五: 5,
    八: 8,
    六: 6,
    四: 4,
  }
  if (value === '十') return 10
  const [tensText, onesText] = value.split('十')
  if (onesText !== undefined) {
    const tens = tensText ? digitByText[tensText] : 1
    const ones = onesText ? digitByText[onesText] : 0
    const result = tens * 10 + ones
    return result >= 1 && result <= 99 ? result : 0
  }
  return digitByText[value] ?? 0
}

function extractTrailingPlannerTimeRange(value: string) {
  const match = value.match(
    /[，,\s](?:在|于)?\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?))(?:\s*(?:-|—|–|至|到)\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?)?))?\s*$/,
  )
  if (!match || match.index === undefined) return null
  const startTime = normalizePlannerTime(match[1])
  const endTime = match[2] ? normalizePlannerTime(match[2]) : undefined
  if (!startTime || (match[2] && !endTime)) return null
  return { ...(endTime ? { endTime } : {}), index: match.index, startTime }
}

function cleanItemCreateTitle(value: string, dayText: string) {
  return value
    .replace(dayText, ' ')
    .replace(/[「」“”"]/g, '')
    .replace(/^(?:请|麻烦|帮我|给我|替我|在|把|将|\s)+/g, '')
    .replace(/^(?:一个|一处|行程点|站点)\s*/g, '')
    .replace(/(?:到|进|加入)?(?:当天|当日|这一天)?(?:的)?行程\s*$/g, '')
    .replace(/[，,。；;：:\s]+/g, ' ')
    .trim()
}

function cleanSemanticSelector(value: string, dayText?: string, stripSubjectPrefix = true) {
  let normalized = value
  if (dayText) normalized = normalized.replace(dayText, ' ')
  normalized = normalized
    .replace(/^(?:请|麻烦|帮我|给我|\s)+/g, '')
    .replace(/^(?:在|于)\s*/g, '')
    .replace(/^(?:当天|当日|这一天|当前日)(?:的|里|中)?\s*/g, '')
  if (stripSubjectPrefix) normalized = normalized.replace(/^(?:把|将)\s*/g, '')
  return normalized
    .replace(/^[「“"]|[」”"]$/g, '')
    .replace(/[，,。；;：:\s]+$/g, '')
    .trim()
}

function normalizePlannerSelector(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function parseDeterministicTimeUpdate(command: string): AiActionItemTimeUpdateArgs | null {
  if (['如果', '假如', '模拟', '会怎样'].some((value) => command.includes(value)) || /\bwhat\s*if\b/i.test(command)) {
    return null
  }
  const match = command.match(
    /(?:改到|改为|调整到|调整为|挪到|移到|安排到)\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?)?)(?:\s*(?:-|—|–|至|到)\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?)?))?/,
  )
  if (!match || match.index === undefined) return null
  const startTime = normalizePlannerTime(match[1])
  const endTime = match[2] ? normalizePlannerTime(match[2]) : undefined
  if (!startTime || (match[2] && !endTime)) return null

  const semanticTarget = inferSemanticTarget(command)
  const namedTarget = command
    .slice(0, match.index)
    .replace(/^(?:请|麻烦|帮我|给我|把|将)+/g, '')
    .replace(/(?:的)?(?:开始)?时间$/g, '')
    .replace(/[，,：:\s]+$/g, '')
    .trim()
  const target = semanticTarget ?? namedTarget
  if (!target || target.length > 160) return null
  return {
    ...(endTime ? { endTime } : {}),
    startTime,
    target,
  }
}

function parseDeterministicRoutePreview(command: string): AiActionRoutePreviewArgs | null {
  if (isHypotheticalCommand(command)) return null
  const routeAction = ['生成', '创建', '准备', '补上', '补全'].some((value) => command.includes(value))
  if (!command.includes('路线') || !routeAction || ['重新', '刷新'].some((value) => command.includes(value))) {
    return null
  }
  if (['今天', '当天', '当前日', '这一日', '这一天'].some((value) => command.includes(value))) {
    return { scope: 'day', target: 'current_day' }
  }
  if (['第一天', '首日'].some((value) => command.includes(value))) {
    return { scope: 'day', target: 'first_day' }
  }
  const ordinal = command.match(/第\s*(\d{1,2})\s*天/)
  if (ordinal) return { scope: 'day', target: `day:${Number(ordinal[1])}` }
  const quoted = command.match(/[「“"]([^」”"]{1,80})[」”"]/)
  if (quoted?.[1]?.trim()) return { scope: 'day', target: quoted[1].trim() }
  return { scope: 'trip' }
}

function parseDeterministicExpenseDraft(command: string): AiActionLedgerExpenseDraftArgs | null {
  if (isHypotheticalCommand(command) || /\d{1,2}月\d{1,2}日/.test(command)) return null
  const actionMatch = command.match(/(?:记(?:录)?|新增|添加|创建)\s*(?:一笔|笔)?/)
  if (!actionMatch) return null
  const hasExpenseNoun = ['一笔', '费用', '消费', '账单', '餐', '车费', '门票', '住宿', '酒店', '保险', '购物']
    .some((value) => command.includes(value))
  if (!hasExpenseNoun) return null

  const dateMatch = command.match(/\b\d{4}-\d{2}-\d{2}\b/)
  const commandWithoutDate = dateMatch ? command.replace(dateMatch[0], ' ') : command
  const amountToken = findExpenseAmountToken(commandWithoutDate)
  if (!amountToken) return null
  const amount = amountToken.match(/\d{1,12}(?:\.\d{1,4})?/)?.[0]
  if (!amount || Number(amount) <= 0) return null

  const title = commandWithoutDate
    .replace(amountToken, ' ')
    .replace(/^(?:请|麻烦|帮我|给我|替我|\s)*(?:记(?:录)?|新增|添加|创建)\s*(?:一笔|笔)?\s*/, '')
    .replace(/(?:费用|消费|账单|草稿)\s*$/g, '')
    .replace(/[，,。；;：:\s]+/g, ' ')
    .trim()
  if (!title || title.length > 100) return null
  const currency = inferExpenseCurrency(amountToken) ?? inferExpenseCurrency(command)
  return {
    amount,
    category: inferExpenseCategory(title),
    ...(currency ? { currency } : {}),
    ...(dateMatch ? { date: dateMatch[0] } : {}),
    title,
  }
}

function findExpenseAmountToken(command: string) {
  const matches = [...command.matchAll(
    /(?:(?:CNY|RMB|人民币|JPY|日元|GBP|英镑|USD|美元|EUR|欧元|HKD|港币|[£$€¥￥])\s*)?\d{1,12}(?:\.\d{1,4})?(?:\s*(?:CNY|RMB|人民币|元|JPY|日元|GBP|英镑|USD|美元|EUR|欧元|HKD|港币))?/gi,
  )].map((match) => match[0])
  const currencyMatches = matches.filter((match) => inferExpenseCurrency(match))
  if (currencyMatches.length === 1) return currencyMatches[0]
  if (currencyMatches.length > 1 || matches.length !== 1) return null
  return matches[0]
}

function isHypotheticalCommand(command: string) {
  return ['如果', '假如', '假设', '假定', '设想', '模拟', '会怎样'].some((value) => command.includes(value)) ||
    /\bwhat\s*if\b/i.test(command)
}

function isNonActionReplanCommand(command: string) {
  const disruptionPattern = '(?:迟到|晚到|延误|晚点|闭馆|关闭|取消|下雨|天气|重排|调整)'
  if (
    new RegExp(`(?:不要|别|无需|不用|不必|禁止|不允许)[^，。；;]{0,48}${disruptionPattern}`).test(command)
    || new RegExp(`(?:没有|没|并未|并没有|未曾|未|不是|并非)[^，。；;]{0,24}${disruptionPattern}`).test(command)
    || new RegExp(`${disruptionPattern}[^，。；;]{0,16}(?:并不存在|并没有|没有发生|不是真的)`).test(command)
  ) {
    return true
  }
  return new RegExp(`(?:是不是|是否|有没有|能否|能不能|可不可以|要不要|该不该)[^，。；;]{0,48}${disruptionPattern}`)
    .test(command)
    || new RegExp(`${disruptionPattern}[^，。；;]{0,32}(?:怎么办|会怎样|怎么调整|怎么处理|如何调整|如何处理|吗|么|\\?|？)`)
      .test(command)
    || /[?？]/.test(command) && new RegExp(disruptionPattern).test(command)
}

function isAiActionStepBoundToCommand(
  command: string,
  step: AiActionStepV1,
) {
  const intent = parseGlobalAiCommandIntent(command)
  const args = step.args as Record<string, unknown>
  if (
    getAiActionRisk(step.actionId) === 'local_write'
    && (
      isHypotheticalCommand(command)
      || isExplicitlyNegatedActionCommand(command)
      || isNonAffirmativeWriteCommand(command)
    )
  ) {
    return false
  }
  switch (step.actionId) {
    case 'ticket.open@1':
      return intent.kind === 'ticket_lookup'
        || intent.kind === 'page_navigation' && intent.target === 'tickets'
    case 'workspace.open@1':
      return intent.kind === 'page_navigation'
        && intent.target === args.target
    case 'history.undo@1':
      return /(?:撤销|恢复)/.test(command)
        && /(?:删除|移除)/.test(command)
        && !/(?:票据|门票|订单|预订|付款|退款|账本|费用)/.test(command)
        && isSemanticTargetBound(args.target, command, 'item')
    case 'item.create@1':
      return /(?:新增|添加|加入|插入|创建)/.test(command)
        && isProviderItemCreateBound(command, args)
        && isSemanticTargetBound(args.title, command, 'literal')
    case 'item.delete@1':
      return /(?:删除|移除)/.test(command)
        && !/(?:取消|退款|退票|作废|票据|门票|订单|预订|付款|账本|费用|整个旅行|整趟旅行)/.test(command)
        && isSemanticTargetBound(args.target, command, 'item')
        && isOptionalExplicitDayBound(args.day, command)
    case 'item.execution.update@1':
      return isProviderExecutionStateBound(command, args.state)
        && !isNonActionItemStateCommand(command)
        && isSemanticTargetBound(args.target, command, 'item')
        && isOptionalExplicitDayBound(args.day, command)
    case 'item.replan.preference.update@1':
      return intent.kind === 'preference_update'
        && isPreferenceArgsBound(args, intent.preference)
        && isSemanticTargetBound(args.target, command, 'item')
        && isOptionalExplicitDayBound(args.day, command)
    case 'trip.replan.apply@1':
      return isProviderReplanBound(command, args)
    case 'day.items.reorder@1':
      return isProviderDayReorderBound(command, args)
    case 'item.move@1':
      return isProviderItemMoveBound(command, args)
    case 'item.time.update@1':
      return isProviderTimeUpdateBound(command, args)
    case 'ledger.expense.draft@1':
      return /(?:记|记录|新增|添加|创建)/.test(command)
        && /(?:费用|消费|账单|餐|车费|门票|住宿|酒店|保险|购物)/.test(command)
        && /\d/.test(command)
        && isProviderExpenseBound(command, args)
        && isSemanticTargetBound(args.title, command, 'literal')
    case 'place.enrich@1':
      return !isTripRepairCommand(command)
        && isPlaceEnrichmentCommand(command)
        && isSemanticTargetBound(args.target, command, 'item')
    case 'route.preview@1':
      return !isTripRepairCommand(command)
        && /路线/.test(command)
        && /(?:生成|创建|准备|补上|补全)/.test(command)
        && isProviderRoutePreviewBound(command, args)
    case 'trip.repair@1':
      return isTripRepairCommand(command)
        && args.scope === inferRepairScope(command)
        && isRequiredExplicitTargetBound(args.target, command)
        && isSemanticTargetBound(args.target, command, 'item')
    default:
      return false
  }
}

function isExplicitlyNegatedActionCommand(command: string) {
  return /(?:不要|别|无需|不用|不必|禁止|不允许)[^，。；;]{0,64}(?:打开|查找|补全|补充|修复|处理|整理|完成|调整|移动|挪|生成|新增|添加|创建|删除|移除|撤销|恢复|跳过|标记|设为|记录|写入)/.test(command)
    || /\b(?:do\s+not|don't|dont|never|no\s+need\s+to)\b[^.!?]{0,96}\b(?:open|find|search|enrich|repair|fix|adjust|move|generate|create|add|delete|remove|undo|restore|skip|mark|record|replan)\b/i.test(command)
}

function isNonAffirmativeWriteCommand(command: string) {
  const normalized = command.trim()
  if (!normalized) return true
  if (isExplicitlyNegatedActionCommand(normalized)) return true
  if (
    /(?:删除|移除|修复|调整|重排|移动|挪|新增|添加|创建|记录|写入|生成|补全|补充|完成|跳过|标记|设为)[^，。；;]{0,48}(?:不用|不要了|不必|无需|算了|取消吧|别了)\s*[。.!！]?$/.test(normalized)
    || /\b(?:never\s+mind|cancel\s+that|do\s+not|don't|dont|no\s+need)\b/i.test(normalized)
  ) {
    return true
  }
  if (/[?？]/.test(normalized)) return true
  if (
    /^(?:请问|是否|是不是|有没有|能否|能不能|可不可以|要不要|该不该|为什么|怎么|如何)/.test(normalized)
    || /(?:吗|么)\s*$/.test(normalized)
    || /^(?:is|are|was|were|do|does|did|can|could|would|should|will|has|have|what|why|how|whether)\b/i.test(normalized)
  ) {
    return true
  }
  return false
}

function hasAffirmativeSemanticMarker(
  command: string,
  markers: string[],
) {
  return markers.some((marker) => {
    let offset = command.indexOf(marker)
    while (offset >= 0) {
      const prefix = command.slice(Math.max(0, offset - 12), offset)
      if (!/(?:不是|并非|非|不要|别|不选|排除)\s*$/.test(prefix)) {
        return true
      }
      offset = command.indexOf(marker, offset + marker.length)
    }
    return false
  })
}

function isProviderItemCreateBound(
  command: string,
  args: Record<string, unknown>,
) {
  const day = findPlannerDayTarget(command)
  if (!day || args.day !== day.target) return false
  const time = extractPlannerTimeConstraint(command)
  if (!time) {
    return args.startTime === undefined && args.endTime === undefined
  }
  return args.startTime === time.startTime
    && args.endTime === time.endTime
}

function isProviderDayReorderBound(
  command: string,
  args: Record<string, unknown>,
) {
  const expected = parseDeterministicDayReorder(command)
  return Boolean(expected && areActionArgsEqual(
    args,
    expected,
    ['anchor', 'day', 'position', 'target'],
  ))
}

function isProviderItemMoveBound(
  command: string,
  args: Record<string, unknown>,
) {
  const expected = parseDeterministicItemMove(command)
  return Boolean(expected && areActionArgsEqual(
    args,
    expected,
    ['anchor', 'destinationDay', 'position', 'sourceDay', 'target'],
  ))
}

function isProviderTimeUpdateBound(
  command: string,
  args: Record<string, unknown>,
) {
  const expected = parseDeterministicTimeUpdate(command)
  return Boolean(expected && areActionArgsEqual(
    args,
    expected,
    ['endTime', 'startTime', 'target'],
  ))
}

function isProviderExpenseBound(
  command: string,
  args: Record<string, unknown>,
) {
  const amount = extractExplicitExpenseAmount(command)
  if (
    !amount
    || typeof args.amount !== 'string'
    || normalizeDecimalAmount(args.amount) !== normalizeDecimalAmount(amount)
  ) {
    return false
  }
  const currency = inferExpenseCurrency(command)
  if (
    currency
      ? args.currency !== currency
      : args.currency !== undefined
  ) {
    return false
  }
  const date = command.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
  if (date ? args.date !== date : args.date !== undefined) return false

  const category = inferExpenseCategory(command)
  return category === 'other'
    ? args.category === undefined || args.category === 'other'
    : args.category === category
}

function isProviderRoutePreviewBound(
  command: string,
  args: Record<string, unknown>,
) {
  const day = findPlannerDayTarget(command)
  if (day) {
    return args.scope === 'day' && args.target === day.target
  }
  const explicitlyWholeTrip = /(?:全部|所有|整趟|整个|全程|每一天|每天)(?:的)?路线|路线[^，。；;]{0,16}(?:全部|所有|整趟|整个|全程|每一天|每天)/.test(command)
  return explicitlyWholeTrip
    && args.scope === 'trip'
    && args.target === undefined
}

function isOptionalExplicitDayBound(
  value: unknown,
  command: string,
) {
  const explicit = findPlannerDayTarget(command)
  return explicit
    ? value === explicit.target
    : value === undefined || isSemanticTargetBound(value, command, 'day')
}

function isRequiredExplicitTargetBound(
  value: unknown,
  command: string,
) {
  const explicit = inferSemanticTarget(command)
  return explicit ? value === explicit : true
}

function areActionArgsEqual(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  fields: string[],
) {
  return fields.every((field) => actual[field] === expected[field])
}

function extractPlannerTimeConstraint(command: string) {
  const match = command.match(
    /(?:^|[，,\s])(?:在|于)?\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?))(?:\s*(?:-|—|–|至|到)\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?)?))?/,
  )
  if (!match) return null
  const startTime = normalizePlannerTime(match[1])
  const endTime = match[2] ? normalizePlannerTime(match[2]) : undefined
  if (!startTime || (match[2] && !endTime)) return null
  return {
    ...(endTime ? { endTime } : {}),
    startTime,
  }
}

function extractExplicitExpenseAmount(command: string) {
  const matches = [...command.matchAll(
    /(?:(?:CNY|RMB|人民币|JPY|日元|GBP|英镑|USD|美元|EUR|欧元|HKD|港币|[£$€¥￥])\s*)?(?:\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.\d{1,4})?(?:\s*(?:CNY|RMB|人民币|元|JPY|日元|GBP|英镑|USD|美元|EUR|欧元|HKD|港币))?/gi,
  )].map((match) => ({
    amount: match[0].match(/(?:\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.\d{1,4})?/)?.[0].replace(/,/g, ''),
    token: match[0],
  })).filter((entry): entry is { amount: string; token: string } => Boolean(entry.amount))
  const currencyMatches = matches.filter((entry) => inferExpenseCurrency(entry.token))
  if (currencyMatches.length === 1) return currencyMatches[0].amount
  if (currencyMatches.length > 1) return undefined
  const decimalMatches = matches.filter((entry) => entry.amount.includes('.'))
  if (decimalMatches.length === 1) return decimalMatches[0].amount
  return matches.length === 1 ? matches[0].amount : undefined
}

function normalizeDecimalAmount(value: string) {
  if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(value.trim())) return ''
  const [integer, decimal = ''] = value.trim().split('.')
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '')
  const normalizedDecimal = decimal.replace(/0+$/, '')
  return normalizedDecimal
    ? `${normalizedInteger}.${normalizedDecimal}`
    : normalizedInteger
}

function isProviderExecutionStateBound(
  command: string,
  state: unknown,
) {
  if (state === 'completed') {
    return /(?:标记|设为|设置为|改为|已经|已)?完成(?:了)?/.test(command)
  }
  if (state === 'skipped') {
    return /(?:标记为|设为|设置为|直接)?跳过(?:了)?/.test(command)
  }
  return state === 'active'
    && /(?:恢复|重置|重新加入)[^，。；;]{0,20}(?:待进行|未完成|进行中|下一站)/.test(command)
}

function isPreferenceArgsBound(
  args: Record<string, unknown>,
  preference: Record<string, unknown>,
) {
  const fields = [
    'bufferMinutes',
    'flexibility',
    'minimumStayMinutes',
    'mobilitySuitability',
    'priority',
    'weatherSuitability',
  ]
  return fields.every((field) => args[field] === preference[field])
}

function isProviderReplanBound(
  command: string,
  args: Record<string, unknown>,
) {
  const intent = parseAdaptiveReplanIntent(
    command,
    parseGlobalAiCommandIntent(command),
  )
  if (
    intent.kind !== 'replan'
    || intent.hypothetical
    || intent.disruptionKind === 'skip'
    || isHypotheticalCommand(command)
    || isNonActionReplanCommand(command)
    || args.kind !== intent.disruptionKind
  ) {
    return false
  }
  const expected = parseDeterministicAdaptiveReplan(command, intent)
  if (!expected) return false
  const hasExplicitDelay = /(?:半小时|一小时|\d{1,3}\s*(?:分钟|分|小时))/.test(command)
  const delayBound = hasExplicitDelay
    ? args.delayMinutes === expected.delayMinutes
    : args.delayMinutes === undefined || args.delayMinutes === expected.delayMinutes
  const strategyBound = expected.strategy
    ? args.strategy === expected.strategy
    : args.strategy === undefined || args.strategy === 'least_change'
  return delayBound
    && strategyBound
    && args.day === expected.day
    && args.target === expected.target
}

function isSemanticTargetBound(
  value: unknown,
  command: string,
  kind: 'day' | 'item' | 'literal',
) {
  if (value === undefined) return true
  if (typeof value !== 'string' || !value.trim()) return false
  if (kind === 'item' && value === 'current_item') {
    return inferSemanticTarget(command) === 'current_item'
  }
  if (kind === 'item' && value === 'first_item') {
    return inferSemanticTarget(command) === 'first_item'
  }
  if (kind === 'day' && value === 'current_day') {
    return findPlannerDayTarget(command)?.target === 'current_day'
  }
  if (kind === 'day' && value === 'first_day') {
    return findPlannerDayTarget(command)?.target === 'first_day'
  }
  if (kind === 'day' && /^(?:day:\d{1,2}|\d{2}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(value)) {
    return findPlannerDayTarget(command)?.target === value
  }
  return normalizePlannerSelector(command)
    .includes(normalizePlannerSelector(value))
}

function inferExpenseCurrency(value: string) {
  if (/GBP|英镑|£/i.test(value)) return 'GBP'
  if (/USD|美元|\$/i.test(value)) return 'USD'
  if (/EUR|欧元|€/i.test(value)) return 'EUR'
  if (/JPY|日元/i.test(value)) return 'JPY'
  if (/HKD|港币/i.test(value)) return 'HKD'
  if (/CNY|RMB|人民币|元|¥|￥/i.test(value)) return 'CNY'
  return undefined
}

function inferExpenseCategory(value: string): NonNullable<AiActionLedgerExpenseDraftArgs['category']> {
  if (['酒店', '住宿', '民宿'].some((keyword) => value.includes(keyword))) return 'lodging'
  if (['打车', '出租', '地铁', '公交', '火车', '机票', '交通', '车费'].some((keyword) => value.includes(keyword))) return 'transport'
  if (['门票', '入场', '展览'].some((keyword) => value.includes(keyword))) return 'admission'
  if (['早餐', '午餐', '晚餐', '餐', '咖啡', '饮料'].some((keyword) => value.includes(keyword))) return 'food'
  if (['购物', '纪念品'].some((keyword) => value.includes(keyword))) return 'shopping'
  if (value.includes('保险')) return 'insurance'
  if (['SIM', '流量', '电话卡', '通信'].some((keyword) => value.toUpperCase().includes(keyword.toUpperCase()))) return 'connectivity'
  return 'other'
}

function normalizePlannerTime(value: string) {
  const normalized = value.trim().replace('：', ':')
  if (normalized.includes(':')) {
    const [hoursText, minutesText] = normalized.split(':')
    return formatPlannerTime(Number(hoursText), Number(minutesText))
  }
  const match = normalized.match(/^(\d{1,2})(?:[点时](\d{1,2})?分?)?$/)
  if (!match) return ''
  return formatPlannerTime(Number(match[1]), Number(match[2] ?? 0))
}

function formatPlannerTime(hours: number, minutes: number) {
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return ''
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function summarizeSteps(steps: Array<Record<string, unknown>>) {
  const actionIds = new Set(steps.map((step) => step.actionId))
  const labels = [
    actionIds.has('workspace.open@1') ? '打开页面' : '',
    actionIds.has('ticket.open@1') ? '打开票据' : '',
    actionIds.has('history.undo@1') ? '撤销行程点删除' : '',
    actionIds.has('item.create@1') ? '新增行程点' : '',
    actionIds.has('item.delete@1') ? '删除行程点' : '',
    actionIds.has('item.execution.update@1') ? '更新行程进度' : '',
    actionIds.has('item.move@1') ? '跨日移动行程点' : '',
    actionIds.has('item.replan.preference.update@1') ? '更新重排偏好' : '',
    actionIds.has('trip.replan.apply@1') ? '应用突发重排' : '',
    actionIds.has('day.items.reorder@1') ? '调整当天顺序' : '',
    actionIds.has('item.time.update@1') ? '调整行程时间' : '',
    actionIds.has('route.preview@1') ? '生成路线预览' : '',
    actionIds.has('ledger.expense.draft@1') ? '创建费用草稿' : '',
    actionIds.has('place.enrich@1') ? '补全地点' : '',
    actionIds.has('trip.repair@1') ? '智能修复行程' : '',
  ].filter(Boolean)
  return labels.join('并') || '处理旅行任务'
}

function isNonActionItemStateCommand(command: string) {
  const mentionsExecutionState = /(?:完成|跳过)/.test(command)
  const isExecutionRestore = /(?:恢复|重置|重新加入)/.test(command)
  if (
    mentionsExecutionState
    && /(?:不要|别|无需|不用|不必|禁止|不允许)\s*(?:把|将)?[^，。；;]{0,40}(?:完成|跳过)/.test(command)
  ) {
    return true
  }
  if (
    mentionsExecutionState
    && !isExecutionRestore
    && /(?:未完成|没有完成|还没完成|尚未完成)/.test(command)
  ) {
    return true
  }
  return /(?:是不是|是否|有没有|能否|可不可以)[^，。；;]{0,40}(?:完成|跳过|固定|移动|必去|优先级)/
    .test(command)
    || /(?:完成|跳过|固定|移动|必去|优先级|下雨|雨天)[^，。；;]{0,12}(?:吗|么|\?|？)\s*$/
      .test(command)
}
