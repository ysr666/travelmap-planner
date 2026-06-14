import type {
  LedgerBudget,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerExpenseSplitShare,
  LedgerParticipant,
  LedgerSettings,
} from '../types'

export const ledgerCategoryLabels: Record<LedgerExpenseCategory, string> = {
  admission: '门票',
  connectivity: '通信',
  food: '餐饮',
  insurance: '保险',
  lodging: '住宿',
  other: '其他',
  shopping: '购物',
  transport: '交通',
}

export type LedgerWarning = {
  expenseId?: string
  budgetId?: string
  kind: 'over_budget' | 'pending' | 'missing_amount' | 'missing_payer' | 'unsplit' | 'missing_rate' | 'duplicate'
  message: string
}

export type LedgerBudgetProgress = {
  budget: LedgerBudget
  spentMinor: number
  overMinor: number
}

export type LedgerSummary = {
  budgetMinor: number
  spentTripMinor: number
  spentHomeMinor: number
  pendingTripMinor: number
  pendingHomeMinor: number
  perPersonTripMinor: number
  perPersonHomeMinor: number
  budgetProgress: LedgerBudgetProgress[]
  warnings: LedgerWarning[]
}

export type LedgerSettlementTransfer = {
  amountMinor: number
  currency: string
  fromParticipantId: string
  fromName: string
  toParticipantId: string
  toName: string
}

export type LedgerSettlementResult = {
  currency: string
  excluded: Array<{ expenseId: string; reason: string; title: string }>
  includedExpenseIds: string[]
  transfers: LedgerSettlementTransfer[]
}

export function normalizeCurrencyCode(value: string | undefined, fallback = 'CNY') {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : fallback
}

export function getCurrencyMinorDigits(currency: string) {
  try {
    return new Intl.NumberFormat('en', {
      currency: normalizeCurrencyCode(currency),
      style: 'currency',
    }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export function parseMoneyInput(value: string, currency: string) {
  const cleaned = value.trim().replace(/\s/g, '').replace(/[^\d,.-]/g, '')
  if (!cleaned) return undefined
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalMark = lastComma > lastDot ? ',' : '.'
    const groupingMark = decimalMark === ',' ? '.' : ','
    normalized = cleaned.split(groupingMark).join('').replace(decimalMark, '.')
  } else if (lastComma >= 0) {
    const decimalDigits = cleaned.length - lastComma - 1
    normalized = decimalDigits > 0 && decimalDigits <= 2
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '')
  } else {
    normalized = cleaned.replace(/,/g, '')
  }
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return undefined
  const factor = 10 ** getCurrencyMinorDigits(currency)
  return Math.round(amount * factor)
}

export function formatLedgerMoney(amountMinor: number | undefined, currency: string, locale = 'zh-CN') {
  if (amountMinor == null) return '待补充'
  const digits = getCurrencyMinorDigits(currency)
  return new Intl.NumberFormat(locale, {
    currency: normalizeCurrencyCode(currency),
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: 'currency',
  }).format(amountMinor / 10 ** digits)
}

export function convertMinorByRate(
  amountMinor: number,
  baseCurrency: string,
  quoteCurrency: string,
  rate: string,
) {
  if (!Number.isSafeInteger(amountMinor)) return undefined
  if (normalizeCurrencyCode(baseCurrency) === normalizeCurrencyCode(quoteCurrency)) return amountMinor
  const parsedRate = parseDecimal(rate)
  if (!parsedRate || parsedRate.numerator <= 0n) return undefined
  const baseFactor = 10n ** BigInt(getCurrencyMinorDigits(baseCurrency))
  const quoteFactor = 10n ** BigInt(getCurrencyMinorDigits(quoteCurrency))
  const numerator = BigInt(amountMinor) * parsedRate.numerator * quoteFactor
  const denominator = parsedRate.denominator * baseFactor
  const rounded = divideRoundHalfUp(numerator, denominator)
  const value = Number(rounded)
  return Number.isSafeInteger(value) ? value : undefined
}

export function allocateLargestRemainder(amountMinor: number, shares: LedgerExpenseSplitShare[]) {
  const validShares = shares.filter((share) => share.weight > 0 && Number.isFinite(share.weight))
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || validShares.length === 0) {
    return new Map<string, number>()
  }
  const scaledWeights = validShares.map((share) => ({
    participantId: share.participantId,
    weight: Math.max(1, Math.round(share.weight * 1_000_000)),
  }))
  const totalWeight = scaledWeights.reduce((total, share) => total + share.weight, 0)
  const rows = scaledWeights.map((share) => {
    const exactNumerator = amountMinor * share.weight
    return {
      amount: Math.floor(exactNumerator / totalWeight),
      participantId: share.participantId,
      remainder: exactNumerator % totalWeight,
    }
  })
  let remaining = amountMinor - rows.reduce((total, row) => total + row.amount, 0)
  rows.sort((first, second) => second.remainder - first.remainder || first.participantId.localeCompare(second.participantId))
  for (let index = 0; index < rows.length && remaining > 0; index += 1, remaining -= 1) {
    rows[index].amount += 1
  }
  return new Map(rows.map((row) => [row.participantId, row.amount]))
}

export function convertExpenseMinor(expense: LedgerExpense, targetCurrency: string) {
  if (expense.amountMinor == null || !expense.currency) return undefined
  const sourceCurrency = normalizeCurrencyCode(expense.currency)
  const target = normalizeCurrencyCode(targetCurrency)
  if (sourceCurrency === target) return expense.amountMinor
  const snapshot = expense.exchangeRate
  if (!snapshot || normalizeCurrencyCode(snapshot.baseCurrency) !== sourceCurrency) return undefined
  if (normalizeCurrencyCode(snapshot.tripCurrency) === target) {
    return convertMinorByRate(expense.amountMinor, sourceCurrency, target, snapshot.rateToTrip)
  }
  if (normalizeCurrencyCode(snapshot.homeCurrency) === target) {
    return convertMinorByRate(expense.amountMinor, sourceCurrency, target, snapshot.rateToHome)
  }
  return undefined
}

export function buildLedgerSummary({
  budgets,
  expenses,
  participants,
  settings,
}: {
  budgets: LedgerBudget[]
  expenses: LedgerExpense[]
  participants: LedgerParticipant[]
  settings: LedgerSettings
}): LedgerSummary {
  const confirmed = expenses.filter((expense) => expense.status === 'confirmed')
  const drafts = expenses.filter((expense) => expense.status === 'draft')
  const completeConfirmed = confirmed.filter((expense) => isExpenseSettlementReady(expense, participants))
  const spentTripMinor = sumConverted(confirmed, settings.tripCurrency)
  const spentHomeMinor = sumConverted(confirmed, settings.homeCurrency)
  const pendingTripMinor = sumConverted(drafts, settings.tripCurrency)
  const pendingHomeMinor = sumConverted(drafts, settings.homeCurrency)
  const completeTripMinor = sumConverted(completeConfirmed, settings.tripCurrency)
  const completeHomeMinor = sumConverted(completeConfirmed, settings.homeCurrency)
  const participantCount = Math.max(1, participants.length)
  const budgetProgress = budgets.map((budget) => {
    const matching = confirmed.filter((expense) => {
      if (budget.scope === 'category') return expense.category === budget.category
      if (budget.scope === 'date') return expense.date === budget.date
      return true
    })
    const spentMinor = sumConverted(matching, budget.currency)
    return { budget, spentMinor, overMinor: Math.max(0, spentMinor - budget.amountMinor) }
  })
  const warnings = buildLedgerWarnings({ budgetProgress, expenses, participants, settings })
  const tripBudget = budgets.find((budget) => budget.scope === 'trip' && budget.currency === settings.tripCurrency)
  return {
    budgetMinor: tripBudget?.amountMinor ?? 0,
    budgetProgress,
    pendingHomeMinor,
    pendingTripMinor,
    perPersonHomeMinor: Math.round(completeHomeMinor / participantCount),
    perPersonTripMinor: Math.round(completeTripMinor / participantCount),
    spentHomeMinor,
    spentTripMinor,
    warnings,
  }
}

export function buildLedgerWarnings({
  budgetProgress,
  expenses,
  participants,
  settings,
}: {
  budgetProgress: LedgerBudgetProgress[]
  expenses: LedgerExpense[]
  participants: LedgerParticipant[]
  settings: LedgerSettings
}) {
  const warnings: LedgerWarning[] = []
  for (const progress of budgetProgress.filter((item) => item.overMinor > 0)) {
    warnings.push({
      budgetId: progress.budget.id,
      kind: 'over_budget',
      message: `${describeBudget(progress.budget)}超出 ${formatLedgerMoney(progress.overMinor, progress.budget.currency)}`,
    })
  }
  const duplicateIds = findDuplicateExpenseIds(expenses)
  for (const expense of expenses.filter((item) => item.status !== 'void')) {
    if (expense.status === 'draft') warnings.push({ expenseId: expense.id, kind: 'pending', message: `「${expense.title}」待确认` })
    if (expense.amountMinor == null || !expense.currency) warnings.push({ expenseId: expense.id, kind: 'missing_amount', message: `「${expense.title}」缺少金额或币种` })
    if (expense.status === 'confirmed' && !expense.payerParticipantId) warnings.push({ expenseId: expense.id, kind: 'missing_payer', message: `「${expense.title}」缺少付款人` })
    if (expense.status === 'confirmed' && !hasValidSplit(expense, participants)) warnings.push({ expenseId: expense.id, kind: 'unsplit', message: `「${expense.title}」尚未完成分摊` })
    if (expense.amountMinor != null && expense.currency && normalizeCurrencyCode(expense.currency) !== normalizeCurrencyCode(settings.tripCurrency) && convertExpenseMinor(expense, settings.tripCurrency) == null) {
      warnings.push({ expenseId: expense.id, kind: 'missing_rate', message: `「${expense.title}」缺少历史汇率` })
    }
    if (!expense.duplicateAcknowledged && duplicateIds.has(expense.id)) warnings.push({ expenseId: expense.id, kind: 'duplicate', message: `「${expense.title}」可能与其他费用重复` })
  }
  return warnings
}

export function findDuplicateExpenseIds(expenses: LedgerExpense[]) {
  const active = expenses.filter((expense) => expense.status !== 'void')
  const duplicateIds = new Set<string>()
  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const first = active[firstIndex]
      const second = active[secondIndex]
      if (getLedgerExpenseDuplicateKind(first, second)) {
        duplicateIds.add(first.id)
        duplicateIds.add(second.id)
      }
    }
  }
  return duplicateIds
}

export function getLedgerExpenseDuplicateKind(
  first: Pick<LedgerExpense, 'amountMinor' | 'currency' | 'date' | 'source' | 'title'>,
  second: Pick<LedgerExpense, 'amountMinor' | 'currency' | 'date' | 'source' | 'title'>,
): 'exact' | 'heuristic' | undefined {
  const exactSource = first.source.kind === second.source.kind && Boolean(
    (first.source.sourceId && first.source.sourceId === second.source.sourceId) ||
    (first.source.fingerprint && first.source.fingerprint === second.source.fingerprint),
  )
  if (exactSource) return 'exact'
  const heuristic = first.date === second.date &&
    first.amountMinor != null && first.amountMinor === second.amountMinor &&
    normalizeCurrencyCode(first.currency) === normalizeCurrencyCode(second.currency) &&
    normalizeExpenseTitle(first.title) === normalizeExpenseTitle(second.title)
  return heuristic ? 'heuristic' : undefined
}

export function buildLedgerSettlement({
  expenses,
  participants,
  settings,
}: {
  expenses: LedgerExpense[]
  participants: LedgerParticipant[]
  settings: LedgerSettings
}): LedgerSettlementResult {
  const participantMap = new Map(participants.map((participant) => [participant.id, participant]))
  const balances = new Map(participants.map((participant) => [participant.id, 0]))
  const excluded: LedgerSettlementResult['excluded'] = []
  const includedExpenseIds: string[] = []
  for (const expense of expenses.filter((item) => item.status !== 'void')) {
    const reason = getSettlementExclusionReason(expense, participants, settings.settlementCurrency)
    if (reason) {
      excluded.push({ expenseId: expense.id, reason, title: expense.title })
      continue
    }
    const amountMinor = convertExpenseMinor(expense, settings.settlementCurrency)!
    const allocations = allocateLargestRemainder(amountMinor, expense.splitShares)
    balances.set(expense.payerParticipantId!, (balances.get(expense.payerParticipantId!) ?? 0) + amountMinor)
    for (const [participantId, shareMinor] of allocations) {
      balances.set(participantId, (balances.get(participantId) ?? 0) - shareMinor)
    }
    includedExpenseIds.push(expense.id)
  }
  const creditors = [...balances.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([participantId, amount]) => ({ amount, participantId }))
    .sort((first, second) => second.amount - first.amount || first.participantId.localeCompare(second.participantId))
  const debtors = [...balances.entries()]
    .filter(([, amount]) => amount < 0)
    .map(([participantId, amount]) => ({ amount: -amount, participantId }))
    .sort((first, second) => second.amount - first.amount || first.participantId.localeCompare(second.participantId))
  const transfers: LedgerSettlementTransfer[] = []
  let debtorIndex = 0
  let creditorIndex = 0
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]
    const creditor = creditors[creditorIndex]
    const amountMinor = Math.min(debtor.amount, creditor.amount)
    const from = participantMap.get(debtor.participantId)!
    const to = participantMap.get(creditor.participantId)!
    if (amountMinor > 0) {
      transfers.push({
        amountMinor,
        currency: settings.settlementCurrency,
        fromName: from.displayName,
        fromParticipantId: from.id,
        toName: to.displayName,
        toParticipantId: to.id,
      })
    }
    debtor.amount -= amountMinor
    creditor.amount -= amountMinor
    if (debtor.amount === 0) debtorIndex += 1
    if (creditor.amount === 0) creditorIndex += 1
  }
  return { currency: settings.settlementCurrency, excluded, includedExpenseIds, transfers }
}

export function getSettlementExclusionReason(expense: LedgerExpense, participants: LedgerParticipant[], settlementCurrency: string) {
  if (expense.status !== 'confirmed') return '费用尚未确认'
  if (expense.amountMinor == null || !expense.currency) return '缺少金额或币种'
  if (!expense.payerParticipantId || !participants.some((participant) => participant.id === expense.payerParticipantId)) return '缺少有效付款人'
  if (!hasValidSplit(expense, participants)) return '分摊尚未完成'
  if (convertExpenseMinor(expense, settlementCurrency) == null) return '缺少结算汇率'
  return undefined
}

export function hasValidSplit(expense: LedgerExpense, participants: LedgerParticipant[]) {
  const validParticipantIds = new Set(participants.map((participant) => participant.id))
  return expense.splitShares.length > 0 && expense.splitShares.every((share) => validParticipantIds.has(share.participantId) && share.weight > 0)
}

function isExpenseSettlementReady(expense: LedgerExpense, participants: LedgerParticipant[]) {
  return expense.status === 'confirmed' && Boolean(expense.payerParticipantId) && hasValidSplit(expense, participants)
}

function sumConverted(expenses: LedgerExpense[], currency: string) {
  return expenses.reduce((total, expense) => total + (convertExpenseMinor(expense, currency) ?? 0), 0)
}

function describeBudget(budget: LedgerBudget) {
  if (budget.scope === 'category' && budget.category) return `${ledgerCategoryLabels[budget.category]}预算`
  if (budget.scope === 'date' && budget.date) return `${budget.date} 预算`
  return '旅行总预算'
}

function normalizeExpenseTitle(title: string) {
  return title.trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function parseDecimal(value: string) {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return undefined
  const whole = match[1]
  if (!whole) return undefined
  const fraction = match[2] ?? ''
  return {
    denominator: 10n ** BigInt(fraction.length),
    numerator: BigInt(`${whole}${fraction}`),
  }
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / 2n) / denominator
}
