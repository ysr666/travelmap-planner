export type AccountLedgerObjectType =
  | 'ledger_settings'
  | 'ledger_participant'
  | 'ledger_budget'
  | 'ledger_expense'

export class AccountLedgerPayloadError extends Error {
  constructor() {
    super('invalid_ledger_payload')
    this.name = 'AccountLedgerPayloadError'
  }
}

const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const CURRENCY = /^[A-Z]{3}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^([1-9]\d{3})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/
const EXPENSE_CATEGORIES = new Set([
  'lodging',
  'transport',
  'admission',
  'food',
  'shopping',
  'insurance',
  'connectivity',
  'other',
])
const EXPENSE_STATUSES = new Set(['draft', 'confirmed', 'void'])
const SPLIT_MODES = new Set(['equal', 'exclude', 'weights'])
const BUDGET_SCOPES = new Set(['trip', 'category', 'date'])
const SOURCE_KINDS = new Set(['manual', 'ticket', 'inbox', 'transport_booking', 'itinerary_note'])
const SOURCE_ROLES = new Set([
  'order_confirmation',
  'payment_receipt',
  'invoice',
  'credit_card_notice',
  'cancellation_notice',
  'refund_notice',
  'other',
])
const LINE_ITEM_KINDS = new Set(['base', 'tax', 'tip', 'discount', 'refund', 'other'])
const PAYMENT_STATUSES = new Set(['unknown', 'unpaid', 'paid', 'partially_refunded', 'refunded'])
const ORDER_STATUSES = new Set(['active', 'cancelled'])
const REVIEW_STATUSES = new Set(['unreviewed', 'auto_confirmed', 'reviewed', 'needs_review'])
const PARTICIPANT_SOURCES = new Set(['manual', 'shared_trip', 'traveler_profile'])

const SETTINGS_FIELDS = new Set([
  'id',
  'tripId',
  'homeCurrency',
  'tripCurrency',
  'settlementCurrency',
  'createdAt',
  'updatedAt',
])
const PARTICIPANT_FIELDS = new Set([
  'id',
  'tripId',
  'displayName',
  'isSelf',
  'source',
  'sourceId',
  'createdAt',
  'updatedAt',
])
const BUDGET_FIELDS = new Set([
  'id',
  'tripId',
  'scope',
  'amountMinor',
  'currency',
  'category',
  'date',
  'createdAt',
  'updatedAt',
])
const EXPENSE_FIELDS = new Set([
  'id',
  'tripId',
  'title',
  'date',
  'category',
  'status',
  'amountMinor',
  'currency',
  'payerParticipantId',
  'splitMode',
  'splitShares',
  'source',
  'sourceLinks',
  'lineItems',
  'merchant',
  'city',
  'orderNumber',
  'itemIds',
  'bookedAt',
  'paidAt',
  'serviceStartAt',
  'serviceEndAt',
  'cancelledAt',
  'refundedAt',
  'paymentStatus',
  'orderStatus',
  'reviewStatus',
  'recognitionConfidence',
  'autoConfirmReason',
  'originalExpenseId',
  'exchangeRate',
  'duplicateAcknowledged',
  'notes',
  'createdAt',
  'updatedAt',
])

export function assertAccountLedgerPayload(
  objectType: AccountLedgerObjectType,
  input: unknown,
): asserts input is Record<string, unknown> {
  const payload = record(input)
  if (objectType === 'ledger_settings') assertSettings(payload)
  else if (objectType === 'ledger_participant') assertParticipant(payload)
  else if (objectType === 'ledger_budget') assertBudget(payload)
  else assertExpense(payload)
}

export function isAccountLedgerPayloadValid(
  objectType: AccountLedgerObjectType,
  input: unknown,
) {
  try {
    assertAccountLedgerPayload(objectType, input)
    return true
  } catch {
    return false
  }
}

function assertSettings(payload: Record<string, unknown>) {
  onlyFields(payload, SETTINGS_FIELDS)
  assertIdentityAndTimestamps(payload)
  if (
    !isCurrency(payload.homeCurrency)
    || !isCurrency(payload.tripCurrency)
    || !isCurrency(payload.settlementCurrency)
  ) fail()
}

function assertParticipant(payload: Record<string, unknown>) {
  onlyFields(payload, PARTICIPANT_FIELDS)
  assertIdentityAndTimestamps(payload)
  if (
    !isBoundedString(payload.displayName, 1, 160)
    || !isOptionalBoolean(payload.isSelf)
    || !isOptionalEnum(payload.source, PARTICIPANT_SOURCES)
    || !isOptionalControlledId(payload.sourceId)
    || (payload.sourceId !== undefined && payload.source === 'manual')
  ) fail()
}

function assertBudget(payload: Record<string, unknown>) {
  onlyFields(payload, BUDGET_FIELDS)
  assertIdentityAndTimestamps(payload)
  if (
    !isEnum(payload.scope, BUDGET_SCOPES)
    || !isSafeInteger(payload.amountMinor, 0)
    || !isCurrency(payload.currency)
    || !isOptionalEnum(payload.category, EXPENSE_CATEGORIES)
    || !isOptionalDate(payload.date)
  ) fail()
  if (payload.scope === 'trip' && (payload.category !== undefined || payload.date !== undefined)) fail()
  if (payload.scope === 'category' && (!isEnum(payload.category, EXPENSE_CATEGORIES) || payload.date !== undefined)) fail()
  if (payload.scope === 'date' && (!isDate(payload.date) || payload.category !== undefined)) fail()
}

function assertExpense(payload: Record<string, unknown>) {
  onlyFields(payload, EXPENSE_FIELDS)
  assertIdentityAndTimestamps(payload)
  if (
    !isBoundedString(payload.title, 1, 500)
    || !isDate(payload.date)
    || !isEnum(payload.category, EXPENSE_CATEGORIES)
    || !isEnum(payload.status, EXPENSE_STATUSES)
    || !isOptionalSafeInteger(payload.amountMinor)
    || !isOptionalCurrency(payload.currency)
    || !isOptionalControlledId(payload.payerParticipantId)
    || !isEnum(payload.splitMode, SPLIT_MODES)
    || !isSource(payload.source)
    || !isOptionalBoundedString(payload.merchant, 1, 500)
    || !isOptionalBoundedString(payload.city, 1, 500)
    || !isOptionalBoundedString(payload.orderNumber, 1, 500)
    || !isOptionalTimestamp(payload.bookedAt)
    || !isOptionalTimestamp(payload.paidAt)
    || !isOptionalTimestamp(payload.serviceStartAt)
    || !isOptionalTimestamp(payload.serviceEndAt)
    || !isOptionalTimestamp(payload.cancelledAt)
    || !isOptionalTimestamp(payload.refundedAt)
    || !isOptionalEnum(payload.paymentStatus, PAYMENT_STATUSES)
    || !isOptionalEnum(payload.orderStatus, ORDER_STATUSES)
    || !isOptionalEnum(payload.reviewStatus, REVIEW_STATUSES)
    || !isOptionalNumberBetween(payload.recognitionConfidence, 0, 1)
    || !isOptionalBoundedString(payload.autoConfirmReason, 1, 500)
    || !isOptionalControlledId(payload.originalExpenseId)
    || payload.originalExpenseId === payload.id
    || !isOptionalBoolean(payload.duplicateAcknowledged)
    || !isOptionalBoundedText(payload.notes, 4_000)
    || !isSplitShares(payload.splitShares)
    || !isOptionalControlledIdList(payload.itemIds, 256)
    || !isOptionalSourceLinks(payload.sourceLinks)
    || !isOptionalLineItems(payload.lineItems)
    || !isOptionalExchangeRate(payload.exchangeRate)
    || (payload.amountMinor !== undefined && payload.currency === undefined)
  ) fail()
}

function assertIdentityAndTimestamps(payload: Record<string, unknown>) {
  if (
    !isControlledId(payload.id)
    || !isControlledId(payload.tripId)
    || !isSafeInteger(payload.createdAt, 0)
    || !isSafeInteger(payload.updatedAt, payload.createdAt as number)
  ) fail()
}

function isSplitShares(input: unknown) {
  if (!Array.isArray(input) || input.length > 128) return false
  const participantIds = new Set<string>()
  return input.every((value) => {
    const share = maybeRecord(value)
    if (!share || !hasOnlyFields(share, new Set(['participantId', 'weight']))) return false
    if (!isControlledId(share.participantId) || participantIds.has(share.participantId as string)) return false
    participantIds.add(share.participantId as string)
    return typeof share.weight === 'number'
      && Number.isFinite(share.weight)
      && share.weight > 0
      && share.weight <= Number.MAX_SAFE_INTEGER
  })
}

function isOptionalSourceLinks(input: unknown) {
  if (input === undefined) return true
  if (!Array.isArray(input) || input.length > 128) return false
  const ids = new Set<string>()
  return input.every((value) => {
    const link = maybeRecord(value)
    if (!link || !hasOnlyFields(link, new Set([
      'id', 'kind', 'sourceId', 'label', 'fingerprint', 'role', 'title', 'capturedAt', 'available',
    ]))) return false
    if (!isControlledId(link.id) || ids.has(link.id as string)) return false
    ids.add(link.id as string)
    return hasValidSourceFields(link)
      && isEnum(link.role, SOURCE_ROLES)
      && isOptionalBoundedString(link.title, 1, 500)
      && isOptionalTimestamp(link.capturedAt)
      && isOptionalBoolean(link.available)
  })
}

function isOptionalLineItems(input: unknown) {
  if (input === undefined) return true
  if (!Array.isArray(input) || input.length > 256) return false
  const ids = new Set<string>()
  return input.every((value) => {
    const item = maybeRecord(value)
    if (!item || !hasOnlyFields(item, new Set(['id', 'title', 'kind', 'category', 'amountMinor', 'currency']))) return false
    if (!isControlledId(item.id) || ids.has(item.id as string)) return false
    ids.add(item.id as string)
    return isBoundedString(item.title, 1, 500)
      && isEnum(item.kind, LINE_ITEM_KINDS)
      && isEnum(item.category, EXPENSE_CATEGORIES)
      && isSafeInteger(item.amountMinor)
      && isCurrency(item.currency)
  })
}

function isOptionalExchangeRate(input: unknown) {
  if (input === undefined) return true
  const rate = maybeRecord(input)
  if (!rate || !hasOnlyFields(rate, new Set([
    'requestedDate',
    'effectiveDate',
    'baseCurrency',
    'tripCurrency',
    'homeCurrency',
    'rateToTrip',
    'rateToHome',
    'provider',
    'sourceUrl',
    'fetchedAt',
  ]))) return false
  return isDate(rate.requestedDate)
    && isDate(rate.effectiveDate)
    && isCurrency(rate.baseCurrency)
    && isCurrency(rate.tripCurrency)
    && isCurrency(rate.homeCurrency)
    && isPositiveDecimal(rate.rateToTrip)
    && isPositiveDecimal(rate.rateToHome)
    && (rate.provider === 'frankfurter' || rate.provider === 'manual')
    && isOptionalHttpsUrl(rate.sourceUrl)
    && isTimestamp(rate.fetchedAt)
}

function isSource(input: unknown) {
  const source = maybeRecord(input)
  return Boolean(source)
    && hasOnlyFields(source!, new Set(['kind', 'sourceId', 'label', 'fingerprint']))
    && hasValidSourceFields(source!)
}

function hasValidSourceFields(source: Record<string, unknown>) {
  return isEnum(source.kind, SOURCE_KINDS)
    && isOptionalControlledId(source.sourceId)
    && isOptionalBoundedString(source.label, 1, 500)
    && isOptionalBoundedString(source.fingerprint, 1, 500)
}

function isOptionalControlledIdList(input: unknown, maximum: number) {
  if (input === undefined) return true
  if (!Array.isArray(input) || input.length > maximum) return false
  const ids = new Set<string>()
  return input.every((value) => {
    if (!isControlledId(value) || ids.has(value as string)) return false
    ids.add(value as string)
    return true
  })
}

function onlyFields(payload: Record<string, unknown>, allowed: Set<string>) {
  if (!hasOnlyFields(payload, allowed)) fail()
}

function hasOnlyFields(payload: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(payload).every((field) => allowed.has(field))
}

function record(input: unknown) {
  const value = maybeRecord(input)
  if (!value) fail()
  return value
}

function maybeRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null
}

function isControlledId(input: unknown) {
  return typeof input === 'string' && CONTROLLED_ID.test(input)
}

function isOptionalControlledId(input: unknown) {
  return input === undefined || isControlledId(input)
}

function isCurrency(input: unknown) {
  return typeof input === 'string' && CURRENCY.test(input)
}

function isOptionalCurrency(input: unknown) {
  return input === undefined || isCurrency(input)
}

function isDate(input: unknown) {
  return typeof input === 'string' && DATE.test(input)
}

function isOptionalDate(input: unknown) {
  return input === undefined || isDate(input)
}

function isTimestamp(input: unknown) {
  if (!isBoundedString(input, 1, 100)) return false
  const match = TIMESTAMP.exec(input as string)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day
    && Number.isFinite(Date.parse(input as string))
}

function isOptionalTimestamp(input: unknown) {
  return input === undefined || isTimestamp(input)
}

function isSafeInteger(input: unknown, minimum = Number.MIN_SAFE_INTEGER) {
  return Number.isSafeInteger(input) && (input as number) >= minimum
}

function isOptionalSafeInteger(input: unknown) {
  return input === undefined || isSafeInteger(input)
}

function isEnum(input: unknown, values: Set<string>) {
  return typeof input === 'string' && values.has(input)
}

function isOptionalEnum(input: unknown, values: Set<string>) {
  return input === undefined || isEnum(input, values)
}

function isOptionalBoolean(input: unknown) {
  return input === undefined || typeof input === 'boolean'
}

function isOptionalNumberBetween(input: unknown, minimum: number, maximum: number) {
  return input === undefined
    || (typeof input === 'number' && Number.isFinite(input) && input >= minimum && input <= maximum)
}

function isBoundedString(input: unknown, minimum: number, maximum: number) {
  return typeof input === 'string'
    && input.length >= minimum
    && input.length <= maximum
    && !hasDisallowedControl(input, false)
}

function isOptionalBoundedString(input: unknown, minimum: number, maximum: number) {
  return input === undefined || isBoundedString(input, minimum, maximum)
}

function isOptionalBoundedText(input: unknown, maximum: number) {
  return input === undefined || (
    typeof input === 'string'
    && input.length <= maximum
    && !hasDisallowedControl(input, true)
  )
}

function hasDisallowedControl(input: string, allowLineBreaks: boolean) {
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    if (code === 127) return true
    if (code < 32 && !(allowLineBreaks && (code === 9 || code === 10 || code === 13))) return true
  }
  return false
}

function isPositiveDecimal(input: unknown) {
  return typeof input === 'string'
    && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,18})?$/.test(input)
    && Number(input) > 0
}

function isOptionalHttpsUrl(input: unknown) {
  if (input === undefined) return true
  if (!isBoundedString(input, 1, 2_048)) return false
  try {
    return new URL(input as string).protocol === 'https:'
  } catch {
    return false
  }
}

function fail(): never {
  throw new AccountLedgerPayloadError()
}
