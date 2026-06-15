import type { LedgerBudget, LedgerExpense, LedgerParticipant, LedgerSettings, Trip } from '../types'
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
  const zip = new JSZip()
  zip.file('账单.csv', buildExpenseCsv(input.expenses))
  zip.file('账单明细.csv', buildLineItemCsv(input.expenses))
  zip.file('来源清单.csv', buildSourceCsv(input.expenses))
  zip.file('旅行消费报告.html', buildLedgerReportHtml(input))
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${safeFileName(input.trip.title, 'trip')}-旅行账单档案.zip`)
}

export function buildLedgerReportHtml(input: LedgerReportInput) {
  const summary = buildLedgerSummary(input)
  const forecast = buildLedgerForecast(input)
  const issues = buildLedgerIntegrityIssues(input.expenses)
  const confirmed = input.expenses.filter((expense) => expense.status === 'confirmed')
  const byCategory = Object.entries(ledgerCategoryLabels).map(([category, label]) => ({
    label,
    total: confirmed.filter((expense) => expense.category === category).reduce((sum, expense) => sum + (convertExpenseMinor(expense, input.settings.tripCurrency) ?? 0), 0),
  })).filter((row) => row.total !== 0)
  const largest = confirmed.map((expense) => ({ expense, amount: convertExpenseMinor(expense, input.settings.tripCurrency) ?? 0 })).sort((first, second) => second.amount - first.amount)[0]
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(input.trip.title)} · 旅行消费报告</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#17202a;margin:40px;line-height:1.55}h1,h2{margin:0 0 12px}h2{margin-top:28px;font-size:18px;border-bottom:1px solid #d8dee4;padding-bottom:8px}.muted{color:#667085}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{border:1px solid #d8dee4;padding:12px}.metric strong{display:block;font-size:18px;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-bottom:1px solid #e7ebef;padding:8px 6px;vertical-align:top}.warning{color:#9a6700}@media print{body{margin:18mm}.no-print{display:none}}</style></head><body>
<h1>${escapeHtml(input.trip.title)} · 旅行消费报告</h1><p class="muted">${escapeHtml(input.trip.destination)} · ${input.trip.startDate} 至 ${input.trip.endDate}</p>
<section class="metrics"><div class="metric">预算<strong>${formatLedgerMoney(summary.budgetMinor, input.settings.tripCurrency)}</strong></div><div class="metric">实际净支出<strong>${formatLedgerMoney(summary.spentTripMinor, input.settings.tripCurrency)}</strong></div><div class="metric">预计最终支出<strong>${formatLedgerMoney(forecast.projectedMinor, input.settings.tripCurrency)}</strong></div><div class="metric">待确认<strong>${formatLedgerMoney(summary.pendingTripMinor, input.settings.tripCurrency)}</strong></div></section>
<h2>类别摘要</h2><table><thead><tr><th>类别</th><th>金额</th></tr></thead><tbody>${byCategory.map((row) => `<tr><td>${row.label}</td><td>${formatLedgerMoney(row.total, input.settings.tripCurrency)}</td></tr>`).join('')}</tbody></table>
<h2>重要账单</h2><p>${largest ? `最大支出为「${escapeHtml(largest.expense.title)}」，${formatLedgerMoney(largest.amount, input.settings.tripCurrency)}。` : '暂无已确认账单。'}</p>
<table><thead><tr><th>日期</th><th>账单</th><th>类别</th><th>城市</th><th>金额</th><th>订单号</th></tr></thead><tbody>${input.expenses.map((expense) => `<tr><td>${expense.date}</td><td>${escapeHtml(expense.title)}</td><td>${ledgerCategoryLabels[expense.category]}</td><td>${escapeHtml(expense.city ?? '')}</td><td>${formatLedgerMoney(expense.amountMinor, expense.currency ?? input.settings.tripCurrency)}</td><td>${escapeHtml(expense.orderNumber ?? '')}</td></tr>`).join('')}</tbody></table>
<h2>完整性检查</h2>${issues.length ? `<ul>${issues.map((issue) => `<li class="warning">${escapeHtml(issue.message)}</li>`).join('')}</ul>` : '<p>未发现需要处理的完整性问题。</p>'}
<h2>来源索引</h2><table><thead><tr><th>账单</th><th>来源角色</th><th>来源</th><th>可用</th></tr></thead><tbody>${input.expenses.flatMap((expense) => getLedgerSourceLinks(expense).map((source) => `<tr><td>${escapeHtml(expense.title)}</td><td>${source.role}</td><td>${escapeHtml(source.title ?? source.label ?? source.sourceId ?? '')}</td><td>${source.available === false ? '否' : '是'}</td></tr>`)).join('')}</tbody></table>
</body></html>`
}

function buildExpenseCsv(expenses: LedgerExpense[]) {
  return toCsv([
    ['账单ID', '日期', '名称', '类别', '商户', '城市', '金额最小单位', '币种', '状态', '付款状态', '订单状态', '订单号', '预订时间', '付款时间', '使用开始', '使用结束'],
    ...expenses.map((expense) => [expense.id, expense.date, expense.title, expense.category, expense.merchant, expense.city, expense.amountMinor, expense.currency, expense.status, expense.paymentStatus, expense.orderStatus, expense.orderNumber, expense.bookedAt, expense.paidAt, expense.serviceStartAt, expense.serviceEndAt]),
  ])
}

function buildLineItemCsv(expenses: LedgerExpense[]) {
  return toCsv([
    ['账单ID', '明细ID', '名称', '类型', '类别', '金额最小单位', '币种'],
    ...expenses.flatMap((expense) => (expense.lineItems ?? []).map((item) => [expense.id, item.id, item.title, item.kind, item.category, item.amountMinor, item.currency])),
  ])
}

function buildSourceCsv(expenses: LedgerExpense[]) {
  return toCsv([
    ['账单ID', '账单名称', '来源ID', '来源类型', '来源角色', '来源标题', '可用'],
    ...expenses.flatMap((expense) => getLedgerSourceLinks(expense).map((source) => [expense.id, expense.title, source.sourceId, source.kind, source.role, source.title ?? source.label, source.available === false ? '否' : '是'])),
  ])
}

function toCsv(rows: Array<Array<unknown>>) {
  return `\uFEFF${rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')}`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
