import type { JsonObject, JsonValue } from './contract'

const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const TRANSPORT_MODES = new Set(['walk', 'transit', 'bus', 'car', 'train', 'flight', 'other'])
const EXECUTION_STATUSES = new Set(['completed', 'skipped'])
const REPLAN_STRATEGIES = new Set(['least_change', 'preserve_most', 'shortest_route'])
const CHANGE_TYPES = new Set(['time_changed', 'day_changed', 'reordered', 'skipped', 'unchanged'])
const TICKET_IMPACTS = new Set(['fixed', 'time_warning', 'skip_warning', 'unaffected'])
const LEDGER_IMPACTS = new Set(['review_needed', 'possible_refund', 'unaffected'])
const BASELINE_OBJECT_TYPES = new Set(['trip', 'day', 'item', 'ticket_meta', 'ledger_expense'])

const TRIP_FIELDS = new Set([
  'createdAt', 'destination', 'endDate', 'id', 'notes', 'restoredAt',
  'restoredFromCloudBackupId', 'restoredFromCloudExportedAt',
  'restoredFromCloudOriginalTripId', 'startDate', 'timeZone', 'timeZoneSource',
  'title', 'updatedAt',
])
const DAY_FIELDS = new Set(['date', 'id', 'sortOrder', 'timeZone', 'timeZoneSource', 'title', 'tripId'])
const ITEM_FIELDS = new Set([
  'address', 'contentEnrichment', 'createdAt', 'dayId', 'endDate', 'endTime',
  'endTimeZone', 'executionState', 'id', 'lat', 'lng', 'locationName', 'notes',
  'previousTransportDurationMinutes', 'previousTransportMode',
  'previousTransportNote', 'replanPreference', 'sortOrder', 'startTime',
  'startTimeZone', 'ticketIds', 'title', 'transportMode', 'tripId', 'updatedAt',
])
const EVENT_FIELDS = new Set([
  'createdAt', 'dayId', 'delayMinutes', 'evidence', 'id', 'itemId', 'kind',
  'notes', 'occurredAt', 'reportedByRole', 'status', 'tripId', 'updatedAt',
])
const RECORD_FIELDS = new Set([
  'accountObjectBaseline', 'afterSnapshot', 'appliedFingerprint',
  'baselineFingerprint', 'beforeSnapshot', 'createdAt', 'eventId', 'evidence',
  'id', 'operationFingerprint', 'operationKind', 'options', 'scopeItemIds',
  'selectedDiff', 'selectedOptionId', 'status', 'tripId', 'updatedAt',
])
const HISTORY_FIELDS = new Set([
  'actionType', 'dedupeKey', 'detail', 'executionId', 'executionSource',
  'executionStatus', 'executionTitle', 'id', 'occurredAt', 'privacyLevel',
  'recommendationFingerprints', 'sourceId', 'sourceKind', 'sourceLabel',
  'targetId', 'targetType', 'title', 'tripId', 'updatedAt',
])

export function assertAdaptiveReplanTripPayload(payload: JsonObject) {
  onlyFields(payload, TRIP_FIELDS)
  controlledId(payload.id)
  boundedString(payload.title, 500)
  boundedString(payload.destination, 500)
  boundedString(payload.startDate, 32)
  boundedString(payload.endDate, 32)
  timestamp(payload.createdAt)
  timestamp(payload.updatedAt)
}

export function assertAdaptiveReplanItemPayload(payload: JsonObject) {
  assertItem(payload)
}

export function assertAdaptiveReplanEventPayload(payload: JsonObject) {
  onlyFields(payload, EVENT_FIELDS)
  controlledId(payload.id)
  controlledId(payload.tripId)
  optionalControlledId(payload.dayId)
  optionalControlledId(payload.itemId)
  enumValue(payload.kind, new Set(['delay', 'closure', 'weather_unsuitable', 'late', 'cancelled']))
  exact(payload.status, 'applied')
  exact(payload.reportedByRole, 'owner')
  isoTimestamp(payload.occurredAt)
  optionalInteger(payload.delayMinutes, 1, 1_440)
  optionalBoundedString(payload.notes, 500)
  if (!Array.isArray(payload.evidence) || payload.evidence.length !== 0) fail()
  timestamp(payload.createdAt)
  timestamp(payload.updatedAt)
  if (payload.updatedAt !== payload.createdAt) fail()
}

export function assertAdaptiveReplanRecordPayload(payload: JsonObject) {
  onlyFields(payload, RECORD_FIELDS)
  controlledId(payload.id)
  controlledId(payload.tripId)
  controlledId(payload.eventId)
  exact(payload.operationKind, 'adaptive_replan')
  controlledId(payload.operationFingerprint)
  exact(payload.status, 'applied')
  boundedString(payload.baselineFingerprint, 524_288)
  boundedString(payload.appliedFingerprint, 524_288)
  timestamp(payload.createdAt)
  timestamp(payload.updatedAt)
  if (payload.updatedAt !== payload.createdAt) fail()
  const scopeItemIds = controlledIdList(payload.scopeItemIds, 1, 124)
  controlledId(payload.selectedOptionId)
  const evidence = array(payload.evidence, 1, 1)
  const source = object(evidence[0])
  onlyFields(source, new Set(['id', 'kind', 'label', 'retrievedAt', 'snippet', 'sourceType']))
  controlledId(source.id)
  exact(source.kind, 'user_report')
  exact(source.label, '用户报告')
  isoTimestamp(source.retrievedAt)
  optionalBoundedString(source.snippet, 500)
  exact(source.sourceType, 'unknown')
  const baseline = array(payload.accountObjectBaseline, 1, 512)
  const baselineKeys = new Set<string>()
  for (const entry of baseline) {
    const record = object(entry)
    onlyFields(record, new Set(['expectedRevision', 'objectId', 'objectType']))
    controlledId(record.objectId)
    enumValue(record.objectType, BASELINE_OBJECT_TYPES)
    integer(record.expectedRevision, 1, Number.MAX_SAFE_INTEGER)
    const key = `${record.objectType}:${record.objectId}`
    if (baselineKeys.has(key)) fail()
    baselineKeys.add(key)
  }
  const beforeSnapshot = assertSnapshot(payload.beforeSnapshot, payload.tripId as string)
  const afterSnapshot = assertSnapshot(payload.afterSnapshot, payload.tripId as string)
  if (!sameSet(scopeItemIds, afterSnapshot.itemIds)) fail()
  if (!scopeItemIds.every((id) => beforeSnapshot.itemIds.includes(id))) fail()
  const options = array(payload.options, 3, 3).map(assertOption)
  if (new Set(options.map((option) => option.strategy)).size !== 3) fail()
  const selected = options.find((option) => option.id === payload.selectedOptionId)
  if (
    !selected
    || !sameJson(selected.diff, payload.selectedDiff)
    || !sameSet(scopeItemIds, selected.changedItemIds)
    || !sameSet(scopeItemIds, selected.itemPatches.map((entry) => entry.itemId))
  ) fail()

  const beforeById = new Map(beforeSnapshot.items.map((item) => [item.id as string, item]))
  const patchById = new Map(selected.itemPatches.map((entry) => [entry.itemId, entry.patch]))
  for (const after of afterSnapshot.items) {
    const itemId = after.id as string
    const before = beforeById.get(itemId)
    const patch = patchById.get(itemId)
    if (!before || !patch) fail()
    const expected: JsonObject = {
      ...before,
      ...patch,
      ...(patch.executionState
        ? {
            executionState: {
              ...object(patch.executionState),
              updatedAt: payload.createdAt,
            },
          }
        : {}),
      updatedAt: payload.createdAt,
    }
    if (!sameJson(expected, after)) fail()
  }
}

export function assertAdaptiveReplanHistoryPayload(payload: JsonObject) {
  onlyFields(payload, HISTORY_FIELDS)
  controlledId(payload.id)
  controlledId(payload.tripId)
  exact(payload.actionType, 'global_ai_adaptive_replan_applied')
  boundedString(payload.dedupeKey, 500)
  controlledId(payload.executionId)
  exact(payload.executionSource, 'live')
  exact(payload.executionStatus, 'success')
  boundedString(payload.executionTitle, 200)
  timestamp(payload.occurredAt)
  exact(payload.privacyLevel, 'private')
  const fingerprints = array(payload.recommendationFingerprints, 0, 50)
  fingerprints.forEach(controlledId)
  controlledId(payload.sourceId)
  exact(payload.sourceKind, 'live')
  optionalBoundedString(payload.sourceLabel, 200)
  controlledId(payload.targetId)
  exact(payload.targetType, 'live')
  boundedString(payload.title, 200)
  optionalBoundedString(payload.detail, 500)
  timestamp(payload.updatedAt)
  if (payload.updatedAt !== payload.occurredAt) fail()
}

function assertSnapshot(value: JsonValue | undefined, tripId: string) {
  const snapshot = object(value)
  onlyFields(snapshot, new Set(['days', 'items']))
  const days = array(snapshot.days, 1, 128).map((entry) => {
    const day = object(entry)
    onlyFields(day, DAY_FIELDS)
    controlledId(day.id)
    exact(day.tripId, tripId)
    boundedString(day.date, 32)
    boundedString(day.title, 500)
    integer(day.sortOrder, 0, Number.MAX_SAFE_INTEGER)
    return day
  })
  const dayIds = new Set(days.map((day) => day.id as string))
  if (dayIds.size !== days.length) fail()
  const items = array(snapshot.items, 1, 124).map((entry) => {
    const item = object(entry)
    assertItem(item)
    exact(item.tripId, tripId)
    if (!dayIds.has(item.dayId as string)) fail()
    return item
  })
  const itemIds = items.map((item) => item.id as string)
  if (new Set(itemIds).size !== itemIds.length) fail()
  return { items, itemIds }
}

function assertItem(payload: JsonObject) {
  onlyFields(payload, ITEM_FIELDS)
  controlledId(payload.id)
  controlledId(payload.tripId)
  controlledId(payload.dayId)
  boundedString(payload.title, 500)
  controlledIdList(payload.ticketIds, 0, 128)
  integer(payload.sortOrder, 0, Number.MAX_SAFE_INTEGER)
  timestamp(payload.createdAt)
  timestamp(payload.updatedAt)
  if (payload.executionState !== undefined) {
    const state = object(payload.executionState)
    onlyFields(state, new Set(['status', 'updatedAt']))
    enumValue(state.status, EXECUTION_STATUSES)
    timestamp(state.updatedAt)
  }
  optionalEnum(payload.previousTransportMode, TRANSPORT_MODES)
  optionalInteger(payload.previousTransportDurationMinutes, 0, 100_000)
  optionalBoundedString(payload.previousTransportNote, 2_000)
}

function assertOption(value: JsonValue) {
  const option = object(value)
  onlyFields(option, new Set(['diff', 'id', 'itemPatches', 'score', 'strategy', 'summary', 'title']))
  controlledId(option.id)
  enumValue(option.strategy, REPLAN_STRATEGIES)
  boundedString(option.title, 200)
  boundedString(option.summary, 2_000)
  finiteNumber(option.score)
  const patches = array(option.itemPatches, 0, 124)
  const itemPatches: Array<{ itemId: string; patch: JsonObject }> = []
  const patchIds = new Set<string>()
  for (const value of patches) {
    const entry = object(value)
    onlyFields(entry, new Set(['itemId', 'patch']))
    controlledId(entry.itemId)
    if (patchIds.has(entry.itemId as string)) fail()
    patchIds.add(entry.itemId as string)
    const patch = object(entry.patch)
    onlyFields(patch, new Set([
      'dayId', 'endTime', 'executionState', 'previousTransportDurationMinutes',
      'previousTransportMode', 'previousTransportNote', 'sortOrder', 'startTime',
    ]))
    if (Object.keys(patch).length === 0) fail()
    optionalControlledId(patch.dayId)
    optionalInteger(patch.sortOrder, 0, Number.MAX_SAFE_INTEGER)
    optionalEnum(patch.previousTransportMode, TRANSPORT_MODES)
    optionalInteger(patch.previousTransportDurationMinutes, 0, 100_000)
    optionalBoundedString(patch.previousTransportNote, 2_000)
    if (patch.executionState !== undefined) {
      const state = object(patch.executionState)
      onlyFields(state, new Set(['status', 'updatedAt']))
      enumValue(state.status, EXECUTION_STATUSES)
      timestamp(state.updatedAt)
    }
    itemPatches.push({ itemId: entry.itemId as string, patch })
  }
  const diff = assertDiff(option.diff)
  const changedItemIds = (diff.itemChanges as JsonObject[])
    .filter((change) => change.changeType !== 'unchanged')
    .map((change) => change.itemId as string)
  return { changedItemIds, diff, id: option.id, itemPatches, strategy: option.strategy }
}

function assertDiff(value: JsonValue | undefined) {
  const diff = object(value)
  onlyFields(diff, new Set([
    'companionImpacts', 'itemChanges', 'ledgerImpacts', 'routeImpacts',
    'ticketImpacts', 'warnings',
  ]))
  const itemChangeIds = new Set<string>()
  array(diff.itemChanges, 1, 128).forEach((value) => {
    const change = object(value)
    onlyFields(change, new Set(['after', 'before', 'changeType', 'itemId', 'reason', 'title']))
    controlledId(change.itemId)
    if (itemChangeIds.has(change.itemId as string)) fail()
    itemChangeIds.add(change.itemId as string)
    enumValue(change.changeType, CHANGE_TYPES)
    boundedString(change.title, 500)
    boundedString(change.reason, 2_000)
    assertSchedule(change.before)
    assertSchedule(change.after)
  })
  array(diff.routeImpacts, 0, 128).forEach((value) => {
    const impact = object(value)
    onlyFields(impact, new Set([
      'afterTravelMinutes', 'beforeTravelMinutes', 'dayId', 'deltaMinutes',
      'itemIds', 'staleRouteCache', 'summary',
    ]))
    controlledId(impact.dayId)
    controlledIdList(impact.itemIds, 0, 128)
    optionalFiniteNumber(impact.beforeTravelMinutes)
    optionalFiniteNumber(impact.afterTravelMinutes)
    optionalFiniteNumber(impact.deltaMinutes)
    if (typeof impact.staleRouteCache !== 'boolean') fail()
    boundedString(impact.summary, 2_000)
  })
  array(diff.ticketImpacts, 0, 128).forEach((value) => {
    const impact = object(value)
    onlyFields(impact, new Set(['impact', 'itemId', 'summary', 'ticketId', 'title']))
    controlledId(impact.ticketId)
    optionalControlledId(impact.itemId)
    enumValue(impact.impact, TICKET_IMPACTS)
    boundedString(impact.title, 500)
    boundedString(impact.summary, 2_000)
  })
  array(diff.ledgerImpacts, 0, 128).forEach((value) => {
    const impact = object(value)
    onlyFields(impact, new Set(['expenseId', 'impact', 'itemIds', 'summary', 'title']))
    controlledId(impact.expenseId)
    controlledIdList(impact.itemIds, 0, 128)
    enumValue(impact.impact, LEDGER_IMPACTS)
    boundedString(impact.title, 500)
    boundedString(impact.summary, 2_000)
  })
  array(diff.companionImpacts, 0, 128).forEach((value) => {
    const impact = object(value)
    onlyFields(impact, new Set(['itemId', 'meetingTime', 'summary', 'title']))
    optionalControlledId(impact.itemId)
    optionalBoundedString(impact.meetingTime, 32)
    boundedString(impact.title, 500)
    boundedString(impact.summary, 2_000)
  })
  array(diff.warnings, 0, 128).forEach((warning) => boundedString(warning, 2_000))
  return diff
}

function assertSchedule(value: JsonValue | undefined) {
  const schedule = object(value)
  onlyFields(schedule, new Set(['dayId', 'endTime', 'executionState', 'sortOrder', 'startTime']))
  controlledId(schedule.dayId)
  integer(schedule.sortOrder, 0, Number.MAX_SAFE_INTEGER)
  optionalBoundedString(schedule.startTime, 32)
  optionalBoundedString(schedule.endTime, 32)
  if (schedule.executionState !== undefined) {
    const state = object(schedule.executionState)
    onlyFields(state, new Set(['status', 'updatedAt']))
    enumValue(state.status, EXECUTION_STATUSES)
    optionalInteger(state.updatedAt, 0, Number.MAX_SAFE_INTEGER)
  }
}

function object(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as JsonObject
}

function array(value: JsonValue | undefined, min: number, max: number): JsonValue[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail()
  return value
}

function onlyFields(value: JsonObject, fields: Set<string>) {
  if (Object.keys(value).some((key) => !fields.has(key))) fail()
}

function controlledId(value: JsonValue | undefined) {
  if (typeof value !== 'string' || !CONTROLLED_ID.test(value)) fail()
}

function optionalControlledId(value: JsonValue | undefined) {
  if (value !== undefined) controlledId(value)
}

function controlledIdList(value: JsonValue | undefined, min: number, max: number) {
  const values = array(value, min, max)
  values.forEach(controlledId)
  const result = values as string[]
  if (new Set(result).size !== result.length) fail()
  return result
}

function boundedString(value: JsonValue | undefined, max: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail()
}

function optionalBoundedString(value: JsonValue | undefined, max: number) {
  if (value !== undefined) boundedString(value, max)
}

function integer(value: JsonValue | undefined, min: number, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail()
}

function optionalInteger(value: JsonValue | undefined, min: number, max: number) {
  if (value !== undefined) integer(value, min, max)
}

function timestamp(value: JsonValue | undefined) {
  integer(value, 0, Number.MAX_SAFE_INTEGER)
}

function isoTimestamp(value: JsonValue | undefined) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) fail()
}

function finiteNumber(value: JsonValue | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail()
}

function optionalFiniteNumber(value: JsonValue | undefined) {
  if (value !== undefined) finiteNumber(value)
}

function enumValue(value: JsonValue | undefined, allowed: Set<string>) {
  if (typeof value !== 'string' || !allowed.has(value)) fail()
}

function optionalEnum(value: JsonValue | undefined, allowed: Set<string>) {
  if (value !== undefined) enumValue(value, allowed)
}

function exact(value: JsonValue | undefined, expected: JsonValue) {
  if (value !== expected) fail()
}

function sameSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function sameJson(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function fail(): never {
  throw new Error('invalid_adaptive_replan_payload')
}
