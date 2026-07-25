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
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
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
  if (actionId === 'place.enrich@1') {
    const target = readText(record.target, MAX_TARGET_LENGTH)
    if (!target) {
      errors.push(`${path}.target 不能为空。`)
      return null
    }
    return { target } as AiActionArgsById[TActionId]
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

function readTime(input: unknown) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return TIME_PATTERN.test(value) ? value : ''
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
