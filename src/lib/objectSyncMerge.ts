import type {
  Day,
  ItineraryItem,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  ObjectSyncConflict,
  ObjectSyncConflictField,
  ObjectSyncConflictResolution,
  SyncObjectPayload,
  SyncObjectType,
  TicketMeta,
  Trip,
} from '../types'

type FieldDef = {
  path: string
  label: string
  notes?: boolean
}

export type ObjectFieldMergeResult =
  | {
      changed: boolean
      conflicts: []
      payload: SyncObjectPayload
      status: 'merged'
    }
  | {
      conflicts: ObjectSyncConflictField[]
      status: 'conflict'
    }

export type ObjectConflictResolutionInput = {
  deleteResolution?: 'delete' | 'keep'
  fieldResolutions?: Record<string, ObjectSyncConflictResolution>
}

export type ObjectConflictResolutionResult =
  | { operation: 'delete'; payload?: undefined }
  | { operation: 'upsert'; payload: SyncObjectPayload }

const FIELD_DEFS: Record<SyncObjectType, FieldDef[]> = {
  day: [
    { label: '日期', path: 'date' },
    { label: '标题', path: 'title' },
    { label: '当天时区', path: 'timeZone' },
    { label: '当天时区来源', path: 'timeZoneSource' },
    { label: '排序', path: 'sortOrder' },
  ],
  item: [
    { label: '所属日期', path: 'dayId' },
    { label: '标题', path: 'title' },
    { label: '开始时间', path: 'startTime' },
    { label: '结束时间', path: 'endTime' },
    { label: '开始时区', path: 'startTimeZone' },
    { label: '结束日期', path: 'endDate' },
    { label: '结束时区', path: 'endTimeZone' },
    { label: '地点名', path: 'locationName' },
    { label: '地址', path: 'address' },
    { label: '纬度', path: 'lat' },
    { label: '经度', path: 'lng' },
    { label: '交通方式', path: 'transportMode' },
    { label: '前序交通方式', path: 'previousTransportMode' },
    { label: '前序交通耗时', path: 'previousTransportDurationMinutes' },
    { label: '前序交通备注', path: 'previousTransportNote' },
    { label: '备注', notes: true, path: 'notes' },
    { label: '景点内容', path: 'contentEnrichment' },
    { label: '旅行执行状态', path: 'executionState' },
    { label: '绑定票据', path: 'ticketIds' },
    { label: '排序', path: 'sortOrder' },
  ],
  ledger_budget: [
    { label: '预算范围', path: 'scope' },
    { label: '预算金额', path: 'amountMinor' },
    { label: '预算币种', path: 'currency' },
    { label: '费用类别', path: 'category' },
    { label: '预算日期', path: 'date' },
  ],
  ledger_expense: [
    { label: '费用名称', path: 'title' },
    { label: '发生日期', path: 'date' },
    { label: '费用类别', path: 'category' },
    { label: '确认状态', path: 'status' },
    { label: '金额', path: 'amountMinor' },
    { label: '币种', path: 'currency' },
    { label: '付款人', path: 'payerParticipantId' },
    { label: '分摊方式', path: 'splitMode' },
    { label: '分摊参与人', path: 'splitShares' },
    { label: '费用来源', path: 'source' },
    { label: '汇率快照', path: 'exchangeRate' },
    { label: '重复确认', path: 'duplicateAcknowledged' },
    { label: '备注', notes: true, path: 'notes' },
  ],
  ledger_participant: [
    { label: '姓名', path: 'displayName' },
    { label: '本人', path: 'isSelf' },
    { label: '来源', path: 'source' },
    { label: '来源标识', path: 'sourceId' },
  ],
  ledger_settings: [
    { label: '常住地币种', path: 'homeCurrency' },
    { label: '旅行币种', path: 'tripCurrency' },
    { label: '结算币种', path: 'settlementCurrency' },
  ],
  ticket_meta: [
    { label: '绑定行程点', path: 'itemId' },
    { label: '票据范围', path: 'scope' },
    { label: '标题', path: 'title' },
    { label: '存储方式', path: 'storageMode' },
    { label: '外部链接', path: 'externalUrl' },
    { label: '参考位置', path: 'referenceLocation' },
    { label: '票据分类', path: 'ticketCategory' },
    { label: '文件名', path: 'fileName' },
    { label: '文件类型', path: 'fileType' },
    { label: 'MIME 类型', path: 'mimeType' },
    { label: '大小', path: 'size' },
    { label: '备注', notes: true, path: 'note' },
  ],
  trip: [
    { label: '标题', path: 'title' },
    { label: '目的地', path: 'destination' },
    { label: '开始日期', path: 'startDate' },
    { label: '结束日期', path: 'endDate' },
    { label: '默认时区', path: 'timeZone' },
    { label: '默认时区来源', path: 'timeZoneSource' },
    { label: '备注', notes: true, path: 'notes' },
  ],
}

export function mergeObjectPayloadFields({
  basePayload,
  localPayload,
  now = Date.now(),
  objectType,
  remotePayload,
}: {
  basePayload?: SyncObjectPayload
  localPayload: SyncObjectPayload
  now?: number
  objectType: SyncObjectType
  remotePayload: SyncObjectPayload
}): ObjectFieldMergeResult {
  const next = clonePayload(localPayload)
  const conflicts: ObjectSyncConflictField[] = []
  let changed = false

  for (const field of FIELD_DEFS[objectType]) {
    const baseValue = getFieldValue(basePayload, field.path)
    const localValue = getFieldValue(localPayload, field.path)
    const remoteValue = getFieldValue(remotePayload, field.path)
    const localChanged = !isSameJsonValue(localValue, baseValue)
    const remoteChanged = !isSameJsonValue(remoteValue, baseValue)

    if (!localChanged && !remoteChanged) {
      continue
    }
    if (localChanged && !remoteChanged) {
      continue
    }
    if (!localChanged && remoteChanged) {
      setFieldValue(next, field.path, remoteValue)
      changed = true
      continue
    }
    if (isSameJsonValue(localValue, remoteValue)) {
      continue
    }

    if (field.notes) {
      const merged = mergeAppendOnlyText(baseValue, localValue, remoteValue)
      if (merged != null) {
        setFieldValue(next, field.path, merged)
        changed = true
        continue
      }
    }

    conflicts.push({
      allowNotesMerge: Boolean(field.notes && typeof localValue === 'string' && typeof remoteValue === 'string'),
      baseValue,
      defaultResolution: 'local',
      fieldPath: field.path,
      label: field.label,
      localValue,
      remoteValue,
    })
  }

  if (conflicts.length > 0) {
    return { conflicts, status: 'conflict' }
  }

  if (objectType === 'item') {
    const localItem = localPayload as ItineraryItem
    const nextItem = next as ItineraryItem
    if (nextItem.dayId !== localItem.dayId && nextItem.executionState) {
      nextItem.executionState = undefined
      changed = true
    }
  }

  if (changed) {
    touchPayload(next, objectType, now)
  }
  return { changed, conflicts: [], payload: next, status: 'merged' }
}

export function resolveObjectSyncConflictPayload(
  conflict: ObjectSyncConflict,
  input: ObjectConflictResolutionInput,
  now = Date.now(),
): ObjectConflictResolutionResult {
  if (conflict.conflictType !== 'field_conflict') {
    if (input.deleteResolution === 'delete') {
      return { operation: 'delete' }
    }
    const payload = clonePayload(conflict.localPayload ?? conflict.remotePayload)
    if (!payload) {
      throw new Error('冲突缺少可保留的对象版本。')
    }
    touchPayload(payload, conflict.objectType, now)
    return { operation: 'upsert', payload }
  }

  const base = conflict.localPayload ?? conflict.remotePayload
  const payload = clonePayload(base)
  if (!payload) {
    throw new Error('冲突缺少可解决的对象版本。')
  }

  for (const field of conflict.fields) {
    const resolution = input.fieldResolutions?.[field.fieldPath] ?? field.defaultResolution
    if (resolution === 'remote') {
      setFieldValue(payload, field.fieldPath, field.remoteValue)
    } else if (resolution === 'merge_notes') {
      const merged = mergeNotesForResolution(field.localValue, field.remoteValue)
      setFieldValue(payload, field.fieldPath, merged)
    } else {
      setFieldValue(payload, field.fieldPath, field.localValue)
    }
  }

  if (conflict.objectType === 'item') {
    const localItem = conflict.localPayload as ItineraryItem | undefined
    const nextItem = payload as ItineraryItem
    if (localItem && nextItem.dayId !== localItem.dayId) {
      nextItem.executionState = undefined
    }
  }

  touchPayload(payload, conflict.objectType, now)
  return { operation: 'upsert', payload }
}

export function buildObjectConflictLabel(objectType: SyncObjectType, payload?: SyncObjectPayload) {
  if (!payload) {
    return `${getObjectTypeLabel(objectType)} ${objectType}`
  }
  if (objectType === 'trip') {
    return (payload as Trip).title || '旅行'
  }
  if (objectType === 'day') {
    const day = payload as Day
    return day.title ? `${day.date} ${day.title}` : day.date
  }
  if (objectType === 'item') {
    const item = payload as ItineraryItem
    return item.title || item.locationName || '行程点'
  }
  if (objectType === 'ledger_settings') return '旅行账本设置'
  if (objectType === 'ledger_participant') return (payload as LedgerParticipant).displayName || '账本参与人'
  if (objectType === 'ledger_budget') return '旅行预算'
  if (objectType === 'ledger_expense') return (payload as LedgerExpense).title || '旅行费用'
  const ticket = payload as TicketMeta
  return ticket.title || ticket.fileName || '票据'
}

export function getObjectTypeLabel(objectType: SyncObjectType) {
  if (objectType === 'trip') return '旅行'
  if (objectType === 'day') return '日期'
  if (objectType === 'item') return '行程点'
  if (objectType === 'ledger_settings') return '账本设置'
  if (objectType === 'ledger_participant') return '账本参与人'
  if (objectType === 'ledger_budget') return '旅行预算'
  if (objectType === 'ledger_expense') return '旅行费用'
  return '票据'
}

export function isSameJsonValue(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function mergeAppendOnlyText(baseValue: unknown, localValue: unknown, remoteValue: unknown) {
  const base = typeof baseValue === 'string' ? baseValue : ''
  const local = typeof localValue === 'string' ? localValue : ''
  const remote = typeof remoteValue === 'string' ? remoteValue : ''
  if (!local.startsWith(base) || !remote.startsWith(base)) {
    return null
  }
  const localSuffix = local.slice(base.length)
  const remoteSuffix = remote.slice(base.length)
  if (!localSuffix && !remoteSuffix) return local
  if (!localSuffix) return remote
  if (!remoteSuffix) return local
  if (localSuffix === remoteSuffix) return local
  return joinTextParts([base, localSuffix, remoteSuffix])
}

function mergeNotesForResolution(localValue: unknown, remoteValue: unknown) {
  return joinTextParts([
    typeof localValue === 'string' ? localValue : formatConflictValue(localValue),
    typeof remoteValue === 'string' ? remoteValue : formatConflictValue(remoteValue),
  ])
}

export function formatConflictValue(value: unknown) {
  if (value == null || value === '') return '（空）'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function joinTextParts(parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
}

function getFieldValue(payload: SyncObjectPayload | undefined, path: string) {
  if (!payload) return undefined
  return (payload as Record<string, unknown>)[path]
}

function setFieldValue(payload: SyncObjectPayload, path: string, value: unknown) {
  const record = payload as Record<string, unknown>
  if (value === undefined) {
    delete record[path]
  } else {
    record[path] = value
  }
}

function clonePayload<T extends SyncObjectPayload | undefined>(payload: T): T {
  if (!payload) return payload
  return JSON.parse(JSON.stringify(payload)) as T
}

function touchPayload(payload: SyncObjectPayload, objectType: SyncObjectType, now: number) {
  if (objectType !== 'day') {
    ;(payload as Trip | ItineraryItem | TicketMeta | LedgerSettings | LedgerParticipant | LedgerBudget | LedgerExpense).updatedAt = now
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((next, key) => {
        next[key] = sortJson(record[key])
        return next
      }, {})
  }
  return value
}
