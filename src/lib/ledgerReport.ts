import type { LedgerBudget, LedgerExpense, LedgerExpenseCategory, LedgerParticipant, LedgerSettings, Trip } from '../types'
import { downloadBlob, safeFileName } from './backup'
import { buildLedgerForecast, buildLedgerIntegrityIssues, getLedgerSourceLinks } from './ledgerArchive'
import { buildLedgerSummary, convertExpenseMinor, formatLedgerMoney, ledgerCategoryLabels } from './ledger'

export type LedgerReportInput = {
  trip: Trip
  settings: LedgerSettings
  participants: LedgerParticipant[]
  budgets: LedgerBudget[]
  expenses: LedgerExpense[]
}

export type LedgerReportGroup = {
  key: string
  label: string
  amountMinor: number
  count: number
}

export type LedgerReportTimelineRow = {
  amountMinor: number
  city?: string
  date: string
  expenseId: string
  title: string
}

export type LedgerReportModel = {
  title: string
  generatedAt: string
  budgetMinor: number
  confirmedNetMinor: number
  pendingMinor: number
  projectedMinor: number
  missingExchangeRate: LedgerExpense[]
  byDate: LedgerReportGroup[]
  byCity: LedgerReportGroup[]
  byCategory: LedgerReportGroup[]
  timeline: LedgerReportTimelineRow[]
  largestExpenses: Array<{ expense: LedgerExpense; amountMinor: number }>
  refunds: LedgerExpense[]
  cancellations: LedgerExpense[]
  issues: ReturnType<typeof buildLedgerIntegrityIssues>
  sourceIndex: Array<{
    available: boolean
    capturedAt?: string
    expenseId: string
    expenseTitle: string
    kind: string
    role: string
    sourceId?: string
    title: string
  }>
}

export function buildLedgerReportModel(input: LedgerReportInput, today = new Date().toISOString().slice(0, 10)): LedgerReportModel {
  const summary = buildLedgerSummary(input)
  const forecast = buildLedgerForecast({ ...input, today })
  const convertedConfirmed = input.expenses
    .filter((expense) => expense.status === 'confirmed')
    .map((expense) => ({ expense, amountMinor: convertExpenseMinor(expense, input.settings.tripCurrency) }))
  const included = convertedConfirmed.filter((row): row is { expense: LedgerExpense; amountMinor: number } => row.amountMinor != null)
  const missingExchangeRate = convertedConfirmed.filter((row) => row.amountMinor == null).map((row) => row.expense)
  const pendingMinor = input.expenses
    .filter((expense) => expense.status === 'draft')
    .reduce((sum, expense) => sum + (convertExpenseMinor(expense, input.settings.tripCurrency) ?? 0), 0)
  const timeline = included.map(({ expense, amountMinor }) => ({
    amountMinor,
    city: expense.city,
    date: (expense.serviceStartAt || expense.paidAt || expense.date).slice(0, 10),
    expenseId: expense.id,
    title: expense.title,
  })).sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title))
  return {
    budgetMinor: summary.budgetMinor,
    byCategory: groupIncluded(included, (expense) => expense.category, (category) => ledgerCategoryLabels[category as LedgerExpenseCategory]),
    byCity: groupIncluded(included, (expense) => expense.city || '未标记城市', (city) => city),
    byDate: groupTimeline(timeline),
    cancellations: input.expenses.filter((expense) => expense.orderStatus === 'cancelled'),
    confirmedNetMinor: included.reduce((sum, row) => sum + row.amountMinor, 0),
    generatedAt: new Date().toISOString(),
    issues: buildLedgerIntegrityIssues(input.expenses),
    largestExpenses: [...included].sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor)).slice(0, 5),
    missingExchangeRate,
    pendingMinor,
    projectedMinor: forecast.projectedMinor,
    refunds: input.expenses.filter((expense) => expense.amountMinor != null && expense.amountMinor < 0 || Boolean(expense.originalExpenseId)),
    sourceIndex: input.expenses.flatMap((expense) => getLedgerSourceLinks(expense).map((source) => ({
      available: source.available !== false,
      capturedAt: source.capturedAt,
      expenseId: expense.id,
      expenseTitle: expense.title,
      kind: source.kind,
      role: source.role,
      sourceId: source.sourceId,
      title: source.title ?? source.label ?? source.sourceId ?? '未命名来源',
    }))),
    timeline,
    title: today > input.trip.endDate ? '旅行结束报告' : '截至当前的旅行消费档案',
  }
}

export function openLedgerPrintReport(input: LedgerReportInput) {
  const popup = window.open('', '_blank', 'noopener,noreferrer')
  if (!popup) throw new Error('浏览器阻止了报告窗口，请允许弹出窗口后重试。')
  popup.document.open()
  popup.document.write(buildLedgerReportHtml(input))
  popup.document.close()
  popup.addEventListener('load', () => popup.print(), { once: true })
}

export async function downloadLedgerArchive(input: LedgerReportInput) {
  const JSZip = (await import('jszip')).default
  const model = buildLedgerReportModel(input)
  const zip = new JSZip()
  zip.file('账单.csv', buildExpenseCsv(input.expenses))
  zip.file('账单明细.csv', buildLineItemCsv(input.expenses))
  zip.file('消费时间线.csv', buildTimelineCsv(model))
  zip.file('按日期汇总.csv', buildGroupCsv(model.byDate, input.settings.tripCurrency))
  zip.file('按城市汇总.csv', buildGroupCsv(model.byCity, input.settings.tripCurrency))
  zip.file('按类别汇总.csv', buildGroupCsv(model.byCategory, input.settings.tripCurrency))
  zip.file('来源清单.csv', buildSourceCsv(model, input.trip.id))
  zip.file('旅行消费报告.html', buildLedgerReportHtml(input, model))
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${safeFileName(input.trip.title, 'trip')}-旅行消费档案.zip`)
}

export function buildLedgerReportHtml(input: LedgerReportInput, model = buildLedgerReportModel(input)) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(input.trip.title)} · ${model.title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#17202a;margin:40px;line-height:1.55}h1,h2{margin:0 0 12px}h2{margin-top:28px;font-size:18px;border-bottom:1px solid #d8dee4;padding-bottom:8px}.muted{color:#667085}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{border:1px solid #d8dee4;padding:12px}.metric strong{display:block;font-size:18px;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-bottom:1px solid #e7ebef;padding:8px 6px;vertical-align:top}.warning{color:#9a6700}@media print{body{margin:18mm}.no-print{display:none}}</style></head><body>
<h1>${escapeHtml(input.trip.title)} · ${model.title}</h1><p class="muted">${escapeHtml(input.trip.destination)} · ${input.trip.startDate} 至 ${input.trip.endDate}</p>
<section class="metrics"><div class="metric">预算<strong>${formatLedgerMoney(model.budgetMinor, input.settings.tripCurrency)}</strong></div><div class="metric">已确认净支出<strong>${formatLedgerMoney(model.confirmedNetMinor, input.settings.tripCurrency)}</strong></div><div class="metric">预计最终支出<strong>${formatLedgerMoney(model.projectedMinor, input.settings.tripCurrency)}</strong></div><div class="metric">待确认<strong>${formatLedgerMoney(model.pendingMinor, input.settings.tripCurrency)}</strong></div></section>
${groupTable('日期摘要', model.byDate, input.settings.tripCurrency)}
${groupTable('城市摘要', model.byCity, input.settings.tripCurrency)}
${groupTable('类别摘要', model.byCategory, input.settings.tripCurrency)}
<h2>消费时间线</h2><table><thead><tr><th>日期</th><th>账单</th><th>城市</th><th>折算金额</th><th>应用内回链</th></tr></thead><tbody>${model.timeline.map((row) => `<tr><td>${row.date}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.city ?? '')}</td><td>${formatLedgerMoney(row.amountMinor, input.settings.tripCurrency)}</td><td>ledger/expense:${escapeHtml(row.expenseId)}</td></tr>`).join('')}</tbody></table>
<h2>重要订单与账单</h2>${model.largestExpenses.length ? `<table><thead><tr><th>日期</th><th>账单</th><th>类别</th><th>城市</th><th>金额</th></tr></thead><tbody>${model.largestExpenses.map(({ expense, amountMinor }) => `<tr><td>${expense.date}</td><td>${escapeHtml(expense.title)}</td><td>${ledgerCategoryLabels[expense.category]}</td><td>${escapeHtml(expense.city ?? '')}</td><td>${formatLedgerMoney(amountMinor, input.settings.tripCurrency)}</td></tr>`).join('')}</tbody></table>` : '<p>暂无可换算的已确认账单。</p>'}
<h2>退款与取消</h2>${model.refunds.length || model.cancellations.length ? `<p>退款 ${model.refunds.length} 笔，取消订单 ${model.cancellations.length} 笔。</p>` : '<p>没有退款或取消记录。</p>'}
<h2>完整性检查</h2>${model.issues.length ? `<ul>${model.issues.map((issue) => `<li class="warning">${escapeHtml(issue.message)}</li>`).join('')}</ul>` : '<p>未发现需要处理的完整性问题。</p>'}
${model.missingExchangeRate.length ? `<p class="warning">${model.missingExchangeRate.length} 笔已确认费用缺少汇率，未纳入折算汇总：${model.missingExchangeRate.map((expense) => escapeHtml(expense.title)).join('、')}</p>` : ''}
<h2>来源索引</h2><table><thead><tr><th>账单</th><th>来源角色</th><th>来源</th><th>可用</th><th>应用内回链</th></tr></thead><tbody>${model.sourceIndex.map((source) => `<tr><td>${escapeHtml(source.expenseTitle)}</td><td>${source.role}</td><td>${escapeHtml(source.title)}</td><td>${source.available ? '是' : '否'}</td><td>ledger/expense:${escapeHtml(source.expenseId)}</td></tr>`).join('')}</tbody></table>
</body></html>`
}

function groupIncluded(rows: Array<{ expense: LedgerExpense; amountMinor: number }>, keyOf: (expense: LedgerExpense) => string, labelOf: (key: string) => string) {
  const groups = new Map<string, LedgerReportGroup>()
  for (const row of rows) {
    const key = keyOf(row.expense)
    const current = groups.get(key) ?? { amountMinor: 0, count: 0, key, label: labelOf(key) }
    current.amountMinor += row.amountMinor
    current.count += 1
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor) || left.label.localeCompare(right.label))
}

function groupTimeline(rows: LedgerReportTimelineRow[]) {
  const groups = new Map<string, LedgerReportGroup>()
  for (const row of rows) {
    const current = groups.get(row.date) ?? { amountMinor: 0, count: 0, key: row.date, label: row.date }
    current.amountMinor += row.amountMinor
    current.count += 1
    groups.set(row.date, current)
  }
  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function groupTable(title: string, groups: LedgerReportGroup[], currency: string) {
  return `<h2>${title}</h2>${groups.length ? `<table><thead><tr><th>项目</th><th>笔数</th><th>净额</th></tr></thead><tbody>${groups.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${formatLedgerMoney(row.amountMinor, currency)}</td></tr>`).join('')}</tbody></table>` : '<p>暂无可换算的已确认账单。</p>'}`
}

function buildExpenseCsv(expenses: LedgerExpense[]) {
  return toCsv([
    ['账单ID', '日期', '名称', '类别', '商户', '城市', '金额最小单位', '币种', '状态', '审核状态', '付款状态', '订单状态', '订单号', '预订时间', '付款时间', '使用开始', '使用结束'],
    ...expenses.map((expense) => [expense.id, expense.date, expense.title, expense.category, expense.merchant, expense.city, expense.amountMinor, expense.currency, expense.status, expense.reviewStatus, expense.paymentStatus, expense.orderStatus, expense.orderNumber, expense.bookedAt, expense.paidAt, expense.serviceStartAt, expense.serviceEndAt]),
  ])
}

function buildLineItemCsv(expenses: LedgerExpense[]) {
  return toCsv([
    ['账单ID', '明细ID', '名称', '类型', '类别', '金额最小单位', '币种'],
    ...expenses.flatMap((expense) => (expense.lineItems ?? []).map((item) => [expense.id, item.id, item.title, item.kind, item.category, item.amountMinor, item.currency])),
  ])
}

function buildTimelineCsv(model: LedgerReportModel) {
  return toCsv([
    ['日期', '账单ID', '账单名称', '城市', '折算金额最小单位'],
    ...model.timeline.map((row) => [row.date, row.expenseId, row.title, row.city, row.amountMinor]),
  ])
}

function buildGroupCsv(groups: LedgerReportGroup[], currency: string) {
  return toCsv([['项目', '笔数', '净额最小单位', '币种'], ...groups.map((row) => [row.label, row.count, row.amountMinor, currency])])
}

function buildSourceCsv(model: LedgerReportModel, tripId: string) {
  return toCsv([
    ['账单ID', '账单名称', '来源ID', '来源类型', '来源角色', '来源标题', '采集时间', '可用', '应用内回链'],
    ...model.sourceIndex.map((source) => [source.expenseId, source.expenseTitle, source.sourceId, source.kind, source.role, source.title, source.capturedAt, source.available ? '是' : '否', `#/ledger/expense?tripId=${encodeURIComponent(tripId)}&expenseId=${encodeURIComponent(source.expenseId)}`]),
  ])
}

export function toCsv(rows: Array<Array<unknown>>) {
  return `\uFEFF${rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')}`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
