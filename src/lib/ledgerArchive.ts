import type {
  LedgerBudget,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerExpenseLineItem,
  LedgerExpenseSourceLink,
  LedgerParticipant,
  LedgerSettings,
  Trip,
} from '../types'
import { convertExpenseMinor, formatLedgerMoney, normalizeCurrencyCode } from './ledger'
import { canAutoConfirmLedgerCandidate, type LedgerExpenseDraftCandidate } from './ledgerExtraction'

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
  totalMinor?: number
  currency?: string
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
): Omit<LedgerExpense, 'id' | 'createdAt' | 'updatedAt'> {
  const autoConfirmed = canAutoConfirmLedgerCandidate(candidate)
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
    status: autoConfirmed ? 'confirmed' : candidate.orderStatus === 'cancelled' && candidate.paymentStatus === 'unpaid' ? 'void' : 'draft',
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
  today = new Date().toISOString().slice(0, 10),
}: {
  budgets: LedgerBudget[]
  expenses: LedgerExpense[]
  settings: LedgerSettings
  trip: Trip
  today?: string
}): LedgerForecast {
  const actualExpenses = expenses.filter((expense) => expense.status === 'confirmed' && expense.date <= today)
  const futureExpenses = expenses.filter((expense) => expense.status === 'confirmed' && expense.date > today)
  const actualMinor = sumInCurrency(actualExpenses, settings.tripCurrency)
  const knownFutureMinor = sumInCurrency(futureExpenses, settings.tripCurrency)
  const tripStart = parseDate(trip.startDate)
  const tripEnd = parseDate(trip.endDate)
  const current = parseDate(today)
  const totalDays = Math.max(1, daysBetween(tripStart, tripEnd) + 1)
  const elapsedDays = current < tripStart ? 0 : Math.min(totalDays, daysBetween(tripStart, current) + 1)
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

export function queryLedgerLocally(query: string, expenses: LedgerExpense[], settings: LedgerSettings): LedgerQueryResult {
  const normalized = query.trim().toLocaleLowerCase()
  let matches = expenses.filter((expense) => expense.status !== 'void')
  const category = detectQueryCategory(normalized)
  if (category) matches = matches.filter((expense) => expense.category === category)
  if (/未确认|待确认/.test(normalized)) matches = matches.filter((expense) => expense.status === 'draft')
  if (/没有关联|未关联/.test(normalized)) matches = matches.filter((expense) => !(expense.itemIds?.length))
  const city = expenses.map((expense) => expense.city).filter(Boolean).find((value) => value && normalized.includes(value.toLocaleLowerCase()))
  if (city) matches = matches.filter((expense) => expense.city === city)
  const converted = matches.map((expense) => ({ expense, amount: convertExpenseMinor(expense, settings.tripCurrency) })).filter((row): row is { expense: LedgerExpense; amount: number } => row.amount != null)
  const totalMinor = converted.reduce((sum, row) => sum + row.amount, 0)
  const wantsLargest = /最大|最高|最贵/.test(normalized)
  if (wantsLargest) matches = converted.sort((first, second) => second.amount - first.amount).slice(0, 1).map((row) => row.expense)
  const answer = wantsLargest
    ? matches[0] ? `最大支出是「${matches[0].title}」，${formatLedgerMoney(convertExpenseMinor(matches[0], settings.tripCurrency), settings.tripCurrency)}。` : '没有找到符合条件的账单。'
    : `找到 ${matches.length} 笔账单，合计 ${formatLedgerMoney(totalMinor, settings.tripCurrency)}。`
  return {
    answer,
    citations: buildLedgerQueryCitations(matches),
    currency: settings.tripCurrency,
    expenseIds: matches.map((expense) => expense.id),
    needsAi: !category && !/(未确认|待确认|没有关联|未关联|最大|最高|最贵|多少|合计|总共)/.test(normalized),
    totalMinor,
  }
}

export function buildLedgerAiQueryContext(expenses: LedgerExpense[], result: LedgerQueryResult) {
  const included = new Set(result.expenseIds)
  return expenses.filter((expense) => included.has(expense.id)).map((expense) => ({
    amountMinor: expense.amountMinor,
    category: expense.category,
    city: expense.city,
    currency: expense.currency,
    date: expense.date,
    id: expense.id,
    itemLinked: Boolean(expense.itemIds?.length),
    merchant: expense.merchant,
    paymentStatus: expense.paymentStatus,
    sourceRefs: getLedgerSourceLinks(expense).map((link) => ({ id: link.id, kind: link.kind, role: link.role })),
    status: expense.status,
    title: expense.title,
  }))
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
  return daysBetween(parseDate(first), parseDate(second))
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`)
}

function daysBetween(first: Date, second: Date) {
  return Math.round((second.getTime() - first.getTime()) / 86_400_000)
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
