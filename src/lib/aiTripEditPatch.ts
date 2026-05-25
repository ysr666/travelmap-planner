import { transportModeLabels } from './itinerary'
import type { AiTripEditContext, AiTripEditContextItem } from './aiTripEditContext'
import type { TransportMode } from '../types'

export const AI_TRIP_EDIT_MAX_OPERATIONS = 30
export const AI_TRIP_EDIT_MAX_SUMMARY_LENGTH = 300
export const AI_TRIP_EDIT_MAX_REASON_LENGTH = 200
export const AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH = 200

export type AiTripEditPatchPlan = {
  summary: string
  operations: AiTripEditOperation[]
  warnings?: string[]
}

export type AiTripEditOperation =
  | UpdateItemOperation
  | MoveItemOperation
  | DeleteItemOperation
  | AddItemOperation

export type AiTripEditItemChanges = {
  title?: string
  startTime?: string
  endTime?: string
  locationName?: string
  address?: string
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
}

export type UpdateItemOperation = {
  type: 'update_item'
  itemId: string
  changes: AiTripEditItemChanges
  reason?: string
}

export type MoveItemOperation = {
  type: 'move_item'
  itemId: string
  targetDayId: string
  targetSortOrder?: number
  targetStartTime?: string
  reason?: string
}

export type DeleteItemOperation = {
  type: 'delete_item'
  itemId: string
  reason?: string
}

export type AddItemOperation = {
  type: 'add_item'
  targetDayId: string
  item: AiTripEditItemChanges & {
    title: string
  }
  targetSortOrder?: number
  reason?: string
}

export type AiTripEditPatchValidationError = {
  path: string
  message: string
}

export type ValidateAiTripEditPatchPlanResult =
  | { ok: true; plan: AiTripEditPatchPlan; warnings: string[] }
  | { ok: false; errors: AiTripEditPatchValidationError[] }

export type AiTripEditPatchPreview = {
  lines: string[]
  warnings: string[]
}

const VALID_OPERATION_TYPES = new Set(['update_item', 'move_item', 'delete_item', 'add_item'])
const VALID_TRANSPORT_MODES = new Set<TransportMode>([
  'walk',
  'transit',
  'bus',
  'car',
  'train',
  'flight',
  'other',
])
const FORBIDDEN_FIELD_NAMES = new Set([
  'apiKey',
  'providerKey',
  'token',
  'cloudToken',
  'ticketBlobs',
  'ticketMetas',
  'routeCache',
  'localDb',
  'fullTrip',
  'Authorization',
  'headers',
  'lat',
  'lng',
  'coordinates',
  'ticketIds',
  'route',
  'polyline',
  'cloud',
  'cloudStatus',
  'externalUrl',
  'url',
  'notes',
])
const ALLOWED_CHANGE_FIELDS = new Set([
  'title',
  'startTime',
  'endTime',
  'locationName',
  'address',
  'previousTransportMode',
  'previousTransportDurationMinutes',
])
const ALLOWED_OPERATION_FIELDS: Record<string, Set<string>> = {
  add_item: new Set(['type', 'targetDayId', 'item', 'targetSortOrder', 'reason']),
  delete_item: new Set(['type', 'itemId', 'reason']),
  move_item: new Set(['type', 'itemId', 'targetDayId', 'targetSortOrder', 'targetStartTime', 'reason']),
  update_item: new Set(['type', 'itemId', 'changes', 'reason']),
}

export function validateAiTripEditPatchPlan(
  input: unknown,
  context: AiTripEditContext,
): ValidateAiTripEditPatchPlanResult {
  const errors: AiTripEditPatchValidationError[] = []
  const dangerousPath = findForbiddenFieldPath(input)
  if (dangerousPath) {
    errors.push({ message: '修改方案包含不允许的敏感字段。', path: dangerousPath })
  }

  const record = readRecord(input)
  const summary = readRequiredText(record.summary, 'summary', AI_TRIP_EDIT_MAX_SUMMARY_LENGTH, errors)
  const rawOperations = Array.isArray(record.operations) ? record.operations : null
  if (!rawOperations) {
    errors.push({ message: 'operations 必须是数组。', path: 'operations' })
  } else if (rawOperations.length < 1 || rawOperations.length > AI_TRIP_EDIT_MAX_OPERATIONS) {
    errors.push({ message: `operations 数量必须在 1 到 ${AI_TRIP_EDIT_MAX_OPERATIONS} 之间。`, path: 'operations' })
  }

  const itemIds = new Set(context.days.flatMap((day) => day.items.map((item) => item.id)))
  const dayIds = new Set(context.days.map((day) => day.id))
  const normalizedOperations: AiTripEditOperation[] = []

  for (const [index, rawOperation] of (rawOperations ?? []).entries()) {
    const operation = readRecord(rawOperation)
    const path = `operations[${index}]`
    const type = operation.type
    if (typeof type !== 'string' || !VALID_OPERATION_TYPES.has(type)) {
      errors.push({ message: '不支持的修改操作。', path: `${path}.type` })
      continue
    }

    rejectUnknownFields(operation, ALLOWED_OPERATION_FIELDS[type], path, errors)
    const reason = readOptionalText(operation.reason, `${path}.reason`, AI_TRIP_EDIT_MAX_REASON_LENGTH, errors)

    if (type === 'update_item') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const changes = normalizeItemChanges(operation.changes, `${path}.changes`, errors, { requireTitle: false })
      if (changes && Object.keys(changes).length === 0) {
        errors.push({ message: 'update_item 至少需要一个 changes 字段。', path: `${path}.changes` })
      }
      if (itemId && changes) {
        validateTimePair(changes.startTime, changes.endTime, `${path}.changes`, errors)
        normalizedOperations.push({ changes, itemId, reason, type })
      }
      continue
    }

    if (type === 'move_item') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const targetDayId = readExistingDayId(operation.targetDayId, `${path}.targetDayId`, dayIds, errors)
      const targetSortOrder = readOptionalSortOrder(operation.targetSortOrder, `${path}.targetSortOrder`, errors)
      const targetStartTime = readOptionalTime(operation.targetStartTime, `${path}.targetStartTime`, errors)
      if (itemId && targetDayId) {
        normalizedOperations.push({
          itemId,
          reason,
          targetDayId,
          targetSortOrder,
          targetStartTime,
          type,
        })
      }
      continue
    }

    if (type === 'delete_item') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      if (itemId) {
        normalizedOperations.push({ itemId, reason, type })
      }
      continue
    }

    const targetDayId = readExistingDayId(operation.targetDayId, `${path}.targetDayId`, dayIds, errors)
    const item = normalizeItemChanges(operation.item, `${path}.item`, errors, { requireTitle: true })
    const targetSortOrder = readOptionalSortOrder(operation.targetSortOrder, `${path}.targetSortOrder`, errors)
    if (item) {
      validateTimePair(item.startTime, item.endTime, `${path}.item`, errors)
    }
    if (targetDayId && item?.title) {
      normalizedOperations.push({
        item: item as AddItemOperation['item'],
        reason,
        targetDayId,
        targetSortOrder,
        type: 'add_item',
      })
    }
  }

  const warnings = normalizeWarnings(record.warnings, errors)
  if (errors.length > 0) {
    return { errors, ok: false }
  }

  return {
    ok: true,
    plan: {
      operations: normalizedOperations,
      summary,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    warnings,
  }
}

export function buildAiTripEditPatchPreview(
  plan: AiTripEditPatchPlan,
  context: AiTripEditContext,
): AiTripEditPatchPreview {
  const itemById = getContextItemMap(context)
  const dayById = new Map(context.days.map((day) => [day.id, day]))
  const lines: string[] = []
  const warnings = [...(plan.warnings ?? [])]

  for (const operation of plan.operations) {
    if (operation.type === 'update_item') {
      const item = itemById.get(operation.itemId)
      const changes = Object.entries(operation.changes)
        .map(([key, value]) => formatChange(key as keyof AiTripEditItemChanges, item, value))
        .filter(Boolean)
      lines.push(`修改：${item?.title ?? operation.itemId}：${changes.join('；')}`)
      continue
    }

    if (operation.type === 'move_item') {
      const item = itemById.get(operation.itemId)
      const fromDay = context.days.find((day) => day.items.some((candidate) => candidate.id === operation.itemId))
      const targetDay = dayById.get(operation.targetDayId)
      const timeText = operation.targetStartTime ? `，时间改为 ${operation.targetStartTime}` : ''
      lines.push(`移动：${item?.title ?? operation.itemId}：${fromDay?.title || fromDay?.date || '原日期'} → ${targetDay?.title || targetDay?.date || operation.targetDayId}${timeText}`)
      continue
    }

    if (operation.type === 'delete_item') {
      const item = itemById.get(operation.itemId)
      lines.push(`删除：${item?.title ?? operation.itemId}`)
      if (item?.hasTicketBindings) {
        warnings.push(`含票据绑定的项目「${item.title}」不会被 AI 删除；请先手动处理票据。`)
      }
      continue
    }

    const targetDay = dayById.get(operation.targetDayId)
    const timeText = operation.item.startTime ? `（${operation.item.startTime}${operation.item.endTime ? `-${operation.item.endTime}` : ''}）` : ''
    lines.push(`新增：${targetDay?.title || targetDay?.date || operation.targetDayId} 添加「${operation.item.title}」${timeText}`)
  }

  return {
    lines,
    warnings: Array.from(new Set(warnings)),
  }
}

export function summarizeAiTripEditPatchPlan(plan: AiTripEditPatchPlan, context: AiTripEditContext): string {
  const preview = buildAiTripEditPatchPreview(plan, context)
  return preview.lines.join('\n')
}

export function getAiTripEditContextItem(context: AiTripEditContext, itemId: string): AiTripEditContextItem | undefined {
  return getContextItemMap(context).get(itemId)
}

function normalizeItemChanges(
  input: unknown,
  path: string,
  errors: AiTripEditPatchValidationError[],
  options: { requireTitle: boolean },
): AiTripEditItemChanges | null {
  const record = readRecord(input)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push({ message: `${path} 必须是对象。`, path })
    return null
  }
  rejectUnknownFields(record, ALLOWED_CHANGE_FIELDS, path, errors)

  const changes: AiTripEditItemChanges = {}
  const title = readOptionalText(record.title, `${path}.title`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
  if (options.requireTitle && !title) {
    errors.push({ message: '新增项目必须包含 title。', path: `${path}.title` })
  }
  if (title) changes.title = title

  for (const key of ['locationName', 'address'] as const) {
    const value = readOptionalText(record[key], `${path}.${key}`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
    if (value) changes[key] = value
  }

  const startTime = readOptionalTime(record.startTime, `${path}.startTime`, errors)
  const endTime = readOptionalTime(record.endTime, `${path}.endTime`, errors)
  if (startTime) changes.startTime = startTime
  if (endTime) changes.endTime = endTime

  if (record.previousTransportMode !== undefined) {
    if (VALID_TRANSPORT_MODES.has(record.previousTransportMode as TransportMode)) {
      changes.previousTransportMode = record.previousTransportMode as TransportMode
    } else {
      errors.push({ message: '交通方式无效。', path: `${path}.previousTransportMode` })
    }
  }

  if (record.previousTransportDurationMinutes !== undefined) {
    const duration = record.previousTransportDurationMinutes
    if (typeof duration === 'number' && Number.isInteger(duration) && duration >= 0 && duration <= 1440) {
      changes.previousTransportDurationMinutes = duration
    } else {
      errors.push({ message: '交通耗时必须是 0 到 1440 的整数分钟。', path: `${path}.previousTransportDurationMinutes` })
    }
  }

  return changes
}

function readExistingItemId(
  value: unknown,
  operationPath: string,
  itemIds: Set<string>,
  errors: AiTripEditPatchValidationError[],
) {
  const itemId = readRequiredText(value, `${operationPath}.itemId`, 128, errors)
  if (itemId && !itemIds.has(itemId)) {
    errors.push({ message: 'itemId 不存在。', path: `${operationPath}.itemId` })
  }
  return itemId
}

function readExistingDayId(
  value: unknown,
  path: string,
  dayIds: Set<string>,
  errors: AiTripEditPatchValidationError[],
) {
  const dayId = readRequiredText(value, path, 128, errors)
  if (dayId && !dayIds.has(dayId)) {
    errors.push({ message: 'targetDayId 不存在。', path })
  }
  return dayId
}

function readRequiredText(value: unknown, path: string, maxLength: number, errors: AiTripEditPatchValidationError[]) {
  const text = readOptionalText(value, path, maxLength, errors)
  if (!text) {
    errors.push({ message: '必须是非空字符串。', path })
  }
  return text ?? ''
}

function readOptionalText(value: unknown, path: string, maxLength: number, errors: AiTripEditPatchValidationError[]) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    errors.push({ message: '必须是字符串。', path })
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  if (containsDangerousMarkup(trimmed)) {
    errors.push({ message: '不能包含脚本或 HTML 标记。', path })
    return undefined
  }
  return trimmed.slice(0, maxLength)
}

function readOptionalTime(value: unknown, path: string, errors: AiTripEditPatchValidationError[]) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !isValidTime(value.trim())) {
    errors.push({ message: '时间必须使用 HH:mm 格式。', path })
    return undefined
  }
  return value.trim()
}

function readOptionalSortOrder(value: unknown, path: string, errors: AiTripEditPatchValidationError[]) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) {
    errors.push({ message: '排序位置必须是 0 到 10000 的整数。', path })
    return undefined
  }
  return value
}

function validateTimePair(
  startTime: string | undefined,
  endTime: string | undefined,
  path: string,
  errors: AiTripEditPatchValidationError[],
) {
  if (startTime && endTime && timeToMinutes(endTime) < timeToMinutes(startTime)) {
    errors.push({ message: '结束时间不能早于开始时间。', path: `${path}.endTime` })
  }
}

function normalizeWarnings(input: unknown, errors: AiTripEditPatchValidationError[]) {
  if (input === undefined) {
    return []
  }
  if (!Array.isArray(input)) {
    errors.push({ message: 'warnings 必须是字符串数组。', path: 'warnings' })
    return []
  }
  return input
    .map((value, index) => readOptionalText(value, `warnings[${index}]`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors))
    .filter((value): value is string => Boolean(value))
    .slice(0, 10)
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowedFields: Set<string>,
  path: string,
  errors: AiTripEditPatchValidationError[],
) {
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      errors.push({ message: `字段 ${key} 不在允许列表中。`, path: `${path}.${key}` })
    }
  }
}

function findForbiddenFieldPath(input: unknown, path = '$'): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  if (Array.isArray(input)) {
    for (const [index, value] of input.entries()) {
      const nested = findForbiddenFieldPath(value, `${path}[${index}]`)
      if (nested) return nested
    }
    return null
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (FORBIDDEN_FIELD_NAMES.has(key)) {
      return `${path}.${key}`
    }
    const nested = findForbiddenFieldPath(value, `${path}.${key}`)
    if (nested) return nested
  }
  return null
}

function getContextItemMap(context: AiTripEditContext) {
  return new Map(context.days.flatMap((day) => day.items.map((item) => [item.id, item] as const)))
}

function formatChange(key: keyof AiTripEditItemChanges, item: AiTripEditContextItem | undefined, value: unknown) {
  const oldValue = getOldValue(key, item)
  const nextValue = key === 'previousTransportMode' && typeof value === 'string'
    ? transportModeLabels[value as TransportMode] ?? value
    : value
  return `${fieldLabel(key)}：${oldValue || '空'} → ${nextValue || '空'}`
}

function getOldValue(key: keyof AiTripEditItemChanges, item: AiTripEditContextItem | undefined) {
  if (!item) return ''
  if (key === 'previousTransportMode' && item.previousTransportMode) {
    return transportModeLabels[item.previousTransportMode]
  }
  const value = item[key]
  return value === undefined ? '' : String(value)
}

function fieldLabel(key: keyof AiTripEditItemChanges) {
  switch (key) {
    case 'address': return '地址'
    case 'endTime': return '结束时间'
    case 'locationName': return '地点'
    case 'previousTransportDurationMinutes': return '交通耗时'
    case 'previousTransportMode': return '前往方式'
    case 'startTime': return '开始时间'
    case 'title': return '标题'
    default: return key
  }
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function containsDangerousMarkup(value: string) {
  return /<\s*\/?\s*(script|iframe|object|embed|style|link|meta|html|body)\b/i.test(value)
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}
