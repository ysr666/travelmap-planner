import type {
  LedgerBudget,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerExpenseLineItem,
  LedgerExpenseSourceLink,
  LedgerExpenseStatus,
  LedgerParticipant,
  LedgerPaymentStatus,
  LedgerReviewStatus,
  LedgerSettings,
  LedgerSourceRole,
  Trip,
} from '../types'
import { resolveTripTimeZone } from './timeZone'
import { plainDateDaysBetween, todayInTimeZone } from './timeSemantics'
import { convertExpenseMinor, formatLedgerMoney, ledgerCategoryLabels, normalizeCurrencyCode } from './ledger'
import { canAutoConfirmLedgerCandidate, type LedgerExpenseDraftCandidate } from './ledgerExtraction'
import { buildLedgerReviewEntries, type LedgerReviewBucket } from './ledgerReview'

export type LedgerIntegrityIssueKind =
  | 'paid_without_receipt'
  | 'unlinked_itinerary'
  | 'missing_amount'
  | 'cancelled_not_reversed'
  | 'source_missing'
  | 'duplicate_conflict'
  | 'line_item_mismatch'

export type LedgerIntegrityIssue = {
  expenseId: string
  kind: LedgerIntegrityIssueKind
  message: string
  severity: 'warning' | 'error'
}

export type LedgerTimelineKind = 'booking' | 'payment' | 'service'

export type LedgerTimelineEvent = {
  id: string
  expenseId: string
  kind: LedgerTimelineKind
  at: string
  title: string
  amountMinor?: number
  currency?: string
  city?: string
}

export type LedgerForecast = {
  actualMinor: number
  knownFutureMinor: number
  projectedMinor: number
  dailyAvailableMinor: number
  remainingDays: number
  riskCategories: LedgerExpenseCategory[]
}

export type LedgerQueryCitation = {
  expenseId: string
  sourceId?: string
  sourceKind?: string
  title: string
  available: boolean
}

export type LedgerQueryResult = {
  answer: string
  expenseIds: string[]
  citations: LedgerQueryCitation[]
  groups?: Array<{ key: string; label: string; amountMinor: number; count: number }>
  missingExchangeRateCount?: number
  plan: LedgerQueryPlan
  totalMinor?: number
  currency?: string
  needsAi: boolean
}

export type LedgerQueryPlan = {
  aggregation: 'list' | 'count' | 'sum' | 'max' | 'group'
  categories?: LedgerExpenseCategory[]
  cities?: string[]
  merchants?: string[]
  statuses?: LedgerExpenseStatus[]
  reviewStatuses?: LedgerReviewStatus[]
  reviewBuckets?: LedgerReviewBucket[]
  paymentStatuses?: LedgerPaymentStatus[]
  orderStatuses?: Array<'active' | 'cancelled'>
  refundState?: 'any_refund' | 'no_refund'
  itemLinked?: boolean
  sourceRoles?: LedgerSourceRole[]
  dateRange?: { from?: string; to?: string }
  groupBy?: 'date' | 'city' | 'category'
  sort?: 'date_asc' | 'date_desc' | 'amount_desc'
  limit?: number
}

export type LedgerLocalQueryParseResult = {
  plan: LedgerQueryPlan
  needsAi: boolean
}

export function getLedgerSourceLinks(expense: LedgerExpense): LedgerExpenseSourceLink[] {
  if (expense.sourceLinks?.length) return expense.sourceLinks
  return [{
    ...expense.source,
    available: true,
    id: `legacy:${expense.source.kind}:${expense.source.sourceId ?? expense.id}`,
    role: 'other',
  }]
}

export function getLedgerNetAmountMinor(expense: LedgerExpense) {
  return expense.amountMinor ?? 0
}

export function areLedgerLineItemsBalanced(expense: Pick<LedgerExpense, 'amountMinor' | 'lineItems'>) {
  if (!expense.lineItems?.length) return true
  if (expense.amountMinor == null) return false
  return expense.lineItems.reduce((sum, item) => sum + item.amountMinor, 0) === expense.amountMinor
}

export function findLedgerCandidateMatch(candidate: LedgerExpenseDraftCandidate, expenses: LedgerExpense[]) {
  const exact = expenses.find((expense) => getLedgerSourceLinks(expense).some((link) =>
    (candidate.source.sourceId && link.kind === candidate.source.kind && link.sourceId === candidate.source.sourceId) ||
    (candidate.source.fingerprint && link.fingerprint === candidate.source.fingerprint),
  ))
  if (exact) return { expense: exact, kind: 'source' as const }

  if (candidate.orderNumber) {
    const order = expenses.find((expense) => expense.orderNumber === candidate.orderNumber && merchantsMatch(expense.merchant, candidate.merchant))
    if (order) return { expense: order, kind: 'order' as const }
  }

  const heuristic = expenses.find((expense) =>
    expense.status !== 'void' &&
    expense.amountMinor != null &&
    candidate.amountMinor != null &&
    Math.abs(expense.amountMinor) === Math.abs(candidate.amountMinor) &&
    normalizeCurrencyCode(expense.currency) === normalizeCurrencyCode(candidate.currency) &&
    Math.abs(dateDistance(expense.date, candidate.date)) <= 2 &&
    merchantsMatch(expense.merchant ?? expense.title, candidate.merchant ?? candidate.title),
  )
  return heuristic ? { expense: heuristic, kind: 'heuristic' as const } : undefined
}

export function buildLedgerExpenseFromCandidate(
  candidate: LedgerExpenseDraftCandidate,
  tripId: string,
  participants: LedgerParticipant[],
  options: { forceDraft?: boolean } = {},
): Omit<LedgerExpense, 'id' | 'createdAt' | 'updatedAt'> {
  const autoConfirmed = !options.forceDraft && canAutoConfirmLedgerCandidate(candidate)
  const amountMinor = candidate.sourceRole === 'refund_notice' && candidate.amountMinor != null
    ? -Math.abs(candidate.amountMinor)
    : candidate.amountMinor
  return {
    amountMinor,
    autoConfirmReason: autoConfirmed ? '置信度达到 0.85，且付款、金额、币种与冲突检查均通过。' : undefined,
    bookedAt: candidate.bookedAt,
    cancelledAt: candidate.cancelledAt,
    category: candidate.category,
    city: candidate.city,
    currency: candidate.currency,
    date: candidate.date,
    itemIds: candidate.itemIds,
    lineItems: normalizeCandidateLineItems(candidate.lineItems, amountMinor),
    merchant: candidate.merchant,
    orderNumber: candidate.orderNumber,
    orderStatus: candidate.orderStatus,
    paidAt: candidate.paidAt,
    payerParticipantId: candidate.payerParticipantId,
    paymentStatus: candidate.paymentStatus,
    recognitionConfidence: candidate.recognitionConfidence,
    refundedAt: candidate.refundedAt,
    reviewStatus: autoConfirmed ? 'auto_confirmed' : 'needs_review',
    serviceEndAt: candidate.serviceEndAt,
    serviceStartAt: candidate.serviceStartAt,
    source: candidate.source,
    sourceLinks: [candidate.sourceLink],
    splitMode: 'equal',
    splitShares: participants.map((participant) => ({ participantId: participant.id, weight: 1 })),
    status: autoConfirmed
      ? 'confirmed'
      : options.forceDraft
        ? 'draft'
        : candidate.orderStatus === 'cancelled' && candidate.paymentStatus === 'unpaid' ? 'void' : 'draft',
    title: candidate.title,
    tripId,
  }
}

export function buildLedgerCandidateMergePatch(expense: LedgerExpense, candidate: LedgerExpenseDraftCandidate): Partial<LedgerExpense> {
  const links = getLedgerSourceLinks(expense)
  const sourceLinks = links.some((link) => link.id === candidate.sourceLink.id) ? links : [...links, candidate.sourceLink]
  const paymentStatus = choosePaymentStatus(expense.paymentStatus, candidate.paymentStatus)
  const orderStatus = expense.orderStatus === 'cancelled' || candidate.orderStatus === 'cancelled' ? 'cancelled' : 'active'
  const paidCancellation = orderStatus === 'cancelled' && ['paid', 'partially_refunded'].includes(paymentStatus)
  return {
    amountMinor: expense.amountMinor ?? candidate.amountMinor,
    bookedAt: expense.bookedAt ?? candidate.bookedAt,
    cancelledAt: expense.cancelledAt ?? candidate.cancelledAt,
    category: expense.category === 'other' ? candidate.category : expense.category,
    city: expense.city ?? candidate.city,
    currency: expense.currency ?? candidate.currency,
    itemIds: unique([...(expense.itemIds ?? []), ...candidate.itemIds]),
    lineItems: expense.lineItems?.length ? expense.lineItems : candidate.lineItems,
    merchant: expense.merchant ?? candidate.merchant,
    orderNumber: expense.orderNumber ?? candidate.orderNumber,
    orderStatus,
    paidAt: expense.paidAt ?? candidate.paidAt,
    paymentStatus,
    recognitionConfidence: Math.max(expense.recognitionConfidence ?? 0, candidate.recognitionConfidence),
    refundedAt: expense.refundedAt ?? candidate.refundedAt,
    reviewStatus: paidCancellation ? 'needs_review' : expense.reviewStatus,
    serviceEndAt: expense.serviceEndAt ?? candidate.serviceEndAt,
    serviceStartAt: expense.serviceStartAt ?? candidate.serviceStartAt,
    sourceLinks,
    status: orderStatus === 'cancelled' && paymentStatus === 'unpaid' ? 'void' : expense.status,
  }
}

export function buildLedgerIntegrityIssues(expenses: LedgerExpense[]) {
  const issues: LedgerIntegrityIssue[] = []
  for (const expense of expenses.filter((item) => item.status !== 'void')) {
    const links = getLedgerSourceLinks(expense)
    const hasReceipt = links.some((link) => ['payment_receipt', 'invoice'].includes(link.role))
    if (expense.paymentStatus === 'paid' && !hasReceipt) {
      issues.push({ expenseId: expense.id, kind: 'paid_without_receipt', message: `「${expense.title}」已付款但缺少票据或发票`, severity: 'warning' })
    }
    if (!(expense.itemIds?.length)) {
      issues.push({ expenseId: expense.id, kind: 'unlinked_itinerary', message: `「${expense.title}」尚未关联行程`, severity: 'warning' })
    }
    if (expense.amountMinor == null || !expense.currency) {
      issues.push({ expenseId: expense.id, kind: 'missing_amount', message: `「${expense.title}」缺少金额或币种`, severity: 'error' })
    }
    if (expense.orderStatus === 'cancelled' && expense.paymentStatus === 'paid') {
      issues.push({ expenseId: expense.id, kind: 'cancelled_not_reversed', message: `「${expense.title}」已取消但尚未退款冲正`, severity: 'error' })
    }
    if (links.some((link) => link.available === false)) {
      issues.push({ expenseId: expense.id, kind: 'source_missing', message: `「${expense.title}」有原始来源已不可用`, severity: 'warning' })
    }
    if (!areLedgerLineItemsBalanced(expense)) {
      issues.push({ expenseId: expense.id, kind: 'line_item_mismatch', message: `「${expense.title}」的明细合计与账单总额不一致`, severity: 'error' })
    }
  }
  for (let first = 0; first < expenses.length; first += 1) {
    for (let second = first + 1; second < expenses.length; second += 1) {
      if (isHeuristicDuplicate(expenses[first], expenses[second])) {
        for (const expense of [expenses[first], expenses[second]]) {
          if (!issues.some((issue) => issue.expenseId === expense.id && issue.kind === 'duplicate_conflict')) {
            issues.push({ expenseId: expense.id, kind: 'duplicate_conflict', message: `「${expense.title}」可能与另一笔账单重复`, severity: 'warning' })
          }
        }
      }
    }
  }
  return issues
}

export function buildLedgerTimeline(expenses: LedgerExpense[]) {
  const events: LedgerTimelineEvent[] = []
  for (const expense of expenses) {
    if (expense.bookedAt) events.push(buildTimelineEvent(expense, 'booking', expense.bookedAt))
    if (expense.paidAt) events.push(buildTimelineEvent(expense, 'payment', expense.paidAt))
    if (expense.serviceStartAt) events.push(buildTimelineEvent(expense, 'service', expense.serviceStartAt))
  }
  return events.sort((first, second) => first.at.localeCompare(second.at) || first.title.localeCompare(second.title))
}

export function buildLedgerForecast({
  budgets,
  expenses,
  settings,
  trip,
  today,
}: {
  budgets: LedgerBudget[]
  expenses: LedgerExpense[]
  settings: LedgerSettings
  trip: Trip
  today?: string
}): LedgerForecast {
  const currentDate = today ?? todayInTimeZone(resolveTripTimeZone(trip))
  const actualExpenses = expenses.filter((expense) => expense.status === 'confirmed' && expense.date <= currentDate)
  const futureExpenses = expenses.filter((expense) => expense.status === 'confirmed' && expense.date > currentDate)
  const actualMinor = sumInCurrency(actualExpenses, settings.tripCurrency)
  const knownFutureMinor = sumInCurrency(futureExpenses, settings.tripCurrency)
  const totalDays = Math.max(1, (plainDateDaysBetween(trip.startDate, trip.endDate) ?? 0) + 1)
  const elapsedDays = currentDate < trip.startDate
    ? 0
    : Math.min(totalDays, (plainDateDaysBetween(trip.startDate, currentDate) ?? 0) + 1)
  const remainingDays = Math.max(0, totalDays - elapsedDays)
  const variableDailyAverage = elapsedDays > 0 ? Math.round(actualMinor / elapsedDays) : 0
  const projectedMinor = actualMinor + knownFutureMinor + variableDailyAverage * remainingDays
  const totalBudget = budgets.find((budget) => budget.scope === 'trip' && normalizeCurrencyCode(budget.currency) === normalizeCurrencyCode(settings.tripCurrency))?.amountMinor ?? 0
  const dailyAvailableMinor = remainingDays > 0 ? Math.max(0, Math.floor((totalBudget - actualMinor - knownFutureMinor) / remainingDays)) : 0
  const riskCategories = budgets.filter((budget) => budget.scope === 'category' && budget.category).flatMap((budget) => {
    const spent = sumInCurrency(expenses.filter((expense) => expense.status === 'confirmed' && expense.category === budget.category), budget.currency)
    return spent > budget.amountMinor || (actualMinor > 0 && elapsedDays > 0 && Math.round(spent / elapsedDays) * totalDays > budget.amountMinor) ? [budget.category!] : []
  })
  return { actualMinor, dailyAvailableMinor, knownFutureMinor, projectedMinor, remainingDays, riskCategories: unique(riskCategories) }
}

export function parseLedgerQueryLocally(query: string, expenses: LedgerExpense[]): LedgerLocalQueryParseResult {
  const normalized = query.trim().toLocaleLowerCase()
  const plan: LedgerQueryPlan = { aggregation: 'list', limit: 50 }
  let recognized = 0
  const category = detectQueryCategory(normalized)
  if (category) { plan.categories = [category]; recognized += 1 }
  if (/未确认|待确认/.test(normalized)) { plan.statuses = ['draft']; recognized += 1 }
  else if (/已确认/.test(normalized)) { plan.statuses = ['confirmed']; recognized += 1 }
  if (/已自动归档|自动归档/.test(normalized)) { plan.reviewStatuses = ['auto_confirmed']; recognized += 1 }
  if (/疑似重复|重复/.test(normalized)) { plan.reviewBuckets = ['duplicate']; recognized += 1 }
  if (/缺字段|资料不全|信息不全/.test(normalized)) { plan.reviewBuckets = ['missing_fields']; recognized += 1 }
  if (/没有关联|未关联/.test(normalized)) { plan.itemLinked = false; recognized += 1 }
  else if (/已关联/.test(normalized)) { plan.itemLinked = true; recognized += 1 }
  if (/未付款/.test(normalized)) { plan.paymentStatuses = ['unpaid', 'unknown']; recognized += 1 }
  else if (/已付款/.test(normalized)) { plan.paymentStatuses = ['paid', 'partially_refunded', 'refunded']; recognized += 1 }
  if (/取消/.test(normalized)) { plan.orderStatuses = ['cancelled']; recognized += 1 }
  if (/退款|冲正/.test(normalized)) { plan.refundState = 'any_refund'; recognized += 1 }
  const sourceRole = detectQuerySourceRole(normalized)
  if (sourceRole) { plan.sourceRoles = [sourceRole]; recognized += 1 }
  const city = expenses.map((expense) => expense.city).filter((value): value is string => Boolean(value)).find((value) => normalized.includes(value.toLocaleLowerCase()))
  if (city) { plan.cities = [city]; recognized += 1 }
  const merchant = expenses.map((expense) => expense.merchant).filter((value): value is string => Boolean(value)).find((value) => normalized.includes(value.toLocaleLowerCase()))
  if (merchant) { plan.merchants = [merchant]; recognized += 1 }
  const dates = [...normalized.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((match) => match[1])
  if (dates.length) { plan.dateRange = { from: dates[0], to: dates[1] ?? dates[0] }; recognized += 1 }
  if (/按城市/.test(normalized)) { plan.aggregation = 'group'; plan.groupBy = 'city'; recognized += 1 }
  else if (/按日期|每天|每日/.test(normalized)) { plan.aggregation = 'group'; plan.groupBy = 'date'; recognized += 1 }
  else if (/按类别|按分类/.test(normalized)) { plan.aggregation = 'group'; plan.groupBy = 'category'; recognized += 1 }
  else if (/最大|最高|最贵/.test(normalized)) { plan.aggregation = 'max'; plan.limit = 1; recognized += 1 }
  else if (/几笔|多少笔|数量/.test(normalized)) { plan.aggregation = 'count'; recognized += 1 }
  else if (/多少钱|合计|总共|一共|总额/.test(normalized)) { plan.aggregation = 'sum'; recognized += 1 }
  if (/最近|最新/.test(normalized)) plan.sort = 'date_desc'
  return { needsAi: recognized === 0, plan }
}

export function executeLedgerQueryPlan(plan: LedgerQueryPlan, expenses: LedgerExpense[], settings: LedgerSettings, needsAi = false): LedgerQueryResult {
  const validated = validateLedgerQueryPlan(plan) ?? { aggregation: 'list' as const, limit: 50 }
  let matches = expenses.filter((expense) => validated.statuses ? validated.statuses.includes(expense.status) : expense.status !== 'void')
  if (validated.categories?.length) matches = matches.filter((expense) => validated.categories!.includes(expense.category))
  if (validated.cities?.length) matches = matches.filter((expense) => expense.city && validated.cities!.some((city) => normalizeText(expense.city!) === normalizeText(city)))
  if (validated.merchants?.length) matches = matches.filter((expense) => validated.merchants!.some((merchant) => merchantsMatch(expense.merchant ?? expense.title, merchant)))
  if (validated.reviewStatuses?.length) matches = matches.filter((expense) => expense.reviewStatus && validated.reviewStatuses!.includes(expense.reviewStatus))
  if (validated.paymentStatuses?.length) matches = matches.filter((expense) => validated.paymentStatuses!.includes(expense.paymentStatus ?? 'unknown'))
  if (validated.orderStatuses?.length) matches = matches.filter((expense) => validated.orderStatuses!.includes(expense.orderStatus ?? 'active'))
  if (validated.refundState === 'any_refund') matches = matches.filter((expense) => (expense.amountMinor ?? 0) < 0 || Boolean(expense.originalExpenseId) || ['partially_refunded', 'refunded'].includes(expense.paymentStatus ?? ''))
  if (validated.refundState === 'no_refund') matches = matches.filter((expense) => (expense.amountMinor ?? 0) >= 0 && !expense.originalExpenseId)
  if (validated.itemLinked !== undefined) matches = matches.filter((expense) => Boolean(expense.itemIds?.length) === validated.itemLinked)
  if (validated.sourceRoles?.length) matches = matches.filter((expense) => getLedgerSourceLinks(expense).some((link) => validated.sourceRoles!.includes(link.role)))
  if (validated.dateRange?.from) matches = matches.filter((expense) => expense.date >= validated.dateRange!.from!)
  if (validated.dateRange?.to) matches = matches.filter((expense) => expense.date <= validated.dateRange!.to!)
  if (validated.reviewBuckets?.length) {
    const reviewById = new Map(buildLedgerReviewEntries(expenses).map((entry) => [entry.expense.id, entry]))
    matches = matches.filter((expense) => validated.reviewBuckets!.some((bucket) => reviewById.get(expense.id)?.buckets.includes(bucket)))
  }
  const convertedRows = matches.map((expense) => ({ amountMinor: convertExpenseMinor(expense, settings.tripCurrency), expense }))
  const convertible = convertedRows.filter((row): row is { amountMinor: number; expense: LedgerExpense } => row.amountMinor != null)
  const missingExchangeRateCount = convertedRows.length - convertible.length
  if (validated.sort === 'date_asc') matches.sort((left, right) => left.date.localeCompare(right.date))
  else if (validated.sort === 'date_desc') matches.sort((left, right) => right.date.localeCompare(left.date))
  else if (validated.sort === 'amount_desc' || validated.aggregation === 'max') matches = convertible.sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor)).map((row) => row.expense)
  const totalMinor = convertible.reduce((sum, row) => sum + row.amountMinor, 0)
  let groups: LedgerQueryResult['groups']
  if (validated.aggregation === 'group' && validated.groupBy) {
    const grouped = new Map<string, { key: string; label: string; amountMinor: number; count: number }>()
    for (const row of convertible) {
      const key = validated.groupBy === 'date' ? row.expense.date : validated.groupBy === 'city' ? row.expense.city || '未标记城市' : row.expense.category
      const label = validated.groupBy === 'category' ? ledgerCategoryLabels[row.expense.category] : key
      const current = grouped.get(key) ?? { amountMinor: 0, count: 0, key, label }
      current.amountMinor += row.amountMinor; current.count += 1; grouped.set(key, current)
    }
    groups = [...grouped.values()].sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor) || left.label.localeCompare(right.label))
  }
  const limited = matches.slice(0, validated.limit ?? 50)
  const suffix = missingExchangeRateCount ? `另有 ${missingExchangeRateCount} 笔缺少汇率，未计入金额。` : ''
  let answer = `找到 ${matches.length} 笔账单。${suffix}`
  if (validated.aggregation === 'sum') answer = `找到 ${matches.length} 笔账单，合计 ${formatLedgerMoney(totalMinor, settings.tripCurrency)}。${suffix}`
  if (validated.aggregation === 'count') answer = `找到 ${matches.length} 笔符合条件的账单。`
  if (validated.aggregation === 'max') answer = limited[0] ? `最大支出是「${limited[0].title}」，${formatLedgerMoney(convertExpenseMinor(limited[0], settings.tripCurrency), settings.tripCurrency)}。` : '没有找到可换算的符合条件账单。'
  if (validated.aggregation === 'group') answer = groups?.length ? groups.map((group) => `${group.label} ${formatLedgerMoney(group.amountMinor, settings.tripCurrency)}（${group.count} 笔）`).join('；') + `。${suffix}` : '没有找到可分组的账单。'
  return {
    answer,
    citations: buildLedgerQueryCitations(limited),
    currency: settings.tripCurrency,
    expenseIds: limited.map((expense) => expense.id),
    groups,
    missingExchangeRateCount,
    needsAi,
    plan: validated,
    totalMinor,
  }
}

export function queryLedgerLocally(query: string, expenses: LedgerExpense[], settings: LedgerSettings): LedgerQueryResult {
  const parsed = parseLedgerQueryLocally(query, expenses)
  return executeLedgerQueryPlan(parsed.plan, expenses, settings, parsed.needsAi)
}

export function buildLedgerAiQueryContext(expenses: LedgerExpense[]) {
  return expenses.slice(0, 80).map((expense) => ({
    amountMinor: expense.amountMinor,
    category: expense.category,
    city: expense.city,
    currency: expense.currency,
    date: expense.date,
    id: expense.id,
    itemLinked: Boolean(expense.itemIds?.length),
    merchant: expense.merchant,
    orderStatus: expense.orderStatus,
    paymentStatus: expense.paymentStatus,
    reviewStatus: expense.reviewStatus,
    sourceRefs: getLedgerSourceLinks(expense).map((link) => ({ id: link.id, kind: link.kind, role: link.role })),
    status: expense.status,
    title: expense.title,
  }))
}

export function validateLedgerQueryPlan(input: unknown): LedgerQueryPlan | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  const allowedKeys = new Set(['aggregation', 'categories', 'cities', 'merchants', 'statuses', 'reviewStatuses', 'reviewBuckets', 'paymentStatuses', 'orderStatuses', 'refundState', 'itemLinked', 'sourceRoles', 'dateRange', 'groupBy', 'sort', 'limit'])
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return undefined
  const aggregations = new Set<LedgerQueryPlan['aggregation']>(['list', 'count', 'sum', 'max', 'group'])
  if (typeof record.aggregation !== 'string' || !aggregations.has(record.aggregation as LedgerQueryPlan['aggregation'])) return undefined
  if (!isEnumArrayOrUndefined(record.categories, ['lodging', 'transport', 'admission', 'food', 'shopping', 'insurance', 'connectivity', 'other'])) return undefined
  if (!isEnumArrayOrUndefined(record.statuses, ['draft', 'confirmed', 'void'])) return undefined
  if (!isEnumArrayOrUndefined(record.reviewStatuses, ['unreviewed', 'auto_confirmed', 'reviewed', 'needs_review'])) return undefined
  if (!isEnumArrayOrUndefined(record.reviewBuckets, ['auto_archived', 'pending', 'duplicate', 'missing_fields'])) return undefined
  if (!isEnumArrayOrUndefined(record.paymentStatuses, ['unknown', 'unpaid', 'paid', 'partially_refunded', 'refunded'])) return undefined
  if (!isEnumArrayOrUndefined(record.orderStatuses, ['active', 'cancelled'])) return undefined
  if (!isEnumArrayOrUndefined(record.sourceRoles, ['order_confirmation', 'payment_receipt', 'invoice', 'credit_card_notice', 'cancellation_notice', 'refund_notice', 'other'])) return undefined
  if (!isStringArrayOrUndefined(record.cities, 12, 120) || !isStringArrayOrUndefined(record.merchants, 12, 160)) return undefined
  const plan: LedgerQueryPlan = { aggregation: record.aggregation as LedgerQueryPlan['aggregation'] }
  const categories = filterEnum(record.categories, ['lodging', 'transport', 'admission', 'food', 'shopping', 'insurance', 'connectivity', 'other'] as const)
  const statuses = filterEnum(record.statuses, ['draft', 'confirmed', 'void'] as const)
  const reviews = filterEnum(record.reviewStatuses, ['unreviewed', 'auto_confirmed', 'reviewed', 'needs_review'] as const)
  const buckets = filterEnum(record.reviewBuckets, ['auto_archived', 'pending', 'duplicate', 'missing_fields'] as const)
  const payments = filterEnum(record.paymentStatuses, ['unknown', 'unpaid', 'paid', 'partially_refunded', 'refunded'] as const)
  const orders = filterEnum(record.orderStatuses, ['active', 'cancelled'] as const)
  const roles = filterEnum(record.sourceRoles, ['order_confirmation', 'payment_receipt', 'invoice', 'credit_card_notice', 'cancellation_notice', 'refund_notice', 'other'] as const)
  if (categories?.length) plan.categories = categories
  if (statuses?.length) plan.statuses = statuses
  if (reviews?.length) plan.reviewStatuses = reviews
  if (buckets?.length) plan.reviewBuckets = buckets
  if (payments?.length) plan.paymentStatuses = payments
  if (orders?.length) plan.orderStatuses = orders
  if (roles?.length) plan.sourceRoles = roles
  const cities = filterStrings(record.cities, 12, 120); if (cities?.length) plan.cities = cities
  const merchants = filterStrings(record.merchants, 12, 160); if (merchants?.length) plan.merchants = merchants
  if (typeof record.itemLinked === 'boolean') plan.itemLinked = record.itemLinked
  if (record.refundState === 'any_refund' || record.refundState === 'no_refund') plan.refundState = record.refundState
  if (record.groupBy === 'date' || record.groupBy === 'city' || record.groupBy === 'category') plan.groupBy = record.groupBy
  if (record.sort === 'date_asc' || record.sort === 'date_desc' || record.sort === 'amount_desc') plan.sort = record.sort
  if (Number.isSafeInteger(record.limit)) plan.limit = Math.min(80, Math.max(1, Number(record.limit)))
  if (record.dateRange && typeof record.dateRange === 'object') {
    const range = record.dateRange as Record<string, unknown>
    const from = typeof range.from === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(range.from) ? range.from : undefined
    const to = typeof range.to === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(range.to) ? range.to : undefined
    if (from || to) plan.dateRange = { from, to }
  }
  if (plan.aggregation === 'group' && !plan.groupBy) return undefined
  return plan
}

export function buildLedgerQueryCitations(expenses: LedgerExpense[]) {
  return expenses.flatMap((expense) => getLedgerSourceLinks(expense).map((link) => ({
    available: link.available !== false,
    expenseId: expense.id,
    sourceId: link.sourceId,
    sourceKind: link.kind,
    title: link.title ?? link.label ?? expense.title,
  })))
}

function normalizeCandidateLineItems(lineItems: LedgerExpenseLineItem[], amountMinor: number | undefined) {
  if (amountMinor == null || lineItems.length === 0) return []
  return lineItems.reduce((sum, item) => sum + item.amountMinor, 0) === amountMinor ? lineItems : []
}

function choosePaymentStatus(current: LedgerExpense['paymentStatus'], incoming: LedgerExpense['paymentStatus']) {
  const rank = { unknown: 0, unpaid: 1, paid: 2, partially_refunded: 3, refunded: 4 }
  const first = current ?? 'unknown'
  const second = incoming ?? 'unknown'
  return rank[second] > rank[first] ? second : first
}

function buildTimelineEvent(expense: LedgerExpense, kind: LedgerTimelineKind, at: string): LedgerTimelineEvent {
  return { amountMinor: expense.amountMinor, at, city: expense.city, currency: expense.currency, expenseId: expense.id, id: `${expense.id}:${kind}`, kind, title: expense.title }
}

function isHeuristicDuplicate(first: LedgerExpense, second: LedgerExpense) {
  if (first.id === second.id || first.status === 'void' || second.status === 'void') return false
  if (getLedgerSourceLinks(first).some((left) => getLedgerSourceLinks(second).some((right) => left.id === right.id))) return false
  return first.amountMinor != null && second.amountMinor != null &&
    Math.abs(first.amountMinor) === Math.abs(second.amountMinor) &&
    normalizeCurrencyCode(first.currency) === normalizeCurrencyCode(second.currency) &&
    Math.abs(dateDistance(first.date, second.date)) <= 2 &&
    merchantsMatch(first.merchant ?? first.title, second.merchant ?? second.title)
}

function merchantsMatch(first: string | undefined, second: string | undefined) {
  if (!first || !second) return true
  const left = normalizeText(first)
  const right = normalizeText(second)
  return left === right || left.includes(right) || right.includes(left)
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function dateDistance(first: string, second: string) {
  return plainDateDaysBetween(first.slice(0, 10), second.slice(0, 10)) ?? 0
}

function sumInCurrency(expenses: LedgerExpense[], currency: string) {
  return expenses.reduce((sum, expense) => sum + (convertExpenseMinor(expense, currency) ?? 0), 0)
}

function detectQueryCategory(query: string): LedgerExpenseCategory | undefined {
  const synonyms: Record<LedgerExpenseCategory, RegExp> = {
    admission: /门票|景点|入场|admission|ticket/,
    connectivity: /通信|流量|电话卡|esim|wifi/,
    food: /餐饮|餐厅|晚餐|午餐|早餐|咖啡|food|restaurant/,
    insurance: /保险|insurance/,
    lodging: /住宿|酒店|旅馆|民宿|hotel|hostel/,
    other: /其他|other/,
    shopping: /购物|商店|纪念品|shopping/,
    transport: /交通|机票|火车|高铁|航班|出租|train|flight|taxi/,
  }
  return (Object.entries(synonyms) as Array<[LedgerExpenseCategory, RegExp]>).find(([, pattern]) => pattern.test(query))?.[0]
}

function detectQuerySourceRole(query: string): LedgerSourceRole | undefined {
  const roles: Array<[LedgerSourceRole, RegExp]> = [
    ['refund_notice', /退款通知|退款邮件/],
    ['cancellation_notice', /取消通知|取消邮件/],
    ['credit_card_notice', /信用卡通知|扣款通知/],
    ['payment_receipt', /付款票据|付款凭证|收据/],
    ['order_confirmation', /订单确认|确认邮件/],
    ['invoice', /发票/],
  ]
  return roles.find(([, pattern]) => pattern.test(query))?.[0]
}

function filterEnum<const T extends readonly string[]>(value: unknown, allowed: T): Array<T[number]> | undefined {
  if (!Array.isArray(value)) return undefined
  const allowedValues = new Set<string>(allowed)
  const filtered = value.filter((item): item is T[number] => typeof item === 'string' && allowedValues.has(item)).slice(0, 12)
  return filtered.length === value.length ? [...new Set(filtered)] : undefined
}

function filterStrings(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && item.trim().length <= maxLength).slice(0, maxItems).map((item) => item.trim())
  return filtered.length === value.length ? [...new Set(filtered)] : undefined
}

function isEnumArrayOrUndefined(value: unknown, allowed: readonly string[]) {
  return value === undefined || Array.isArray(value) && value.length <= 12 && value.every((item) => typeof item === 'string' && allowed.includes(item))
}

function isStringArrayOrUndefined(value: unknown, maxItems: number, maxLength: number) {
  return value === undefined || Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.trim().length <= maxLength)
}
