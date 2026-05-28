import { transportModeLabels } from '../itinerary'
import type { AiTripEditContext, AiTripEditContextDay, AiTripEditContextItem } from './aiTripEditContext'
import type { TransportMode } from '../../types'

export const AI_TRIP_EDIT_MAX_OPERATIONS = 20
export const AI_TRIP_EDIT_MAX_SUMMARY_LENGTH = 300
export const AI_TRIP_EDIT_MAX_REASON_LENGTH = 200
export const AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH = 200
export const AI_TRIP_EDIT_MAX_NOTE_LENGTH = 500

export type AiTripEditPatchPlan = {
  summary: string
  operations: AiTripEditOperation[]
  warnings?: string[]
}

export type AiTripEditOperation =
  | UpdateItemTitleOperation
  | UpdateItemTimeOperation
  | UpdateItemLocationTextOperation
  | UpdateItemNoteOperation
  | UpdateItemTransportOperation
  | AddItemOperation
  | RemoveItemOperation
  | MoveItemOperation
  | ReorderDayItemsOperation
  | UpdateDayTitleOperation

export type UpdateItemTitleOperation = {
  type: 'update_item_title'
  itemId: string
  title: string
  reason: string
}

export type UpdateItemTimeOperation = {
  type: 'update_item_time'
  itemId: string
  startTime?: string
  endTime?: string
  reason: string
}

export type UpdateItemLocationTextOperation = {
  type: 'update_item_location_text'
  itemId: string
  locationName?: string
  address?: string
  reason: string
}

export type UpdateItemNoteOperation = {
  type: 'update_item_note'
  itemId: string
  note: string
  reason: string
}

export type UpdateItemTransportOperation = {
  type: 'update_item_transport'
  itemId: string
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
  reason: string
}

export type AddItemOperation = {
  type: 'add_item'
  targetDayId: string
  item: AiTripEditNewItem
  targetSortOrder?: number
  reason: string
}

export type RemoveItemOperation = {
  type: 'remove_item'
  itemId: string
  reason: string
}

export type MoveItemOperation = {
  type: 'move_item'
  itemId: string
  targetDayId: string
  targetSortOrder?: number
  targetStartTime?: string
  reason: string
}

export type ReorderDayItemsOperation = {
  type: 'reorder_day_items'
  dayId: string
  orderedItemIds: string[]
  reason: string
}

export type UpdateDayTitleOperation = {
  type: 'update_day_title'
  dayId: string
  title: string
  reason: string
}

export type AiTripEditNewItem = {
  title: string
  startTime?: string
  endTime?: string
  locationName?: string
  address?: string
  note?: string
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
}

export type AiTripEditPatchValidationError = {
  path: string
  message: string
}

export type ValidateAiTripEditPatchPlanResult =
  | { ok: true; plan: AiTripEditPatchPlan; warnings: string[] }
  | { ok: false; errors: AiTripEditPatchValidationError[] }

export type AiTripEditPatchImpact = {
  affectedDayCount: number
  affectedDayIds: string[]
  affectedItemCount: number
  affectedItemIds: string[]
  hasWritePayload: boolean
  routeMayBeStale: boolean
  writeOperationCount: number
}

export type AiTripEditPatchPreview = AiTripEditPatchImpact & {
  lines: string[]
  warnings: string[]
}

const ROUTE_STALE_WARNING = '部分时间、地点或顺序修改可能让已有路线缓存过期；本次不会清除路线缓存。'

const VALID_OPERATION_TYPES = new Set<AiTripEditOperation['type']>([
  'update_item_title',
  'update_item_time',
  'update_item_location_text',
  'update_item_note',
  'update_item_transport',
  'add_item',
  'remove_item',
  'move_item',
  'reorder_day_items',
  'update_day_title',
])
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
  'urls',
  'notes',
  'fileName',
  'fileNames',
  'blob',
  'blobs',
])
const ALLOWED_PLAN_FIELDS = new Set(['summary', 'operations', 'warnings'])
const ALLOWED_NEW_ITEM_FIELDS = new Set([
  'title',
  'startTime',
  'endTime',
  'locationName',
  'address',
  'note',
  'previousTransportMode',
  'previousTransportDurationMinutes',
])
const ALLOWED_OPERATION_FIELDS: Record<AiTripEditOperation['type'], Set<string>> = {
  add_item: new Set(['type', 'targetDayId', 'item', 'targetSortOrder', 'reason']),
  move_item: new Set(['type', 'itemId', 'targetDayId', 'targetSortOrder', 'targetStartTime', 'reason']),
  remove_item: new Set(['type', 'itemId', 'reason']),
  reorder_day_items: new Set(['type', 'dayId', 'orderedItemIds', 'reason']),
  update_day_title: new Set(['type', 'dayId', 'title', 'reason']),
  update_item_location_text: new Set(['type', 'itemId', 'locationName', 'address', 'reason']),
  update_item_note: new Set(['type', 'itemId', 'note', 'reason']),
  update_item_time: new Set(['type', 'itemId', 'startTime', 'endTime', 'reason']),
  update_item_title: new Set(['type', 'itemId', 'title', 'reason']),
  update_item_transport: new Set(['type', 'itemId', 'previousTransportMode', 'previousTransportDurationMinutes', 'reason']),
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
  rejectUnknownFields(record, ALLOWED_PLAN_FIELDS, '$', errors)

  const summary = readRequiredText(record.summary, 'summary', AI_TRIP_EDIT_MAX_SUMMARY_LENGTH, errors)
  const warnings = normalizeWarnings(record.warnings, errors)
  const rawOperations = Array.isArray(record.operations) ? record.operations : null
  if (!rawOperations) {
    errors.push({ message: 'operations 必须是数组。', path: 'operations' })
  } else if (rawOperations.length > AI_TRIP_EDIT_MAX_OPERATIONS) {
    errors.push({ message: `operations 不能超过 ${AI_TRIP_EDIT_MAX_OPERATIONS} 个。`, path: 'operations' })
  } else if (rawOperations.length === 0 && warnings.length === 0) {
    errors.push({ message: '无操作方案必须包含明确 warning。', path: 'warnings' })
  }

  const itemMap = getContextItemMap(context)
  const dayMap = getContextDayMap(context)
  const itemIds = new Set(itemMap.keys())
  const dayIds = new Set(dayMap.keys())
  const normalizedOperations: AiTripEditOperation[] = []

  for (const [index, rawOperation] of (rawOperations ?? []).entries()) {
    const operation = readRecord(rawOperation)
    const path = `operations[${index}]`
    const type = operation.type
    if (typeof type !== 'string' || !VALID_OPERATION_TYPES.has(type as AiTripEditOperation['type'])) {
      errors.push({ message: '不支持的修改操作。', path: `${path}.type` })
      continue
    }

    rejectUnknownFields(operation, ALLOWED_OPERATION_FIELDS[type as AiTripEditOperation['type']], path, errors)
    const reason = readRequiredText(operation.reason, `${path}.reason`, AI_TRIP_EDIT_MAX_REASON_LENGTH, errors)

    if (type === 'update_item_title') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const title = readRequiredText(operation.title, `${path}.title`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
      if (itemId && title && reason) {
        normalizedOperations.push({ itemId, reason, title, type })
      }
      continue
    }

    if (type === 'update_item_time') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const startTime = readOptionalTime(operation.startTime, `${path}.startTime`, errors)
      const endTime = readOptionalTime(operation.endTime, `${path}.endTime`, errors)
      if (!startTime && !endTime) {
        errors.push({ message: 'update_item_time 至少需要 startTime 或 endTime。', path })
      }
      validateTimePair(startTime, endTime, path, errors)
      if (itemId && reason && (startTime || endTime)) {
        normalizedOperations.push({ endTime, itemId, reason, startTime, type })
      }
      continue
    }

    if (type === 'update_item_location_text') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const locationName = readOptionalText(operation.locationName, `${path}.locationName`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
      const address = readOptionalText(operation.address, `${path}.address`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
      if (!locationName && !address) {
        errors.push({ message: 'update_item_location_text 至少需要 locationName 或 address。', path })
      }
      if (itemId && reason && (locationName || address)) {
        normalizedOperations.push({ address, itemId, locationName, reason, type })
      }
      continue
    }

    if (type === 'update_item_note') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const note = readRequiredText(operation.note, `${path}.note`, AI_TRIP_EDIT_MAX_NOTE_LENGTH, errors)
      if (itemId && note && reason) {
        normalizedOperations.push({ itemId, note, reason, type })
      }
      continue
    }

    if (type === 'update_item_transport') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const transport = normalizeTransport(operation, path, errors)
      if (transport.previousTransportMode === undefined && transport.previousTransportDurationMinutes === undefined) {
        errors.push({ message: 'update_item_transport 至少需要交通方式或耗时。', path })
      }
      if (itemId && reason && (transport.previousTransportMode !== undefined || transport.previousTransportDurationMinutes !== undefined)) {
        normalizedOperations.push({ itemId, reason, type, ...transport })
      }
      continue
    }

    if (type === 'add_item') {
      const targetDayId = readExistingDayId(operation.targetDayId, `${path}.targetDayId`, dayIds, errors)
      const item = normalizeNewItem(operation.item, `${path}.item`, errors)
      const targetSortOrder = readOptionalSortOrder(operation.targetSortOrder, `${path}.targetSortOrder`, errors)
      if (targetDayId && item && reason) {
        normalizedOperations.push({ item, reason, targetDayId, targetSortOrder, type })
      }
      continue
    }

    if (type === 'remove_item') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      if (itemId && reason) {
        normalizedOperations.push({ itemId, reason, type })
      }
      continue
    }

    if (type === 'move_item') {
      const itemId = readExistingItemId(operation.itemId, path, itemIds, errors)
      const targetDayId = readExistingDayId(operation.targetDayId, `${path}.targetDayId`, dayIds, errors)
      const targetSortOrder = readOptionalSortOrder(operation.targetSortOrder, `${path}.targetSortOrder`, errors)
      const targetStartTime = readOptionalTime(operation.targetStartTime, `${path}.targetStartTime`, errors)
      if (itemId && targetDayId && reason) {
        normalizedOperations.push({ itemId, reason, targetDayId, targetSortOrder, targetStartTime, type })
      }
      continue
    }

    if (type === 'reorder_day_items') {
      const dayId = readExistingDayId(operation.dayId, `${path}.dayId`, dayIds, errors)
      const orderedItemIds = readRequiredStringArray(operation.orderedItemIds, `${path}.orderedItemIds`, errors)
      if (dayId && orderedItemIds) {
        validateReorderItemIds(dayMap.get(dayId), orderedItemIds, `${path}.orderedItemIds`, errors)
      }
      if (dayId && orderedItemIds && reason) {
        normalizedOperations.push({ dayId, orderedItemIds, reason, type })
      }
      continue
    }

    const dayId = readExistingDayId(operation.dayId, `${path}.dayId`, dayIds, errors)
    const title = readRequiredText(operation.title, `${path}.title`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
    if (dayId && title && reason) {
      normalizedOperations.push({ dayId, reason, title, type: 'update_day_title' })
    }
  }

  rejectUnsafeReorderCombinations(normalizedOperations, context, errors)

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
  const dayById = getContextDayMap(context)
  const lines: string[] = []
  const warnings = [...(plan.warnings ?? [])]
  const impact = deriveAiTripEditPatchImpact(plan, context)

  for (const operation of plan.operations) {
    if (operation.type === 'update_item_title') {
      const item = itemById.get(operation.itemId)
      lines.push(`修改标题：${item?.title ?? operation.itemId} → ${operation.title}`)
      continue
    }

    if (operation.type === 'update_item_time') {
      const item = itemById.get(operation.itemId)
      const changes = [
        operation.startTime ? formatChange('startTime', item, operation.startTime) : '',
        operation.endTime ? formatChange('endTime', item, operation.endTime) : '',
      ].filter(Boolean)
      lines.push(`修改时间：${item?.title ?? operation.itemId}：${changes.join('；')}`)
      continue
    }

    if (operation.type === 'update_item_location_text') {
      const item = itemById.get(operation.itemId)
      const changes = [
        operation.locationName ? formatChange('locationName', item, operation.locationName) : '',
        operation.address ? formatChange('address', item, operation.address) : '',
      ].filter(Boolean)
      lines.push(`修改地点：${item?.title ?? operation.itemId}：${changes.join('；')}`)
      continue
    }

    if (operation.type === 'update_item_note') {
      const item = itemById.get(operation.itemId)
      lines.push(`修改备注：${item?.title ?? operation.itemId}：将更新备注`)
      continue
    }

    if (operation.type === 'update_item_transport') {
      const item = itemById.get(operation.itemId)
      const changes = [
        operation.previousTransportMode ? formatChange('previousTransportMode', item, operation.previousTransportMode) : '',
        operation.previousTransportDurationMinutes !== undefined
          ? formatChange('previousTransportDurationMinutes', item, operation.previousTransportDurationMinutes)
          : '',
      ].filter(Boolean)
      lines.push(`修改交通：${item?.title ?? operation.itemId}：${changes.join('；')}`)
      continue
    }

    if (operation.type === 'add_item') {
      const targetDay = dayById.get(operation.targetDayId)
      const timeText = operation.item.startTime ? `（${operation.item.startTime}${operation.item.endTime ? `-${operation.item.endTime}` : ''}）` : ''
      lines.push(`新增：${dayLabel(targetDay, operation.targetDayId)} 添加「${operation.item.title}」${timeText}`)
      continue
    }

    if (operation.type === 'remove_item') {
      const item = itemById.get(operation.itemId)
      lines.push(`移除：${item?.title ?? operation.itemId}`)
      if (item?.ticketBoundState === 'item_bound' || item?.hasTicketBindings) {
        warnings.push(`含票据绑定的项目「${item.title}」不会被 AI 删除；请先手动处理票据。`)
      }
      continue
    }

    if (operation.type === 'move_item') {
      const item = itemById.get(operation.itemId)
      const fromDay = context.days.find((day) => day.items.some((candidate) => candidate.id === operation.itemId))
      const targetDay = dayById.get(operation.targetDayId)
      const timeText = operation.targetStartTime ? `，时间改为 ${operation.targetStartTime}` : ''
      lines.push(`移动：${item?.title ?? operation.itemId}：${dayLabel(fromDay, '原日期')} → ${dayLabel(targetDay, operation.targetDayId)}${timeText}`)
      continue
    }

    if (operation.type === 'reorder_day_items') {
      const day = dayById.get(operation.dayId)
      lines.push(`调整顺序：${dayLabel(day, operation.dayId)} 的 ${operation.orderedItemIds.length} 个行程项将重新排序`)
      continue
    }

    const day = dayById.get(operation.dayId)
    lines.push(`修改日期标题：${dayLabel(day, operation.dayId)} → ${operation.title}`)
  }

  if (impact.routeMayBeStale) {
    warnings.push(ROUTE_STALE_WARNING)
  }
  if (plan.operations.length === 0) {
    lines.push('不写入任何修改。')
  }

  return {
    ...impact,
    lines,
    warnings: Array.from(new Set(warnings)),
  }
}

export function deriveAiTripEditPatchImpact(
  plan: AiTripEditPatchPlan,
  context: AiTripEditContext,
): AiTripEditPatchImpact {
  const itemById = getContextItemMap(context)
  const affectedDayIds = new Set<string>()
  const affectedItemIds = new Set<string>()
  let routeMayBeStale = false

  for (const operation of plan.operations) {
    if (operation.type === 'update_day_title') {
      affectedDayIds.add(operation.dayId)
      continue
    }

    if (operation.type === 'add_item') {
      affectedDayIds.add(operation.targetDayId)
      routeMayBeStale = true
      continue
    }

    if (operation.type === 'reorder_day_items') {
      affectedDayIds.add(operation.dayId)
      operation.orderedItemIds.forEach((itemId) => affectedItemIds.add(itemId))
      routeMayBeStale = true
      continue
    }

    const item = itemById.get(operation.itemId)
    affectedItemIds.add(operation.itemId)
    if (item?.dayId) {
      affectedDayIds.add(item.dayId)
    }

    if (operation.type === 'move_item') {
      affectedDayIds.add(operation.targetDayId)
      routeMayBeStale = true
    } else if (
      operation.type === 'update_item_time' ||
      operation.type === 'update_item_location_text' ||
      operation.type === 'update_item_transport' ||
      operation.type === 'remove_item'
    ) {
      routeMayBeStale = true
    }
  }

  const affectedDayIdList = Array.from(affectedDayIds).sort()
  const affectedItemIdList = Array.from(affectedItemIds).sort()
  return {
    affectedDayCount: affectedDayIdList.length,
    affectedDayIds: affectedDayIdList,
    affectedItemCount: affectedItemIdList.length,
    affectedItemIds: affectedItemIdList,
    hasWritePayload: plan.operations.length > 0,
    routeMayBeStale,
    writeOperationCount: plan.operations.length,
  }
}

export function summarizeAiTripEditPatchPlan(plan: AiTripEditPatchPlan, context: AiTripEditContext): string {
  const preview = buildAiTripEditPatchPreview(plan, context)
  return preview.lines.join('\n')
}

export function getAiTripEditContextItem(context: AiTripEditContext, itemId: string): AiTripEditContextItem | undefined {
  return getContextItemMap(context).get(itemId)
}

function normalizeNewItem(
  input: unknown,
  path: string,
  errors: AiTripEditPatchValidationError[],
): AiTripEditNewItem | null {
  const record = readRecord(input)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push({ message: `${path} 必须是对象。`, path })
    return null
  }
  rejectUnknownFields(record, ALLOWED_NEW_ITEM_FIELDS, path, errors)

  const title = readRequiredText(record.title, `${path}.title`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
  const item: AiTripEditNewItem = { title }
  const startTime = readOptionalTime(record.startTime, `${path}.startTime`, errors)
  const endTime = readOptionalTime(record.endTime, `${path}.endTime`, errors)
  validateTimePair(startTime, endTime, path, errors)
  if (startTime) item.startTime = startTime
  if (endTime) item.endTime = endTime

  for (const key of ['locationName', 'address'] as const) {
    const value = readOptionalText(record[key], `${path}.${key}`, AI_TRIP_EDIT_MAX_PATCH_TEXT_LENGTH, errors)
    if (value) item[key] = value
  }

  const note = readOptionalText(record.note, `${path}.note`, AI_TRIP_EDIT_MAX_NOTE_LENGTH, errors)
  if (note) item.note = note

  Object.assign(item, normalizeTransport(record, path, errors))
  return title ? item : null
}

function normalizeTransport(
  record: Record<string, unknown>,
  path: string,
  errors: AiTripEditPatchValidationError[],
): Pick<UpdateItemTransportOperation, 'previousTransportMode' | 'previousTransportDurationMinutes'> {
  const transport: Pick<UpdateItemTransportOperation, 'previousTransportMode' | 'previousTransportDurationMinutes'> = {}
  if (record.previousTransportMode !== undefined) {
    if (VALID_TRANSPORT_MODES.has(record.previousTransportMode as TransportMode)) {
      transport.previousTransportMode = record.previousTransportMode as TransportMode
    } else {
      errors.push({ message: '交通方式无效。', path: `${path}.previousTransportMode` })
    }
  }

  if (record.previousTransportDurationMinutes !== undefined) {
    const duration = record.previousTransportDurationMinutes
    if (typeof duration === 'number' && Number.isInteger(duration) && duration >= 0 && duration <= 1440) {
      transport.previousTransportDurationMinutes = duration
    } else {
      errors.push({ message: '交通耗时必须是 0 到 1440 的整数分钟。', path: `${path}.previousTransportDurationMinutes` })
    }
  }
  return transport
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
    errors.push({ message: 'dayId 不存在。', path })
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
  if (trimmed.length > maxLength) {
    errors.push({ message: `不能超过 ${maxLength} 个字符。`, path })
    return undefined
  }
  if (containsDangerousMarkup(trimmed)) {
    errors.push({ message: '不能包含脚本或 HTML 标记。', path })
    return undefined
  }
  return trimmed
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
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10_000) {
    errors.push({ message: '排序位置必须是 1 到 10000 的整数。', path })
    return undefined
  }
  return value
}

function readRequiredStringArray(value: unknown, path: string, errors: AiTripEditPatchValidationError[]) {
  if (!Array.isArray(value)) {
    errors.push({ message: '必须是字符串数组。', path })
    return null
  }
  const values: string[] = []
  const seen = new Set<string>()
  for (const [index, rawValue] of value.entries()) {
    const itemId = readRequiredText(rawValue, `${path}[${index}]`, 128, errors)
    if (!itemId) continue
    if (seen.has(itemId)) {
      errors.push({ message: '排序列表不能包含重复 itemId。', path: `${path}[${index}]` })
      continue
    }
    seen.add(itemId)
    values.push(itemId)
  }
  return values
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

function validateReorderItemIds(
  day: AiTripEditContextDay | undefined,
  orderedItemIds: string[],
  path: string,
  errors: AiTripEditPatchValidationError[],
) {
  if (!day) return
  const expected = day.items.map((item) => item.id).sort()
  const actual = [...orderedItemIds].sort()
  if (expected.length !== actual.length || expected.some((itemId, index) => itemId !== actual[index])) {
    errors.push({ message: '排序列表必须完整包含该日期下的全部行程项，且不能多出或遗漏。', path })
  }
}

function rejectUnsafeReorderCombinations(
  operations: AiTripEditOperation[],
  context: AiTripEditContext,
  errors: AiTripEditPatchValidationError[],
) {
  const itemById = getContextItemMap(context)
  const reorderedDayIds = new Set(operations
    .filter((operation): operation is ReorderDayItemsOperation => operation.type === 'reorder_day_items')
    .map((operation) => operation.dayId))
  if (reorderedDayIds.size === 0) return

  operations.forEach((operation, index) => {
    if (operation.type === 'reorder_day_items') return
    if (operation.type === 'add_item' && reorderedDayIds.has(operation.targetDayId)) {
      errors.push({ message: 'reorder_day_items 不能和同一天的新增项目混用。', path: `operations[${index}]` })
    }
    if (operation.type === 'move_item') {
      const sourceDayId = itemById.get(operation.itemId)?.dayId
      if ((sourceDayId && reorderedDayIds.has(sourceDayId)) || reorderedDayIds.has(operation.targetDayId)) {
        errors.push({ message: 'reorder_day_items 不能和同一天的移动项目混用。', path: `operations[${index}]` })
      }
    }
    if (operation.type === 'remove_item') {
      const sourceDayId = itemById.get(operation.itemId)?.dayId
      if (sourceDayId && reorderedDayIds.has(sourceDayId)) {
        errors.push({ message: 'reorder_day_items 不能和同一天的移除项目混用。', path: `operations[${index}]` })
      }
    }
  })
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
      errors.push({ message: `字段 ${key} 不在允许列表中。`, path: path === '$' ? key : `${path}.${key}` })
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

function getContextDayMap(context: AiTripEditContext) {
  return new Map(context.days.map((day) => [day.id, day] as const))
}

function formatChange(key: keyof AiTripEditNewItem, item: AiTripEditContextItem | undefined, value: unknown) {
  const oldValue = getOldValue(key, item)
  const nextValue = key === 'previousTransportMode' && typeof value === 'string'
    ? transportModeLabels[value as TransportMode] ?? value
    : value
  return `${fieldLabel(key)}：${oldValue || '空'} → ${nextValue || '空'}`
}

function getOldValue(key: keyof AiTripEditNewItem, item: AiTripEditContextItem | undefined) {
  if (!item) return ''
  if (key === 'previousTransportMode' && item.previousTransportMode) {
    return transportModeLabels[item.previousTransportMode]
  }
  if (key === 'note') {
    return item.noteText ?? item.noteSummary ?? ''
  }
  const value = item[key]
  return value === undefined ? '' : String(value)
}

function fieldLabel(key: keyof AiTripEditNewItem) {
  switch (key) {
    case 'address': return '地址'
    case 'endTime': return '结束时间'
    case 'locationName': return '地点'
    case 'note': return '备注'
    case 'previousTransportDurationMinutes': return '交通耗时'
    case 'previousTransportMode': return '前往方式'
    case 'startTime': return '开始时间'
    case 'title': return '标题'
    default: return key
  }
}

function dayLabel(day: AiTripEditContextDay | undefined, fallback: string) {
  return day?.title || day?.date || fallback
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
