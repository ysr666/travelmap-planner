import type { ExistingTripImportAppliedChange } from '../ai/existingTripImport'
import type { LedgerExpenseDraftCandidate } from '../ledgerExtraction'
import {
  appendTripOperationsExecutionRecord,
  createTripOperationsExecutionRecord,
  type TripOperationsAppliedChange,
  type TripOperationsExecutionRecord,
  type TripOperationsExecutionSource,
  type TripOperationsLocalState,
} from '../tripOperationsState'
import type { ItineraryItem, LedgerExpense, TripDisruptionEvent, TripReplanRecord } from '../../types'
import type { TripIntelligenceAppliedChange, TripIntelligenceScope, TripIntelligenceSourceRef } from './types'

type MapAppliedChangeOptions = {
  idPrefix?: string
  source?: TripIntelligenceSourceRef
}

type AppendTripIntelligenceExecutionRecordInput = {
  fingerprints: string[]
  intelligenceAppliedChanges: TripIntelligenceAppliedChange[]
  legacyAppliedChanges?: TripOperationsAppliedChange[]
  now?: number
  source?: TripOperationsExecutionSource
  status: TripOperationsExecutionRecord['status']
  title: string
}

const DEFAULT_OPERATIONS_SOURCE: TripIntelligenceSourceRef = {
  id: 'trip_operations',
  kind: 'operations',
  label: 'Trip Operations Agent',
}

const INBOX_SOURCE: TripIntelligenceSourceRef = {
  id: 'travel_inbox',
  kind: 'inbox',
  label: 'Travel Inbox',
}

const LIVE_SOURCE: TripIntelligenceSourceRef = {
  id: 'adaptive_replan',
  kind: 'live',
  label: 'Live Mode',
}

const LEDGER_SOURCE: TripIntelligenceSourceRef = {
  id: 'ledger',
  kind: 'ledger',
  label: 'Finance',
}

export function mapTripOperationsAppliedChange(
  change: TripOperationsAppliedChange,
  options: MapAppliedChangeOptions = {},
): TripIntelligenceAppliedChange {
  const source = options.source ?? DEFAULT_OPERATIONS_SOURCE
  const targetType = mapTripOperationsTarget(change.target)
  const targetId = change.itemId ?? change.ticketId ?? change.dayId
  const idSeed = [
    options.idPrefix ?? 'operations',
    change.action,
    targetId ?? change.target,
    change.title,
    change.occurredAt,
  ].join(':')
  return {
    actionType: change.action,
    detail: sanitizeAppliedChangeDetail(change.detail),
    id: `${options.idPrefix ?? 'operations'}:${hashString(idSeed)}`,
    occurredAt: change.occurredAt,
    source,
    targetId,
    targetType,
    title: sanitizeAppliedChangeTitle(change.title),
  }
}

export function mapExistingTripImportAppliedChange(
  change: ExistingTripImportAppliedChange,
  now = Date.now(),
): TripIntelligenceAppliedChange {
  const targetType = mapInboxTarget(change.kind)
  const targetId = change.ticketId ?? change.itemId ?? change.dayId ?? change.id
  const actionType = `inbox_${change.action}_${change.kind}`
  return {
    actionType,
    detail: sanitizeAppliedChangeDetail(`${inboxActionLabel(change.action)}旅行材料建议。`),
    id: `inbox:${hashString([actionType, targetId, change.title, now].join(':'))}`,
    occurredAt: now,
    source: INBOX_SOURCE,
    targetId,
    targetType,
    title: sanitizeAppliedChangeTitle(change.title),
  }
}

export function mapExistingTripImportAppliedChangeToTripOperationsChange(
  change: ExistingTripImportAppliedChange,
  now = Date.now(),
): TripOperationsAppliedChange {
  const target = change.kind === 'ticket'
    ? 'tickets'
    : change.kind === 'item'
      ? 'item'
      : change.kind === 'day'
        ? 'day'
        : 'trip'
  const action: TripOperationsAppliedChange['action'] = change.kind === 'ticket'
    ? change.action === 'bound' ? 'bound_ticket' : 'merged_ticket'
    : change.kind === 'item'
      ? change.action === 'created' ? 'created_item' : 'updated_item'
      : change.kind === 'day'
        ? 'updated_day'
        : 'updated_trip'
  return {
    action,
    dayId: change.dayId,
    detail: `${inboxActionLabel(change.action)}收件箱内容。`,
    itemId: change.itemId,
    occurredAt: now,
    target,
    ticketId: change.ticketId,
    title: change.title,
  }
}

export function mapTripReplanAppliedChange(
  record: TripReplanRecord,
  mode: 'applied' | 'undone',
  now = Date.now(),
): TripIntelligenceAppliedChange {
  const selectedOption = record.options.find((option) => option.id === record.selectedOptionId)
  const diff = record.selectedDiff ?? selectedOption?.diff
  const changedItemCount = diff
    ? diff.itemChanges.filter((change) => change.changeType !== 'unchanged').length
    : record.beforeSnapshot.items.length
  const actionType = mode === 'applied' ? 'replan_applied' : 'replan_undone'
  const title = mode === 'applied' ? '已应用自适应重排' : '已撤销自适应重排'
  const detail = mode === 'applied'
    ? `已写入 ${changedItemCount} 个行程点调整；票据、账本和交通订单仍需人工确认。`
    : `已恢复 ${changedItemCount} 个行程点到重排前状态。`
  return {
    actionType,
    detail: sanitizeAppliedChangeDetail(detail),
    id: `live:${hashString([actionType, record.id, record.updatedAt, now].join(':'))}`,
    occurredAt: now,
    source: { ...LIVE_SOURCE, id: record.id },
    targetId: record.id,
    targetType: 'live',
    title,
  }
}

export function mapLiveItemExecutionAppliedChange(
  item: ItineraryItem,
  status: 'completed' | 'skipped' | null,
  now = Date.now(),
): TripIntelligenceAppliedChange {
  const actionType = status === 'completed'
    ? 'live_item_completed'
    : status === 'skipped'
      ? 'live_item_skipped'
      : 'live_item_restored'
  const detail = status === 'completed'
    ? '已标记为完成，下一站判断会重新计算。'
    : status === 'skipped'
      ? '已标记为跳过，后续安排会重新计算。'
      : '已恢复为待处理，重新参与 Live Mode 判断。'
  return {
    actionType,
    detail: sanitizeAppliedChangeDetail(detail),
    id: `live:${hashString([actionType, item.id, item.updatedAt, now].join(':'))}`,
    occurredAt: now,
    source: { ...LIVE_SOURCE, id: 'live_item_execution' },
    targetId: item.id,
    targetType: 'item',
    title: sanitizeAppliedChangeTitle(item.title),
  }
}

export function mapLiveDisruptionReportedAppliedChange(
  event: TripDisruptionEvent,
  record?: TripReplanRecord | null,
  now = Date.now(),
): TripIntelligenceAppliedChange {
  const optionCount = record?.options.length ?? 0
  return {
    actionType: 'live_disruption_reported',
    detail: sanitizeAppliedChangeDetail(optionCount > 0
      ? `已生成 ${optionCount} 个重排方案，确认前不会写入行程。`
      : '已记录突发情况，等待后续处理。'),
    id: `live:${hashString(['live_disruption_reported', event.id, record?.id ?? '', now].join(':'))}`,
    occurredAt: now,
    source: { ...LIVE_SOURCE, id: event.id },
    targetId: record?.id ?? event.id,
    targetType: 'live',
    title: `${getDisruptionKindLabel(event.kind)}已报告`,
  }
}

export function mapLedgerExpenseDraftCreatedAppliedChange(
  expense: LedgerExpense,
  candidate?: LedgerExpenseDraftCandidate,
  now = Date.now(),
): TripIntelligenceAppliedChange {
  const sourceLabel = candidate?.source.kind === 'ticket'
    ? '票据'
    : candidate?.source.kind === 'inbox'
      ? '旅行材料'
      : candidate?.source.kind === 'transport_booking'
        ? '交通订单'
        : candidate?.source.kind === 'itinerary_note'
          ? '行程备注'
          : '账本来源'
  return {
    actionType: 'ledger_expense_draft_created',
    detail: sanitizeAppliedChangeDetail(`已从${sourceLabel}生成待确认草稿；金额、付款人和分摊仍需在账本审核。`),
    id: `ledger:${hashString(['ledger_expense_draft_created', expense.id, expense.updatedAt, now].join(':'))}`,
    occurredAt: now,
    source: LEDGER_SOURCE,
    targetId: expense.id,
    targetType: 'finance',
    title: sanitizeAppliedChangeTitle(expense.title),
  }
}

export function getTripIntelligenceAppliedChangesForRecord(
  record: TripOperationsExecutionRecord,
): TripIntelligenceAppliedChange[] {
  if (record.intelligenceAppliedChanges?.length) return record.intelligenceAppliedChanges
  const source = sourceForExecutionRecord(record.source)
  return record.appliedChanges.map((change, index) =>
    mapTripOperationsAppliedChange(change, {
      idPrefix: `${record.id}:${index}`,
      source,
    }),
  )
}

export function appendTripIntelligenceExecutionRecord(
  state: TripOperationsLocalState,
  input: AppendTripIntelligenceExecutionRecordInput,
): TripOperationsLocalState {
  const legacyAppliedChanges = input.legacyAppliedChanges ?? []
  const intelligenceAppliedChanges = input.intelligenceAppliedChanges.length > 0
    ? input.intelligenceAppliedChanges
    : legacyAppliedChanges.map((change) => mapTripOperationsAppliedChange(change, {
      source: sourceForExecutionRecord(input.source ?? 'trip_operations'),
    }))

  return appendTripOperationsExecutionRecord(state, createTripOperationsExecutionRecord({
    appliedChanges: legacyAppliedChanges,
    fingerprints: input.fingerprints,
    intelligenceAppliedChanges,
    now: input.now,
    source: input.source,
    status: input.status,
    title: input.title,
  }))
}

export function formatTripIntelligenceAppliedActionLabel(actionType: string) {
  if (actionType === 'generated_route') return '生成路线'
  if (actionType === 'retried_ticket_upload') return '重试上传'
  if (actionType === 'cleared_ticket_cache') return '清理缓存'
  if (actionType === 'saved_daily_tip') return '保存提示'
  if (actionType === 'updated_content') return '补充内容'
  if (actionType === 'bound_ticket') return '绑定票据'
  if (actionType === 'merged_ticket') return '合并票据'
  if (actionType === 'created_item') return '创建行程点'
  if (actionType === 'removed_item') return '删除行程点'
  if (actionType === 'reordered_day') return '调整顺序'
  if (actionType === 'updated_day') return '更新日期'
  if (actionType === 'updated_trip') return '更新旅行'
  if (actionType === 'updated_item') return '更新行程点'
  if (actionType === 'live_item_completed') return '标记完成'
  if (actionType === 'live_item_skipped') return '跳过行程点'
  if (actionType === 'live_item_restored') return '恢复行程点'
  if (actionType === 'live_disruption_reported') return '报告突发情况'
  if (actionType === 'ledger_expense_draft_created') return '生成费用草稿'
  if (actionType === 'replan_applied') return '应用重排'
  if (actionType === 'replan_undone') return '撤销重排'
  if (actionType.startsWith('inbox_bound_')) return '绑定材料'
  if (actionType.startsWith('inbox_created_')) return '创建内容'
  if (actionType.startsWith('inbox_merged_')) return '合并内容'
  if (actionType.startsWith('inbox_appended_')) return '追加内容'
  if (actionType.startsWith('inbox_updated_')) return '更新内容'
  return '完成动作'
}

export function sanitizeAppliedChangeDetail(input?: string) {
  if (!input) return undefined
  const withoutStack = input
    .split(/\r?\n/)
    .filter((line) => !/^\s*at\s+\S+/.test(line) && !/^error:/i.test(line.trim()))
    .join(' ')
  const sanitized = withoutStack
    .replace(/\b(?:raw[_ -]?provider[_ -]?payload|provider[_ -]?payload|response[_ -]?body)\b\s*[:=]?\s*(?:\{[^}]*\}|\[[^\]]*\]|\S+)/gi, '[已隐藏服务数据]')
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[已隐藏邮箱]')
    .replace(/\b(?:authorization|bearer|api[_-]?key|secret|token)\b\s*[:=]?\s*\S*/gi, '[已隐藏凭据]')
    .replace(/\b(?:pnr|booking|order|passport|application|document)[_ -]?(?:id|no|number)?\b\s*[:=#]?\s*[A-Z0-9-]{4,}/gi, '[已隐藏编号]')
    .replace(/(?:订单号|证件号|申请号|票号|预订号)\s*[:：#]?\s*[A-Za-z0-9-]{4,}/g, '[已隐藏编号]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[已隐藏凭据]')
    .replace(/\b[A-Z0-9]{6,}\b/g, '[已隐藏编号]')
    .replace(/\b\d{8,}\b/g, '[已隐藏编号]')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized.length > 160 ? `${sanitized.slice(0, 157)}...` : sanitized
}

function sanitizeAppliedChangeTitle(input: string) {
  return sanitizeAppliedChangeDetail(input) ?? '已完成的旅行修改'
}

function sourceForExecutionRecord(source: TripOperationsExecutionSource): TripIntelligenceSourceRef {
  if (source === 'travel_inbox') return INBOX_SOURCE
  if (source === 'ai_trip_edit') {
    return {
      id: 'ai_trip_edit',
      kind: 'operations',
      label: 'AI Trip Edit',
    }
  }
  return DEFAULT_OPERATIONS_SOURCE
}

function mapTripOperationsTarget(target: TripOperationsAppliedChange['target']): TripIntelligenceScope {
  if (target === 'day') return 'day'
  if (target === 'item') return 'item'
  if (target === 'tickets') return 'ticket'
  if (target === 'sync_settings') return 'sync'
  return 'trip'
}

function mapInboxTarget(kind: ExistingTripImportAppliedChange['kind']): TripIntelligenceScope {
  if (kind === 'day') return 'day'
  if (kind === 'item') return 'item'
  if (kind === 'ticket') return 'ticket'
  return 'trip'
}

function inboxActionLabel(action: ExistingTripImportAppliedChange['action']) {
  if (action === 'created') return '已创建'
  if (action === 'bound') return '已绑定'
  if (action === 'merged') return '已合并'
  if (action === 'appended') return '已追加'
  return '已更新'
}

function getDisruptionKindLabel(kind: TripDisruptionEvent['kind']) {
  if (kind === 'delay') return '延误'
  if (kind === 'closure') return '地点关闭'
  if (kind === 'weather_unsuitable') return '天气不适合'
  if (kind === 'late') return '迟到'
  if (kind === 'cancelled') return '取消'
  return '临时跳过'
}

function hashString(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index) | 0
  }
  return Math.abs(hash).toString(36)
}
