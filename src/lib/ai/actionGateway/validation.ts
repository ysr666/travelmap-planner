import {
  AI_ACTION_PLAN_MAX_STEPS,
  AI_ACTION_PLAN_SCHEMA_VERSION,
  type AiActionArgsById,
  type AiActionId,
  type AiActionPlanValidationResult,
  type AiActionStepV1,
} from './types'
import {
  getAiActionIdempotencyKey,
  getAiActionInputSchema,
  getAiActionRisk,
  isAiActionId,
} from './registry'

const MAX_SUMMARY_LENGTH = 200
const MAX_TARGET_LENGTH = 160
const MAX_QUERY_LENGTH = 160
const MAX_ITEM_TITLE_LENGTH = 100
const MAX_EXPENSE_TITLE_LENGTH = 100
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const EXPENSE_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const EXPENSE_CATEGORIES = new Set([
  'admission',
  'connectivity',
  'food',
  'insurance',
  'lodging',
  'other',
  'shopping',
  'transport',
])
const REORDER_POSITIONS = new Set(['after', 'before', 'first', 'last'])
const ITEM_EXECUTION_STATES = new Set(['active', 'completed', 'skipped'])
const REPLAN_FLEXIBILITIES = new Set(['fixed', 'movable', 'optional'])
const REPLAN_PRIORITIES = new Set(['must_keep', 'high', 'normal', 'low'])
const REPLAN_WEATHER_SUITABILITIES = new Set(['any_weather', 'avoid_rain', 'indoor_preferred'])
const REPLAN_MOBILITY_SUITABILITIES = new Set(['normal', 'easy', 'demanding'])
const REPLAN_DISRUPTION_KINDS = new Set([
  'cancelled',
  'closure',
  'delay',
  'late',
  'weather_unsuitable',
])
const REPLAN_STRATEGIES = new Set([
  'least_change',
  'preserve_most',
  'shortest_route',
])
const WORKSPACE_TARGETS = new Set([
  'documents',
  'home',
  'inbox',
  'ledger',
  'map',
  'search',
  'settings',
  'trip',
])
const PLAN_FIELDS = new Set(['schemaVersion', 'summary', 'steps'])
const STEP_FIELDS = new Set(['actionId', 'args', 'dependsOn', 'id'])
const FORBIDDEN_FIELDS = new Set([
  'apikey',
  'authorization',
  'bearer',
  'blob',
  'blobs',
  'cloudtoken',
  'coordinates',
  'filename',
  'filenames',
  'fulldb',
  'headers',
  'localdb',
  'providerkey',
  'routecache',
  'secret',
  'ticketblob',
  'ticketblobs',
  'token',
])

export function validateAiActionPlan(input: unknown): AiActionPlanValidationResult {
  const errors: string[] = []
  const forbiddenPath = findForbiddenFieldPath(input)
  if (forbiddenPath) errors.push(`计划包含不允许的敏感字段：${forbiddenPath}`)

  const record = readRecord(input)
  rejectUnknownFields(record, PLAN_FIELDS, 'plan', errors)
  if (record.schemaVersion !== AI_ACTION_PLAN_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须是 ${AI_ACTION_PLAN_SCHEMA_VERSION}。`)
  }
  const summary = readText(record.summary, MAX_SUMMARY_LENGTH)
  if (!summary) errors.push('计划摘要不能为空。')
  const rawSteps = Array.isArray(record.steps) ? record.steps : null
  if (!rawSteps) {
    errors.push('steps 必须是数组。')
  } else if (rawSteps.length === 0 || rawSteps.length > AI_ACTION_PLAN_MAX_STEPS) {
    errors.push(`计划必须包含 1-${AI_ACTION_PLAN_MAX_STEPS} 个步骤。`)
  }

  const steps: AiActionStepV1[] = []
  const ids = new Set<string>()
  for (const [index, rawStep] of (rawSteps ?? []).entries()) {
    const stepRecord = readRecord(rawStep)
    const path = `steps[${index}]`
    rejectUnknownFields(stepRecord, STEP_FIELDS, path, errors)
    const id = typeof stepRecord.id === 'string' && ID_PATTERN.test(stepRecord.id)
      ? stepRecord.id
      : ''
    if (!id) {
      errors.push(`${path}.id 无效。`)
    } else if (ids.has(id)) {
      errors.push(`${path}.id 重复。`)
    } else {
      ids.add(id)
    }

    if (!isAiActionId(stepRecord.actionId)) {
      errors.push(`${path}.actionId 不受支持。`)
      continue
    }
    const actionId = stepRecord.actionId
    const args = validateArgs(actionId, stepRecord.args, `${path}.args`, errors)
    const dependsOn = validateDependencies(stepRecord.dependsOn, `${path}.dependsOn`, errors)
    if (!id || !args) continue
    steps.push({
      actionId,
      args,
      dependsOn,
      id,
      idempotencyKey: '',
      risk: getAiActionRisk(actionId),
      status: 'pending',
    } as AiActionStepV1)
  }

  validateDependencyGraph(steps, ids, errors)
  const actionIds = new Set(steps.map((step) => step.actionId))
  if (actionIds.has('place.enrich@1') && actionIds.has('trip.repair@1')) {
    errors.push('补全单个地点与整趟智能修复不能放在同一计划中。')
  }
  if (steps.filter((step) => step.actionId === 'item.create@1').length > 1) {
    errors.push('一个计划最多新增一个行程点。')
  }
  if (steps.filter((step) => step.actionId === 'day.items.reorder@1').length > 1) {
    errors.push('一个计划最多调整一次当天顺序。')
  }
  if (steps.filter((step) => step.actionId === 'item.move@1').length > 1) {
    errors.push('一个计划最多跨日移动一个行程点。')
  }
  if (steps.filter((step) => step.actionId === 'item.delete@1').length > 1) {
    errors.push('一个计划最多删除一个行程点。')
  }
  if (steps.filter((step) => step.actionId === 'history.undo@1').length > 1) {
    errors.push('一个计划最多撤销一次删除。')
  }
  if (steps.filter((step) => step.actionId === 'item.execution.update@1').length > 1) {
    errors.push('一个计划最多更新一次行程进度。')
  }
  if (steps.filter((step) => step.actionId === 'item.replan.preference.update@1').length > 1) {
    errors.push('一个计划最多更新一次重排偏好。')
  }
  if (steps.filter((step) => step.actionId === 'trip.replan.apply@1').length > 1) {
    errors.push('一个计划最多应用一次突发重排。')
  }
  const structuralActionCount = [
    'day.items.reorder@1',
    'item.create@1',
    'item.delete@1',
    'item.move@1',
  ].filter((actionId) => actionIds.has(actionId as AiActionId)).length
  if (structuralActionCount > 1) {
    errors.push('新增、删除、当天重排与跨日移动需要分开确认。')
  }
  if (
    actionIds.has('history.undo@1')
    && steps.some((step) =>
      step.actionId !== 'history.undo@1' && step.risk === 'local_write',
    )
  ) {
    errors.push('撤销删除不能与其他写入动作放在同一计划中。')
  }
  const boundedItemStateActions = new Set([
    'item.execution.update@1',
    'item.replan.preference.update@1',
    'trip.replan.apply@1',
  ])
  if (
    steps.some((step) => boundedItemStateActions.has(step.actionId))
    && steps.filter((step) => step.risk === 'local_write').length > 1
  ) {
    errors.push('行程进度、重排偏好或突发重排需要与其他写入动作分开确认。')
  }
  if (errors.length > 0 || !summary) return { errors: Array.from(new Set(errors)), ok: false }

  const orderedSteps = sortStepsByDependencies(steps)
  const planId = `action-plan:${hashString(stableStringify({ schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION, steps: orderedSteps, summary }))}`
  const normalizedSteps = orderedSteps.map((step) => ({
    ...step,
    idempotencyKey: getAiActionIdempotencyKey(
      step.actionId,
      step.args,
      { planId, stepId: step.id },
    ),
  }))
  return {
    ok: true,
    plan: {
      planId,
      requiresConfirmation: normalizedSteps.some((step) => step.risk === 'local_write'),
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: normalizedSteps,
      summary,
    },
  }
}

function sortStepsByDependencies(steps: AiActionStepV1[]) {
  const remaining = [...steps]
  const ordered: AiActionStepV1[] = []
  const completed = new Set<string>()
  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((step) =>
      step.dependsOn.every((dependency) => completed.has(dependency)),
    )
    if (nextIndex < 0) return steps
    const [next] = remaining.splice(nextIndex, 1)
    ordered.push(next)
    completed.add(next.id)
  }
  return ordered
}

function validateArgs<TActionId extends AiActionId>(
  actionId: TActionId,
  input: unknown,
  path: string,
  errors: string[],
): AiActionArgsById[TActionId] | null {
  const record = readRecord(input)
  const inputSchema = getAiActionInputSchema(actionId)
  rejectUnknownFields(record, new Set(inputSchema.allowedFields), path, errors)
  for (const field of inputSchema.requiredFields) {
    if (record[field] === undefined) errors.push(`${path}.${field} 不能为空。`)
  }
  if (actionId === 'ticket.open@1') {
    const query = readOptionalText(record.query, MAX_QUERY_LENGTH)
    if (record.query !== undefined && !query) errors.push(`${path}.query 无效。`)
    return (query ? { query } : {}) as AiActionArgsById[TActionId]
  }
  if (actionId === 'ticket.bind@1') {
    const ticket = readSemanticTarget(record.ticket, MAX_TARGET_LENGTH)
    const target = readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    if (!ticket) errors.push(`${path}.ticket 必须是语义票据名称。`)
    if (!target) errors.push(`${path}.target 必须是语义行程点目标。`)
    if (!ticket || !target) return null
    return { target, ticket } as AiActionArgsById[TActionId]
  }
  if (actionId === 'item.create@1') {
    const day = readSemanticTarget(record.day, MAX_TARGET_LENGTH)
    const title = readText(record.title, MAX_ITEM_TITLE_LENGTH)
    const startTime = record.startTime === undefined ? undefined : readTime(record.startTime)
    const endTime = record.endTime === undefined ? undefined : readTime(record.endTime)
    if (!day) errors.push(`${path}.day 必须是语义日期目标。`)
    if (!title) errors.push(`${path}.title 不能为空。`)
    if (record.startTime !== undefined && !startTime) errors.push(`${path}.startTime 必须是 HH:mm。`)
    if (record.endTime !== undefined && !endTime) errors.push(`${path}.endTime 必须是 HH:mm。`)
    if (!startTime && endTime) errors.push(`${path}.endTime 需要同时提供 startTime。`)
    if (startTime && endTime && timeToMinutes(endTime) < timeToMinutes(startTime)) {
      errors.push(`${path}.endTime 不能早于 startTime。`)
    }
    if (!day || !title) return null
    return {
      day,
      ...(endTime ? { endTime } : {}),
      ...(startTime ? { startTime } : {}),
      title,
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'item.delete@1') {
    const target = readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    const day = record.day === undefined
      ? undefined
      : readSemanticTarget(record.day, MAX_TARGET_LENGTH)
    if (!target) errors.push(`${path}.target 必须是语义行程点目标。`)
    if (record.day !== undefined && !day) {
      errors.push(`${path}.day 必须是语义日期目标。`)
    }
    if (!target) return null
    return {
      ...(day ? { day } : {}),
      target,
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'history.undo@1') {
    const target = record.target === undefined
      ? undefined
      : readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    if (record.kind !== 'item_delete') {
      errors.push(`${path}.kind 只允许 item_delete。`)
    }
    if (record.target !== undefined && !target) {
      errors.push(`${path}.target 必须是语义行程点名称。`)
    }
    if (target === 'current_item' || target === 'first_item') {
      errors.push(`${path}.target 必须是已删除行程点名称，不能使用当前目标。`)
    }
    if (record.kind !== 'item_delete') return null
    if (target === 'current_item' || target === 'first_item') return null
    return {
      kind: 'item_delete',
      ...(target ? { target } : {}),
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'item.execution.update@1') {
    const target = readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    const day = record.day === undefined
      ? undefined
      : readSemanticTarget(record.day, MAX_TARGET_LENGTH)
    const state = typeof record.state === 'string' && ITEM_EXECUTION_STATES.has(record.state)
      ? record.state as 'active' | 'completed' | 'skipped'
      : undefined
    if (!target) errors.push(`${path}.target 必须是语义行程点目标。`)
    if (record.day !== undefined && !day) {
      errors.push(`${path}.day 必须是语义日期目标。`)
    }
    if (!state) errors.push(`${path}.state 无效。`)
    if (!target || !state) return null
    return {
      ...(day ? { day } : {}),
      state,
      target,
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'item.replan.preference.update@1') {
    const target = readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    const day = record.day === undefined
      ? undefined
      : readSemanticTarget(record.day, MAX_TARGET_LENGTH)
    const flexibility = readEnum(record.flexibility, REPLAN_FLEXIBILITIES)
    const priority = readEnum(record.priority, REPLAN_PRIORITIES)
    const weatherSuitability = readEnum(
      record.weatherSuitability,
      REPLAN_WEATHER_SUITABILITIES,
    )
    const mobilitySuitability = readEnum(
      record.mobilitySuitability,
      REPLAN_MOBILITY_SUITABILITIES,
    )
    const bufferMinutes = readBoundedInteger(record.bufferMinutes, 1, 240)
    const minimumStayMinutes = readBoundedInteger(record.minimumStayMinutes, 1, 720)
    if (!target) errors.push(`${path}.target 必须是语义行程点目标。`)
    if (record.day !== undefined && !day) {
      errors.push(`${path}.day 必须是语义日期目标。`)
    }
    validateOptionalEnum(record, 'flexibility', flexibility, path, errors)
    validateOptionalEnum(record, 'priority', priority, path, errors)
    validateOptionalEnum(record, 'weatherSuitability', weatherSuitability, path, errors)
    validateOptionalEnum(record, 'mobilitySuitability', mobilitySuitability, path, errors)
    validateOptionalInteger(record, 'bufferMinutes', bufferMinutes, path, errors)
    validateOptionalInteger(record, 'minimumStayMinutes', minimumStayMinutes, path, errors)
    const hasPreference = [
      flexibility,
      priority,
      weatherSuitability,
      mobilitySuitability,
      bufferMinutes,
      minimumStayMinutes,
    ].some((value) => value !== undefined)
    if (!hasPreference) errors.push(`${path} 至少需要一个重排偏好字段。`)
    if (!target || !hasPreference) return null
    return {
      ...(bufferMinutes ? { bufferMinutes } : {}),
      ...(day ? { day } : {}),
      ...(flexibility ? { flexibility } : {}),
      ...(minimumStayMinutes ? { minimumStayMinutes } : {}),
      ...(mobilitySuitability ? { mobilitySuitability } : {}),
      ...(priority ? { priority } : {}),
      target,
      ...(weatherSuitability ? { weatherSuitability } : {}),
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'trip.replan.apply@1') {
    const kind = readEnum(record.kind, REPLAN_DISRUPTION_KINDS)
    const delayMinutes = readBoundedInteger(record.delayMinutes, 1, 240)
    const target = record.target === undefined
      ? undefined
      : readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    const day = record.day === undefined
      ? undefined
      : readSemanticTarget(record.day, MAX_TARGET_LENGTH)
    const strategy = readEnum(record.strategy, REPLAN_STRATEGIES)
    if (!kind) errors.push(`${path}.kind 无效。`)
    validateOptionalInteger(record, 'delayMinutes', delayMinutes, path, errors)
    if (record.target !== undefined && !target) {
      errors.push(`${path}.target 必须是语义行程点目标。`)
    }
    if (record.day !== undefined && !day) {
      errors.push(`${path}.day 必须是语义日期目标。`)
    }
    validateOptionalEnum(record, 'strategy', strategy, path, errors)
    if (
      delayMinutes !== undefined
      && kind !== 'delay'
      && kind !== 'late'
    ) {
      errors.push(`${path}.delayMinutes 只允许用于 delay 或 late。`)
    }
    if (!kind) return null
    return {
      ...(day ? { day } : {}),
      ...(delayMinutes ? { delayMinutes } : {}),
      kind,
      ...(strategy ? { strategy } : {}),
      ...(target ? { target } : {}),
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'day.items.reorder@1') {
    const target = readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    const day = record.day === undefined
      ? undefined
      : readSemanticTarget(record.day, MAX_TARGET_LENGTH)
    const anchor = record.anchor === undefined
      ? undefined
      : readSemanticTarget(record.anchor, MAX_TARGET_LENGTH)
    const position = typeof record.position === 'string' && REORDER_POSITIONS.has(record.position)
      ? record.position as 'after' | 'before' | 'first' | 'last'
      : undefined
    if (!target) errors.push(`${path}.target 必须是语义行程点目标。`)
    if (record.day !== undefined && !day) errors.push(`${path}.day 必须是语义日期目标。`)
    if (!position) errors.push(`${path}.position 无效。`)
    if ((position === 'before' || position === 'after') && !anchor) {
      errors.push(`${path}.anchor 在 before/after 时不能为空。`)
    }
    if ((position === 'first' || position === 'last') && record.anchor !== undefined) {
      errors.push(`${path}.anchor 只允许用于 before/after。`)
    }
    if (target && anchor && normalizeSemanticText(target) === normalizeSemanticText(anchor)) {
      errors.push(`${path}.target 与 anchor 不能相同。`)
    }
    if (!target || !position) return null
    return {
      ...(anchor ? { anchor } : {}),
      ...(day ? { day } : {}),
      position,
      target,
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'item.move@1') {
    const target = readSemanticTarget(record.target, MAX_TARGET_LENGTH)
    const destinationDay = readSemanticTarget(record.destinationDay, MAX_TARGET_LENGTH)
    const sourceDay = record.sourceDay === undefined
      ? undefined
      : readSemanticTarget(record.sourceDay, MAX_TARGET_LENGTH)
    const anchor = record.anchor === undefined
      ? undefined
      : readSemanticTarget(record.anchor, MAX_TARGET_LENGTH)
    const position = typeof record.position === 'string' && REORDER_POSITIONS.has(record.position)
      ? record.position as 'after' | 'before' | 'first' | 'last'
      : undefined
    if (!target) errors.push(`${path}.target 必须是语义行程点目标。`)
    if (!destinationDay) errors.push(`${path}.destinationDay 必须是语义日期目标。`)
    if (record.sourceDay !== undefined && !sourceDay) {
      errors.push(`${path}.sourceDay 必须是语义日期目标。`)
    }
    if (!position) errors.push(`${path}.position 无效。`)
    if ((position === 'before' || position === 'after') && !anchor) {
      errors.push(`${path}.anchor 在 before/after 时不能为空。`)
    }
    if ((position === 'first' || position === 'last') && record.anchor !== undefined) {
      errors.push(`${path}.anchor 只允许用于 before/after。`)
    }
    if (target && anchor && normalizeSemanticText(target) === normalizeSemanticText(anchor)) {
      errors.push(`${path}.target 与 anchor 不能相同。`)
    }
    if (
      sourceDay
      && destinationDay
      && normalizeSemanticText(sourceDay) === normalizeSemanticText(destinationDay)
    ) {
      errors.push(`${path}.sourceDay 与 destinationDay 不能相同。`)
    }
    if (!target || !destinationDay || !position) return null
    return {
      ...(anchor ? { anchor } : {}),
      destinationDay,
      position,
      ...(sourceDay ? { sourceDay } : {}),
      target,
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'item.time.update@1') {
    const target = readText(record.target, MAX_TARGET_LENGTH)
    const startTime = readTime(record.startTime)
    const endTime = record.endTime === undefined ? undefined : readTime(record.endTime)
    if (!target) errors.push(`${path}.target 不能为空。`)
    if (!startTime) errors.push(`${path}.startTime 必须是 HH:mm。`)
    if (record.endTime !== undefined && !endTime) errors.push(`${path}.endTime 必须是 HH:mm。`)
    if (startTime && endTime && timeToMinutes(endTime) < timeToMinutes(startTime)) {
      errors.push(`${path}.endTime 不能早于 startTime。`)
    }
    if (!target || !startTime) return null
    return {
      ...(endTime ? { endTime } : {}),
      startTime,
      target,
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'ledger.expense.draft@1') {
    const title = readText(record.title, MAX_EXPENSE_TITLE_LENGTH)
    const amount = readExpenseAmount(record.amount)
    const currency = record.currency === undefined ? undefined : readCurrency(record.currency)
    const date = record.date === undefined ? undefined : readPlainDate(record.date)
    const category = record.category === undefined
      ? undefined
      : typeof record.category === 'string' && EXPENSE_CATEGORIES.has(record.category)
        ? record.category
        : undefined
    if (!title) errors.push(`${path}.title 不能为空。`)
    if (!amount) errors.push(`${path}.amount 必须是有效正数。`)
    if (record.currency !== undefined && !currency) errors.push(`${path}.currency 必须是三位大写币种代码。`)
    if (record.date !== undefined && !date) errors.push(`${path}.date 必须是有效的 YYYY-MM-DD。`)
    if (record.category !== undefined && !category) errors.push(`${path}.category 无效。`)
    if (!title || !amount) return null
    return {
      amount,
      ...(category ? { category } : {}),
      ...(currency ? { currency } : {}),
      ...(date ? { date } : {}),
      title,
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'place.enrich@1') {
    const target = readText(record.target, MAX_TARGET_LENGTH)
    if (!target) {
      errors.push(`${path}.target 不能为空。`)
      return null
    }
    return { target } as AiActionArgsById[TActionId]
  }
  if (actionId === 'route.preview@1') {
    if (record.scope !== 'day' && record.scope !== 'trip') {
      errors.push(`${path}.scope 无效。`)
      return null
    }
    const target = readOptionalText(record.target, MAX_TARGET_LENGTH)
    if (record.target !== undefined && !target) errors.push(`${path}.target 无效。`)
    if (record.scope === 'trip' && target) errors.push(`${path}.target 只允许用于 day 范围。`)
    return {
      scope: record.scope,
      ...(record.scope === 'day' && target ? { target } : {}),
    } as AiActionArgsById[TActionId]
  }
  if (actionId === 'workspace.open@1') {
    if (typeof record.target !== 'string' || !WORKSPACE_TARGETS.has(record.target)) {
      errors.push(`${path}.target 无效。`)
      return null
    }
    return { target: record.target } as AiActionArgsById[TActionId]
  }
  const scope = record.scope
  if (scope !== 'trip' && scope !== 'day' && scope !== 'item') {
    errors.push(`${path}.scope 无效。`)
    return null
  }
  const target = readOptionalText(record.target, MAX_TARGET_LENGTH)
  if (record.target !== undefined && !target) errors.push(`${path}.target 无效。`)
  return { scope, ...(target ? { target } : {}) } as AiActionArgsById[TActionId]
}

function validateDependencies(input: unknown, path: string, errors: string[]) {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > AI_ACTION_PLAN_MAX_STEPS) {
    errors.push(`${path} 必须是短数组。`)
    return []
  }
  const values = input.filter((value): value is string => typeof value === 'string' && ID_PATTERN.test(value))
  if (values.length !== input.length) errors.push(`${path} 包含无效步骤 ID。`)
  return Array.from(new Set(values))
}

function validateDependencyGraph(steps: AiActionStepV1[], ids: Set<string>, errors: string[]) {
  const dependencies = new Map(steps.map((step) => [step.id, step.dependsOn]))
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) errors.push(`${step.id} 依赖不存在的步骤 ${dependency}。`)
      if (dependency === step.id) errors.push(`${step.id} 不能依赖自身。`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string): boolean {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) {
      if (visit(dependency)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  if (steps.some((step) => visit(step.id))) errors.push('计划步骤存在循环依赖。')
}

function rejectUnknownFields(record: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} 不受支持。`)
  }
}

function findForbiddenFieldPath(input: unknown, path = '$'): string | null {
  if (Array.isArray(input)) {
    for (const [index, value] of input.entries()) {
      const nested = findForbiddenFieldPath(value, `${path}[${index}]`)
      if (nested) return nested
    }
    return null
  }
  if (!input || typeof input !== 'object') return null
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-zA-Z]/g, '').toLowerCase()
    if (FORBIDDEN_FIELDS.has(normalized)) return `${path}.${key}`
    const nested = findForbiddenFieldPath(value, `${path}.${key}`)
    if (nested) return nested
  }
  return null
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function readText(input: unknown, maxLength: number) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return value.length > 0 && value.length <= maxLength ? value : ''
}

function readOptionalText(input: unknown, maxLength: number) {
  return input === undefined ? undefined : readText(input, maxLength) || undefined
}

function readEnum(input: unknown, allowed: Set<string>) {
  return typeof input === 'string' && allowed.has(input) ? input : undefined
}

function readBoundedInteger(input: unknown, minimum: number, maximum: number) {
  return typeof input === 'number'
    && Number.isSafeInteger(input)
    && input >= minimum
    && input <= maximum
    ? input
    : undefined
}

function validateOptionalEnum(
  record: Record<string, unknown>,
  field: string,
  value: string | undefined,
  path: string,
  errors: string[],
) {
  if (record[field] !== undefined && value === undefined) {
    errors.push(`${path}.${field} 无效。`)
  }
}

function validateOptionalInteger(
  record: Record<string, unknown>,
  field: string,
  value: number | undefined,
  path: string,
  errors: string[],
) {
  if (record[field] !== undefined && value === undefined) {
    errors.push(`${path}.${field} 必须是范围内的整数。`)
  }
}

function readSemanticTarget(input: unknown, maxLength: number) {
  const value = readText(input, maxLength)
  if (!value) return ''
  if (/[?#=&]/.test(value)) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(?:\/|\.\/|\.\.\/)/.test(value)) return ''
  if (/^(?:item|trip|ticket|ledger|expense)[_:-][a-z0-9_-]+$/i.test(value)) return ''
  if (/^day[_-][a-z0-9_-]+$/i.test(value)) return ''
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return ''
  return value
}

function normalizeSemanticText(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, '')
}

function readTime(input: unknown) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return TIME_PATTERN.test(value) ? value : ''
}

function readExpenseAmount(input: unknown) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return EXPENSE_AMOUNT_PATTERN.test(value) && Number(value) > 0 ? value : ''
}

function readCurrency(input: unknown) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return CURRENCY_PATTERN.test(value) ? value : ''
}

function readPlainDate(input: unknown) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return ''
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth ? value : ''
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
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

function hashString(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
